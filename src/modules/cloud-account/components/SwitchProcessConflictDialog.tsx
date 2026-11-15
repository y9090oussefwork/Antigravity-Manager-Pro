import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  closeAllProcesses,
  closeProcessByPid,
  listRunningProcesses,
} from '@/modules/antigravity-runtime/actions/process';
import type { RunningProcessSummary } from '@/modules/antigravity-runtime/ipc/handler';
import type { AntigravityAppTarget } from '@/shared/platform/antigravityAppTarget';

interface SwitchProcessConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target?: AntigravityAppTarget;
  accountEmail?: string;
  onRetrySwitch: () => void;
}

export function SwitchProcessConflictDialog({
  open,
  onOpenChange,
  target,
  accountEmail,
  onRetrySwitch,
}: SwitchProcessConflictDialogProps) {
  const { t } = useTranslation();
  const [processes, setProcesses] = useState<RunningProcessSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [closingPid, setClosingPid] = useState<number | null>(null);
  const [closingAll, setClosingAll] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    setErrorMessage(null);
    try {
      const list = await listRunningProcesses(target);
      setProcesses(list);
      return list;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
      return [];
    } finally {
      setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let active = true;
    listRunningProcesses(target)
      .then((list) => {
        if (!active) {
          return;
        }
        setProcesses(list);
        setErrorMessage(null);
      })
      .catch((error) => {
        if (!active) {
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [open, target]);

  const handleCloseSingle = async (pid: number) => {
    setClosingPid(pid);
    setErrorMessage(null);
    try {
      await closeProcessByPid(pid);
      await loadProcesses();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClosingPid(null);
    }
  };

  const handleCloseAllAndRetry = async () => {
    setClosingAll(true);
    setErrorMessage(null);
    try {
      await closeAllProcesses(target);
      const remaining = await loadProcesses();
      if (remaining.length === 0) {
        onOpenChange(false);
        onRetrySwitch();
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setClosingAll(false);
    }
  };

  const handleRetry = () => {
    onOpenChange(false);
    onRetrySwitch();
  };

  const isBusy = loading || closingAll || closingPid !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <span>{t('cloud.switch-conflict-dialog.title')}</span>
          </DialogTitle>
          <DialogDescription>
            {accountEmail
              ? t('cloud.switch-conflict-dialog.description-with-account', {
                  email: accountEmail,
                })
              : t('cloud.switch-conflict-dialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {t('cloud.switch-conflict-dialog.running-count', { count: processes.length })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={isBusy}
              onClick={() => {
                void loadProcesses();
              }}
              className="h-7 gap-1.5 px-2 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('cloud.switch-conflict-dialog.refresh')}</span>
            </Button>
          </div>

          {errorMessage ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </div>
          ) : null}

          {processes.length === 0 && !loading ? (
            <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-3 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>{t('cloud.switch-conflict-dialog.all-closed')}</span>
            </div>
          ) : (
            <div className="max-h-60 space-y-2 overflow-y-auto pe-1">
              {processes.map((proc) => (
                <div
                  key={proc.pid}
                  className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] font-medium uppercase">
                        {proc.target}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        PID {proc.pid}
                      </span>
                    </div>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={proc.userDataDir ?? proc.executablePath}
                    >
                      {proc.userDataDir
                        ? t('cloud.switch-conflict-dialog.isolated-profile', {
                            path: proc.userDataDir,
                          })
                        : t('cloud.switch-conflict-dialog.default-profile')}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => {
                      void handleCloseSingle(proc.pid);
                    }}
                    className="h-7 shrink-0 gap-1 px-2 text-xs"
                  >
                    <X className="h-3.5 w-3.5" />
                    <span>{t('cloud.switch-conflict-dialog.close-one')}</span>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            disabled={closingAll}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button type="button" variant="outline" disabled={isBusy} onClick={handleRetry}>
            {t('cloud.switch-conflict-dialog.retry-switch')}
          </Button>
          {processes.length > 0 ? (
            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              onClick={() => {
                void handleCloseAllAndRetry();
              }}
            >
              {t('cloud.switch-conflict-dialog.close-all-and-retry')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
