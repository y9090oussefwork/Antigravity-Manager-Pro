import { describe, expect, it } from 'vitest';
import { isReleaseNotesLink } from '@/modules/app-shell/update/releaseNotesLinks';
import { isTrustedExternalUrl } from '@/modules/app-shell/utils/externalUrlPolicy';

describe('release-note external navigation', () => {
  it.each([
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/pull/123',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/issues/123',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/commit/abc',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/compare/v1.0.0...v1.2.3',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/blob/main/CHANGELOG.md',
    'https://github.com/contributor-name',
  ])('allows a release-note destination: %s', (url) => {
    expect(isReleaseNotesLink(url)).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'file:///C:/Windows',
    'http://github.com/y9090oussefwork/Antigravity-Manager-Pro/releases',
    'https://github.com.evil.example/y9090oussefwork/Antigravity-Manager-Pro',
    'https://github.com@evil.example/y9090oussefwork/Antigravity-Manager-Pro',
    'https://user:password@github.com/y9090oussefwork/Antigravity-Manager-Pro',
    'https://github.com/Draculabo/AnotherRepository',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro-other/releases',
    'https://github.com/login',
    'https://github.com/settings',
    'https://github.com/contributor-name?redirect=elsewhere',
    'https://github.com/y9090oussefwork/Antigravity-Manager-Pro/%2fother',
  ])('rejects a destination outside the release-note allowlist: %s', (url) => {
    expect(isReleaseNotesLink(url)).toBe(false);
  });

  it('keeps the broader allowance out of the existing general external-link policy', () => {
    expect(isTrustedExternalUrl('https://github.com/y9090oussefwork/Antigravity-Manager-Pro/pull/123')).toBe(
      false,
    );
    expect(isTrustedExternalUrl('https://github.com/contributor-name')).toBe(false);
  });
});
