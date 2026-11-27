import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudAccountRepo } from '@/modules/cloud-account/persistence/cloudHandler';
import { CloudAccountRefreshService } from '@/modules/cloud-account/services/CloudAccountRefreshService';
import { GoogleAPIService } from '@/modules/cloud-account/services/GoogleAPIService';
import { refreshAccountQuotaCore } from '@/modules/cloud-account/services/cloud-account-quota-refresh.service';
import { enrollGoogleAccount } from '@/modules/cloud-account/services/google-account-enrollment.service';
import { mockAxiosRequests } from '../helpers/mock-axios-request';

const state = vi.hoisted(() => ({
  directory: '',
  quarantine: vi.fn(),
  reload: vi.fn(async () => true),
}));

vi.mock('better-sqlite3', async () => {
  const { createRequire } = await import('node:module');
  return { default: createRequire(import.meta.url)('better-sqlite3') };
});
vi.mock('@/shared/platform/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/platform/paths')>();
  return {
    ...actual,
    getAgentDir: () => state.directory,
    getCloudAccountsDbPath: () => path.join(state.directory, 'accounts.db'),
  };
});
vi.mock('@/modules/identity-profile/public', () => ({ prepareDesktopIdentityStorage: vi.fn() }));
vi.mock('@/server/main', () => ({
  quarantineNestServerAccountLeaseAccount: state.quarantine,
  reloadNestServerAccountLeaseCache: state.reload,
}));

const VALIDATION_URL =
  'https://accounts.google.com/v3/signin/continue?plt=synthetic&continue=https://developers.google.com/gemini-code-assist/auth/auth_success_gemini';

function validation403Payload(url = VALIDATION_URL) {
  return {
    error: {
      code: 403,
      message: 'Verify your account to continue.',
      status: 'PERMISSION_DENIED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'VALIDATION_REQUIRED',
          domain: 'cloudcode-pa.googleapis.com',
          metadata: {
            validation_url: url,
            validation_error_message: 'Verify your account to continue.',
          },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.Help',
          links: [{ description: 'Verify your account', url }],
        },
      ],
    },
  };
}

beforeEach(() => {
  state.directory = fs.mkdtempSync(path.join(os.tmpdir(), 'agm-validation-detect-'));
  state.quarantine.mockClear();
  state.reload.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  CloudAccountRefreshService.resetStateForTesting();
  fs.rmSync(state.directory, { recursive: true, force: true });
});

