import { execFile, spawn } from 'node:child_process';
import { constants as fsConstants, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import type { CloudAccountView } from '@/modules/cloud-account/services/cloud-account-view';
import { DesktopOAuthLoginError } from '@/modules/cloud-account/services/desktop-oauth-login.error';
import { GoogleLoginOperation } from '@/modules/cloud-account/services/google-login-operation';
import { normalizeTrustedGoogleValidationUrl } from '@/modules/cloud-account/utils/google-validation-url';
import {
  type BrowserId,
  type BrowserProfileDiscoveryResult,
  type DiscoveredBrowserAccount,
  type DiscoveredBrowserProfile,
  OpenBrowserProfileInputSchema,
  type ScannedBrowserSummary,
} from './browser-profile-discovery.schema';

const execFileAsync = promisify(execFile);

const ROOT_PROFILE_SENTINEL = '__default_root__';

interface BrowserDefinition {
  id: BrowserId;
  name: string;
  executableNames: readonly string[];
  macosAppNames?: readonly string[];
  getUserDataDirs: (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, homeDir: string) => string[];
  getCandidateExecutables: (
    platform: NodeJS.Platform,
    env: NodeJS.ProcessEnv,
    homeDir: string,
  ) => string[];
}

const LocalStateSchema = z
  .object({
    profile: z
      .object({
        info_cache: z
          .record(
            z.string(),
            z
              .object({
                name: z.string().optional(),
                shortcut_name: z.string().optional(),
                gaia_name: z.string().optional(),
                user_name: z.string().optional(),
                last_downloaded_gaia_picture_url_with_size: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const PreferencesSchema = z
  .object({
    account_info: z
      .array(
        z
          .object({
            email: z.string().optional(),
            full_name: z.string().optional(),
            given_name: z.string().optional(),
            picture_url: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    google: z
      .object({
        services: z
          .object({
            username: z.string().optional(),
          })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
    profile: z
      .object({
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

function windowsUserDataDir(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  root: 'local' | 'roaming',
  ...segments: string[]
): string {
  const base =
    root === 'local'
      ? (env.LOCALAPPDATA ?? path.join(homeDir, 'AppData', 'Local'))
      : (env.APPDATA ?? path.join(homeDir, 'AppData', 'Roaming'));
  return path.join(base, ...segments);
}

function windowsProgramCandidates(env: NodeJS.ProcessEnv, ...relativePaths: string[]): string[] {
  const bases = [
    env.ProgramFiles,
    env['ProgramFiles(x86)'],
    env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : undefined,
    env.LOCALAPPDATA,
  ].filter((value): value is string => Boolean(value));

  const candidates: string[] = [];
  for (const base of bases) {
    for (const rel of relativePaths) {
      candidates.push(path.join(base, rel));
    }
  }
  return candidates;
}

const BROWSER_DEFINITIONS: readonly BrowserDefinition[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    executableNames: ['chrome.exe', 'google-chrome', 'google-chrome-stable'],
    macosAppNames: ['Google Chrome.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'local', 'Google', 'Chrome', 'User Data')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome')];
      }
      return [path.join(homeDir, '.config', 'google-chrome')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(env, path.join('Google', 'Chrome', 'Application', 'chrome.exe'));
      }
      if (platform === 'darwin') {
        return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
      }
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];
    },
  },
  {
    id: 'chrome-beta',
    name: 'Google Chrome Beta',
    executableNames: ['chrome.exe', 'google-chrome-beta'],
    macosAppNames: ['Google Chrome Beta.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'local', 'Google', 'Chrome Beta', 'User Data')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Google', 'Chrome Beta')];
      }
      return [path.join(homeDir, '.config', 'google-chrome-beta')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(
          env,
          path.join('Google', 'Chrome Beta', 'Application', 'chrome.exe'),
        );
      }
      if (platform === 'darwin') {
        return ['/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta'];
      }
      return ['/usr/bin/google-chrome-beta'];
    },
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    executableNames: ['msedge.exe', 'microsoft-edge', 'microsoft-edge-stable'],
    macosAppNames: ['Microsoft Edge.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'local', 'Microsoft', 'Edge', 'User Data')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Microsoft Edge')];
      }
      return [path.join(homeDir, '.config', 'microsoft-edge')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(
          env,
          path.join('Microsoft', 'Edge', 'Application', 'msedge.exe'),
        );
      }
      if (platform === 'darwin') {
        return ['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'];
      }
      return ['/usr/bin/microsoft-edge', '/usr/bin/microsoft-edge-stable'];
    },
  },
  {
    id: 'brave',
    name: 'Brave',
    executableNames: ['brave.exe', 'brave-browser', 'brave'],
    macosAppNames: ['Brave Browser.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [
          windowsUserDataDir(env, homeDir, 'local', 'BraveSoftware', 'Brave-Browser', 'User Data'),
        ];
      }
      if (platform === 'darwin') {
        return [
          path.join(homeDir, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
        ];
      }
      return [path.join(homeDir, '.config', 'BraveSoftware', 'Brave-Browser')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(
          env,
          path.join('BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
        );
      }
      if (platform === 'darwin') {
        return ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'];
      }
      return ['/usr/bin/brave-browser', '/usr/bin/brave'];
    },
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    executableNames: ['vivaldi.exe', 'vivaldi', 'vivaldi-stable'],
    macosAppNames: ['Vivaldi.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'local', 'Vivaldi', 'User Data')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Vivaldi')];
      }
      return [path.join(homeDir, '.config', 'vivaldi')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(env, path.join('Vivaldi', 'Application', 'vivaldi.exe'));
      }
      if (platform === 'darwin') {
        return ['/Applications/Vivaldi.app/Contents/MacOS/Vivaldi'];
      }
      return ['/usr/bin/vivaldi', '/usr/bin/vivaldi-stable'];
    },
  },
  {
    id: 'chromium',
    name: 'Chromium',
    executableNames: ['chrome.exe', 'chromium', 'chromium-browser'],
    macosAppNames: ['Chromium.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'local', 'Chromium', 'User Data')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'Chromium')];
      }
      return [path.join(homeDir, '.config', 'chromium')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(env, path.join('Chromium', 'Application', 'chrome.exe'));
      }
      if (platform === 'darwin') {
        return ['/Applications/Chromium.app/Contents/MacOS/Chromium'];
      }
      return ['/usr/bin/chromium', '/usr/bin/chromium-browser'];
    },
  },
  {
    id: 'opera',
    name: 'Opera',
    executableNames: ['opera.exe', 'opera'],
    macosAppNames: ['Opera.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'roaming', 'Opera Software', 'Opera Stable')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'com.operasoftware.Opera')];
      }
      return [path.join(homeDir, '.config', 'opera')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(
          env,
          path.join('Opera', 'opera.exe'),
          path.join('Opera', 'launcher.exe'),
        );
      }
      if (platform === 'darwin') {
        return ['/Applications/Opera.app/Contents/MacOS/Opera'];
      }
      return ['/usr/bin/opera'];
    },
  },
  {
    id: 'opera-gx',
    name: 'Opera GX',
    executableNames: ['opera.exe', 'opera-gx'],
    macosAppNames: ['Opera GX.app'],
    getUserDataDirs: (platform, env, homeDir) => {
      if (platform === 'win32') {
        return [windowsUserDataDir(env, homeDir, 'roaming', 'Opera Software', 'Opera GX Stable')];
      }
      if (platform === 'darwin') {
        return [path.join(homeDir, 'Library', 'Application Support', 'com.operasoftware.OperaGX')];
      }
      return [path.join(homeDir, '.config', 'opera-gx')];
    },
    getCandidateExecutables: (platform, env) => {
      if (platform === 'win32') {
        return windowsProgramCandidates(
          env,
          path.join('Opera GX', 'opera.exe'),
          path.join('Opera GX', 'launcher.exe'),
        );
      }
      if (platform === 'darwin') {
        return ['/Applications/Opera GX.app/Contents/MacOS/Opera'];
      }
      return ['/usr/bin/opera-gx'];
    },
  },
];

export interface BrowserDiscoverySystemOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  customUserDataDirs?: Partial<Record<BrowserId, string>>;
  customExecutables?: Partial<Record<BrowserId, string | null>>;
}

