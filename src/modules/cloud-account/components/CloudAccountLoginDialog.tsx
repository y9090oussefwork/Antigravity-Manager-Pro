import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Cloud, DatabaseZap, ExternalLink, KeyRound, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
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

export function CloudAccountLoginDialog() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const validationLink = useOpenAccountValidationLink();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<AddMethod>('google');
  const [importing, setImporting] = useState(false);
  const [pendingValidationAccount, setPendingValidationAccount] = useState<CloudAccountView | null>(
    null,
  );
  const [recheckingValidation, setRecheckingValidation] = useState(false);
  const [validationRecheckState, setValidationRecheckState] = useState<'idle' | 'pending' | 'failed'>(
    'idle',
  );
  const sessionQueueRef = useRef(Promise.resolve());

  const accountSaved = useCallback(
    (isCurrent: boolean, account?: CloudAccountView) => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.cloudAccounts });
      if (!isCurrent) {
        return;
      }
      if (account?.health?.validation) {
        setPendingValidationAccount(account);
        setValidationRecheckState('idle');
        return;
      }
      setPendingValidationAccount(null);
      setOpen(false);
      toast({ title: t('cloud.toast.addSuccess'), variant: 'success' });
    },
    [queryClient, t, toast],
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
          if (nextOpen) {
            setMethod('google');
          }
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden="true" className="size-4" />
          {t('cloud.addAccount')}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl" closeDisabled={closeBusy}>
        <DialogHeader>
          <DialogTitle>
            {pendingValidationAccount
              ? t('cloud.authDialog.validation-required.title')
              : t('cloud.addAccount')}
          </DialogTitle>
          <DialogDescription>
            {pendingValidationAccount
              ? t('cloud.authDialog.validation-required.description', {
                  email: pendingValidationAccount.email,
                })
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
                    setOpen(false);
                  }}
                >
                  {t('cloud.authDialog.validation-required.later')}
                </Button>
              </div>
            </div>
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
