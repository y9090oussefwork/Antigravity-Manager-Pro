import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import type { CloudAccount } from '@/modules/cloud-account/types';
import { WorkspaceProfileRepo } from '@/modules/workspace/persistence/workspace-profile-repo';
import { checkAndSwitchWorkspacesIfNeeded } from '@/modules/workspace/services/workspace-auto-switch.service';
import type { WorkspaceProfile } from '@/modules/workspace/types';
import {
  classifyWorkspaceAccountStatus,
  filterWorkspaceAccountsByStatus,
  getWorkspaceAccountMinQuotaPercentage,
  getWorkspaceAccountStatusCounts,
} from '@/modules/workspace/utils/workspace-account-status';
import { getProfilesBaseDir } from '@/shared/platform/paths';

const fixturePaths = vi.hoisted(() => ({ root: '' }));

vi.mock('@/shared/platform/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/platform/paths')>();
  return {
    ...actual,
    getProfilesBaseDir: () => path.join(fixturePaths.root, 'profiles'),
    getProfileUserDataDir: (profileId: string) =>
      path.join(
        fixturePaths.root,
        'profiles',
        path.basename(actual.getProfileUserDataDir(profileId, { isWsl: false })),
      ),
  };
});

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('better-sqlite3') };
});

function makeViewAccount(
  id: string,
  overrides: Partial<CloudAccountView> & { percentage?: number } = {},
): CloudAccountView {
  const percentage = overrides.percentage ?? 80;
  return {
    id,
    provider: 'google',
    email: `${id}@example.com`,
    status: overrides.status ?? 'active',
    created_at: 1700000000,
    last_used: 1700000000,
    proxy_configured: false,
    health: overrides.health,
    status_reason: overrides.status_reason,
    quota: overrides.quota ?? {
      subscription_tier: 'Pro',
      models: {
        'gemini-4-neon': {
          percentage,
          resetTime: '2026-12-01T00:00:00Z',
        },
      },
    },
  };
}

function makeCoreAccount(
  id: string,
  percentage: number,
  status: CloudAccount['status'] = 'active',
): CloudAccount {
  return {
    id,
    provider: 'google',
    email: `${id}@example.com`,
    status,
    created_at: 1700000000,
    last_used: 1700000000,
    token: {
      access_token: 'tok',
      refresh_token: 'ref',
      expires_in: 3600,
      expiry_timestamp: Date.now() + 3600000,
      token_type: 'Bearer',
    },
    quota: {
      subscription_tier: 'Pro',
      models: {
        'gemini-4-neon': {
          percentage,
          resetTime: '2026-12-01T00:00:00Z',
        },
      },
    },
  };
}

