/** The message shown by the `extensionStarter.hello` command. Pure, so it is unit-testable. */
export function greeting(name = 'Indrasol Labs'): string {
  const who = name.trim() || 'Indrasol Labs';
  return `Hello from ${who}!`;
}
