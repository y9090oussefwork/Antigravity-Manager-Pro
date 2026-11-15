const COMPACT_QUOTA_SUMMARY_STORAGE_KEY = 'agm.cloud.compactQuotaSummary';

export function readCompactQuotaSummaryPreference(
  getStorage: () => Pick<Storage, 'getItem'> | undefined,
): boolean {
  try {
    return getStorage()?.getItem(COMPACT_QUOTA_SUMMARY_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveCompactQuotaSummaryPreference(
  getStorage: () => Pick<Storage, 'setItem'> | undefined,
  enabled: boolean,
): void {
  try {
    getStorage()?.setItem(COMPACT_QUOTA_SUMMARY_STORAGE_KEY, String(enabled));
  } catch {
    // Ignore storage write failures in restricted renderer contexts.
  }
}
