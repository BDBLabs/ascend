import { describe, expect, it } from 'vitest';

import {
  brandFieldEyebrow,
  brandName,
  brandTagline,
  isAscendMode,
  isRetiredAscendRoute,
} from './brand';

describe('brand', () => {
  it('defaults to J-Box without the flag', () => {
    expect(isAscendMode({} as NodeJS.ProcessEnv)).toBe(false);
    expect(brandName({} as NodeJS.ProcessEnv)).toBe('J-Box');
    expect(brandFieldEyebrow({} as NodeJS.ProcessEnv)).toBe('J-Box Field');
    expect(brandTagline({} as NodeJS.ProcessEnv)).toBe(
      'Staff workspace for trade contractors.',
    );
  });

  it('flips to Ascend with ASCEND_MODE=1', () => {
    const env = { ASCEND_MODE: '1' } as NodeJS.ProcessEnv;
    expect(isAscendMode(env)).toBe(true);
    expect(brandName(env)).toBe('Ascend');
    expect(brandFieldEyebrow(env)).toBe('Ascend Field');
    expect(brandTagline(env)).toBe('Workspace for elevator modernization.');
  });

  it('retires the J-Box dashboard and dispatch portal paths', () => {
    expect(isRetiredAscendRoute('/jbox')).toBe(true);
    expect(isRetiredAscendRoute('/jbox/jobs')).toBe(true);
    expect(isRetiredAscendRoute('/dispatch')).toBe(true);
    expect(isRetiredAscendRoute('/dispatch/track')).toBe(true);
    expect(isRetiredAscendRoute('/field')).toBe(false);
    expect(isRetiredAscendRoute('/field/login')).toBe(false);
    expect(isRetiredAscendRoute('/ascend')).toBe(false);
    expect(isRetiredAscendRoute('/platform')).toBe(false);
    expect(isRetiredAscendRoute('/jboxer')).toBe(false);
  });
});
