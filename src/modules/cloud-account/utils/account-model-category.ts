import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';

export type AccountModelCategory = 'all' | 'gemini-pro' | 'gemini-pro-go' | 'other';
export type ResolvedAccountModelCategory = Exclude<AccountModelCategory, 'all'>;
export type AccountModelCategoryOverrides = Record<string, ResolvedAccountModelCategory>;

const ACCOUNT_MODEL_CATEGORY_STORAGE_KEY = 'agm:account-model-category';
const ACCOUNT_MODEL_CATEGORY_OVERRIDES_STORAGE_KEY = 'agm:account-model-category-overrides';
export const ACCOUNT_MODEL_CATEGORY_OVERRIDES_EVENT = 'agm:account-model-category-overrides-changed';

const PRO_MODEL_PATTERN = /carbon|neon|argon|claude-(?:opus|sonnet)-5-5/i;
const HYDROGEN_PATTERN = /hydrogen/i;

function isResolvedCategory(value: unknown): value is ResolvedAccountModelCategory {
  return value === 'gemini-pro' || value === 'gemini-pro-go' || value === 'other';
}

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
      if (group.description) {
        signals.push(group.description);
      }
      if (group.model_ids) {
        for (const modelId of group.model_ids) {
          signals.push(modelId);
        }
      }
      for (const bucket of group.buckets) {
        if (bucket.bucket_id) {
          signals.push(bucket.bucket_id);
        }
        if (bucket.display_name) {
          signals.push(bucket.display_name);
        }
        if (bucket.description) {
          signals.push(bucket.description);
        }
      }
    }
  }

  return signals;
}

/**
 * Classifies an account based on the model families available in its quota:
 * - Accounts exposing Carbon, Neon, Argon, or Claude 5.5 models belong to `gemini-pro`.
 * - Accounts without those models that expose Hydrogen belong to `gemini-pro-go`.
 * - All remaining accounts fall into `other`.
 */
export function classifyAccountModelCategory(
  account: Pick<CloudAccountView, 'quota'>,
): ResolvedAccountModelCategory {
  const signals = collectAccountModelSignals(account);
  if (signals.some((signal) => PRO_MODEL_PATTERN.test(signal))) {
    return 'gemini-pro';
  }

  if (signals.some((signal) => HYDROGEN_PATTERN.test(signal))) {
    return 'gemini-pro-go';
  }

  return 'other';
}

export interface ResolvedAccountModelCategoryDetails {
  category: ResolvedAccountModelCategory;
  autoCategory: ResolvedAccountModelCategory;
  isManual: boolean;
}

export function resolveAccountModelCategoryDetails(
  account: Partial<Pick<CloudAccountView, 'id'>> & Pick<CloudAccountView, 'quota'>,
  overrides?: AccountModelCategoryOverrides,
): ResolvedAccountModelCategoryDetails {
  const autoCategory = classifyAccountModelCategory(account);
  const override = account.id && overrides ? overrides[account.id] : undefined;
  if (isResolvedCategory(override)) {
    return {
      category: override,
      autoCategory,
      isManual: true,
    };
  }
  return {
    category: autoCategory,
    autoCategory,
    isManual: false,
  };
}

export function resolveAccountModelCategory(
  account: Partial<Pick<CloudAccountView, 'id'>> & Pick<CloudAccountView, 'quota'>,
  overrides?: AccountModelCategoryOverrides,
): ResolvedAccountModelCategory {
  return resolveAccountModelCategoryDetails(account, overrides).category;
}

export function countAccountsByModelCategory<
  T extends Partial<Pick<CloudAccountView, 'id'>> & Pick<CloudAccountView, 'quota'>,
>(
  accounts: readonly T[],
  overrides?: AccountModelCategoryOverrides,
): Record<AccountModelCategory, number> {
  const counts: Record<AccountModelCategory, number> = {
    all: accounts.length,
    'gemini-pro': 0,
    'gemini-pro-go': 0,
    other: 0,
  };

  for (const account of accounts) {
    counts[resolveAccountModelCategory(account, overrides)] += 1;
  }

  return counts;
}

export function filterAccountsByModelCategory<
  T extends Partial<Pick<CloudAccountView, 'id'>> & Pick<CloudAccountView, 'quota'>,
>(
  accounts: readonly T[],
  category: AccountModelCategory,
  overrides?: AccountModelCategoryOverrides,
): T[] {
  if (category === 'all') {
    return [...accounts];
  }

  return accounts.filter((account) => resolveAccountModelCategory(account, overrides) === category);
}

export function readAccountModelCategoryOverrides(
  getStorage: () => Pick<Storage, 'getItem'> | undefined,
): AccountModelCategoryOverrides {
  try {
    const raw = getStorage()?.getItem(ACCOUNT_MODEL_CATEGORY_OVERRIDES_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const overrides: AccountModelCategoryOverrides = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (key && isResolvedCategory(value)) {
        overrides[key] = value;
      }
    }
    return overrides;
  } catch {
    return {};
  }
}

export function saveAccountModelCategoryOverrides(
  getStorage: () => Pick<Storage, 'setItem'> | undefined,
  overrides: AccountModelCategoryOverrides,
): void {
  try {
    getStorage()?.setItem(ACCOUNT_MODEL_CATEGORY_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(ACCOUNT_MODEL_CATEGORY_OVERRIDES_EVENT));
    }
  } catch {
    // Ignore storage write failures in restricted renderer contexts.
  }
}

export function setAccountModelCategoryOverride(
  getStorage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined,
  accountId: string,
  category: ResolvedAccountModelCategory | 'auto',
): AccountModelCategoryOverrides {
  const current = readAccountModelCategoryOverrides(getStorage);
  const next: AccountModelCategoryOverrides = { ...current };
  if (category === 'auto') {
    delete next[accountId];
  } else {
    next[accountId] = category;
  }
  saveAccountModelCategoryOverrides(getStorage, next);
  return next;
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
