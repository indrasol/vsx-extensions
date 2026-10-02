/**
 * The only module that builds outbound URLs. Every link goes to a first-party short link on
 * labs.indrasol.com, which redirects; `placement` says where in Churnmap it was clicked (the short
 * link counts it, the extension sends nothing). Links open only when the user clicks them, through
 * `vscode.env.openExternal` (the `churnmap.openTalkLink` command and the More from Labs view).
 * No `vscode` import, so the unit tests and the README check can load it.
 */
export const LABS_BASE = 'https://labs.indrasol.com';

export type Placement = 'panel' | 'walkthrough' | 'readme' | 'notfound' | 'postcard';

export const links = {
  /** Churnmap's own landing page. */
  go: (placement: Placement): string => `${LABS_BASE}/go/churnmap/${placement}`,
  /** Talk to Indrasol: the form on Churnmap's page (questions, demos, team rollouts). */
  talk: (placement: Placement): string => `${LABS_BASE}/go/churnmap/${placement}?to=talk`,
  /** Indrasol, the company behind Indrasol Labs. */
  indrasol: (placement: Placement): string => `${LABS_BASE}/go/indrasol/${placement}`,
} as const;

/** The items Churnmap adds at the top of its "More from Indrasol Labs" view. */
export const MORE_FROM_LABS_LINKS = [
  { label: 'Talk to Indrasol', url: links.talk('panel') },
  { label: 'Built by Indrasol', url: links.indrasol('panel') },
] as const;