describe('Google account validation detection during enrollment and quota refresh', () => {
  it('captures VALIDATION_REQUIRED from loadCodeAssist.ineligibleTiers and retrieveUserQuotaSummary 403 without polluting QuotaData', async () => {
    mockAxiosRequests(
      vi.fn(async (url: string) => {
        if (url.includes('loadCodeAssist')) {
          return {
            status: 200,
            json: async () => ({
              cloudaicompanionProject: 'synthetic-project',
              paidTier: { id: 'g1-pro-tier' },
              ineligibleTiers: [
                {
                  reasonCode: 'VALIDATION_REQUIRED',
                  tierId: 'free-tier',
                  validationErrorMessage: 'Verify your account to continue.',
                  validationUrl: VALIDATION_URL,
                },
              ],
            }),
          };
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return { status: 403, json: async () => validation403Payload() };
        }
        return {
          status: 200,
          json: async () => ({
            models: {
              'gemini-3-flash': {
                quotaInfo: { remainingFraction: 1, resetTime: '2090-01-01T00:00:00Z' },
              },
            },
          }),
        };
      }),
    );

    const quota = await GoogleAPIService.fetchQuota('synthetic-token');
    expect(quota.subscription_tier).toBe('pro');
    expect(quota.quota_groups).toBeUndefined();
    expect(GoogleAPIService.getValidationObservation(quota)).toEqual({
      verificationUrl: VALIDATION_URL,
      description: 'Verify your account to continue.',
    });
  });

  it('drops untrusted non-accounts.google.com validation URLs', async () => {
    mockAxiosRequests(
      vi.fn(async (url: string) => {
        if (url.includes('loadCodeAssist')) {
          return {
            status: 200,
            json: async () => ({
              cloudaicompanionProject: 'synthetic-project',
              ineligibleTiers: [
                {
                  reasonCode: 'VALIDATION_REQUIRED',
                  validationUrl: 'https://evil.example/verify',
                },
              ],
            }),
          };
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return { status: 403, json: async () => validation403Payload('https://evil.example/verify') };
        }
        return { status: 200, json: async () => ({ models: {} }) };
      }),
    );

    const quota = await GoogleAPIService.fetchQuota('synthetic-token');
    expect(GoogleAPIService.getValidationObservation(quota)).toEqual({
      verificationUrl: undefined,
      description: 'Verify your account',
    });
  });

  it('persists health.validation immediately when enrolling an unverified account and clears it once verified on refresh', async () => {
    vi.spyOn(GoogleAPIService, 'exchangeCode').mockResolvedValue({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-grant',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    vi.spyOn(GoogleAPIService, 'getUserInfo').mockResolvedValue({
      id: 'synthetic-user',
      verified_email: true,
      email: 'fresh-unverified@example.com',
      name: 'Fresh User',
      picture: '',
    });
    vi.spyOn(GoogleAPIService, 'fetchAICredits').mockResolvedValue(null);

    let verified = false;
    mockAxiosRequests(
      vi.fn(async (url: string) => {
        if (url.includes('loadCodeAssist')) {
          return {
            status: 200,
            json: async () => ({
              cloudaicompanionProject: 'synthetic-project',
              paidTier: { id: 'g1-pro-tier' },
              ...(verified
                ? {}
                : {
                    ineligibleTiers: [
                      {
                        reasonCode: 'VALIDATION_REQUIRED',
                        validationErrorMessage: 'Verify your account to continue.',
                        validationUrl: VALIDATION_URL,
                      },
                    ],
                  }),
            }),
          };
        }
        if (url.includes('retrieveUserQuotaSummary')) {
          return verified
            ? { status: 200, json: async () => ({ groups: [] }) }
            : { status: 403, json: async () => validation403Payload() };
        }
        return {
          status: 200,
          json: async () => ({
            models: {
              'gemini-3-flash': {
                quotaInfo: { remainingFraction: 1, resetTime: '2090-01-01T00:00:00Z' },
              },
            },
          }),
        };
      }),
    );

    const enrolled = await enrollGoogleAccount('synthetic-code', {
      redirectUri: 'http://127.0.0.1/callback',
    });
    expect(enrolled.status).toBe('active');
    expect(enrolled.health?.validation).toMatchObject({
      status: 'requires_action',
      reason: 'VALIDATION_REQUIRED',
      verification_url: VALIDATION_URL,
      description: 'Verify your account to continue.',
    });
    expect((await CloudAccountRepo.getAccount(enrolled.id))?.health?.validation).toMatchObject({
      status: 'requires_action',
      reason: 'VALIDATION_REQUIRED',
      verification_url: VALIDATION_URL,
    });

    const refreshedStillUnverified = await refreshAccountQuotaCore(enrolled.id);
    expect(refreshedStillUnverified.health?.validation?.reason).toBe('VALIDATION_REQUIRED');

    verified = true;
    const refreshedVerified = await refreshAccountQuotaCore(enrolled.id);
    expect(refreshedVerified.health?.validation).toBeUndefined();
    expect((await CloudAccountRepo.getAccount(enrolled.id))?.health?.validation).toBeUndefined();
    expect(state.reload).toHaveBeenCalled();
  });

  it('persists health.validation when enrollment hits 403 VALIDATION_REQUIRED directly from fetchAvailableModels', async () => {
    vi.spyOn(GoogleAPIService, 'exchangeCode').mockResolvedValue({
      access_token: 'synthetic-access',
      refresh_token: 'synthetic-grant',
      token_type: 'Bearer',
      expires_in: 3600,
    });
    vi.spyOn(GoogleAPIService, 'getUserInfo').mockResolvedValue({
      id: 'synthetic-user-2',
      verified_email: true,
      email: 'blocked-403@example.com',
      name: 'Blocked User',
      picture: '',
    });

    mockAxiosRequests(
      vi.fn(async (url: string) => {
        if (url.includes('loadCodeAssist')) {
          return { status: 403, json: async () => validation403Payload() };
        }
        return { status: 403, json: async () => validation403Payload() };
      }),
    );

    const enrolled = await enrollGoogleAccount('synthetic-code', {
      redirectUri: 'http://127.0.0.1/callback',
    });
    expect(enrolled.quota).toBeUndefined();
    expect(enrolled.health?.validation).toMatchObject({
      status: 'requires_action',
      reason: 'VALIDATION_REQUIRED',
      verification_url: VALIDATION_URL,
    });
  });
});
