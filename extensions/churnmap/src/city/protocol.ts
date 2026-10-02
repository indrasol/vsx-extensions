/**
 * The message protocol between the extension host and the city webview (ADR-0011). Shared by
 * both sides, so it is browser-safe. Only paths, numbers and short strings cross the boundary:
 * never file contents, and no string longer than `MAX_SHORT_STRING` except a path. The one
 * exception is the postcard's PNG bytes (webview → host), checked by `isPngBuffer`.
 *
 * Messages from the webview are untrusted input: the host accepts them only through
 * `isWebviewToHost`, which checks every field and rejects unknown keys. Test-only messages
 * (`test:*`) pass the guard only when the caller says it runs in test mode.
 */
import {
  type Component,
  type IgnoredFile,
  isWindow,
  type Trend,
  type Window,
} from '../analysis/model.js';
import type { Layout } from './model.js';

export const MAX_PATH_LENGTH = 4096;
export const MAX_SHORT_STRING = 200;

export type ThemeKind = 'light' | 'dark' | 'hc';

/** `churnmap.rank`: source code only (the default) or every file. */
export type RankMode = 'code' | 'all';

/** The HUD chip and the Hotspots view description while `churnmap.rank` is `all`. */
export const RANK_ALL_LABEL = 'Ranking: all files';

/** The 3D city or the flat 2D treemap of the same layout. */
export type ViewMode = '3d' | '2d';

export function isViewMode(x: unknown): x is ViewMode {
  return x === '3d' || x === '2d';
}

/** One ranked hotspot, as the city's HUD, insights rail and card show it. */
export interface TopEntry {
  path: string;
  rank: number;
  score: number;
  /** Colour position, 0–100 (relative band + score within it); its band is `bandOfHeat(heat)`. */
  heat: number;
  /** The numbers behind each sentence ("more often than 99% of files"); each short. */
  reasons: string[];
  /** The reasons as plain sentences ("Changed 41 times in 90 days"): ≤ 3 × 120 characters. */
  sentences: string[];
  /** Commits per week across the window, oldest first (numbers only). */
  weekly: number[];
  authors: number;
  trend: Trend;
  /**
   * All five components as sentences with their percentile (0–1), for the "How is this
   * scored?" worked example; each sentence ≤ 120 characters.
   */
  parts: { component: Component; text: string; percentile: number }[];
}

export interface AnalysisMessage {
  type: 'analysis';
  layout: Layout;
  top: TopEntry[];
  window: Window;
  /** The repository folder's name. */
  repoName: string;
  /**
   * Where the repository is, for the HUD name's tooltip only: the root with the home folder
   * shortened to `~`, at most `MAX_SHORT_STRING` characters (…-shortened from the left).
   */
  repoPath?: string;
  /** `churnmap.rank` the analysis was ranked with; the HUD shows a chip while it is `all`. */
  rank?: RankMode;
  /** Files the user ignored: out of `top` and the glow, still drawn; the card says why. */
  ignored: IgnoredFile[];
  /**
   * Two short sentences (≤ 80 characters each) for eligible files outside `top` that score at
   * least 30, keyed by path; everything else has none, so the message stays small.
   */
  notes: Record<string, string[]>;
}

/** A corner of the city a panel docks in: top-left, top-right, bottom-left, bottom-right. */
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: readonly Corner[] = ['tl', 'tr', 'br', 'bl'];

export function isCorner(x: unknown): x is Corner {
  return x === 'tl' || x === 'tr' || x === 'bl' || x === 'br';
}

/** The panels that can be moved, collapsed and closed: the pinned card, the rail, the legend. */
export type PanelId = 'card' | 'rail' | 'legend';
export const PANEL_IDS: readonly PanelId[] = ['card', 'rail', 'legend'];

export interface PanelState {
  corner: Corner;
  /** The card as a pill, the rail as "3 need attention ›", the legend as its colour bar. */
  collapsed: boolean;
  /** Closed (the rail and legend come back from the ⋯ menu; the card closes with the selection). */
  hidden: boolean;
}

/** Remembered per workspace. */
export type PanelPrefs = Record<PanelId, PanelState>;

export const DEFAULT_PANELS: Readonly<PanelPrefs> = {
  card: { corner: 'bl', collapsed: false, hidden: false },
  rail: { corner: 'tr', collapsed: false, hidden: false },
  legend: { corner: 'bl', collapsed: false, hidden: false },
};

