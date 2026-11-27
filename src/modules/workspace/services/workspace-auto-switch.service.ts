import { CloudAccountRepo } from '@/modules/cloud-account/persistence/cloudHandler';
import { isAccountOAuthRecoveryBlocked } from '@/modules/cloud-account/persistence/oauth-recovery-service';
import { AutoSwitchService } from '@/modules/cloud-account/services/AutoSwitchService';
import type { CloudAccount } from '@/modules/cloud-account/types';
import { logger } from '@/shared/logging/logger';
import { WorkspaceProfileRepo } from '../persistence/workspace-profile-repo';
import type { WorkspaceProfile, WorkspaceProfileStatus } from '../types';
import { getWorkspaceAccountMinQuotaPercentage } from '../utils/workspace-account-status';
import { WorkspaceLifecycleService } from './workspace-lifecycle.service';
import { WorkspaceProfileService } from './workspace-profile.service';

export interface WorkspaceAutoSwitchDependencies {
  listProfiles: () => Promise<WorkspaceProfile[]>;
  getStatuses: (profiles: WorkspaceProfile[]) => Promise<WorkspaceProfileStatus[]>;
  getAccounts: () => Promise<CloudAccount[]>;
  isAccountDepleted: (account: CloudAccount) => boolean;
  isOAuthBlocked: (accountId: string) => boolean;
  switchWorkspaceAccount: (workspaceId: string, accountId: string) => Promise<void>;
}

export interface WorkspaceAutoSwitchResult {
  workspaceId: string;
  fromAccountId: string;
  toAccountId: string;
}

function getAverageQuotaPercentage(account: CloudAccount): number {
  const models = Object.values(account.quota?.models ?? {});
  if (models.length === 0) {
    return 0;
  }
  const sum = models.reduce((total, model) => total + model.percentage, 0);
  return sum / models.length;
}

function pickBestCandidateAccount(
  profile: WorkspaceProfile,
  accountMap: Map<string, CloudAccount>,
  deps: Pick<WorkspaceAutoSwitchDependencies, 'isAccountDepleted' | 'isOAuthBlocked'>,
): CloudAccount | null {
  const accountPoolIds = profile.accountIds ?? [profile.accountId];
  const candidates: CloudAccount[] = [];
  for (const candidateId of accountPoolIds) {
    if (candidateId === profile.accountId) {
      continue;
    }
    const candidate = accountMap.get(candidateId);
    if (!candidate) {
      continue;
    }
    if (deps.isOAuthBlocked(candidate.id)) {
      continue;
    }
    if (candidate.status !== 'active' || !candidate.quota) {
      continue;
    }
    if (deps.isAccountDepleted(candidate)) {
      continue;
    }
    candidates.push(candidate);
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftMin = getWorkspaceAccountMinQuotaPercentage(left.quota) ?? 0;
    const rightMin = getWorkspaceAccountMinQuotaPercentage(right.quota) ?? 0;
    const minDiff = rightMin - leftMin;
    if (minDiff !== 0) {
      return minDiff;
    }
    return getAverageQuotaPercentage(right) - getAverageQuotaPercentage(left);
  });

  return candidates[0] ?? null;
}

export async function checkAndSwitchWorkspacesIfNeeded(
  customDeps?: Partial<WorkspaceAutoSwitchDependencies>,
): Promise<WorkspaceAutoSwitchResult[]> {
  const deps: WorkspaceAutoSwitchDependencies = {
    listProfiles: customDeps?.listProfiles ?? (() => WorkspaceProfileRepo.listProfiles()),
    getStatuses:
      customDeps?.getStatuses ?? ((profiles) => WorkspaceLifecycleService.getStatuses(profiles)),
    getAccounts: customDeps?.getAccounts ?? (() => CloudAccountRepo.getAccounts()),
    isAccountDepleted:
      customDeps?.isAccountDepleted ?? ((account) => AutoSwitchService.isAccountDepleted(account)),
    isOAuthBlocked: customDeps?.isOAuthBlocked ?? isAccountOAuthRecoveryBlocked,
    switchWorkspaceAccount:
      customDeps?.switchWorkspaceAccount ??
      (async (workspaceId, accountId) => {
        await WorkspaceProfileService.update({ id: workspaceId, accountId });
      }),
  };

  const profiles = await deps.listProfiles();
  const eligibleProfiles = profiles.filter(
    (profile) => Boolean(profile.autoSwitchEnabled) && (profile.accountIds?.length ?? 0) > 1,
  );
  if (eligibleProfiles.length === 0) {
    return [];
  }

  const [statuses, accounts] = await Promise.all([
    deps.getStatuses(eligibleProfiles),
    deps.getAccounts(),
  ]);
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const switched: WorkspaceAutoSwitchResult[] = [];

  for (const [index, profile] of eligibleProfiles.entries()) {
    const status = statuses[index];
    if (!status?.running) {
      continue;
    }

    const activeAccount = accountMap.get(profile.accountId);
    const needsSwitch =
      !activeAccount ||
      activeAccount.status !== 'active' ||
      deps.isAccountDepleted(activeAccount);
    if (!needsSwitch) {
      continue;
    }

    const nextAccount = pickBestCandidateAccount(profile, accountMap, deps);
    if (!nextAccount) {
      logger.warn(
        `WorkspaceAutoSwitch: No healthy backup account available in workspace "${profile.name}" (${profile.id})`,
      );
      continue;
    }

    try {
      logger.info(
        `WorkspaceAutoSwitch: Rotating workspace "${profile.name}" from ${activeAccount?.email ?? profile.accountId} to ${nextAccount.email}`,
      );
      await deps.switchWorkspaceAccount(profile.id, nextAccount.id);
      switched.push({
        workspaceId: profile.id,
        fromAccountId: profile.accountId,
        toAccountId: nextAccount.id,
      });
    } catch (error) {
      logger.error(
        `WorkspaceAutoSwitch: Failed to rotate workspace "${profile.name}" (${profile.id})`,
        error,
      );
    }
  }

  return switched;
}
