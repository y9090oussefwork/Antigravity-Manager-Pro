import { useTranslation } from 'react-i18next';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import { getQuotaStatus } from '@/modules/cloud-account/utils/quota-display';
import {
  DEFAULT_QUOTA_GROUP_VISIBILITY,
  isClaudeQuotaHidden,
  type QuotaGroupVisibility,
} from '@/modules/cloud-account/utils/quota-group-visibility';
import { QUOTA_TEXT_COLOR_CLASS_BY_STATUS } from '@/modules/cloud-account/components/quota-colors';
import { cn } from '@/shared/ui/utils';
import {
  formatWorkspaceAccountQuotaSummary,
  getWorkspaceAccountWindowQuota,
  type FamilyWindowQuota,
} from '@/modules/workspace/utils/workspace-account-status';

interface WorkspaceQuotaBadgesProps {
  quota: CloudAccountView['quota'] | undefined;
  visibility?: QuotaGroupVisibility;
  className?: string;
}

function WindowPill({ label, percentage }: { label: string; percentage: number }) {
  const status = getQuotaStatus(percentage);
  return (
    <span
      className={cn(
        'border-border/70 bg-muted/40 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums',
        QUOTA_TEXT_COLOR_CLASS_BY_STATUS[status],
      )}
    >
      <span className="text-muted-foreground font-normal">{label}</span>
      <span>{percentage}%</span>
    </span>
  );
}

function FamilyWindowChip({
  familyLabel,
  windows,
  fiveHourLabel,
  weeklyLabel,
}: {
  familyLabel: string;
  windows: FamilyWindowQuota;
  fiveHourLabel: string;
  weeklyLabel: string;
}) {
  if (windows.fiveHour === null && windows.weekly === null) {
    return null;
  }

  return (
    <span className="border-border/70 bg-muted/40 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs tabular-nums">
      <span className="text-muted-foreground font-medium">{familyLabel}</span>
      {windows.fiveHour !== null && (
        <span
          className={cn(
            'font-semibold',
            QUOTA_TEXT_COLOR_CLASS_BY_STATUS[getQuotaStatus(windows.fiveHour)],
          )}
        >
          {fiveHourLabel} {windows.fiveHour}%
        </span>
      )}
      {windows.fiveHour !== null && windows.weekly !== null && (
        <span className="text-muted-foreground" aria-hidden="true">
          ·
        </span>
      )}
      {windows.weekly !== null && (
        <span
          className={cn(
            'font-semibold',
            QUOTA_TEXT_COLOR_CLASS_BY_STATUS[getQuotaStatus(windows.weekly)],
          )}
        >
          {weeklyLabel} {windows.weekly}%
        </span>
      )}
    </span>
  );
}

export function WorkspaceQuotaBadges({
  quota,
  visibility = DEFAULT_QUOTA_GROUP_VISIBILITY,
  className,
}: WorkspaceQuotaBadgesProps) {
  const { t } = useTranslation();
  const summary = getWorkspaceAccountWindowQuota(quota, visibility);

  if (summary.fiveHour === null && summary.weekly === null) {
    return null;
  }

  const fiveHourShort = t('cloud.quota-window.five-hours-short');
  const weeklyShort = t('cloud.quota-window.weekly-short');
  const title = formatWorkspaceAccountQuotaSummary(quota, visibility);
  const claudeHasData = summary.claude.fiveHour !== null || summary.claude.weekly !== null;
  const geminiHasData = summary.gemini.fiveHour !== null || summary.gemini.weekly !== null;
  const showSingleFamilyMode = isClaudeQuotaHidden(visibility) || !claudeHasData;

  if (showSingleFamilyMode) {
    const targetFiveHour = geminiHasData ? summary.gemini.fiveHour : summary.fiveHour;
    const targetWeekly = geminiHasData ? summary.gemini.weekly : summary.weekly;

    return (
      <div className={cn('flex flex-wrap items-center gap-1', className)} title={title}>
        {targetFiveHour !== null && (
          <WindowPill label={fiveHourShort} percentage={targetFiveHour} />
        )}
        {targetWeekly !== null && <WindowPill label={weeklyShort} percentage={targetWeekly} />}
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)} title={title}>
      {geminiHasData && (
        <FamilyWindowChip
          familyLabel="Gemini"
          windows={summary.gemini}
          fiveHourLabel={fiveHourShort}
          weeklyLabel={weeklyShort}
        />
      )}
      {claudeHasData && (
        <FamilyWindowChip
          familyLabel="Claude"
          windows={summary.claude}
          fiveHourLabel={fiveHourShort}
          weeklyLabel={weeklyShort}
        />
      )}
    </div>
  );
}
