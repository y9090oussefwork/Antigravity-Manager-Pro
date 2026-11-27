import { useCallback, useEffect, useState } from 'react';
import {
  ACCOUNT_MODEL_CATEGORY_OVERRIDES_EVENT,
  readAccountModelCategoryOverrides,
  setAccountModelCategoryOverride,
  type AccountModelCategoryOverrides,
  type ResolvedAccountModelCategory,
} from '@/modules/cloud-account/utils/account-model-category';

function getLocalStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.localStorage : undefined;
}

export function useAccountModelCategoryOverrides() {
  const [overrides, setOverrides] = useState<AccountModelCategoryOverrides>(() =>
    readAccountModelCategoryOverrides(getLocalStorage),
  );

  useEffect(() => {
    const sync = () => {
      setOverrides(readAccountModelCategoryOverrides(getLocalStorage));
    };

    window.addEventListener(ACCOUNT_MODEL_CATEGORY_OVERRIDES_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(ACCOUNT_MODEL_CATEGORY_OVERRIDES_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const setOverride = useCallback(
    (accountId: string, category: ResolvedAccountModelCategory | 'auto') => {
      const next = setAccountModelCategoryOverride(getLocalStorage, accountId, category);
      setOverrides(next);
    },
    [],
  );

  return { overrides, setOverride };
}