function isPanelState(x: unknown): x is PanelState {
  return (
    isObject(x) &&
    hasExactKeys(x, ['corner', 'collapsed', 'hidden']) &&
    isCorner(x.corner) &&
    typeof x.collapsed === 'boolean' &&
    typeof x.hidden === 'boolean'
  );
}

export function isPanelPrefs(x: unknown): x is PanelPrefs {
  return isObject(x) && hasExactKeys(x, PANEL_IDS) && PANEL_IDS.every((id) => isPanelState(x[id]));
}

/** Stored prefs, or the defaults for anything missing or malformed. */
export function panelPrefsOrDefault(x: unknown): PanelPrefs {
  if (isPanelPrefs(x)) return x;
  const out = { ...DEFAULT_PANELS };
  if (isObject(x)) {
    for (const id of PANEL_IDS) {
      const state = x[id];
      if (isPanelState(state)) out[id] = state;
    }
  }
  return out;
}

/** One box the HUD overlap test measures (test mode only). */
export interface TestBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The steps adaptive quality takes, in order, when frames stay slow. */
export type QualityStep = 'shadows' | 'edges' | 'labels';

export function isQualityStep(x: unknown): x is QualityStep {
  return x === 'shadows' || x === 'edges' || x === 'labels';
}

/** At most this many ignored entries ride along with an analysis. */
export const MAX_IGNORED = 1000;

/** How much of the repository's layout a postcard shows (`churnmap.postcard.detail`). */
export type PostcardDetail = 'paths' | 'districts' | 'none';

export function isPostcardDetail(x: unknown): x is PostcardDetail {
  return x === 'paths' || x === 'districts' || x === 'none';
}

export const POSTCARD_WIDTH = 1600;
export const POSTCARD_HEIGHT = 900;
/** The largest PNG the host accepts from the webview. */
export const MAX_POSTCARD_BYTES = 4 * 1024 * 1024;
/** Every PNG starts with these eight bytes. */
export const PNG_SIGNATURE: readonly number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Render the postcard. The host has already reduced each label to the chosen detail (a path, a
 * top-level folder, or `#rank`), so the webview never decides what is revealed.
 */
export interface PostcardMessage {
  type: 'postcard';
  detail: PostcardDetail;
  repoName: string;
  window: Window;
  top: { rank: number; label: string; score: number; heat: number }[];
}

export type HostToWebview =
  | AnalysisMessage
  | { type: 'theme'; kind: ThemeKind }
  | { type: 'window'; window: Window }
  /** Fly the camera to a building and show its card (folded leaves: no-op). */
  | { type: 'select'; path: string }
  /** Force the high-contrast palette on or off (a `hc` theme turns it on by itself). */
  | { type: 'highContrast'; on: boolean }
  /** No analysis to show (not built yet, or the cache was cleared). */
  | { type: 'empty'; message: string }
  /** Switch to this view (sent by *Toggle 2D treemap* and right after each `analysis`). */
  | { type: 'view'; mode: ViewMode }
  /** Remembered per workspace: whether the insights rail is open. Sent on `ready`. */
  | { type: 'prefs'; railOpen: boolean; panels?: PanelPrefs }
  /** Show the first-run coach mark (the host sends it once, ever). */
  | { type: 'coach' }
  | PostcardMessage;

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'rendered'; buildings: number; ms: number }
  | { type: 'openFile'; path: string }
  | { type: 'error'; message: string }
  /** The HUD's 30 / 90 / 365 control: rebuild with this window. */
  | { type: 'setWindow'; window: Window }
  /** The building or district under the pointer (throttled to ≤ 10 per second), or none. */
  | { type: 'hover'; path: string | null }
  /** The webview switched views (HUD button, `2` key or a `view` message); the host saves it. */
  | { type: 'viewChanged'; mode: ViewMode }
  /** The insights rail was opened or closed; the host remembers it for this workspace. */
  | { type: 'setRail'; open: boolean }
  /** A panel was moved, collapsed, expanded or closed; the host remembers them per workspace. */
  | { type: 'setPanels'; panels: PanelPrefs }
  /** The HUD's ⋯ menu: run *Churnmap: Export postcard*. */
  | { type: 'exportPostcard' }
  /** The HUD's "switch" button beside the repository name: run *Churnmap: Select repository…*. */
  | { type: 'selectRepository' }
  /** The HUD's "Ranking: all files" chip, "Code only": rank source code only again. */
  | { type: 'rankCodeOnly' }
  /** A card's or rail card's "✦ AI prompt" button, or the A key: run *Churnmap: Create AI Prompt…* for `path`. */
  | { type: 'createPrompt'; path: string }
  /** The HUD's ⋯ menu: run *Churnmap: Export for agents*. */
  | { type: 'exportForAgents' }
  /** The HUD's ⋯ menu: run *Churnmap: Connect to AI agent…*. */
  | { type: 'addToAgent' }
  /** Adaptive quality dropped an effect because frames stayed slow (logged once per step). */
  | { type: 'quality'; step: QualityStep; frameMs: number }
  /** The postcard: PNG bytes (the one binary value that crosses the boundary), 1600×900. */
  | { type: 'postcardResult'; png: ArrayBuffer; width: number; height: number; ms: number }
  | { type: 'postcardError'; message: string };

