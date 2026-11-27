import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';

export type AccountModelCategory = 'all' | 'gemini-pro' | 'gemini-pro-go' | 'other';
export type ResolvedAccountModelCategory = Exclude<AccountModelCategory, 'all'>;

const ACCOUNT_MODEL_CATEGORY_STORAGE_KEY = 'agm:account-model-category';
const CARBON_OR_NEON_PATTERN = /carbon|neon/i;
const HYDROGEN_PATTERN = /hydrogen/i;

function collectAccountModelSignals(account: Pick<CloudAccountView, 'quota'>): string[] {
  const signals: string[] = [];
  const models = account.quota?.models;
  if (models) {
    for (const [modelId, info] of Object.entries(models)) {
      signals.push(modelId);
      if (info?.display_name) {
        signals.push(info.display_name);
      }
    }
  }

  const groups = account.quota?.quota_groups;
  if (groups) {
    for (const group of groups) {
      if (group.display_name) {
        signals.push(group.display_name);
      }
      for (const bucket of group.buckets) {
        if (bucket.bucket_id) {
          signals.push(bucket.bucket_id);
        }
      }
    }
  }

  return signals;
}

/**
 * Classifies an account based on the model families available in its quota:
 * - Accounts exposing Carbon or Neon models belong to `gemini-pro`.
 * - Accounts without Carbon/Neon that expose Hydrogen belong to `gemini-pro-go`.
 * - All remaining accounts (e.g. unrefreshed or non-Gemini-4) fall into `other`.
 */
export function classifyAccountModelCategory(
  account: Pick<CloudAccountView, 'quota'>,
): ResolvedAccountModelCategory {
  const signals = collectAccountModelSignals(account);
  if (signals.some((signal) => CARBON_OR_NEON_PATTERN.test(signal))) {
    return 'gemini-pro';
  }

  if (signals.some((signal) => HYDROGEN_PATTERN.test(signal))) {
    return 'gemini-pro-go';
  }

  return 'other';
}

export function countAccountsByModelCategory<T extends Pick<CloudAccountView, 'quota'>>(
  accounts: readonly T[],
): Record<AccountModelCategory, number> {
  const counts: Record<AccountModelCategory, number> = {
    all: accounts.length,
    'gemini-pro': 0,
    'gemini-pro-go': 0,
    other: 0,
  };

  for (const account of accounts) {
    counts[classifyAccountModelCategory(account)] += 1;
  }

  return counts;
}

export function filterAccountsByModelCategory<T extends Pick<CloudAccountView, 'quota'>>(
  accounts: readonly T[],
  category: AccountModelCategory,
): T[] {
  if (category === 'all') {
    return [...accounts];
  }

  return accounts.filter((account) => classifyAccountModelCategory(account) === category);
}

export function readAccountModelCategoryPreference(
  getStorage: () => Pick<Storage, 'getItem'> | undefined,
): AccountModelCategory {
  try {
    const value = getStorage()?.getItem(ACCOUNT_MODEL_CATEGORY_STORAGE_KEY);
    if (value === 'gemini-pro' || value === 'gemini-pro-go' || value === 'other') {
      return value;
    }
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveAccountModelCategoryPreference(
  getStorage: () => Pick<Storage, 'setItem'> | undefined,
  category: AccountModelCategory,
): void {
  try {
    getStorage()?.setItem(ACCOUNT_MODEL_CATEGORY_STORAGE_KEY, category);
  } catch {
    // Ignore storage write failures in restricted renderer contexts.
  }
}
