import { mergeQuotaWindows } from '../utils/quota-windows';
import { v4 as uuidv4 } from 'uuid';
import { isEqual } from 'lodash-es';
import {
  CloudAccountRepo,
  CloudAccountEmailConflictError,
  type CloudAccountWriteGuard,
} from '@/modules/cloud-account/persistence/cloudHandler';
import { CloudAccountRefreshService } from '@/modules/cloud-account/services/CloudAccountRefreshService';
import { GoogleAPIService } from '@/modules/cloud-account/services/GoogleAPIService';
import { clearValidationHealthAfterSuccessfulProbe } from '@/modules/cloud-account/services/CloudAccountHealthService';
import type { CloudAccount, CloudTokenData } from '@/modules/cloud-account/types';
import { logger } from '@/shared/logging/logger';
import { prepareDesktopIdentityStorage } from '@/modules/identity-profile/public';
import { GoogleLoginOperation, GoogleLoginStepError } from './google-login-operation';
import { captureTokenWriteGuard } from './cloud-account-refresh-writeback';
import { CloudAccountRefreshContextChangedError } from './cloud-account-refresh-context';
import { CloudAccountQuotaObservation } from './cloud-account-quota-observation';
import { persistValidationRequiredHealth } from './cloud-account-quota-refresh.service';
import { clearAccountStatus } from './cloud-account-refresh-state.service';

export class DuplicateGoogleAccountError extends GoogleLoginStepError {
  constructor(
    stage: 'duplicate-check' | 'account-persist' = 'duplicate-check',
    cause?: CloudAccountEmailConflictError,
  ) {
    super(stage, 'not-attempted', 'duplicate-account', cause);
    this.message = 'Google account already exists';
    this.name = 'DuplicateGoogleAccountError';
  }
}

export class ReauthAccountMismatchError extends GoogleLoginStepError {
  constructor() {
    super('duplicate-check', 'not-attempted', 'duplicate-account', undefined);
    this.message = 'Signed-in Google account does not match the account being re-authenticated';
    this.name = 'ReauthAccountMismatchError';
  }
}

function isAccountBlockedForReauth(account: CloudAccount): boolean {
  return Boolean(
    account.health?.validation ||
      account.health?.oauth?.refresh_blocked ||
      account.status === 'expired',
  );
}

