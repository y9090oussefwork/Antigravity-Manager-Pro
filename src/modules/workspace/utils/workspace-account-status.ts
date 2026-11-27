import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';

export type WorkspaceAccountStatus = 'active' | 'available' | 'exhausted' | 'unavailable';
export type WorkspaceAccountStatusFilter = 'all' | 'available' | 'active' | 'exhausted';

export interface WorkspaceAccountStatusInput {
  id: string;
  status?: CloudAccountView['status'];
  status_reason?: CloudAccountView['status_reason'];
  health?: CloudAccountView['health'];
  quota?: {
    is_forbidden?: boolean;
    models?: Record<string, { percentage: number }>;
  };
}

const WORKSPACE_EXHAUSTED_THRESHOLD_PERCENT = 5;

export function getWorkspaceAccountMinQuotaPercentage(
  quota?: { models?: Record<string, { percentage: number }> } | null,
): number | null {
  const models = quota?.models ? Object.values(quota.models) : [];
  if (models.length === 0) {
    return null;
  }

  let min = 100;
  for (const model of models) {
    if (model.percentage < min) {
      min = model.percentage;
    }
  }
  return min;
}

export function classifyWorkspaceAccountStatus(
  account: WorkspaceAccountStatusInput,
  activeAccountId: string,
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

  const minPercentage = getWorkspaceAccountMinQuotaPercentage(account.quota);
  if (minPercentage !== null && minPercentage <= WORKSPACE_EXHAUSTED_THRESHOLD_PERCENT) {
    return 'exhausted';
  }

  return 'available';
}

export function getWorkspaceAccountStatusCounts<T extends WorkspaceAccountStatusInput>(
  accounts: readonly T[],
  activeAccountId: string,
): Record<WorkspaceAccountStatusFilter, number> {
  const counts: Record<WorkspaceAccountStatusFilter, number> = {
    all: accounts.length,
    available: 0,
    active: 0,
    exhausted: 0,
  };

  for (const account of accounts) {
    const status = classifyWorkspaceAccountStatus(account, activeAccountId);
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
): T[] {
  if (filter === 'all') {
    return [...accounts];
  }

  return accounts.filter((account) => {
    const status = classifyWorkspaceAccountStatus(account, activeAccountId);
    if (filter === 'exhausted') {
      return status === 'exhausted' || status === 'unavailable';
    }
    return status === filter;
  });
}
