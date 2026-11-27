import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Cloud,
  DatabaseZap,
  ExternalLink,
  KeyRound,
  LogIn,
  Plus,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { refreshAccountQuota } from '../actions/cloud';
import { QUERY_KEYS } from '../hooks/useCloudAccounts';
import { useOpenAccountValidationLink } from '../hooks/useOpenAccountValidationLink';
import type { CloudAccountView } from '../services/cloud-account-view';
import { LocalAccountImportPanel } from '../local-import/components/LocalAccountImportDialog';
import { CloudAccountOAuthPanel } from './CloudAccountOAuthPanel';
import { CloudAccountCredentialImportPanel } from './CloudAccountCredentialImportPanel';

const methods = [
  { id: 'google', icon: Cloud },
  { id: 'credentials', icon: KeyRound },
  { id: 'local', icon: DatabaseZap },
] as const;

type AddMethod = (typeof methods)[number]['id'];

export interface ReauthAccountTarget {
  id: string;
  email: string;
}

export interface CloudAccountLoginDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  reauthAccount?: ReauthAccountTarget | null;
  hideTrigger?: boolean;
}

export function CloudAccountLoginDialog({
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  reauthAccount = null,
  hideTrigger = false,
}: CloudAccountLoginDialogProps = {}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const validationLink = useOpenAccountValidationLink();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [method, setMethod] = useState<AddMethod>('google');
  const [importing, setImporting] = useState(false);
  const [activeReauthTarget, setActiveReauthTarget] = useState<ReauthAccountTarget | null>(null);
  const [pendingValidationAccount, setPendingValidationAccount] = useState<CloudAccountView | null>(
    null,
  );
  const [recheckingValidation, setRecheckingValidation] = useState(false);
  const [validationRecheckState, setValidationRecheckState] = useState<'idle' | 'pending' | 'failed'>(
    'idle',
  );
  const sessionQueueRef = useRef(Promise.resolve());

  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (controlledOnOpenChange) {
        controlledOnOpenChange(nextOpen);
      } else {
        setUncontrolledOpen(nextOpen);
      }
    },
    [controlledOnOpenChange],
  );

  const effectiveReauthTarget = open ? (activeReauthTarget ?? reauthAccount) : null;

  const accountSaved = useCallback(
    (isCurrent: boolean, account?: CloudAccountView, isReauth?: boolean) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
      if (!isCurrent) {
        return;
      }
      if (account?.health?.validation) {
        setPendingValidationAccount(account);
        setValidationRecheckState('idle');
        return;
      }
      setActiveReauthTarget(null);
      setPendingValidationAccount(null);
      setOpen(false);
      toast({
        title: t(isReauth ? 'cloud.toast.reauthSuccess' : 'cloud.toast.addSuccess'),
        variant: 'success',
      });
    },
    [queryClient, setOpen, t, toast],
  );

  const handleRecheckValidation = async () => {
    if (!pendingValidationAccount || recheckingValidation) {
      return;
    }
    setRecheckingValidation(true);
    setValidationRecheckState('idle');
    try {
      const updated = await refreshAccountQuota({ accountId: pendingValidationAccount.id });
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
      if (updated.health?.validation) {
        setPendingValidationAccount(updated);
        setValidationRecheckState('pending');
        return;
      }
      setPendingValidationAccount(null);
      setOpen(false);
      toast({ title: t('cloud.toast.validationVerified'), variant: 'success' });
    } catch {
      setValidationRecheckState('failed');
    } finally {
      setRecheckingValidation(false);
    }
  };

  const closeBusy = importing || recheckingValidation;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!closeBusy) {
          setOpen(nextOpen);
          setPendingValidationAccount(null);
          setValidationRecheckState('idle');
          setActiveReauthTarget(null);
          if (nextOpen) {
            setMethod('google');
          }
        }
      }}
    >
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button>
            <Plus aria-hidden="true" className="size-4" />
            {t('cloud.addAccount')}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-xl" closeDisabled={closeBusy}>
        <DialogHeader>
          <DialogTitle>
            {pendingValidationAccount
              ? t('cloud.authDialog.validation-required.title')
              : effectiveReauthTarget
                ? t('cloud.authDialog.reauth.title')
                : t('cloud.addAccount')}
          </DialogTitle>
          <DialogDescription>
            {pendingValidationAccount
              ? t('cloud.authDialog.validation-required.description', {
                  email: pendingValidationAccount.email,
                })
              : effectiveReauthTarget
                ? t('cloud.authDialog.reauth.description', { email: effectiveReauthTarget.email })
                : t('cloud.add-flow.description')}
          </DialogDescription>
        </DialogHeader>
        {open &&
          (pendingValidationAccount ? (
            <div className="grid gap-4">
              <div
                role="status"
                className="border-destructive/30 bg-destructive/5 text-foreground flex items-start gap-3 rounded-lg border p-3.5 text-sm"
              >
                <ShieldAlert
                  aria-hidden="true"
                  className="text-destructive mt-0.5 size-4 shrink-0"
                />
                <div className="grid gap-1">
                  <p className="font-medium">{pendingValidationAccount.email}</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    {validationRecheckState === 'pending'
                      ? t('cloud.authDialog.validation-required.still-pending')
                      : validationRecheckState === 'failed'
                        ? t('cloud.authDialog.validation-required.recheck-failed')
                        : t('cloud.authDialog.validation-required.hint')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {pendingValidationAccount.health?.validation?.has_verification_link && (
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={validationLink.isPending || recheckingValidation}
                      onClick={() => validationLink.open(pendingValidationAccount.id)}
                    >
                      <ExternalLink aria-hidden="true" className="size-4" />
                      {t('cloud.card.completeValidation')}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="default"
                    disabled={recheckingValidation}
                    onClick={() => {
                      setActiveReauthTarget({
                        id: pendingValidationAccount.id,
                        email: pendingValidationAccount.email,
                      });
                      setPendingValidationAccount(null);
                      setValidationRecheckState('idle');
                    }}
                  >
                    <LogIn aria-hidden="true" className="size-4" />
                    {t('cloud.card.signInAgain')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={recheckingValidation}
                    onClick={handleRecheckValidation}
                  >
                    <RefreshCw
                      aria-hidden="true"
                      className={`size-4 ${recheckingValidation ? 'animate-spin' : ''}`}
                    />
                    {t('cloud.authDialog.validation-required.recheck')}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={recheckingValidation}
                  onClick={() => {
                    setPendingValidationAccount(null);
                    setValidationRecheckState('idle');
                    setActiveReauthTarget(null);
                    setOpen(false);
                  }}
                >
                  {t('cloud.authDialog.validation-required.later')}
                </Button>
              </div>
            </div>
          ) : effectiveReauthTarget ? (
            <CloudAccountOAuthPanel
              sessionQueueRef={sessionQueueRef}
              reauthAccountId={effectiveReauthTarget.id}
              onAuthorized={accountSaved}
            />
          ) : (
            <Tabs
              value={method}
              onValueChange={(value) => {
                const next = methods.find(({ id }) => id === value);
                if (next && !importing) {
                  setMethod(next.id);
                }
              }}
              activationMode="manual"
            >
              <TabsList className="grid w-full grid-cols-3" aria-label={t('cloud.add-flow.methods')}>
                {methods.map(({ id, icon: Icon }) => (
                  <TabsTrigger
                    key={id}
                    value={id}
                    disabled={importing && id !== method}
                    className="gap-1.5 px-1 text-xs sm:text-sm"
                  >
                    <Icon aria-hidden="true" className="hidden size-4 sm:block" />
                    {t(`cloud.add-flow.tabs.${id}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="google" className="mt-4">
                {method === 'google' && (
                  <CloudAccountOAuthPanel
                    sessionQueueRef={sessionQueueRef}
                    onAuthorized={accountSaved}
                  />
                )}
              </TabsContent>
              <TabsContent value="credentials" className="mt-4">
                {method === 'credentials' && (
                  <CloudAccountCredentialImportPanel
                    onBusyChange={setImporting}
                    onComplete={() => setOpen(false)}
                  />
                )}
              </TabsContent>
              <TabsContent value="local" className="mt-4">
                {method === 'local' && <LocalAccountImportPanel onBusyChange={setImporting} />}
              </TabsContent>
            </Tabs>
          ))}
      </DialogContent>
    </Dialog>
  );
}