/**
 * Test mode only (the webview ignores these unless its script URL carries `?test=1`).
 * - `test:emit`: post `payload` as if the user had caused it, so integration tests drive the real
 *   message path end to end.
 * - `test:stats`: reply with a `test:stats` snapshot (frame and animation counters).
 * - `test:bench`: orbit the camera for `frames` animation frames, then reply with `test:stats`.
 * - `test:capture`: lay the page out at `width` × `height`, draw the city and its overlays into
 *   one PNG and reply with `test:capture` (screenshots for a person to look at).
 * - `test:dismissCoach`: close the coach mark if it is showing.
 * - `test:settle`: wait until no tween or 3D ↔ 2D morph runs and two more frames have drawn (or
 *   `timeoutMs` passed), then reply with `test:stats`, `settled` saying which. The render-settled
 *   signal for screenshots, instead of a fixed delay.
 * - `test:benchIntro`: replay the intro on the current city and reply with its frame times.
 * - `test:clock`: freeze the city's animation clock (first call) and move it `advance` ms forward;
 *   `null` lets it run again. Frames can then be captured at exact times (the demo GIF).
 * - `test:frame`: like `test:capture`, but animations keep their current state and the page stays
 *   at `width` × `height` until the clock is released, so frames of a motion line up.
 * - `test:railFly`: focus the insights rail's card for `rank` and press Enter on it.
 * - `test:clickBuilding`: click (or double-click) the building at `path` with real pointer events.
 * - `test:click`: click the HUD or rail control whose `data-test` is `target` (the user's path).
 * - `test:reducedMotion`: force `prefers-reduced-motion` on or off; `null` follows the OS again.
 */
export type TestHostToWebview =
  | { type: 'test:emit'; payload: WebviewToHost }
  | { type: 'test:stats' }
  | { type: 'test:bench'; frames: number }
  | { type: 'test:capture'; width: number; height: number }
  | { type: 'test:dismissCoach' }
  | { type: 'test:settle'; timeoutMs: number }
  | { type: 'test:benchIntro' }
  | { type: 'test:clock'; advance: number | null }
  | { type: 'test:frame'; width: number; height: number }
  | { type: 'test:railFly'; rank: number }
  | { type: 'test:reducedMotion'; on: boolean | null }
  | { type: 'test:click'; target: string }
  | { type: 'test:clickBuilding'; path: string; double: boolean }
  /** Lay the page out at `width` × `height` and reply with `test:boxes` (the HUD overlap test). */
  | { type: 'test:layout'; width: number; height: number }
  /** Drag a panel by its header to `corner` with real pointer events. */
  | { type: 'test:drag'; panel: PanelId; corner: Corner }
  /**
   * Press `key` on the element whose `data-test` is `target` (keydown, bubbling); `view` is the
   * canvas in charge, and an `Alt+` prefix holds Alt.
   */
  | { type: 'test:key'; target: string; key: string }
  /** Move a real pointer over any building on screen other than `except`. */
  | { type: 'test:hoverAny'; except: string }
  /**
   * Lay the page out at `width` × `height` with the rail shown or closed, fit the city (no
   * animation) and reply with `test:boxes`: `safe` (the safe area), `city` (the city's bounds on
   * screen) and every shown panel.
   */
  | { type: 'test:fit'; width: number; height: number; rail: boolean }
  /**
   * Drag across the view's canvas with real pointer events: `button` 0 (left), 1 (middle) or 2
   * (right), Shift held or not, by (dx, dy) CSS px from its centre.
   */
  | { type: 'test:dragView'; dx: number; dy: number; button: 0 | 1 | 2; shift: boolean }
  /** Send a wheel event at the canvas centre (a two-finger trackpad drag when `ctrl` is false). */
  | { type: 'test:wheel'; deltaX: number; deltaY: number; ctrl: boolean };

