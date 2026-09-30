import { describe, expect, it } from 'vitest';
import { greeting } from '../../src/hello.js';

describe('greeting', () => {
  it('greets Indrasol Labs by default', () => {
    expect(greeting()).toBe('Hello from Indrasol Labs!');
  });

  it('greets a given name', () => {
    expect(greeting('Ada')).toBe('Hello from Ada!');
  });

  it('falls back to the default for a blank name', () => {
    expect(greeting('   ')).toBe('Hello from Indrasol Labs!');
  });
});