describe('workspace multi-account support', () => {
  let tempDir: string;
  let testDbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-ws-multi-'));
    fixturePaths.root = tempDir;
    testDbPath = path.join(tempDir, 'cloud_accounts.db');
    WorkspaceProfileRepo.setDatabasePath(testDbPath);

    // Seed a legacy workspace_profiles schema without account_ids_json or auto_switch_enabled.
    const db = new Database(testDbPath);
    // eslint-disable-next-line agm/no-handwritten-sql -- Legacy DDL schema fixture for migration test
    db.exec(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email TEXT NOT NULL,
        token_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL
      );
      CREATE TABLE workspace_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        account_id TEXT NOT NULL,
        project_path TEXT NOT NULL,
        user_data_dir TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_launched_at INTEGER
      );
      INSERT INTO workspace_profiles (id, name, account_id, project_path, user_data_dir, created_at)
      VALUES (
        '11111111-1111-4111-8111-111111111111',
        'Legacy Project',
        'acc-1',
        '${path.join(tempDir, 'legacy').replace(/\\/g, '\\\\')}',
        '${path.join(getProfilesBaseDir(), '11111111-1111-4111-8111-111111111111').replace(/\\/g, '\\\\')}',
        1700000000000
      );
    `);
    db.close();
  });

  afterEach(() => {
    WorkspaceProfileRepo.setDatabasePath(null);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('migrates legacy rows and persists multi-account pools and auto-switch flags', async () => {
    const legacy = await WorkspaceProfileRepo.getProfile('11111111-1111-4111-8111-111111111111');
    expect(legacy?.accountIds).toEqual(['acc-1']);
    expect(legacy?.autoSwitchEnabled).toBe(false);
    expect(WorkspaceProfileRepo.hasAnyAutoSwitchEnabled()).toBe(false);

    const created = await WorkspaceProfileRepo.createProfile({
      name: 'Multi-Account Project',
      accountId: 'acc-1',
      accountIds: ['acc-1', 'acc-2', 'acc-3'],
      autoSwitchEnabled: true,
      projectPath: path.join(tempDir, 'multi'),
    });
    expect(created.accountIds).toEqual(['acc-1', 'acc-2', 'acc-3']);
    expect(created.autoSwitchEnabled).toBe(true);
    expect(WorkspaceProfileRepo.hasAnyAutoSwitchEnabled()).toBe(true);

    // Switching the active account preserves the rest of the pool.
    const switched = await WorkspaceProfileRepo.updateProfile({
      id: created.id,
      accountId: 'acc-2',
    });
    expect(switched.accountId).toBe('acc-2');
    expect(switched.accountIds).toEqual(['acc-1', 'acc-2', 'acc-3']);
    expect(await WorkspaceProfileRepo.getProfilesByAccountId('acc-3')).toHaveLength(1);
  });

  it('classifies and filters assigned workspace accounts by status', () => {
    const active = makeViewAccount('acc-1', { percentage: 90 });
    const available = makeViewAccount('acc-2', { percentage: 75 });
    const exhausted = makeViewAccount('acc-3', { percentage: 3 });
    const rateLimited = makeViewAccount('acc-4', { status: 'rate_limited', percentage: 40 });
    const expired = makeViewAccount('acc-5', { status: 'expired', percentage: 80 });
    const pool = [active, available, exhausted, rateLimited, expired];

    expect(classifyWorkspaceAccountStatus(active, 'acc-1')).toBe('active');
    expect(classifyWorkspaceAccountStatus(available, 'acc-1')).toBe('available');
    expect(classifyWorkspaceAccountStatus(exhausted, 'acc-1')).toBe('exhausted');
    expect(classifyWorkspaceAccountStatus(rateLimited, 'acc-1')).toBe('exhausted');
    expect(classifyWorkspaceAccountStatus(expired, 'acc-1')).toBe('unavailable');

    expect(getWorkspaceAccountStatusCounts(pool, 'acc-1')).toEqual({
      all: 5,
      available: 1,
      active: 1,
      exhausted: 3,
    });
    expect(filterWorkspaceAccountsByStatus(pool, 'acc-1', 'available')).toEqual([available]);
    expect(filterWorkspaceAccountsByStatus(pool, 'acc-1', 'active')).toEqual([active]);
    expect(filterWorkspaceAccountsByStatus(pool, 'acc-1', 'exhausted')).toEqual([
      exhausted,
      rateLimited,
      expired,
    ]);
  });

  it('auto-switches only running workspaces strictly within their assigned account pool', async () => {
    const runningWorkspace: WorkspaceProfile = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Running Workspace',
      accountId: 'acc-depleted',
      accountIds: ['acc-depleted', 'acc-pool-low', 'acc-pool-high'],
      autoSwitchEnabled: true,
      projectPath: '/tmp/running',
      userDataDir: '/tmp/profiles/running',
      createdAt: 1,
      lastLaunchedAt: null,
    };
    const idleWorkspace: WorkspaceProfile = {
      ...runningWorkspace,
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Idle Workspace',
    };

    const switchWorkspaceAccount = vi.fn(async () => undefined);
    const results = await checkAndSwitchWorkspacesIfNeeded({
      listProfiles: async () => [runningWorkspace, idleWorkspace],
      getStatuses: async () => [{ running: true, pid: 100 }, { running: false }],
      getAccounts: async () => [
        makeCoreAccount('acc-depleted', 0),
        makeCoreAccount('acc-pool-low', 30),
        makeCoreAccount('acc-pool-high', 85),
        makeCoreAccount('acc-outside-pool', 100),
      ],
      isAccountDepleted: (account) => (account.quota?.models['gemini-4-neon']?.percentage ?? 0) <= 5,
      isOAuthBlocked: () => false,
      switchWorkspaceAccount,
    });

    expect(results).toEqual([
      {
        workspaceId: runningWorkspace.id,
        fromAccountId: 'acc-depleted',
        toAccountId: 'acc-pool-high',
      },
    ]);
    expect(switchWorkspaceAccount).toHaveBeenCalledTimes(1);
    expect(switchWorkspaceAccount).toHaveBeenCalledWith(runningWorkspace.id, 'acc-pool-high');
  });

  it('computes effective workspace quota from quota_groups without falsely treating Argon 0% as exhausted', () => {
    const proWithArgonZero = makeViewAccount('acc-pro', {
      quota: {
        subscription_tier: 'pro',
        models: {
          'gemini-4-argon-high': { percentage: 0, resetTime: '2026-12-01T00:00:00Z' },
          'gemini-3.8-flash-high': { percentage: 100, resetTime: '2026-12-01T00:00:00Z' },
          'claude-sonnet-5-5-high': { percentage: 100, resetTime: '2026-12-01T00:00:00Z' },
        },
        quota_groups: [
          {
            display_name: 'Gemini Models',
            buckets: [
              {
                bucket_id: 'gemini-weekly',
                window: 'weekly',
                remaining_fraction: 0.76,
                reset_time: '2026-12-03T00:00:00Z',
              },
              {
                bucket_id: 'gemini-5h',
                window: '5h',
                remaining_fraction: 1,
                reset_time: '2026-11-28T00:00:00Z',
              },
            ],
          },
          {
            display_name: 'Claude and GPT models',
            buckets: [
              {
                bucket_id: '3p-weekly',
                window: 'weekly',
                remaining_fraction: 1,
                reset_time: '2026-12-04T00:00:00Z',
              },
            ],
          },
        ],
      },
    });
    const depletedGroupAccount = makeViewAccount('acc-group-low', {
      quota: {
        subscription_tier: 'free',
        models: {
          'gemini-3.8-flash-high': { percentage: 100, resetTime: '2026-12-01T00:00:00Z' },
        },
        quota_groups: [
          {
            display_name: 'Gemini Models',
            buckets: [
              {
                bucket_id: 'gemini-weekly',
                window: 'weekly',
                remaining_fraction: 0.01,
                reset_time: '2026-12-03T00:00:00Z',
              },
            ],
          },
        ],
      },
    });
    const noGroupArgonZero = makeViewAccount('acc-no-groups', {
      quota: {
        subscription_tier: 'pro',
        models: {
          'gemini-4-argon-high': { percentage: 0, resetTime: '2026-12-01T00:00:00Z' },
          'gemini-3.8-flash-high': { percentage: 85, resetTime: '2026-12-01T00:00:00Z' },
        },
      },
    });

    expect(getWorkspaceAccountMinQuotaPercentage(proWithArgonZero.quota)).toBe(76);
    expect(classifyWorkspaceAccountStatus(proWithArgonZero, 'other-active')).toBe('available');

    expect(getWorkspaceAccountMinQuotaPercentage(depletedGroupAccount.quota)).toBe(1);
    expect(classifyWorkspaceAccountStatus(depletedGroupAccount, 'other-active')).toBe('exhausted');

    expect(getWorkspaceAccountMinQuotaPercentage(noGroupArgonZero.quota)).toBe(85);
    expect(classifyWorkspaceAccountStatus(noGroupArgonZero, 'other-active')).toBe('available');
  });

  it('uses quota_groups threshold in default workspace auto-switch detector', async () => {
    const runningWorkspace: WorkspaceProfile = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'AutoSwitch Default Check',
      accountId: 'acc-argon-only-zero',
      accountIds: ['acc-argon-only-zero', 'acc-healthy'],
      autoSwitchEnabled: true,
      projectPath: '/tmp/ws-default',
      userDataDir: '/tmp/profiles/ws-default',
      createdAt: 1,
      lastLaunchedAt: null,
    };

    const healthyAccount: CloudAccount = {
      ...makeCoreAccount('acc-healthy', 100),
      quota: {
        subscription_tier: 'pro',
        models: {
          'gemini-4-argon-high': { percentage: 0, resetTime: '2026-12-01T00:00:00Z' },
          'gemini-3.8-flash-high': { percentage: 100, resetTime: '2026-12-01T00:00:00Z' },
        },
        quota_groups: [
          {
            display_name: 'Gemini Models',
            buckets: [
              {
                bucket_id: 'gemini-weekly',
                window: 'weekly',
                remaining_fraction: 0.7,
                reset_time: '2026-12-03T00:00:00Z',
              },
            ],
          },
        ],
      },
    };
    const activeStillHealthy: CloudAccount = {
      ...healthyAccount,
      id: 'acc-argon-only-zero',
      email: 'acc-argon-only-zero@example.com',
    };

    const switchWorkspaceAccount = vi.fn(async () => undefined);
    const noSwitch = await checkAndSwitchWorkspacesIfNeeded({
      listProfiles: async () => [runningWorkspace],
      getStatuses: async () => [{ running: true, pid: 200 }],
      getAccounts: async () => [activeStillHealthy, healthyAccount],
      isOAuthBlocked: () => false,
      switchWorkspaceAccount,
    });
    expect(noSwitch).toEqual([]);
    expect(switchWorkspaceAccount).not.toHaveBeenCalled();

    const activeGroupDepleted: CloudAccount = {
      ...activeStillHealthy,
      quota: {
        subscription_tier: 'pro',
        models: { 'gemini-3.8-flash-high': { percentage: 100, resetTime: '2026-12-01T00:00:00Z' } },
        quota_groups: [
          {
            display_name: 'Gemini Models',
            buckets: [
              {
                bucket_id: 'gemini-5h',
                window: '5h',
                remaining_fraction: 0,
                reset_time: '2026-11-28T00:00:00Z',
              },
            ],
          },
        ],
      },
    };

    const switched = await checkAndSwitchWorkspacesIfNeeded({
      listProfiles: async () => [runningWorkspace],
      getStatuses: async () => [{ running: true, pid: 200 }],
      getAccounts: async () => [activeGroupDepleted, healthyAccount],
      isOAuthBlocked: () => false,
      switchWorkspaceAccount,
    });
    expect(switched).toEqual([
      {
        workspaceId: runningWorkspace.id,
        fromAccountId: 'acc-argon-only-zero',
        toAccountId: 'acc-healthy',
      },
    ]);
  });
});