/** Test mode only: counters from the webview, flat numbers and booleans. */
export type TestStats = Record<string, number | boolean>;
export type TestWebviewToHost =
  | { type: 'test:stats'; stats: TestStats }
  | { type: 'test:capture'; png: ArrayBuffer; width: number; height: number }
  | { type: 'test:boxes'; width: number; height: number; boxes: TestBox[] };

/** Everything the webview may post; `TestWebviewToHost` passes the guard only in test mode. */
export type AnyWebviewToHost = WebviewToHost | TestWebviewToHost;

/** Everything the host may post; `TestHostToWebview` is only sent in test mode. */
export type AnyHostToWebview = HostToWebview | TestHostToWebview;

type Obj = Record<string, unknown>;

function isObject(x: unknown): x is Obj {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** True when `x` has exactly these keys (so nothing unexpected rides along). */
function hasExactKeys(x: Obj, keys: readonly string[]): boolean {
  const own = Object.keys(x);
  return own.length === keys.length && keys.every((k) => Object.hasOwn(x, k));
}

/**
 * A repository-relative path: a non-empty string of at most `MAX_PATH_LENGTH` characters, with
 * no `..` or empty segments, not absolute, and no NUL or backslash.
 */
export function isRepoRelativePath(x: unknown): x is string {
  if (typeof x !== 'string' || x.length === 0 || x.length > MAX_PATH_LENGTH) return false;
  if (x.includes('\0') || x.includes('\\')) return false;
  if (x.startsWith('/') || /^[A-Za-z]:/.test(x)) return false;
  return x.split('/').every((segment) => segment !== '' && segment !== '..' && segment !== '.');
}

function isShortString(x: unknown): x is string {
  return typeof x === 'string' && x.length <= MAX_SHORT_STRING;
}

function isCount(x: unknown): x is number {
  return typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 10_000_000;
}

function isDuration(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 3_600_000;
}

/** An ArrayBuffer (from any realm) of at most `MAX_POSTCARD_BYTES` that starts like a PNG. */
export function isPngBuffer(x: unknown): x is ArrayBuffer {
  if (Object.prototype.toString.call(x) !== '[object ArrayBuffer]') return false;
  const buffer = x as ArrayBuffer;
  if (buffer.byteLength < PNG_SIGNATURE.length || buffer.byteLength > MAX_POSTCARD_BYTES) {
    return false;
  }
  const head = new Uint8Array(buffer, 0, PNG_SIGNATURE.length);
  return PNG_SIGNATURE.every((byte, i) => head[i] === byte);
}

const VALIDATORS: Record<WebviewToHost['type'], (m: Obj) => boolean> = {
  ready: (m) => hasExactKeys(m, ['type']),
  rendered: (m) =>
    hasExactKeys(m, ['type', 'buildings', 'ms']) && isCount(m.buildings) && isDuration(m.ms),
  openFile: (m) => hasExactKeys(m, ['type', 'path']) && isRepoRelativePath(m.path),
  error: (m) => hasExactKeys(m, ['type', 'message']) && isShortString(m.message),
  setWindow: (m) => hasExactKeys(m, ['type', 'window']) && isWindow(m.window),
  viewChanged: (m) => hasExactKeys(m, ['type', 'mode']) && isViewMode(m.mode),
  setRail: (m) => hasExactKeys(m, ['type', 'open']) && typeof m.open === 'boolean',
  setPanels: (m) => hasExactKeys(m, ['type', 'panels']) && isPanelPrefs(m.panels),
  exportPostcard: (m) => hasExactKeys(m, ['type']),
  selectRepository: (m) => hasExactKeys(m, ['type']),
  rankCodeOnly: (m) => hasExactKeys(m, ['type']),
  createPrompt: (m) => hasExactKeys(m, ['type', 'path']) && isRepoRelativePath(m.path),
  exportForAgents: (m) => hasExactKeys(m, ['type']),
  addToAgent: (m) => hasExactKeys(m, ['type']),
  quality: (m) =>
    hasExactKeys(m, ['type', 'step', 'frameMs']) && isQualityStep(m.step) && isDuration(m.frameMs),
  hover: (m) =>
    hasExactKeys(m, ['type', 'path']) && (m.path === null || isRepoRelativePath(m.path)),
  postcardResult: (m) =>
    hasExactKeys(m, ['type', 'png', 'width', 'height', 'ms']) &&
    isPngBuffer(m.png) &&
    m.width === POSTCARD_WIDTH &&
    m.height === POSTCARD_HEIGHT &&
    isDuration(m.ms),
  postcardError: (m) => hasExactKeys(m, ['type', 'message']) && isShortString(m.message),
};

function isTestStats(x: unknown): x is TestStats {
  if (!isObject(x)) return false;
  const entries = Object.entries(x);
  return (
    entries.length <= 64 &&
    entries.every(
      ([k, v]) =>
        k.length <= 64 && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))),
    )
  );
}