/** Exchange a Google authorization code and persist or re-authorize the resulting account in the owned profile. */
export async function enrollGoogleAccount(
  code: string,
  options: {
    oauthClientKey?: string;
    redirectUri: string;
    operation?: GoogleLoginOperation;
    reauthAccountId?: string;
  },
): Promise<CloudAccount> {
  const operation = options.operation ?? new GoogleLoginOperation();
  const tokenResp = await operation.run('token-exchange', () =>
    GoogleAPIService.exchangeCode(code, undefined, options.oauthClientKey, options.redirectUri),
  );
  const userInfo = await operation.run('user-info', () =>
    GoogleAPIService.getUserInfo(tokenResp.access_token),
  );
  let reauthTarget: CloudAccount | null = null;
  if (options.reauthAccountId) {
    const requested = await operation.run(
      'duplicate-check',
      () => CloudAccountRepo.getAccount(options.reauthAccountId!),
      'storage-failed',
    );
    if (
      !requested ||
      requested.email.trim().toLowerCase() !== userInfo.email.trim().toLowerCase()
    ) {
      throw new ReauthAccountMismatchError();
    }
    reauthTarget = requested;
  } else {
    const existing = await operation.run(
      'duplicate-check',
      () => CloudAccountRepo.getAccountByEmail(userInfo.email),
      'storage-failed',
    );
    if (existing) {
      if (!isAccountBlockedForReauth(existing)) {
        throw new DuplicateGoogleAccountError();
      }
      reauthTarget = existing;
    }
  }

  const now = Math.floor(Date.now() / 1000);
  if (!tokenResp.refresh_token && !reauthTarget?.token.refresh_token) {
    logger.warn('OAuth token exchange returned no refresh token; the account may expire soon');
  }

  let storedAccount: CloudAccount;
  if (reauthTarget) {
    const expectedPreviousToken = structuredClone(reauthTarget.token);
    const updatedToken: CloudTokenData = {
      ...reauthTarget.token,
      access_token: tokenResp.access_token,
      refresh_token: tokenResp.refresh_token || reauthTarget.token.refresh_token || '',
      expires_in: tokenResp.expires_in,
      expiry_timestamp: now + tokenResp.expires_in,
      token_type: tokenResp.token_type,
      email: userInfo.email,
      oauth_client_key: tokenResp.oauth_client_key,
      id_token: tokenResp.id_token ?? reauthTarget.token.id_token,
    };
    const reauthPreTokenGuard = captureTokenWriteGuard(reauthTarget);
    operation.accountCommit = 'uncertain';
    await operation.run(
      'account-persist',
      async () => {
        const updated = await CloudAccountRepo.compareAndUpdateToken(
          reauthTarget.id,
          expectedPreviousToken,
          updatedToken,
          reauthPreTokenGuard,
          true,
        );
        if (!updated) {
          throw new CloudAccountRefreshContextChangedError(reauthTarget.id);
        }
      },
      'storage-failed',
    );
    reauthTarget.token = updatedToken;
    reauthTarget.last_used = now;
    storedAccount = reauthTarget;
  } else {
    const account: CloudAccount = {
      id: uuidv4(),
      provider: 'google',
      email: userInfo.email,
      name: userInfo.name || userInfo.email,
      avatar_url: userInfo.picture,
      token: {
        access_token: tokenResp.access_token,
        refresh_token: tokenResp.refresh_token || '',
        expires_in: tokenResp.expires_in,
        expiry_timestamp: now + tokenResp.expires_in,
        token_type: tokenResp.token_type,
        email: userInfo.email,
        oauth_client_key: tokenResp.oauth_client_key,
        is_gcp_tos: false,
        id_token: tokenResp.id_token,
      },
      created_at: now,
      last_used: now,
    };

    await operation.run('identity-preparation', prepareDesktopIdentityStorage, 'storage-failed');
    operation.accountCommit = 'uncertain';
    storedAccount = await operation.run(
      'account-persist',
      async () => {
        try {
          return await CloudAccountRepo.insertAccount(account, userInfo.id);
        } catch (error) {
          if (error instanceof CloudAccountEmailConflictError) {
            operation.accountCommit = 'not-attempted';
            throw new DuplicateGoogleAccountError('account-persist', error);
          }
          throw error;
        }
      },
      'storage-failed',
    );
  }
  operation.accountCommit = 'confirmed';
  const observation = new CloudAccountQuotaObservation(storedAccount.id);
  try {
    const tokenGuard = captureTokenWriteGuard(storedAccount);
    const guard: CloudAccountWriteGuard = (current) => {
      observation.assertCurrent();
      tokenGuard(current);
    };
    const initialHealth = structuredClone(storedAccount.health);
    const assertCurrent = () => CloudAccountRepo.assertCurrentAccount(storedAccount.id, guard);
    await operation.run(
      'account-finalize',
      async () => {
        await CloudAccountRefreshService.clearFailureState(storedAccount.id, (current) => {
          guard(current);
          if (!reauthTarget && !isEqual(current?.health, initialHealth)) {
            throw new CloudAccountRefreshContextChangedError(storedAccount.id);
          }
        });
        assertCurrent();
        if (reauthTarget) {
          storedAccount.health = (await CloudAccountRepo.getAccount(storedAccount.id))?.health;
        }
        try {
          const quota = await GoogleAPIService.fetchQuota(
            storedAccount.token.access_token,
            ...(storedAccount.proxy_url ? [storedAccount.proxy_url] : []),
          );
          const validationObservation = GoogleAPIService.getValidationObservation(quota);
          assertCurrent();
          observation.accept();
          try {
            const aiCredits = await GoogleAPIService.fetchAICredits(
              storedAccount.token.access_token,
              storedAccount.proxy_url,
            );
            assertCurrent();
            if (aiCredits) {
              quota.ai_credits = aiCredits;
            }
          } catch (error) {
            if (error instanceof CloudAccountRefreshContextChangedError) {
              throw error;
            }
            assertCurrent();
            logger.warn('Failed to fetch initial AI credits');
          }
          const reconciled = mergeQuotaWindows(storedAccount.quota, quota);
          await CloudAccountRepo.updateQuota(storedAccount.id, reconciled, guard);
          assertCurrent();
          storedAccount.quota = reconciled;
          if (reauthTarget) {
            await clearAccountStatus(storedAccount, guard);
            assertCurrent();
          }
          if (validationObservation) {
            await persistValidationRequiredHealth(storedAccount, validationObservation, guard);
            assertCurrent();
          } else if (reauthTarget && storedAccount.health?.validation) {
            await clearValidationHealthAfterSuccessfulProbe(storedAccount, guard);
            assertCurrent();
          }
        } catch (error) {
          if (error instanceof CloudAccountRefreshContextChangedError) {
            throw error;
          }
          assertCurrent();
          observation.accept(error);
          const validationFailure = GoogleAPIService.extractValidationFromQuotaError(error);
          if (validationFailure) {
            await persistValidationRequiredHealth(storedAccount, validationFailure, guard);
            assertCurrent();
          }
          logger.warn('Failed to fetch initial quota');
        }
      },
      'storage-failed',
    );
    return storedAccount;
  } finally {
    observation.close();
  }
}
