import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import { isWeeklyQuotaBucket } from '@/modules/cloud-account/utils/quota-groups';
import {
  DEFAULT_QUOTA_GROUP_VISIBILITY,
  quotaFamily,
  type QuotaGroupVisibility,
} from '@/modules/cloud-account/utils/quota-group-visibility';

export type WorkspaceAccountStatus = 'active' | 'available' | 'exhausted' | 'unavailable';
export type WorkspaceAccountStatusFilter = 'all' | 'available' | 'active' | 'exhausted';

export interface WorkspaceQuotaBucketInput {
  bucket_id?: string;
  window?: string;
  display_name?: string;
  description?: string;
  remaining_fraction: number;
}

export interface WorkspaceQuotaGroupInput {
  display_name?: string;
  description?: string;
  buckets?: WorkspaceQuotaBucketInput[];
}

export interface WorkspaceAccountStatusInput {
  id: string;
  status?: CloudAccountView['status'];
  status_reason?: CloudAccountView['status_reason'];
  health?: CloudAccountView['health'];
  quota?: {
    is_forbidden?: boolean;
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  };
}

export interface FamilyWindowQuota {
  fiveHour: number | null;
  weekly: number | null;
}

export interface WorkspaceAccountWindowQuota {
  fiveHour: number | null;
  weekly: number | null;
  gemini: FamilyWindowQuota;
  claude: FamilyWindowQuota;
  effectiveMin: number | null;
}

const WORKSPACE_EXHAUSTED_THRESHOLD_PERCENT = 5;
const DEDICATED_ARGON_PATTERN = /argon/i;
const ARGON_MODEL_ID_PATTERN = /^(?:models\/)?gemini-4-argon/i;

function isDedicatedArgonGroup(group: WorkspaceQuotaGroupInput): boolean {
  if (group.display_name && DEDICATED_ARGON_PATTERN.test(group.display_name)) {
    return true;
  }
  const buckets = group.buckets ?? [];
  return (
    buckets.length > 0 &&
    buckets.every((bucket) => Boolean(bucket.bucket_id && DEDICATED_ARGON_PATTERN.test(bucket.bucket_id)))
  );
}

function minOption(current: number | null, next: number): number {
  return current === null ? next : Math.min(current, next);
}

