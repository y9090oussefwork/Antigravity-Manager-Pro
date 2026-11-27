import { useTranslation } from 'react-i18next';
import React, { useMemo, useState } from 'react';
import { FolderOpen, Loader2, Shield, AlertCircle, Search, Zap, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  classifyAccountModelCategory,
  type AccountModelCategory,
} from '@/modules/cloud-account/utils/account-model-category';
import {
  classifyWorkspaceAccountStatus,
  getWorkspaceAccountMinQuotaPercentage,
} from '@/modules/workspace/utils/workspace-account-status';
import { selectWorkspaceDirectory } from '@/modules/workspace/actions/workspace';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import type {
  CreateWorkspaceProfileInput,
  UpdateWorkspaceProfileInput,
  WorkspaceProfileView,
} from '@/modules/workspace/types';

export interface WorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspace?: WorkspaceProfileView | null;
  initialData?: WorkspaceProfileView | null;
  accounts: CloudAccountView[];
  onSubmit: (data: CreateWorkspaceProfileInput | UpdateWorkspaceProfileInput) => Promise<void>;
  isSubmitting?: boolean;
  onSelectDirectory?: (defaultPath?: string) => Promise<string | null>;
}

function getInitialAccountIds(
  activeProfile: WorkspaceProfileView | null,
  accounts: CloudAccountView[],
): string[] {
  if (activeProfile) {
    const raw = activeProfile.accountIds?.length ? activeProfile.accountIds : [activeProfile.accountId];
    return Array.from(new Set(raw.filter(Boolean)));
  }
  return accounts[0]?.id ? [accounts[0].id] : [];
}

