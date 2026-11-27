import { describe, expect, it } from 'vitest';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import {
  classifyAccountModelCategory,
  countAccountsByModelCategory,
  filterAccountsByModelCategory,
  readAccountModelCategoryOverrides,
  resolveAccountModelCategory,
  setAccountModelCategoryOverride,
} from '@/modules/cloud-account/utils/account-model-category';

function makeAccount(
  id: string,
  models: Record<string, { display_name?: string; percentage: number }> = {},
  quotaGroups: Array<{ display_name: string; bucket_id: string; description?: string }> = [],
): Pick<CloudAccountView, 'id' | 'quota'> {
  return {
    id,
    quota: {
      models: Object.fromEntries(
        Object.entries(models).map(([key, value]) => [
          key,
          {
            percentage: value.percentage,
            resetTime: '2026-12-01T00:00:00Z',
            display_name: value.display_name,
          },
        ]),
      ),
      quota_groups: quotaGroups.map((group) => ({
        display_name: group.display_name,
        description: group.description,
        buckets: [
          {
            bucket_id: group.bucket_id,
            window: '5h',
            remaining_fraction: 1,
            reset_time: '2026-12-01T00:00:00Z',
          },
        ],
      })),
    },
  };
}

function createMemoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

describe('account model category classification', () => {
  it('classifies accounts with Carbon, Neon, Argon, or Claude 5.5 models as Gemini Pro', () => {
    const withCarbon = makeAccount('a1', { 'gemini-4-carbon-high': { percentage: 80 } });
    const withNeon = makeAccount('a2', {
      'models/custom-model': { display_name: 'Gemini 4 Neon (Medium)', percentage: 60 },
    });
    const withBothCarbonAndHydrogen = makeAccount('a3', {
      'gemini-4-hydrogen': { percentage: 90 },
      'gemini-4-neon': { percentage: 50 },
    });
    const withGroupDescription = makeAccount(
      'a4',
      { 'gemini-3-flash': { percentage: 100 } },
      [
        {
          display_name: 'Gemini Models',
          bucket_id: 'gemini-5h',
          description:
            'Models within this group: Gemini 4 Neon, Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Gemini 3.8 Flash',
        },
      ],
    );
    const withArgonFallback = makeAccount('a5', {
      'gemini-4-argon-high': { percentage: 0 },
      'claude-opus-5-5-high': { percentage: 100 },
    });

    expect(classifyAccountModelCategory(withCarbon)).toBe('gemini-pro');
    expect(classifyAccountModelCategory(withNeon)).toBe('gemini-pro');
    expect(classifyAccountModelCategory(withBothCarbonAndHydrogen)).toBe('gemini-pro');
    expect(classifyAccountModelCategory(withGroupDescription)).toBe('gemini-pro');
    expect(classifyAccountModelCategory(withArgonFallback)).toBe('gemini-pro');
  });

  it('classifies Hydrogen-only accounts as Gemini Pro Go', () => {
    const hydrogenModel = makeAccount('b1', { 'gemini-4-hydrogen-medium': { percentage: 95 } });
    const hydrogenGroup = makeAccount('b2', {}, [
      { display_name: 'Gemini 4 Hydrogen', bucket_id: 'hydrogen-bucket' },
    ]);
    const hydrogenGroupDescription = makeAccount(
      'b3',
      { 'gemini-3-flash': { percentage: 100 } },
      [
        {
          display_name: 'Gemini Models',
          bucket_id: 'gemini-5h',
          description: 'Models within this group: Gemini 4 Hydrogen, Gemini 3.8 Flash',
        },
      ],
    );

    expect(classifyAccountModelCategory(hydrogenModel)).toBe('gemini-pro-go');
    expect(classifyAccountModelCategory(hydrogenGroup)).toBe('gemini-pro-go');
    expect(classifyAccountModelCategory(hydrogenGroupDescription)).toBe('gemini-pro-go');
  });

  it('counts and filters accounts accurately across categories and manual overrides', () => {
    const proAccount = makeAccount('pro', { 'gemini-4-neon': { percentage: 100 } });
    const goAccount = makeAccount('go', { 'gemini-4-hydrogen': { percentage: 100 } });
    const otherAccount = makeAccount('other', { 'gemini-3-flash': { percentage: 100 } });
    const pool = [proAccount, goAccount, otherAccount];

    expect(countAccountsByModelCategory(pool)).toEqual({
      all: 3,
      'gemini-pro': 1,
      'gemini-pro-go': 1,
      other: 1,
    });

    expect(filterAccountsByModelCategory(pool, 'all')).toHaveLength(3);
    expect(filterAccountsByModelCategory(pool, 'gemini-pro')).toEqual([proAccount]);
    expect(filterAccountsByModelCategory(pool, 'gemini-pro-go')).toEqual([goAccount]);
    expect(filterAccountsByModelCategory(pool, 'other')).toEqual([otherAccount]);

    const storage = createMemoryStorage();
    const afterOverride = setAccountModelCategoryOverride(() => storage, 'other', 'gemini-pro-go');
    expect(readAccountModelCategoryOverrides(() => storage)).toEqual({ other: 'gemini-pro-go' });
    expect(resolveAccountModelCategory(otherAccount, afterOverride)).toBe('gemini-pro-go');
    expect(countAccountsByModelCategory(pool, afterOverride)).toEqual({
      all: 3,
      'gemini-pro': 1,
      'gemini-pro-go': 2,
      other: 0,
    });
    expect(filterAccountsByModelCategory(pool, 'gemini-pro-go', afterOverride)).toEqual([
      goAccount,
      otherAccount,
    ]);

    const afterReset = setAccountModelCategoryOverride(() => storage, 'other', 'auto');
    expect(afterReset).toEqual({});
    expect(resolveAccountModelCategory(otherAccount, afterReset)).toBe('other');
  });
});
