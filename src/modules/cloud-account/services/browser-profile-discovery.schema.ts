import { z } from 'zod';

export const BrowserIdSchema = z.enum([
  'chrome',
  'chrome-beta',
  'edge',
  'brave',
  'vivaldi',
  'chromium',
  'opera',
  'opera-gx',
]);

export type BrowserId = z.infer<typeof BrowserIdSchema>;

export const BrowserProfileDirectorySchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^(?!\.\.?$)[A-Za-z0-9 ._@-]+$/, 'Invalid browser profile directory');

export const DiscoveredBrowserAccountSchema = z.strictObject({
  email: z.string().email().max(320),
  fullName: z.string().max(160).optional(),
  avatarUrl: z.string().url().optional(),
  isAdded: z.boolean(),
  addedAccountId: z.string().optional(),
  needsValidation: z.boolean(),
});

export type DiscoveredBrowserAccount = z.infer<typeof DiscoveredBrowserAccountSchema>;

export const DiscoveredBrowserProfileSchema = z.strictObject({
  id: z.string(),
  browserId: BrowserIdSchema,
  browserName: z.string(),
  profileDirectory: BrowserProfileDirectorySchema,
  profileName: z.string(),
  canLaunch: z.boolean(),
  accounts: z.array(DiscoveredBrowserAccountSchema),
});

export type DiscoveredBrowserProfile = z.infer<typeof DiscoveredBrowserProfileSchema>;

export const ScannedBrowserSummarySchema = z.strictObject({
  browserId: BrowserIdSchema,
  browserName: z.string(),
  canLaunch: z.boolean(),
  profileCount: z.number().int().nonnegative(),
  accountCount: z.number().int().nonnegative(),
});

export type ScannedBrowserSummary = z.infer<typeof ScannedBrowserSummarySchema>;

export const BrowserProfileDiscoveryResultSchema = z.strictObject({
  profiles: z.array(DiscoveredBrowserProfileSchema),
  scannedBrowsers: z.array(ScannedBrowserSummarySchema),
  totalAccounts: z.number().int().nonnegative(),
  unaddedAccounts: z.number().int().nonnegative(),
});

export type BrowserProfileDiscoveryResult = z.infer<typeof BrowserProfileDiscoveryResultSchema>;

export const OpenBrowserProfileInputSchema = z.strictObject({
  browserId: BrowserIdSchema,
  profileDirectory: BrowserProfileDirectorySchema,
  sessionId: z.uuid().optional(),
  loginHint: z.string().trim().min(1).max(320).optional(),
});

export type OpenBrowserProfileInput = z.infer<typeof OpenBrowserProfileInputSchema>;
