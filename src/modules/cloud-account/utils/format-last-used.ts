import { formatDistanceToNow, type Locale } from 'date-fns';
import { arEG, enUS, fr, ptBR, ru, tr, vi, zhCN } from 'date-fns/locale';

const locales: Partial<Record<string, Locale>> = {
  ar: arEG,
  en: enUS,
  fr,
  pt: ptBR,
  ru,
  tr,
  vi,
  zh: zhCN,
};

export function formatAccountLastUsed(timestampSeconds: number, language = 'en'): string {
  return formatDistanceToNow(timestampSeconds * 1000, {
    addSuffix: true,
    locale: locales[language?.split('-')[0] ?? 'en'] ?? enUS,
  });
}
