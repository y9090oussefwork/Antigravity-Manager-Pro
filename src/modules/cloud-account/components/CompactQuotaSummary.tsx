import { useTranslation } from 'react-i18next';
import type { CloudQuotaData, CloudQuotaGroup } from '@/modules/cloud-account/types';
import {
  clampQuotaPercentage,
  formatResetTimeLabel,
  getQuotaStatus,
} from '@/modules/cloud-account/utils/quota-display';
import { isWeeklyQuotaBucket } from '@/modules/cloud-account/utils/quota-groups';
import { QUOTA_TEXT_COLOR_CLASS_BY_STATUS } from './quota-colors';

interface CompactQuotaRow {
  id: string;
  label: string;
  percentage: number;
  resetTime?: string;
}

interface CompactQuotaSection {
  id: string;
  title: string;
  rows: CompactQuotaRow[];
}

function QuotaRing({ percentage }: { percentage: number }) {
  const clamped = clampQuotaPercentage(percentage);
  const status = getQuotaStatus(clamped);
  const strokeClass = QUOTA_TEXT_COLOR_CLASS_BY_STATUS[status];
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (clamped / 100) * circumference;

  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      className="shrink-0 -rotate-90"
      aria-hidden="true"
    >
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        className="text-muted/60"
      />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className={strokeClass}
      />
    </svg>
  );
}

function buildSectionsFromGroups(
  groups: readonly CloudQuotaGroup[],
  fiveHourLabel: string,
  weeklyLabel: string,
): CompactQuotaSection[] {
  return groups
    .filter((group) => group.buckets.length > 0)
    .map((group) => {
      const sortedBuckets = [...group.buckets].sort((a, b) => {
        const aWeekly = isWeeklyQuotaBucket(a) ? 0 : 1;
        const bWeekly = isWeeklyQuotaBucket(b) ? 0 : 1;
        return aWeekly - bWeekly;
      });
      return {
        id: group.display_name,
        title: group.display_name,
        rows: sortedBuckets.map((bucket) => ({
          id: `${bucket.bucket_id}:${bucket.window}`,
          label: bucket.display_name || (isWeeklyQuotaBucket(bucket) ? weeklyLabel : fiveHourLabel),
          percentage: Math.round(bucket.remaining_fraction * 100),
          resetTime: bucket.reset_time,
        })),
      };
    });
}

function buildFallbackSections(
  quota: CloudQuotaData | undefined,
  geminiTitle: string,
  claudeTitle: string,
  fiveHourLabel: string,
): CompactQuotaSection[] {
  const entries = Object.entries(quota?.models ?? {});
  if (entries.length === 0) {
    return [];
  }

  const summarize = (
    id: string,
    title: string,
    matcher: (name: string) => boolean,
  ): CompactQuotaSection | null => {
    const matched = entries.filter(([name]) => matcher(name.toLowerCase()));
    if (matched.length === 0) {
      return null;
    }
    const minEntry = matched.reduce((best, curr) =>
      curr[1].percentage < best[1].percentage ? curr : best,
    );
    return {
      id,
      title,
      rows: [
        {
          id: `${id}:5h`,
          label: fiveHourLabel,
          percentage: Math.round(minEntry[1].percentage),
          resetTime: minEntry[1].resetTime,
        },
      ],
    };
  };

  return [
    summarize('gemini', geminiTitle, (name) => name.includes('gemini')),
    summarize('claude-gpt', claudeTitle, (name) => name.includes('claude') || name.includes('gpt')),
  ].filter((section): section is CompactQuotaSection => section !== null);
}

export function CompactQuotaSummary({ quota }: { quota?: CloudQuotaData }) {
  const { t } = useTranslation();
  const fiveHourLabel = t('cloud.compact-summary.five-hour-limit');
  const weeklyLabel = t('cloud.compact-summary.weekly-limit');

  const sections =
    quota?.quota_groups && quota.quota_groups.length > 0
      ? buildSectionsFromGroups(quota.quota_groups, fiveHourLabel, weeklyLabel)
      : buildFallbackSections(
          quota,
          t('cloud.compact-summary.gemini-models'),
          t('cloud.compact-summary.claude-gpt-models'),
          fiveHourLabel,
        );

  if (sections.length === 0) {
    return (
      <div className="text-muted-foreground rounded-lg border px-3 py-2.5 text-xs">
        {t('cloud.card.noQuotaData')}
      </div>
    );
  }

  return (
    <div
      data-slot="compact-quota-summary"
      className="bg-muted/20 space-y-2.5 rounded-lg border px-3 py-2.5"
    >
      {sections.map((section) => (
        <div key={section.id} className="space-y-1">
          <div className="text-foreground text-xs font-semibold">{section.title}</div>
          <div className="space-y-1">
            {section.rows.map((row) => {
              const status = getQuotaStatus(row.percentage);
              const resetLabel = row.resetTime
                ? formatResetTimeLabel(row.resetTime, {
                    prefix: t('cloud.compact-summary.resets-in'),
                    unknown: '',
                  })
                : '';
              return (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-3 text-xs leading-tight"
                >
                  <div className="min-w-0">
                    <div className="text-muted-foreground">{row.label}</div>
                    {resetLabel ? (
                      <div className="text-muted-foreground/80 text-[11px]">{resetLabel}</div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span
                      className={`font-medium tabular-nums ${QUOTA_TEXT_COLOR_CLASS_BY_STATUS[status]}`}
                    >
                      {t('cloud.compact-summary.percent-left', {
                        percent: clampQuotaPercentage(row.percentage),
                      })}
                    </span>
                    <QuotaRing percentage={row.percentage} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
