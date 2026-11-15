import { describe, expect, it } from 'vitest';
import { BUG_REPORT_URL } from '@/modules/app-shell/bug-report';
import { isTrustedExternalUrl } from '@/modules/app-shell/utils/externalUrlPolicy';

describe('external URL policy', () => {
  it('allows the production bug-report URL', () => {
    expect(isTrustedExternalUrl(BUG_REPORT_URL)).toBe(true);
  });

  it.each([
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases/tag/v0.21.1',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new/?template=bug_report.md',
  ])('allows an owned GitHub destination: %s', (url) => {
    expect(isTrustedExternalUrl(url)).toBe(true);
  });

  it.each([
    'http://github.com/y9090oussefwork/Antigravity-Manager-Pro',
    'https://user:password@github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=bug_report.md#details',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=bug_report.md&title=bug',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=bug_report.md&template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/new?template=feature_request.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues%2Fnew?template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues?template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/322?template=bug_report.md',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/322',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro.evil.example/issues',
    'https://evil.example/y9090oussefwork/Antigravity-Manager-Pro',
    'not-a-url',
  ])('rejects a destination outside the narrow allowlist: %s', (url) => {
    expect(isTrustedExternalUrl(url)).toBe(false);
  });
});
