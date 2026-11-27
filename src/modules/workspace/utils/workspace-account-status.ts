import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';

export type WorkspaceAccountStatus = 'active' | 'available' | 'exhausted' | 'unavailable';
export type WorkspaceAccountStatusFilter = 'all' | 'available' | 'active' | 'exhausted';

export interface WorkspaceQuotaBucketInput {
  bucket_id?: string;
  window?: string;
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

export function getWorkspaceAccountMinQuotaPercentage(
  quota?: {
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
): number | null {
  const groups = quota?.quota_groups ?? [];
  const bucketPercentages: number[] = [];
  for (const group of groups) {
    if (isDedicatedArgonGroup(group)) {
      continue;
    }
    for (const bucket of group.buckets ?? []) {
      bucketPercentages.push(Math.round(bucket.remaining_fraction * 100));
    }
  }

  if (bucketPercentages.length > 0) {
    return Math.min(...bucketPercentages);
  }

  const entries = quota?.models ? Object.entries(quota.models) : [];
  if (entries.length === 0) {
    return null;
  }

  const nonArgonEntries = entries.filter(([modelId]) => !ARGON_MODEL_ID_PATTERN.test(modelId));
  const targetEntries = nonArgonEntries.length > 0 ? nonArgonEntries : entries;

  let min = 100;
  for (const [, model] of targetEntries) {
    if (model.percentage < min) {
      min = model.percentage;
    }
  }
  return min;
}

export function getWorkspaceAccountQuotaBreakdown(
  quota?: {
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
): { gemini?: number; claude?: number } {
  const groups = quota?.quota_groups ?? [];
  let geminiMin: number | undefined;
  let claudeMin: number | undefined;

  for (const group of groups) {
    if (isDedicatedArgonGroup(group)) {
      continue;
    }
    const label = `${group.display_name ?? ''} ${group.description ?? ''}`.toLowerCase();
    const percentages = (group.buckets ?? []).map((bucket) =>
      Math.round(bucket.remaining_fraction * 100),
    );
    if (percentages.length === 0) {
      continue;
    }
    const groupMin = Math.min(...percentages);
    if (label.includes('gemini')) {
      geminiMin = geminiMin === undefined ? groupMin : Math.min(geminiMin, groupMin);
    } else if (label.includes('claude') || label.includes('gpt') || label.includes('3p')) {
      claudeMin = claudeMin === undefined ? groupMin : Math.min(claudeMin, groupMin);
    }
  }

  return {
    ...(geminiMin !== undefined ? { gemini: geminiMin } : {}),
    ...(claudeMin !== undefined ? { claude: claudeMin } : {}),
  };
}

export function formatWorkspaceAccountQuotaSummary(
  quota?: {
    models?: Record<string, { percentage: number }>;
    quota_groups?: WorkspaceQuotaGroupInput[];
  } | null,
): string | undefined {
  const breakdown = getWorkspaceAccountQuotaBreakdown(quota);
  const parts: string[] = [];
  if (breakdown.gemini !== undefined) {
    parts.push(`Gemini: ${breakdown.gemini}%`);
  }
  if (breakdown.claude !== undefined) {
    parts.push(`Claude / GPT: ${breakdown.claude}%`);
  }
  if (parts.length > 0) {
    return parts.join(' • ');
  }
  const min = getWorkspaceAccountMinQuotaPercentage(quota);
  return min !== null ? `${min}%` : undefined;
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
