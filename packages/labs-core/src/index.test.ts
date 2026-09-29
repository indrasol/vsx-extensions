import { describe, expect, it } from 'vitest';
import { LABS } from './index.js';

describe('labs-core', () => {
  it('exports the program identifier', () => {
    expect(LABS).toBe('indrasol-labs');
  });
});
