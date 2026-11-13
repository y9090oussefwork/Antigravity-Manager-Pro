const WINDOWS_UPDATE_BASE_URL =
  'https://raw.githubusercontent.com/y9090oussefwork/Antigravity-Manager-Pro/release-updates';

export function getWindowsUpdateBaseUrl({
  platform = process.platform,
  arch = process.arch,
}: {
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
} = {}) {
  return `${WINDOWS_UPDATE_BASE_URL}/${platform}/${arch}`;
}

export function getWindowsNsisUpdateBaseUrl(_arch: NodeJS.Architecture = process.arch): string {
  return 'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/latest/download';
}
