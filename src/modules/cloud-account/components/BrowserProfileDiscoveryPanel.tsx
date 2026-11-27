import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  Loader2,
  LogIn,
  Plus,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  cancelOAuthSession,
  copyOAuthSessionLink,
  discoverBrowserProfiles,
  openBrowserProfile,
  prepareOAuthSession,
  submitOAuthSessionCallback,
  waitForOAuthSession,
} from '../actions/cloud';
import type {
  BrowserId,
  DiscoveredBrowserAccount,
  DiscoveredBrowserProfile,
} from '../services/browser-profile-discovery.schema';
import type { CloudAccountView } from '../services/cloud-account-view';
import {
  readDesktopOAuthLoginErrorCode,
  type DesktopOAuthLoginErrorCode,
} from '../services/desktop-oauth-login.schema';

type DiscoveryFilter = 'unadded' | 'all' | 'added';

interface ActiveProfileLogin {
  sessionId: string;
  browserId: BrowserId;
  browserName: string;
  profileDirectory: string;
  profileName: string;
  email: string;
}

function getOAuthErrorDescription(
  error: unknown,
  loginCode: DesktopOAuthLoginErrorCode | null,
  t: (key: string) => string,
): string {
  if (loginCode === 'authorization-denied') {
    return t('cloud.authDialog.errors.authorization-denied');
  }
  if (loginCode === 'login-timeout') {
    return t('cloud.authDialog.errors.login-timeout');
  }
  if (loginCode === 'browser-open-failed') {
    return t('cloud.authDialog.errors.browser-open-failed');
  }
  if (loginCode === 'duplicate-account') {
    return t('cloud.authDialog.errors.duplicate-account');
  }
  if (loginCode === 'invalid-manual-input') {
    return t('cloud.authDialog.errors.invalid-manual-input');
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return t('cloud.toast.loginFailed');
}

export function BrowserProfileDiscoveryPanel({
  onBusyChange,
  onAccountSaved,
  onValidationRequired,
}: {
  onBusyChange?: (busy: boolean) => void;
  onAccountSaved?: (account: CloudAccountView) => void;
  onValidationRequired?: (account: CloudAccountView) => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    data: discovery = null,
    isLoading,
    isFetching,
    error: queryError,
    refetch: refetchDiscovery,
  } = useQuery({
    queryKey: ['browserProfileDiscovery'],
    queryFn: discoverBrowserProfiles,
    staleTime: 30_000,
  });
  const loading = isLoading || isFetching;
  const scanError = queryError
    ? queryError instanceof Error
      ? queryError.message
      : t('cloud.add-flow.browsers.scan-failed')
    : null;
  const [filter, setFilter] = useState<DiscoveryFilter>('unadded');
  const [browserFilter, setBrowserFilter] = useState<BrowserId | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLogin, setActiveLogin] = useState<ActiveProfileLogin | null>(null);
  const [manualCallbackOpen, setManualCallbackOpen] = useState(false);
  const [manualCallback, setManualCallback] = useState('');
  const [submittingCallback, setSubmittingCallback] = useState(false);
  const [openingProfileKey, setOpeningProfileKey] = useState<string | null>(null);

  const activeSessionIdRef = useRef<string | null>(null);

  const loadDiscovery = async () => {
    await refetchDiscovery();
  };

  useEffect(() => {
    return () => {
      const pendingSessionId = activeSessionIdRef.current;
      if (pendingSessionId) {
        activeSessionIdRef.current = null;
        cancelOAuthSession(pendingSessionId).catch(() => undefined);
      }
    };
  }, []);

  useEffect(() => {
    onBusyChange?.(activeLogin !== null);
  }, [activeLogin, onBusyChange]);

  const counts = useMemo(() => {
    const total = discovery?.totalAccounts ?? 0;
    const unadded = discovery?.unaddedAccounts ?? 0;
    return {
      unadded,
      all: total,
      added: Math.max(0, total - unadded),
    };
  }, [discovery]);

  const filteredProfiles = useMemo(() => {
    if (!discovery) {
      return [];
    }
    const q = searchQuery.trim().toLowerCase();

    return discovery.profiles
      .filter((profile) => browserFilter === 'all' || profile.browserId === browserFilter)
      .map((profile) => {
        const profileMatchesSearch =
          q.length > 0 &&
          (profile.profileName.toLowerCase().includes(q) ||
            profile.browserName.toLowerCase().includes(q) ||
            profile.profileDirectory.toLowerCase().includes(q));

        const matchingAccounts = profile.accounts.filter((acc) => {
          if (filter === 'unadded' && acc.isAdded) {
            return false;
          }
          if (filter === 'added' && !acc.isAdded) {
            return false;
          }
          if (!q || profileMatchesSearch) {
            return true;
          }
          return (
            acc.email.toLowerCase().includes(q) ||
            Boolean(acc.fullName?.toLowerCase().includes(q))
          );
        });

        return {
          ...profile,
          accounts: matchingAccounts,
        };
      })
      .filter((profile) => profile.accounts.length > 0);
  }, [browserFilter, discovery, filter, searchQuery]);

  const handleOpenProfileOnly = async (profile: DiscoveredBrowserProfile) => {
    setOpeningProfileKey(profile.id);
    try {
      await openBrowserProfile({
        browserId: profile.browserId,
        profileDirectory: profile.profileDirectory,
      });
    } catch (error) {
      toast({
        error,
        title: t('cloud.add-flow.browsers.open-failed'),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setOpeningProfileKey((curr) => (curr === profile.id ? null : curr));
    }
  };

  const handleCancelActiveLogin = async () => {
    const current = activeLogin;
    if (!current) {
      return;
    }
    activeSessionIdRef.current = null;
    setActiveLogin(null);
    setManualCallback('');
    setManualCallbackOpen(false);
    await cancelOAuthSession(current.sessionId).catch(() => undefined);
  };

  const handleAddAccountFromProfile = async (
    profile: DiscoveredBrowserProfile,
    account: DiscoveredBrowserAccount,
  ) => {
    if (activeLogin) {
      return;
    }

    let preparedSessionId: string | null = null;
    try {
      const prepared = await prepareOAuthSession(
        undefined,
        account.isAdded && account.needsValidation ? account.addedAccountId : undefined,
        account.email,
      );
      preparedSessionId = prepared.sessionId;
      activeSessionIdRef.current = prepared.sessionId;
      setActiveLogin({
        sessionId: prepared.sessionId,
        browserId: profile.browserId,
        browserName: profile.browserName,
        profileDirectory: profile.profileDirectory,
        profileName: profile.profileName,
        email: account.email,
      });
      setManualCallbackOpen(false);
      setManualCallback('');

      await openBrowserProfile({
        browserId: profile.browserId,
        profileDirectory: profile.profileDirectory,
        sessionId: prepared.sessionId,
        loginHint: account.email,
      });

      const savedAccount = await waitForOAuthSession(prepared.sessionId);
      if (activeSessionIdRef.current !== prepared.sessionId) {
        return;
      }

      activeSessionIdRef.current = null;
      setActiveLogin(null);
      setManualCallback('');
      setManualCallbackOpen(false);

      await queryClient.invalidateQueries({ queryKey: ['cloudAccounts'] });
      await loadDiscovery();

      if (savedAccount.health?.validation) {
        onValidationRequired?.(savedAccount);
        return;
      }

      toast({
        title: t('cloud.toast.loginSuccess'),
        description: savedAccount.email,
        variant: 'success',
      });
      onAccountSaved?.(savedAccount);
    } catch (error) {
      if (preparedSessionId && activeSessionIdRef.current === preparedSessionId) {
        activeSessionIdRef.current = null;
        setActiveLogin(null);
        await cancelOAuthSession(preparedSessionId).catch(() => undefined);
      }

      const loginCode = readDesktopOAuthLoginErrorCode(error);
      if (loginCode === 'login-cancelled') {
        return;
      }

      toast({
        error,
        title: t('cloud.toast.loginFailed'),
        description: getOAuthErrorDescription(error, loginCode, t),
        variant: 'destructive',
      });

      if (loginCode === 'duplicate-account') {
        await queryClient.invalidateQueries({ queryKey: ['cloudAccounts'] });
        await loadDiscovery();
      }
    }
  };

  const handleSubmitManualCallback = async () => {
    if (!activeLogin || !manualCallback.trim()) {
      return;
    }
    setSubmittingCallback(true);
    try {
      await submitOAuthSessionCallback(activeLogin.sessionId, manualCallback.trim());
    } catch (error) {
      toast({
        error,
        title: t('cloud.toast.loginFailed'),
        description: getOAuthErrorDescription(
          error,
          readDesktopOAuthLoginErrorCode(error),
          t,
        ),
        variant: 'destructive',
      });
    } finally {
      setSubmittingCallback(false);
    }
  };

  return (
    <div className="space-y-3" data-testid="browser-profile-discovery-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
          <span>
            {t('cloud.add-flow.browsers.summary', {
              unadded: counts.unadded,
              total: counts.all,
            })}
          </span>
          {discovery && discovery.scannedBrowsers.length > 0 && (
            <span className="text-muted-foreground">
              ({discovery.scannedBrowsers.map((b) => b.browserName).join(' · ')})
            </span>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => loadDiscovery()}
          disabled={loading || activeLogin !== null}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('cloud.add-flow.browsers.rescan')}
        </Button>
      </div>

      {activeLogin && (
        <div
          className="border-primary/30 bg-primary/5 space-y-2.5 rounded-lg border p-3 text-xs"
          role="status"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Loader2 className="text-primary h-4 w-4 shrink-0 animate-spin" />
              <span className="text-foreground font-medium">
                {t('cloud.add-flow.browsers.waiting-in-profile', {
                  email: activeLogin.email,
                  browser: activeLogin.browserName,
                  profile: activeLogin.profileName,
                })}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  openBrowserProfile({
                    browserId: activeLogin.browserId,
                    profileDirectory: activeLogin.profileDirectory,
                    sessionId: activeLogin.sessionId,
                    loginHint: activeLogin.email,
                  }).catch(() => undefined)
                }
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('cloud.add-flow.browsers.reopen-profile')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  copyOAuthSessionLink(activeLogin.sessionId)
                    .then(() =>
                      toast({
                        title: t('cloud.add-flow.link-copied'),
                      }),
                    )
                    .catch(() => undefined)
                }
              >
                <Copy className="h-3.5 w-3.5" />
                {t('cloud.add-flow.copy-link')}
              </Button>
              <Button type="button" size="xs" variant="ghost" onClick={handleCancelActiveLogin}>
                <X className="h-3.5 w-3.5" />
                {t('common.cancel')}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground text-xs underline"
              onClick={() => setManualCallbackOpen((prev) => !prev)}
            >
              {t('cloud.authDialog.manual-sign-in')}
            </button>
          </div>

          {manualCallbackOpen && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-1">
                <Label htmlFor="browser-discovery-manual-callback" className="text-xs">
                  {t('cloud.add-flow.callback-label')}
                </Label>
                <Input
                  id="browser-discovery-manual-callback"
                  value={manualCallback}
                  onChange={(e) => setManualCallback(e.target.value)}
                  placeholder={t('cloud.authDialog.placeholder')}
                  className="h-8 text-xs"
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={submittingCallback || !manualCallback.trim()}
                onClick={handleSubmitManualCallback}
              >
                {submittingCallback ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {t('cloud.add-flow.submit-callback')}
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {(['unadded', 'all', 'added'] as const).map((key) => (
            <Button
              key={key}
              type="button"
              size="xs"
              variant={filter === key ? 'secondary' : 'ghost'}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className="h-7 gap-1 px-2 text-xs"
            >
              <span>{t(`cloud.add-flow.browsers.filter-${key}`)}</span>
              <span className="text-muted-foreground tabular-nums">{counts[key]}</span>
            </Button>
          ))}
        </div>

        {discovery && discovery.scannedBrowsers.length > 1 && (
          <div className="flex flex-wrap items-center gap-1">
            <Button
              type="button"
              size="xs"
              variant={browserFilter === 'all' ? 'secondary' : 'outline'}
              onClick={() => setBrowserFilter('all')}
              className="h-7 px-2 text-xs"
            >
              {t('cloud.add-flow.browsers.all-browsers')}
            </Button>
            {discovery.scannedBrowsers.map((browser) => (
              <Button
                key={browser.browserId}
                type="button"
                size="xs"
                variant={browserFilter === browser.browserId ? 'secondary' : 'outline'}
                onClick={() => setBrowserFilter(browser.browserId)}
                className="h-7 px-2 text-xs"
              >
                {browser.browserName}
              </Button>
            ))}
          </div>
        )}

        <div className="relative min-w-[180px] flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 start-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('cloud.add-flow.browsers.search-placeholder')}
            aria-label={t('cloud.add-flow.browsers.search-placeholder')}
            className="h-8 ps-8 text-xs"
          />
        </div>
      </div>

      {loading && !discovery ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{t('cloud.add-flow.browsers.scanning')}</span>
        </div>
      ) : scanError ? (
        <div
          role="alert"
          className="border-destructive/30 bg-destructive/5 text-destructive flex items-center justify-between gap-2 rounded-lg border p-3 text-xs"
        >
          <span className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 shrink-0" />
            <span>{scanError}</span>
          </span>
          <Button type="button" size="xs" variant="outline" onClick={() => loadDiscovery()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !discovery || discovery.profiles.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-xs">
          <Globe className="mx-auto mb-2 h-6 w-6 opacity-50" />
          <p>{t('cloud.add-flow.browsers.empty-none-found')}</p>
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border border-dashed p-6 text-center text-xs">
          <CheckCircle2 className="text-success mx-auto mb-2 h-6 w-6 opacity-80" />
          <p>
            {filter === 'unadded' && counts.unadded === 0 && !searchQuery
              ? t('cloud.add-flow.browsers.all-added')
              : t('cloud.add-flow.browsers.no-matches')}
          </p>
        </div>
      ) : (
        <div className="max-h-96 space-y-2.5 overflow-y-auto pe-1">
          {filteredProfiles.map((profile) => {
            const profileUnaddedCount = profile.accounts.filter((acc) => !acc.isAdded).length;
            return (
              <div key={profile.id} className="bg-muted/20 rounded-lg border p-2.5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="h-5 px-1.5 text-xs font-medium">
                      {profile.browserName}
                    </Badge>
                    <span className="text-foreground truncate text-xs font-semibold">
                      {profile.profileName}
                    </span>
                    {profile.profileDirectory !== '__default_root__' && (
                      <span className="text-muted-foreground text-xs">
                        ({profile.profileDirectory})
                      </span>
                    )}
                    {profileUnaddedCount > 0 && (
                      <Badge
                        variant="secondary"
                        className="bg-primary/10 text-primary h-5 px-1.5 text-xs tabular-nums"
                      >
                        {t('cloud.add-flow.browsers.unadded-badge', {
                          count: profileUnaddedCount,
                        })}
                      </Badge>
                    )}
                  </div>

                  {profile.canLaunch && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      disabled={openingProfileKey === profile.id || activeLogin !== null}
                      onClick={() => handleOpenProfileOnly(profile)}
                      className="h-6 gap-1 px-2 text-xs"
                    >
                      {openingProfileKey === profile.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <FolderOpen className="h-3 w-3" />
                      )}
                      {t('cloud.add-flow.browsers.open-profile')}
                    </Button>
                  )}
                </div>

                <div className="divide-y rounded-md border bg-background">
                  {profile.accounts.map((acc) => {
                    const isLoggingThis =
                      activeLogin?.email.toLowerCase() === acc.email.toLowerCase() &&
                      activeLogin?.browserId === profile.browserId &&
                      activeLogin?.profileDirectory === profile.profileDirectory;
                    const displayInitial = (acc.fullName || acc.email || 'G')[0].toUpperCase();

                    return (
                      <div
                        key={acc.email}
                        className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2"
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2.5">
                          <Avatar className="h-7 w-7 shrink-0 rounded-full border">
                            {acc.avatarUrl && <AvatarImage src={acc.avatarUrl} alt={acc.email} />}
                            <AvatarFallback className="text-xs font-semibold">
                              {displayInitial}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="text-foreground truncate text-xs font-medium">
                              {acc.email}
                            </div>
                            {acc.fullName && (
                              <div className="text-muted-foreground truncate text-xs">
                                {acc.fullName}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {acc.isAdded ? (
                            acc.needsValidation ? (
                              <>
                                <Badge variant="destructive" className="h-6 px-2 text-xs">
                                  {t('cloud.add-flow.browsers.status-validation')}
                                </Badge>
                                <Button
                                  type="button"
                                  size="xs"
                                  variant="outline"
                                  disabled={!profile.canLaunch || activeLogin !== null}
                                  onClick={() => handleAddAccountFromProfile(profile, acc)}
                                  className="h-7 gap-1 px-2.5 text-xs"
                                >
                                  {isLoggingThis ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <LogIn className="h-3.5 w-3.5" />
                                  )}
                                  {t('cloud.card.signInAgain')}
                                </Button>
                              </>
                            ) : (
                              <Badge variant="secondary" className="h-6 gap-1 px-2 text-xs">
                                <CheckCircle2 className="text-success h-3.5 w-3.5" />
                                {t('cloud.add-flow.browsers.status-added')}
                              </Badge>
                            )
                          ) : (
                            <Button
                              type="button"
                              size="xs"
                              variant="default"
                              disabled={!profile.canLaunch || activeLogin !== null}
                              title={
                                !profile.canLaunch
                                  ? t('cloud.add-flow.browsers.cannot-launch')
                                  : undefined
                              }
                              onClick={() => handleAddAccountFromProfile(profile, acc)}
                              className="h-7 gap-1 px-2.5 text-xs"
                            >
                              {isLoggingThis ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Plus className="h-3.5 w-3.5" />
                              )}
                              {t('cloud.add-flow.browsers.add-in-profile')}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
