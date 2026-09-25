import { describe, expect, it } from 'vitest';

import { brandFieldEyebrow, brandName, brandTagline } from './brand';

describe('brand', () => {
  it('is always Ascend — a single-product codebase with no brand modes', () => {
    expect(brandName()).toBe('Ascend');
    expect(brandFieldEyebrow()).toBe('Ascend Field');
    expect(brandTagline()).toBe('Workspace for elevator modernization.');
  });
});