export const WorkspaceDialog: React.FC<WorkspaceDialogProps> = ({
  open,
  onOpenChange,
  workspace,
  initialData,
  accounts,
  onSubmit,
  isSubmitting = false,
  onSelectDirectory = selectWorkspaceDirectory,
}) => {
  const { t } = useTranslation();
  const activeProfile = workspace ?? initialData ?? null;
  const isEdit = Boolean(activeProfile);

  const [name, setName] = useState(activeProfile?.name ?? '');
  const [accountId, setAccountId] = useState(activeProfile?.accountId ?? accounts[0]?.id ?? '');
  const [accountIds, setAccountIds] = useState<string[]>(() =>
    getInitialAccountIds(activeProfile, accounts),
  );
  const [autoSwitchEnabled, setAutoSwitchEnabled] = useState<boolean>(
    activeProfile?.autoSwitchEnabled ?? false,
  );
  const [accountSearch, setAccountSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<AccountModelCategory>('all');
  const [error, setError] = useState<string | null>(null);
  const [isBrowsing, setIsBrowsing] = useState(false);
  const [projectPath, setProjectPath] = useState(activeProfile?.projectPath ?? '');
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevProfileId, setPrevProfileId] = useState(activeProfile?.id);

  if (open !== prevOpen || activeProfile?.id !== prevProfileId) {
    setPrevOpen(open);
    setPrevProfileId(activeProfile?.id);
    if (open) {
      if (activeProfile) {
        setName(activeProfile.name);
        setAccountId(activeProfile.accountId);
        setAccountIds(getInitialAccountIds(activeProfile, accounts));
        setAutoSwitchEnabled(Boolean(activeProfile.autoSwitchEnabled));
        setProjectPath(activeProfile.projectPath);
      } else {
        setName('');
        setAccountId(accounts[0]?.id ?? '');
        setAccountIds(accounts[0]?.id ? [accounts[0].id] : []);
        setAutoSwitchEnabled(false);
        setProjectPath('');
      }
      setAccountSearch('');
      setCategoryFilter('all');
      setError(null);
    }
  }

  const selectedSet = useMemo(() => new Set(accountIds), [accountIds]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    return accounts.filter((acc) => {
      if (categoryFilter !== 'all' && classifyAccountModelCategory(acc) !== categoryFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const email = acc.email.toLowerCase();
      const displayName = acc.name?.toLowerCase() ?? '';
      return email.includes(query) || displayName.includes(query);
    });
  }, [accounts, accountSearch, categoryFilter]);

  const toggleAccountMembership = (id: string, checked: boolean) => {
    if (checked) {
      const next = accountIds.includes(id) ? accountIds : [...accountIds, id];
      setAccountIds(next);
      if (!accountId) {
        setAccountId(id);
      }
      return;
    }

    const next = accountIds.filter((item) => item !== id);
    setAccountIds(next);
    if (accountId === id) {
      setAccountId(next[0] ?? '');
    }
  };

  const handleSetActiveAccount = (id: string) => {
    if (!selectedSet.has(id)) {
      setAccountIds((prev) => [...prev, id]);
    }
    setAccountId(id);
  };

  const handleBrowseFolder = async () => {
    setIsBrowsing(true);
    try {
      const selected = await onSelectDirectory(projectPath || undefined);
      if (selected) {
        setProjectPath(selected);
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('workspace-profile.failed-to-select-directory'),
      );
    } finally {
      setIsBrowsing(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedPath = projectPath.trim();
    const normalizedIds = accountIds.filter(Boolean);
    const resolvedActiveId =
      accountId && normalizedIds.includes(accountId) ? accountId : (normalizedIds[0] ?? '');

    if (!trimmedName) {
      setError(t('workspace-profile.workspace-profile-name-is-required'));
      return;
    }
    if (trimmedName.length > 100) {
      setError(t('workspace-profile.workspace-profile-name-cannot-exceed-100-characters'));
      return;
    }
    if (!resolvedActiveId || normalizedIds.length === 0) {
      setError(t('workspace-profile.a-bound-google-account-must-be-selected'));
      return;
    }
    if (!trimmedPath) {
      setError(t('workspace-profile.project-directory-path-is-required'));
      return;
    }

    const initialIds = getInitialAccountIds(activeProfile, accounts);
    const idsChanged =
      normalizedIds.length !== initialIds.length ||
      normalizedIds.some((id, index) => id !== initialIds[index]);
    const initialAutoSwitch = Boolean(activeProfile?.autoSwitchEnabled);
    const autoSwitchChanged = autoSwitchEnabled !== initialAutoSwitch;

    try {
      if (isEdit && activeProfile) {
        const updatePayload: UpdateWorkspaceProfileInput = {
          id: activeProfile.id,
          name: trimmedName,
          accountId: resolvedActiveId,
          projectPath: trimmedPath,
          ...(idsChanged || normalizedIds.length > 1 ? { accountIds: normalizedIds } : {}),
          ...(autoSwitchChanged || autoSwitchEnabled ? { autoSwitchEnabled } : {}),
        };
        await onSubmit(updatePayload);
      } else {
        const createPayload: CreateWorkspaceProfileInput = {
          name: trimmedName,
          accountId: resolvedActiveId,
          projectPath: trimmedPath,
          ...(normalizedIds.length > 1 ? { accountIds: normalizedIds } : {}),
          ...(autoSwitchEnabled ? { autoSwitchEnabled } : {}),
        };
        await onSubmit(createPayload);
      }
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('workspace-profile.failed-to-save-workspace-profile'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit
              ? t('workspace-profile.edit-workspace-profile')
              : t('workspace-profile.create-new-workspace')}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? t('workspace-profile.edit-description')
              : t('workspace-profile.create-description')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} noValidate className="space-y-4 py-2">
          {activeProfile?.status.running && (
            <p className="text-muted-foreground text-sm" role="status">
              {t('workspace-profile.restart-warning')}
            </p>
          )}
          {error && (
            <div
              role="alert"
              className="border-destructive/20 bg-destructive/10 text-destructive flex items-center gap-2 rounded-lg border p-3 text-xs"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Profile Name Field */}
          <div className="space-y-1.5">
            <Label htmlFor="ws-name">{t('workspace-profile.profile-name')}</Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('workspace-profile.e-g-acme-client-portal-personal-research')}
              maxLength={100}
              required
            />
          </div>

          {/* Assigned Google Accounts Pool */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ws-account-search">{t('workspace-profile.assigned-accounts')}</Label>
              <span className="text-muted-foreground text-xs tabular-nums">
                {t('workspace-profile.selected-accounts-count', { count: accountIds.length })}
              </span>
            </div>
            {accounts.length === 0 ? (
              <div className="border-warning-border bg-warning-soft/30 text-warning rounded-lg border p-3 text-xs">
                {t('workspace-profile.no-accounts')}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border p-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[160px] flex-1">
                    <Search className="text-muted-foreground pointer-events-none absolute top-1/2 start-2.5 h-3.5 w-3.5 -translate-y-1/2" />
                    <Input
                      id="ws-account-search"
                      value={accountSearch}
                      onChange={(e) => setAccountSearch(e.target.value)}
                      placeholder={t('workspace-profile.search-accounts-placeholder')}
                      className="h-8 ps-8 text-xs"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {(['all', 'gemini-pro', 'gemini-pro-go'] as const).map((cat) => (
                      <Button
                        key={cat}
                        type="button"
                        size="xs"
                        variant={categoryFilter === cat ? 'secondary' : 'ghost'}
                        aria-pressed={categoryFilter === cat}
                        onClick={() => setCategoryFilter(cat)}
                        className="h-7 px-2 text-[11px]"
                      >
                        {t(`cloud.model-category.${cat}`)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="max-h-52 divide-y overflow-y-auto rounded-md border">
                  {filteredAccounts.length === 0 ? (
                    <div className="text-muted-foreground px-3 py-4 text-center text-xs">
                      {t('workspace-profile.no-matching-accounts')}
                    </div>
                  ) : (
                    filteredAccounts.map((acc) => {
                      const isChecked = selectedSet.has(acc.id);
                      const isCurrentActive = acc.id === accountId;
                      const accountStatus = classifyWorkspaceAccountStatus(acc, accountId);
                      const modelCategory = classifyAccountModelCategory(acc);
                      const minQuota = getWorkspaceAccountMinQuotaPercentage(acc.quota);

                      return (
                        <div
                          key={acc.id}
                          className={`flex items-center justify-between gap-2 px-2.5 py-2 transition-colors ${
                            isChecked ? 'bg-primary/5' : 'hover:bg-muted/40'
                          }`}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2.5">
                            <Checkbox
                              id={`ws-acc-${acc.id}`}
                              checked={isChecked}
                              onCheckedChange={(checked) =>
                                toggleAccountMembership(acc.id, checked === true)
                              }
                              aria-label={acc.email}
                            />
                            <Avatar className="h-6 w-6 shrink-0 rounded-full border">
                              {acc.avatar_url && <AvatarImage src={acc.avatar_url} />}
                              <AvatarFallback className="text-[10px] font-bold">
                                {acc.email[0].toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <label
                              htmlFor={`ws-acc-${acc.id}`}
                              className="min-w-0 flex-1 cursor-pointer"
                            >
                              <div className="text-foreground truncate text-xs font-medium">
                                {acc.email}
                              </div>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px]">
                                {acc.quota?.subscription_tier && (
                                  <Badge variant="outline" className="h-4 px-1 py-0 text-[10px]">
                                    {acc.quota.subscription_tier}
                                  </Badge>
                                )}
                                {modelCategory !== 'other' && (
                                  <Badge variant="secondary" className="h-4 px-1 py-0 text-[10px]">
                                    {t(`cloud.model-category.${modelCategory}`)}
                                  </Badge>
                                )}
                                <span
                                  className={
                                    accountStatus === 'available' || accountStatus === 'active'
                                      ? 'text-success'
                                      : accountStatus === 'exhausted'
                                        ? 'text-amber-600 dark:text-amber-400'
                                        : 'text-destructive'
                                  }
                                >
                                  {t(`workspace-profile.account-status.${accountStatus}`)}
                                  {minQuota !== null ? ` (${minQuota}%)` : ''}
                                </span>
                              </div>
                            </label>
                          </div>

                          <div className="shrink-0">
                            {isCurrentActive ? (
                              <Badge
                                variant="secondary"
                                className="border-primary/30 bg-primary/10 text-primary h-6 gap-1 px-2 text-[10px]"
                              >
                                <Check className="h-3 w-3" />
                                {t('workspace-profile.active-for-launch')}
                              </Badge>
                            ) : (
                              <Button
                                type="button"
                                size="xs"
                                variant="ghost"
                                onClick={() => handleSetActiveAccount(acc.id)}
                                className="h-6 px-2 text-[10px]"
                              >
                                {t('workspace-profile.set-active-account')}
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Per-Project Auto-Switch Toggle */}
          <div className="bg-muted/20 flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div className="min-w-0 space-y-0.5">
              <Label
                htmlFor="ws-auto-switch"
                className="flex cursor-pointer items-center gap-1.5 text-xs font-medium"
              >
                <Zap
                  className={`h-3.5 w-3.5 ${autoSwitchEnabled ? 'text-primary' : 'text-muted-foreground'}`}
                />
                {t('workspace-profile.auto-switch-title')}
              </Label>
              <p className="text-muted-foreground text-[11px]">
                {t('workspace-profile.auto-switch-description')}
              </p>
            </div>
            <Switch
              id="ws-auto-switch"
              checked={autoSwitchEnabled}
              onCheckedChange={setAutoSwitchEnabled}
            />
          </div>

          {/* Project Directory with Folder Browse Button */}
          <div className="space-y-1.5">
            <Label htmlFor="ws-path">{t('workspace-profile.project-directory')}</Label>
            <div className="flex gap-2">
              <Input
                id="ws-path"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                placeholder={t('workspace-profile.path-to-project-folder')}
                className="flex-1 font-mono text-xs"
                required
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleBrowseFolder}
                disabled={isBrowsing}
                aria-label={t('workspace-profile.browse-for-project-folder')}
                title={t('workspace-profile.browse-folder')}
              >
                {isBrowsing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FolderOpen className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Auto-Generated User Data Directory Preview */}
          <div className="bg-muted/40 space-y-1.5 rounded-lg border p-3 text-xs">
            <div className="text-muted-foreground flex items-center justify-between font-medium">
              <span className="flex items-center gap-1.5">
                <Shield className="text-primary h-3.5 w-3.5" />
                {t('workspace-profile.isolated-user-data-directory')}
              </span>
              <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">
                {t('workspace-profile.auto-managed')}
              </Badge>
            </div>
            <p className="text-foreground/80 bg-background/80 border-border/50 rounded border px-2.5 py-1.5 font-mono text-[11px] break-all">
              {isEdit && activeProfile
                ? activeProfile.userDataDir
                : t('workspace-profile.created-automatically-when-saved')}
            </p>
            <p className="text-muted-foreground text-[11px]">
              {t('workspace-profile.login-data-description')}
            </p>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              {t('workspace-profile.cancel')}
            </Button>
            <Button type="submit" disabled={isSubmitting || accounts.length === 0}>
              {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit
                ? t('workspace-profile.save-changes')
                : t('workspace-profile.create-workspace')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
