import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_QUOTA_GROUP_VISIBILITY,
  QUOTA_GROUP_VISIBILITY_CHANGE_EVENT,
  QUOTA_GROUP_VISIBILITY_STORAGE_KEY,
  readQuotaGroupVisibility,
  saveQuotaGroupVisibility,
  type QuotaGroupVisibility,
} from '../utils/quota-group-visibility';

export function useQuotaGroupVisibility() {
  const [visibility, setVisibilityState] = useState<QuotaGroupVisibility>(() => {
    if (typeof window === 'undefined') {
      return DEFAULT_QUOTA_GROUP_VISIBILITY;
    }
    return readQuotaGroupVisibility(() => window.localStorage);
  });

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const syncFromStorage = () => {
      setVisibilityState(readQuotaGroupVisibility(() => window.localStorage));
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === QUOTA_GROUP_VISIBILITY_STORAGE_KEY) {
        syncFromStorage();
      }
    };

    window.addEventListener(QUOTA_GROUP_VISIBILITY_CHANGE_EVENT, syncFromStorage);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(QUOTA_GROUP_VISIBILITY_CHANGE_EVENT, syncFromStorage);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const setVisibility = useCallback(
    (
      nextOrUpdater:
        | QuotaGroupVisibility
        | ((current: QuotaGroupVisibility) => QuotaGroupVisibility),
    ) => {
      setVisibilityState((current) => {
        const next =
          typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
        if (typeof window !== 'undefined') {
          saveQuotaGroupVisibility(() => window.localStorage, next);
        }
        return next;
      });
    },
    [],
  );

  return [visibility, setVisibility] as const;
}