export function getWorkspaceAccountWindowQuota(
  quota?: {
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): WorkspaceAccountWindowQuota {
  const gemini: FamilyWindowQuota = { fiveHour: null, weekly: null };
  const claude: FamilyWindowQuota = { fiveHour: null, weekly: null };
  let fiveHour: number | null = null;
  let weekly: number | null = null;
  let effectiveMin: number | null = null;

  const groups = quota?.quota_groups ?? [];
  let sawGroupBucket = false;

  for (const group of groups) {
    if (isDedicatedArgonGroup(group)) {
      continue;
    }
    for (const bucket of group.buckets ?? []) {
      const bucketMeta = [bucket.bucket_id, bucket.display_name, bucket.description]
        .filter(Boolean)
        .join(' ');
      const groupMeta = [group.display_name, group.description].filter(Boolean).join(' ');
      const detected = quotaFamily(bucketMeta);
      const family = detected === undefined ? quotaFamily(groupMeta) : detected;
      const isWeekly = isWeeklyQuotaBucket({
        bucket_id: bucket.bucket_id ?? '',
        window: bucket.window ?? '',
        remaining_fraction: bucket.remaining_fraction,
        reset_time: '',
        ...(bucket.display_name ? { display_name: bucket.display_name } : {}),
        ...(bucket.description ? { description: bucket.description } : {}),
      });
      const windowKey = isWeekly ? 'weekly' : 'fiveHour';

      if (family != null && !visibility[windowKey][family]) {
        continue;
      }

      sawGroupBucket = true;
      const pct = Math.round(bucket.remaining_fraction * 100);
      effectiveMin = minOption(effectiveMin, pct);

      if (isWeekly) {
        weekly = minOption(weekly, pct);
      } else {
        fiveHour = minOption(fiveHour, pct);
      }

      if (family === 'gemini') {
        gemini[windowKey] = minOption(gemini[windowKey], pct);
      } else if (family === 'claude') {
        claude[windowKey] = minOption(claude[windowKey], pct);
      }
    }
  }

  const entries = quota?.models ? Object.entries(quota.models) : [];
  if (!sawGroupBucket && entries.length > 0) {
    const nonArgonEntries = entries.filter(([modelId]) => !ARGON_MODEL_ID_PATTERN.test(modelId));
    const targetEntries = nonArgonEntries.length > 0 ? nonArgonEntries : entries;

    for (const [modelId, model] of targetEntries) {
      const family = quotaFamily(modelId);
      if (family != null && !visibility.fiveHour[family]) {
        continue;
      }
      const pct = Math.round(model.percentage);
      effectiveMin = minOption(effectiveMin, pct);
      fiveHour = minOption(fiveHour, pct);
      if (family === 'gemini') {
        gemini.fiveHour = minOption(gemini.fiveHour, pct);
      } else if (family === 'claude') {
        claude.fiveHour = minOption(claude.fiveHour, pct);
      }
    }
  }

  return {
    fiveHour,
    weekly,
    gemini,
    claude,
    effectiveMin,
  };
}

export function getWorkspaceAccountMinQuotaPercentage(
  quota?: {
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): number | null {
  return getWorkspaceAccountWindowQuota(quota, visibility).effectiveMin;
}

export function getWorkspaceAccountQuotaBreakdown(
  quota?: {
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): { gemini?: number; claude?: number } {
  const summary = getWorkspaceAccountWindowQuota(quota, visibility);
  const geminiVals = [summary.gemini.fiveHour, summary.gemini.weekly].filter(
    (v): v is number => v !== null,
  );
  const claudeVals = [summary.claude.fiveHour, summary.claude.weekly].filter(
    (v): v is number => v !== null,
  );

  return {
    ...(geminiVals.length > 0 ? { gemini: Math.min(...geminiVals) } : {}),
    ...(claudeVals.length > 0 ? { claude: Math.min(...claudeVals) } : {}),
  };
}

export function formatWorkspaceAccountQuotaSummary(
  quota?: {
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): string | undefined {
  const summary = getWorkspaceAccountWindowQuota(quota, visibility);
  const formatFamily = (label: string, fw: FamilyWindowQuota): string | null => {
    const pieces: string[] = [];
    if (fw.fiveHour !== null) {
      pieces.push(`5h: ${fw.fiveHour}%`);
    }
    if (fw.weekly !== null) {
      pieces.push(`Weekly: ${fw.weekly}%`);
    }
    return pieces.length > 0 ? `${label} (${pieces.join(' · ')})` : null;
  };

  const parts = [
    formatFamily('Gemini', summary.gemini),
    formatFamily('Claude / GPT', summary.claude),
  ].filter((part): part is string => part !== null);

  if (parts.length > 0) {
    return parts.join(' • ');
  }

  const windowParts: string[] = [];
  if (summary.fiveHour !== null) {
    windowParts.push(`5h: ${summary.fiveHour}%`);
  }
  if (summary.weekly !== null) {
    windowParts.push(`Weekly: ${summary.weekly}%`);
  }
  if (windowParts.length > 0) {
    return windowParts.join(' • ');
  }

  return summary.effectiveMin !== null ? `${summary.effectiveMin}%` : undefined;
}

export function classifyWorkspaceAccountStatus(
  account: WorkspaceAccountStatusInput,
  activeAccountId: string,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): WorkspaceAccountStatus {
  if (account.id === activeAccountId) {
    return 'active';
  }

  const isValidationBlocked =
    account.health?.validation?.status === 'requires_action' ||
    account.status_reason === 'validation_required';
  if (account.status === 'expired' || account.quota?.is_forbidden || isValidationBlocked) {
    return 'unavailable';
  }

  if (account.status === 'rate_limited') {
    return 'exhausted';
  }

  const minPercentage = getWorkspaceAccountMinQuotaPercentage(account.quota, visibility);
  if (minPercentage !== null && minPercentage <= WORKSPACE_EXHAUSTED_THRESHOLD_PERCENT) {
    return 'exhausted';
  }

  return 'available';
}

export function getWorkspaceAccountStatusCounts<T extends WorkspaceAccountStatusInput>(
  accounts: readonly T[],
  activeAccountId: string,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): Record<WorkspaceAccountStatusFilter, number> {
  const counts: Record<WorkspaceAccountStatusFilter, number> = {
    all: accounts.length,
    available: 0,
    active: 0,
    exhausted: 0,
  };

  for (const account of accounts) {
    const status = classifyWorkspaceAccountStatus(account, activeAccountId, visibility);
    if (status === 'active') {
      counts.active += 1;
    } else if (status === 'available') {
      counts.available += 1;
    } else {
      // Group depleted/rate-limited and unavailable accounts under exhausted for quick filtering.
      counts.exhausted += 1;
    }
  }

  return counts;
}

export function filterWorkspaceAccountsByStatus<T extends WorkspaceAccountStatusInput>(
  accounts: readonly T[],
  activeAccountId: string,
  filter: WorkspaceAccountStatusFilter,
  visibility: QuotaGroupVisibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
): T[] {
  if (filter === 'all') {
    return [...accounts];
  }

  return accounts.filter((account) => {
    const status = classifyWorkspaceAccountStatus(account, activeAccountId, visibility);
    if (filter === 'exhausted') {
      return status === 'exhausted' || status === 'unavailable';
    }
    return status === filter;
  });
}