function getBrowserDefinition(browserId: BrowserId): BrowserDefinition {
  const def = BROWSER_DEFINITIONS.find((entry) => entry.id === browserId);
  if (!def) {
    throw new Error(`Unknown browser definition: ${browserId}`);
  }
  return def;
}

function stripSurroundingQuotes(rawPath: string): string {
  const trimmed = rawPath.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

async function queryWindowsAppPath(executableName: string): Promise<string | null> {
  const roots = [
    `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
    `HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${executableName}`,
  ];
  for (const regKey of roots) {
    try {
      const { stdout } = await execFileAsync('reg.exe', ['query', regKey, '/ve'], {
        windowsHide: true,
        timeout: 1500,
      });
      const match = stdout.match(/REG_(?:SZ|EXPAND_SZ)\s+(.+)/i);
      if (!match?.[1]) {
        continue;
      }
      const candidate = stripSurroundingQuotes(match[1]);
      if (candidate && !candidate.startsWith('\\\\') && existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Missing registry key is expected when a browser is not installed.
    }
  }
  return null;
}

async function isFileExecutable(filePath: string, platform: NodeJS.Platform): Promise<boolean> {
  if (!filePath || filePath.startsWith('\\\\')) {
    return false;
  }
  try {
    const mode = platform === 'win32' ? fsConstants.F_OK : fsConstants.X_OK;
    await fs.access(filePath, mode);
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function resolveBrowserExecutable(
  browserId: BrowserId,
  options: BrowserDiscoverySystemOptions = {},
): Promise<{ type: 'executable'; path: string } | { type: 'macos-app'; appName: string } | null> {
  const custom = options.customExecutables?.[browserId];
  if (custom !== undefined) {
    if (!custom) {
      return null;
    }
    return { type: 'executable', path: custom };
  }

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  const definition = getBrowserDefinition(browserId);

  if (platform === 'win32') {
    // Check explicit candidate paths first so Chrome and Chrome Beta resolve distinctly even if both use chrome.exe in App Paths.
    for (const candidate of definition.getCandidateExecutables(platform, env, homeDir)) {
      if (await isFileExecutable(candidate, platform)) {
        return { type: 'executable', path: candidate };
      }
    }

    if (browserId !== 'chrome-beta' && browserId !== 'chromium' && browserId !== 'opera-gx') {
      for (const exeName of definition.executableNames) {
        if (!exeName.endsWith('.exe')) {
          continue;
        }
        const regPath = await queryWindowsAppPath(exeName);
        if (regPath && (await isFileExecutable(regPath, platform))) {
          return { type: 'executable', path: regPath };
        }
      }
    }

    return null;
  }

  if (platform === 'darwin') {
    for (const candidate of definition.getCandidateExecutables(platform, env, homeDir)) {
      if (await isFileExecutable(candidate, platform)) {
        const appName = definition.macosAppNames?.[0];
        if (appName) {
          return { type: 'macos-app', appName };
        }
        return { type: 'executable', path: candidate };
      }
    }
    return null;
  }

  for (const candidate of definition.getCandidateExecutables(platform, env, homeDir)) {
    if (await isFileExecutable(candidate, platform)) {
      return { type: 'executable', path: candidate };
    }
  }
  return null;
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function sanitizeAvatarUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeEmail(rawEmail: string | undefined): string | null {
  if (!rawEmail) {
    return null;
  }
  const trimmed = rawEmail.trim();
  const parsed = z.string().email().max(320).safeParse(trimmed);
  return parsed.success ? parsed.data : null;
}

interface RawDiscoveredAccount {
  email: string;
  fullName?: string;
  avatarUrl?: string;
}

async function readAccountsFromPreferences(
  preferencesPath: string,
  fallbackUserName?: string,
  fallbackAvatarUrl?: string,
): Promise<{ accounts: RawDiscoveredAccount[]; preferenceProfileName?: string }> {
  const rawJson = await readJsonFile(preferencesPath);
  const byEmail = new Map<string, RawDiscoveredAccount>();
  let preferenceProfileName: string | undefined;

  if (rawJson !== null) {
    const parsed = PreferencesSchema.safeParse(rawJson);
    if (parsed.success) {
      preferenceProfileName = parsed.data.profile?.name?.trim() || undefined;
      for (const entry of parsed.data.account_info ?? []) {
        const email = sanitizeEmail(entry.email);
        if (!email) {
          continue;
        }
        const key = email.toLowerCase();
        if (byEmail.has(key)) {
          continue;
        }
        const fullName = entry.full_name?.trim() || entry.given_name?.trim() || undefined;
        byEmail.set(key, {
          email,
          fullName,
          avatarUrl: sanitizeAvatarUrl(entry.picture_url),
        });
      }
      const fallbackPrefEmail = sanitizeEmail(parsed.data.google?.services?.username);
      if (fallbackPrefEmail && !byEmail.has(fallbackPrefEmail.toLowerCase())) {
        byEmail.set(fallbackPrefEmail.toLowerCase(), {
          email: fallbackPrefEmail,
          avatarUrl: sanitizeAvatarUrl(fallbackAvatarUrl),
        });
      }
    }
  }

  const fallbackCacheEmail = sanitizeEmail(fallbackUserName);
  if (fallbackCacheEmail && !byEmail.has(fallbackCacheEmail.toLowerCase())) {
    byEmail.set(fallbackCacheEmail.toLowerCase(), {
      email: fallbackCacheEmail,
      avatarUrl: sanitizeAvatarUrl(fallbackAvatarUrl),
    });
  }

  return {
    accounts: Array.from(byEmail.values()),
    preferenceProfileName,
  };
}

function resolveUserDataDirs(
  definition: BrowserDefinition,
  options: BrowserDiscoverySystemOptions,
): string[] {
  const customDir = options.customUserDataDirs?.[definition.id];
  if (customDir !== undefined) {
    return customDir ? [customDir] : [];
  }
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const homeDir = options.homeDir ?? os.homedir();
  return definition.getUserDataDirs(platform, env, homeDir);
}

interface RawBrowserProfileEntry {
  profileDirectory: string;
  profileName: string;
  accounts: RawDiscoveredAccount[];
}

async function scanUserDataDir(userDataDir: string): Promise<RawBrowserProfileEntry[]> {
  if (!existsSync(userDataDir)) {
    return [];
  }

  const localStateJson = await readJsonFile(path.join(userDataDir, 'Local State'));
  const localStateParsed =
    localStateJson !== null ? LocalStateSchema.safeParse(localStateJson) : null;
  const infoCache =
    localStateParsed && localStateParsed.success
      ? (localStateParsed.data.profile?.info_cache ?? {})
      : {};

  const candidateDirs = new Map<
    string,
    {
      cachedName?: string;
      cachedUserName?: string;
      cachedAvatar?: string;
    }
  >();

  for (const [profileDirectory, entry] of Object.entries(infoCache)) {
    if (!/^(?!\.\.?$)[A-Za-z0-9 ._@-]{1,128}$/.test(profileDirectory)) {
      continue;
    }
    const profileFolder = path.join(userDataDir, profileDirectory);
    if (!existsSync(profileFolder)) {
      continue;
    }
    candidateDirs.set(profileDirectory, {
      cachedName:
        entry.name?.trim() ||
        entry.shortcut_name?.trim() ||
        entry.gaia_name?.trim() ||
        undefined,
      cachedUserName: entry.user_name?.trim() || undefined,
      cachedAvatar: entry.last_downloaded_gaia_picture_url_with_size?.trim() || undefined,
    });
  }

  if (candidateDirs.size === 0) {
    try {
      const entries = await fs.readdir(userDataDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        if (entry.name !== 'Default' && !/^Profile \d+$/.test(entry.name)) {
          continue;
        }
        if (existsSync(path.join(userDataDir, entry.name, 'Preferences'))) {
          candidateDirs.set(entry.name, {});
        }
      }
    } catch {
      // Ignore unreadable user data root.
    }
  }

  if (candidateDirs.size === 0 && existsSync(path.join(userDataDir, 'Preferences'))) {
    candidateDirs.set(ROOT_PROFILE_SENTINEL, {});
  }

  const profileTasks = Array.from(candidateDirs.entries()).map(
    async ([profileDirectory, cached]): Promise<RawBrowserProfileEntry | null> => {
      const preferencesPath =
        profileDirectory === ROOT_PROFILE_SENTINEL
          ? path.join(userDataDir, 'Preferences')
          : path.join(userDataDir, profileDirectory, 'Preferences');
      const { accounts, preferenceProfileName } = await readAccountsFromPreferences(
        preferencesPath,
        cached.cachedUserName,
        cached.cachedAvatar,
      );
      if (accounts.length === 0) {
        return null;
      }

      const fallbackDirLabel =
        profileDirectory === ROOT_PROFILE_SENTINEL ? 'Default' : profileDirectory;
      const profileName =
        cached.cachedName || preferenceProfileName || fallbackDirLabel;

      return {
        profileDirectory,
        profileName,
        accounts,
      };
    },
  );

  const resolved = await Promise.all(profileTasks);
  return resolved.filter((item): item is RawBrowserProfileEntry => item !== null);
}

export async function discoverBrowserProfiles(
  existingAccounts: readonly CloudAccountView[],
  options: BrowserDiscoverySystemOptions = {},
): Promise<BrowserProfileDiscoveryResult> {
  const existingByEmail = new Map<string, CloudAccountView>();
  for (const account of existingAccounts) {
    const normalizedEmail = account.email.trim().toLowerCase();
    if (normalizedEmail && !existingByEmail.has(normalizedEmail)) {
      existingByEmail.set(normalizedEmail, account);
    }
  }

  const browserResults = await Promise.all(
    BROWSER_DEFINITIONS.map(async (definition) => {
      const dirs = resolveUserDataDirs(definition, options);
      const userDataDir = dirs.find((candidate) => existsSync(candidate));
      if (!userDataDir) {
        return null;
      }

      const [rawProfiles, launcher] = await Promise.all([
        scanUserDataDir(userDataDir),
        resolveBrowserExecutable(definition.id, options),
      ]);
      const canLaunch = launcher !== null;

      if (rawProfiles.length === 0) {
        return null;
      }

      const profiles: DiscoveredBrowserProfile[] = rawProfiles.map((rawProfile) => {
        const accounts: DiscoveredBrowserAccount[] = rawProfile.accounts
          .map((rawAcc) => {
            const matched = existingByEmail.get(rawAcc.email.toLowerCase());
            const needsValidation = Boolean(
              matched?.health?.validation?.status === 'requires_action' ||
                matched?.status_reason === 'validation_required',
            );
            return {
              email: rawAcc.email,
              ...(rawAcc.fullName ? { fullName: rawAcc.fullName } : {}),
              ...(rawAcc.avatarUrl ? { avatarUrl: rawAcc.avatarUrl } : {}),
              isAdded: Boolean(matched),
              ...(matched ? { addedAccountId: matched.id } : {}),
              needsValidation,
            };
          })
          .sort((a, b) => {
            if (a.isAdded !== b.isAdded) {
              return a.isAdded ? 1 : -1;
            }
            return a.email.localeCompare(b.email);
          });

        return {
          id: `${definition.id}:${rawProfile.profileDirectory}`,
          browserId: definition.id,
          browserName: definition.name,
          profileDirectory: rawProfile.profileDirectory,
          profileName: rawProfile.profileName,
          canLaunch,
          accounts,
        };
      });

      const accountCount = profiles.reduce((sum, profile) => sum + profile.accounts.length, 0);
      const summary: ScannedBrowserSummary = {
        browserId: definition.id,
        browserName: definition.name,
        canLaunch,
        profileCount: profiles.length,
        accountCount,
      };

      return { profiles, summary };
    }),
  );

  const allProfiles: DiscoveredBrowserProfile[] = [];
  const scannedBrowsers: ScannedBrowserSummary[] = [];

  for (const result of browserResults) {
    if (!result) {
      continue;
    }
    scannedBrowsers.push(result.summary);
    allProfiles.push(...result.profiles);
  }

  allProfiles.sort((left, right) => {
    const leftUnadded = left.accounts.filter((acc) => !acc.isAdded).length;
    const rightUnadded = right.accounts.filter((acc) => !acc.isAdded).length;
    if ((leftUnadded > 0) !== (rightUnadded > 0)) {
      return leftUnadded > 0 ? -1 : 1;
    }
    if (left.browserId !== right.browserId) {
      return left.browserName.localeCompare(right.browserName);
    }
    return left.profileName.localeCompare(right.profileName);
  });

  const uniqueEmails = new Set<string>();
  const unaddedEmails = new Set<string>();
  for (const profile of allProfiles) {
    for (const acc of profile.accounts) {
      const key = acc.email.toLowerCase();
      uniqueEmails.add(key);
      if (!acc.isAdded) {
        unaddedEmails.add(key);
      }
    }
  }

  return {
    profiles: allProfiles,
    scannedBrowsers,
    totalAccounts: uniqueEmails.size,
    unaddedAccounts: unaddedEmails.size,
  };
}

export interface LaunchBrowserProfileOptions extends BrowserDiscoverySystemOptions {
  authorizationUrl?: string;
  spawnProcess?: typeof spawn;
}

export async function launchBrowserProfile(
  rawInput: { browserId: BrowserId; profileDirectory: string },
  options: LaunchBrowserProfileOptions = {},
): Promise<void> {
  const input = OpenBrowserProfileInputSchema.parse({
    browserId: rawInput.browserId,
    profileDirectory: rawInput.profileDirectory,
  });

  const definition = getBrowserDefinition(input.browserId);
  const dirs = resolveUserDataDirs(definition, options);
  const userDataDir = dirs.find((candidate) => existsSync(candidate));
  if (!userDataDir) {
    throw new DesktopOAuthLoginError('browser-open-failed');
  }

  if (input.profileDirectory !== ROOT_PROFILE_SENTINEL) {
    const profilePath = path.resolve(userDataDir, input.profileDirectory);
    const rootPath = path.resolve(userDataDir);
    if (!profilePath.startsWith(`${rootPath}${path.sep}`) || !existsSync(profilePath)) {
      throw new DesktopOAuthLoginError('browser-open-failed');
    }
  } else if (!existsSync(path.join(userDataDir, 'Preferences'))) {
    throw new DesktopOAuthLoginError('browser-open-failed');
  }

  const launcher = await resolveBrowserExecutable(input.browserId, options);
  if (!launcher) {
    throw new DesktopOAuthLoginError('browser-open-failed');
  }

  let validatedUrl: string | undefined;
  if (options.authorizationUrl) {
    const normalized = normalizeTrustedGoogleValidationUrl(options.authorizationUrl);
    if (!normalized) {
      const operation = new GoogleLoginOperation();
      throw new DesktopOAuthLoginError(
        'login-failed',
        operation.finish(undefined, 'malformed-response'),
      );
    }
    validatedUrl = normalized;
  }

  const profileArgs =
    input.profileDirectory === ROOT_PROFILE_SENTINEL
      ? []
      : [`--profile-directory=${input.profileDirectory}`];
  const urlArgs = validatedUrl ? [validatedUrl] : [];

  const spawnImpl = options.spawnProcess ?? spawn;
  const command = launcher.type === 'macos-app' ? 'open' : launcher.path;
  const args =
    launcher.type === 'macos-app'
      ? ['-na', launcher.appName, '--args', ...profileArgs, ...urlArgs]
      : [...profileArgs, ...urlArgs];

  try {
    const child = spawnImpl(command, args, {
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    });
    child.unref();
  } catch (error) {
    const operation = new GoogleLoginOperation();
    throw new DesktopOAuthLoginError('browser-open-failed', operation.finish(error));
  }
}
