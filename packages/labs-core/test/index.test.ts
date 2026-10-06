import { describe, expect, it } from 'vitest';
import * as core from '../src/index.js';

describe('labs-core', () => {
  it('exports the program identifier and the factories', () => {
    expect(core.LABS).toBe('indrasol-labs');
    expect(typeof core.createLogger).toBe('function');
    expect(typeof core.registerMoreFromLabsView).toBe('function');
  });
});
