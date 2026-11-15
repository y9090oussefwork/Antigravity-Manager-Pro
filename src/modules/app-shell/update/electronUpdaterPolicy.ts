import type { ManualUpdateInfo, ManualUpdatePlatform, UpdateNotificationState } from './types';

const RELEASE_TAG_URL_PREFIX = 'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/tag/';

interface BuildElectronUpdaterNotificationInput {
  state: UpdateNotificationState;
  platform: ManualUpdatePlatform;
  version: string;
  releaseName?: string | null;
  downloadPercent?: number;
}

export function buildElectronUpdaterNotification({
  state,
  platform,
  version,
  releaseName,
  downloadPercent,
}: BuildElectronUpdaterNotificationInput): ManualUpdateInfo {
  const tagName = version.startsWith('v') ? version : `v${version}`;

  return {
    version,
    tagName,
    releaseName: releaseName || tagName,
    releaseUrl: `${RELEASE_TAG_URL_PREFIX}${tagName}`,
    platform,
    source: 'electron-updater',
    state,
    ...(downloadPercent === undefined ? {} : { downloadPercent }),
  };
}