/** Test-mode messages from the webview; see `TestWebviewToHost`. */
const TEST_VALIDATORS: Record<string, (m: Obj) => boolean> = {
  'test:stats': (m) => hasExactKeys(m, ['type', 'stats']) && isTestStats(m.stats),
  'test:boxes': (m) =>
    hasExactKeys(m, ['type', 'width', 'height', 'boxes']) &&
    isCount(m.width) &&
    isCount(m.height) &&
    Array.isArray(m.boxes) &&
    m.boxes.length <= 64 &&
    m.boxes.every(
      (b) =>
        isObject(b) &&
        hasExactKeys(b, ['name', 'x', 'y', 'w', 'h']) &&
        isShortString(b.name) &&
        [b.x, b.y, b.w, b.h].every((v) => typeof v === 'number' && Number.isFinite(v)),
    ),
  // Screenshots can be larger than a postcard; the signature check is the same.
  'test:capture': (m) =>
    hasExactKeys(m, ['type', 'png', 'width', 'height']) &&
    isCount(m.width) &&
    isCount(m.height) &&
    Object.prototype.toString.call(m.png) === '[object ArrayBuffer]' &&
    (m.png as ArrayBuffer).byteLength >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => new Uint8Array(m.png as ArrayBuffer, 0, 8)[i] === byte),
};

export interface GuardOptions {
  /** Accept `test:*` messages. Pass true only when the extension runs in test mode. */
  test?: boolean;
}

/** The runtime guard for everything the webview posts (`test:*` only with `{ test: true }`). */
export function isWebviewToHost(x: unknown, opts: GuardOptions = {}): x is AnyWebviewToHost {
  if (!isObject(x) || typeof x.type !== 'string') return false;
  if (Object.hasOwn(VALIDATORS, x.type)) {
    return VALIDATORS[x.type as WebviewToHost['type']](x);
  }
  if (opts.test === true && Object.hasOwn(TEST_VALIDATORS, x.type)) {
    return TEST_VALIDATORS[x.type]?.(x) ?? false;
  }
  return false;
}

/**
 * The guard for `AnalysisMessage.ignored` (the webview checks it before use): at most
 * `MAX_IGNORED` entries, each exactly `{ path, reason, until }` with a repository-relative path,
 * a short reason and a finite time.
 */
export function isIgnoredList(x: unknown): x is IgnoredFile[] {
  return (
    Array.isArray(x) &&
    x.length <= MAX_IGNORED &&
    x.every(
      (e) =>
        isObject(e) &&
        hasExactKeys(e, ['path', 'reason', 'until']) &&
        isRepoRelativePath(e.path) &&
        isShortString(e.reason) &&
        typeof e.until === 'number' &&
        Number.isFinite(e.until),
    )
  );
}

/** Cuts a string to `MAX_SHORT_STRING` characters (for reasons and error text). */
export function toShortString(text: string): string {
  return text.length <= MAX_SHORT_STRING ? text : `${text.slice(0, MAX_SHORT_STRING - 1)}…`;
}
