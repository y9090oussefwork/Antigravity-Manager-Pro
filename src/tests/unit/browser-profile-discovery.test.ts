import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouterClient } from '@orpc/server';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import { OpenBrowserProfileInputSchema } from '@/modules/cloud-account/services/browser-profile-discovery.schema';
import {
  discoverBrowserProfiles,
  launchBrowserProfile,
} from '@/modules/cloud-account/services/browser-profile-discovery.service';
import { cloudRouter } from '@/modules/cloud-account/ipc/router';
import { getCloudAccountAdapter } from '@/modules/cloud-account/ipc/cloud-account-adapter';

vi.mock('@/modules/cloud-account/ipc/cloud-account-adapter', () => ({
  getCloudAccountAdapter: vi.fn(),
}));

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agm-browser-discovery-'));
  tempDirs.push(dir);
  return dir;
}

function makeExistingAccount(
  id: string,
  email: string,
  needsValidation = false,
): CloudAccountView {
  return {
    id,
    provider: 'google',
    email,
    created_at: 1,
    is_active: false,
    is_active_classic: false,
    last_used: 1,
    proxy_configured: false,
    ...(needsValidation
      ? {
          status: 'active',
          status_reason: 'validation_required',
          health: {
            validation: {
              status: 'requires_action',
              reason: 'VALIDATION_REQUIRED',
              has_verification_link: true,
            },
          },
        }
      : { status: 'active' }),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe('browser profile discovery service', () => {
  it('discovers multi-account Chromium profiles, deduplicates emails, and marks added vs unadded accounts', async () => {
    const root = createTempDir();
    const chromeUserData = path.join(root, 'ChromeUserData');
    const edgeUserData = path.join(root, 'EdgeUserData');

    mkdirSync(path.join(chromeUserData, 'Default'), { recursive: true });
    mkdirSync(path.join(chromeUserData, 'Profile 23'), { recursive: true });
    mkdirSync(path.join(edgeUserData, 'Default'), { recursive: true });

    writeFileSync(
      path.join(chromeUserData, 'Local State'),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Personal', user_name: 'primary@gmail.com' },
            'Profile 23': { name: 'Antigravity Work', user_name: 'work1@gmail.com' },
          },
        },
      }),
    );

    writeFileSync(
      path.join(chromeUserData, 'Default', 'Preferences'),
      JSON.stringify({
        account_info: [
          {
            email: 'primary@gmail.com',
            full_name: 'Primary User',
            picture_url: 'https://lh3.googleusercontent.com/a/primary',
          },
          {
            email: 'PRIMARY@gmail.com',
            full_name: 'Duplicate Case',
          },
        ],
      }),
    );

    writeFileSync(
      path.join(chromeUserData, 'Profile 23', 'Preferences'),
      JSON.stringify({
        account_info: [
          { email: 'work1@gmail.com', full_name: 'Work One' },
          { email: 'work2@gmail.com', full_name: 'Work Two' },
          { email: 'blocked@gmail.com', full_name: 'Needs Validation' },
        ],
      }),
    );

    writeFileSync(
      path.join(edgeUserData, 'Local State'),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: 'Edge Profile' },
          },
        },
      }),
    );
    writeFileSync(
      path.join(edgeUserData, 'Default', 'Preferences'),
      JSON.stringify({
        google: {
          services: {
            username: 'edgeonly@gmail.com',
          },
        },
      }),
    );

    const existingAccounts = [
      makeExistingAccount('acc-1', 'primary@gmail.com'),
      makeExistingAccount('acc-2', 'blocked@gmail.com', true),
    ];

    const result = await discoverBrowserProfiles(existingAccounts, {
      customUserDataDirs: {
        chrome: chromeUserData,
        'chrome-beta': '',
        edge: edgeUserData,
        brave: '',
        vivaldi: '',
        chromium: '',
        opera: '',
        'opera-gx': '',
      },
      customExecutables: {
        chrome: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        edge: 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      },
    });

    expect(result.totalAccounts).toBe(5);
    expect(result.unaddedAccounts).toBe(3);
    expect(result.scannedBrowsers.map((b) => b.browserId)).toEqual(['chrome', 'edge']);

    const workProfile = result.profiles.find(
      (profile) => profile.browserId === 'chrome' && profile.profileDirectory === 'Profile 23',
    );
    expect(workProfile).toMatchObject({
      profileName: 'Antigravity Work',
      canLaunch: true,
    });
    expect(workProfile?.accounts.map((acc) => [acc.email, acc.isAdded, acc.needsValidation])).toEqual([
      ['work1@gmail.com', false, false],
      ['work2@gmail.com', false, false],
      ['blocked@gmail.com', true, true],
    ]);

    const defaultProfile = result.profiles.find(
      (profile) => profile.browserId === 'chrome' && profile.profileDirectory === 'Default',
    );
    expect(defaultProfile?.accounts).toHaveLength(1);
    expect(defaultProfile?.accounts[0]).toMatchObject({
      email: 'primary@gmail.com',
      isAdded: true,
      addedAccountId: 'acc-1',
    });

    const edgeProfile = result.profiles.find((profile) => profile.browserId === 'edge');
    expect(edgeProfile?.accounts.map((acc) => acc.email)).toEqual(['edgeonly@gmail.com']);
  });

  it('rejects path-traversal profileDirectory values at schema validation', () => {
    expect(() =>
      OpenBrowserProfileInputSchema.parse({
        browserId: 'chrome',
        profileDirectory: '../Secret',
      }),
    ).toThrow();
    expect(() =>
      OpenBrowserProfileInputSchema.parse({
        browserId: 'chrome',
        profileDirectory: '.',
      }),
    ).toThrow();
    expect(() =>
      OpenBrowserProfileInputSchema.parse({
        browserId: 'chrome',
        profileDirectory: 'Profile 23',
      }),
    ).not.toThrow();
  });

  it('launches the resolved browser executable directly with --profile-directory and trusted Google OAuth URL', async () => {
    const root = createTempDir();
    const chromeUserData = path.join(root, 'ChromeUserData');
    mkdirSync(path.join(chromeUserData, 'Profile 12'), { recursive: true });

    const unref = vi.fn();
    const spawnMock = vi.fn(() => ({ unref }) as never);
    const trustedUrl =
      'https://accounts.google.com/o/oauth2/v2/auth?client_id=abc&login_hint=user%40gmail.com';

    await launchBrowserProfile(
      { browserId: 'chrome', profileDirectory: 'Profile 12' },
      {
        platform: 'win32',
        customUserDataDirs: { chrome: chromeUserData },
        customExecutables: { chrome: 'C:\\Chrome\\chrome.exe' },
        authorizationUrl: trustedUrl,
        spawnProcess: spawnMock,
      },
    );

    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\Chrome\\chrome.exe',
      ['--profile-directory=Profile 12', trustedUrl],
      expect.objectContaining({
        detached: true,
        stdio: 'ignore',
        shell: false,
      }),
    );
    expect(unref).toHaveBeenCalledTimes(1);
  });

  it('rejects untrusted URLs in launchBrowserProfile without spawning a process', async () => {
    const root = createTempDir();
    const chromeUserData = path.join(root, 'ChromeUserData');
    mkdirSync(path.join(chromeUserData, 'Profile 12'), { recursive: true });
    const spawnMock = vi.fn();

    await expect(
      launchBrowserProfile(
        { browserId: 'chrome', profileDirectory: 'Profile 12' },
        {
          platform: 'win32',
          customUserDataDirs: { chrome: chromeUserData },
          customExecutables: { chrome: 'C:\\Chrome\\chrome.exe' },
          authorizationUrl: 'https://evil.example/steal',
          spawnProcess: spawnMock as never,
        },
      ),
    ).rejects.toMatchObject({ loginCode: 'login-failed' });
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('forwards loginHint through cloudRouter.oauthSession.prepare', async () => {
    const prepare = vi.fn(async () => ({ sessionId: '11111111-1111-4111-8111-111111111111' }));
    vi.mocked(getCloudAccountAdapter).mockReturnValue({
      getOAuthSession: async () => ({
        prepare,
        getAuthorizationUrl: () => 'https://accounts.google.com/o/oauth2/v2/auth',
        open: vi.fn(),
        copy: vi.fn(),
        wait: vi.fn(),
        submit: vi.fn(),
        cancel: vi.fn(),
      }),
    } as never);

    const client = createRouterClient(cloudRouter);
    await expect(
      client.oauthSession.prepare({ loginHint: 'target@gmail.com' }),
    ).resolves.toEqual({ sessionId: '11111111-1111-4111-8111-111111111111' });
    expect(prepare).toHaveBeenCalledWith(undefined, undefined, 'target@gmail.com');
  });
});
