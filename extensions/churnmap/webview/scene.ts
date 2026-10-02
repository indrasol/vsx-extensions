import {
  AdditiveBlending,
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  InstancedBufferAttribute,
  InstancedMesh,
  type Material,
  Mesh,
  MOUSE,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  type Building,
  DEFAULT_LAYOUT_OPTIONS,
  type District,
  type Layout,
} from '../src/city/model.js';
import {
  backgroundGradient,
  glassColour,
  GLASS_OPACITY,
  heatOf,
  isGlass,
  mixRgb,
  type PaletteVariant,
  type RGB,
  rampColour,
  rgbCss,
  variantOf,
} from '../src/city/palette.js';
import type { AnalysisMessage, QualityStep } from '../src/city/protocol.js';
import { glowAmount, pulseOpacity, shouldAnimate } from './animation.js';
import {
  type CameraPose,
  clampTarget,
  fitDirection,
  fitPose,
  easeInOutCubic,
  FLY_MS,
  focusPose,
  HERO_BACK,
  heroPose,
  interpolatePose,
} from './camera.js';
import { reducedMotionQuery } from './dom.js';
import { spaceHeld, wheelGesture } from './gesture.js';
import { FloatingLabels, LABELLED_RANKS, type LabelAnchor, pickDistrictLabels } from './labels.js';
import { Animator, DURATION, ease } from './motion.js';
import { BOX_STRIDE, pickNearest, type Vec3 } from './picking.js';
import { AdaptiveQuality } from './quality.js';
import { type Rect, toNdc } from './safeArea.js';
import type { ThemeColours } from './theme.js';
import { interpolate, planTween, type TweenEntry, type Visual } from './tween.js';
import type { CityView, NavAction, Overlays, PostcardLook, RenderStats } from './view.js';

export type { NavAction, RenderStats };

/** World units: the layout's 1000×1000 plane maps 1:1; the tallest building is this high. */
export const MAX_BUILDING_HEIGHT = 160;
export const MIN_BUILDING_HEIGHT = 0.02;
/** Each nested district plate sits this much above its parent. */
export const PLATE_STEP = 0.8;
/** Shadows only for cities up to this many buildings. */
export const SHADOW_MAX_BUILDINGS = 5000;
/** The hovered building rises this much; everything else dims to 40 %. */
export const HOVER_LIFT = 0.04;
export const DIM_AMOUNT = 0.6;
/** Intro: each district starts rising up to `INTRO_STAGGER_MS` late and rises for the rest. */
export const INTRO_STAGGER_MS = 300;
const INTRO_RISE_MS = DURATION.intro - INTRO_STAGGER_MS;
/** The 3D → 2D morph narrows the field of view towards orthographic. */
const MORPH_FOV = 8;
const BASE_FOV = 45;
/** Keyboard steps: arrows pan this many CSS px, Alt + arrows orbit, +/- dolly by this factor. */
const KEY_PAN_PX = 40;
const KEY_DOLLY = 1.2;
/**
 * Animations are finished by a timer this long after they should have ended when no animation
 * frame has advanced them (a webview whose frames stop), so the city never stays mid-morph.
 */
const WATCHDOG_GRACE_MS = 150;
const WATCHDOG_MS = 250;
const MIN_FOOTPRINT = DEFAULT_LAYOUT_OPTIONS.minBuilding;
const GLOW_RANKS = 20;
const GLOW_OPACITY = 0.28;
const EDGE_DARK = 0.42;
const EDGE_DARK_HC = 0.75;

/** InstancedMesh constructions this page has made (a test hook: a window switch makes none). */
let instancedMeshes = 0;
function instanced<G extends BufferGeometry, M extends Material>(
  geometry: G,
  material: M,
  count: number,
): InstancedMesh<G, M> {
  instancedMeshes += 1;
  const mesh = new InstancedMesh<G, M>(geometry, material, count);
  mesh.frustumCulled = false; // tweens move instances; the bounding sphere would go stale
  return mesh;
}

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearColour(target: Color, rgb: RGB): Color {
  return target.setRGB(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, SRGBColorSpace);
}

/** A vertical gradient as the scene background (screen-space). */
function gradientTexture([top, bottom]: readonly [string, string]): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

type Shader = WebGLProgramParametersWithUniforms;

/**
 * Buildings: per-instance id, opacity and glow; focus dimming and lift; UV-based edge shading
 * (a crisp outline without extra geometry, faded out on faces only a few pixels wide).
 */
function patchBuilding(shader: Shader, uniforms: Record<string, { value: unknown }>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute float aId;
attribute float aOpacity;
attribute float aGlow;
uniform float uFocusId;
varying float vFocus;
varying float vOpacity;
varying float vGlow;
varying vec2 vEdgeUv;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vFocus = (uFocusId >= 0.0 && abs(aId - uFocusId) < 0.5) ? 1.0 : 0.0;
vOpacity = aOpacity;
vGlow = aGlow;
vEdgeUv = uv;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform float uDim;
uniform vec3 uBg;
uniform float uEdge;
uniform float uEdgeDark;
uniform vec3 uFocusGlow;
varying float vFocus;
varying float vOpacity;
varying float vGlow;
varying vec2 vEdgeUv;
float cmEdge() {
  vec2 fw = max(fwidth(vEdgeUv), vec2(1e-5));
  vec2 w = fw * 1.6;
  vec2 a = smoothstep(vec2(0.0), w, vEdgeUv) * smoothstep(vec2(0.0), w, 1.0 - vEdgeUv);
  float facePx = 1.0 / max(fw.x, fw.y);
  return (1.0 - min(a.x, a.y)) * smoothstep(4.0, 14.0, facePx);
}`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float cmE = cmEdge();
diffuseColor.rgb *= 1.0 - uEdgeDark * cmE * uEdge * (1.0 - vFocus);
diffuseColor.a *= vOpacity;`,
    )
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * (0.04 + 0.34 * vGlow) + uFocusGlow * cmE * vFocus * 1.6;`,
    )
    .replace(
      '#include <opaque_fragment>',
      `#include <opaque_fragment>
float cmKeep = 1.0 - ${DIM_AMOUNT.toFixed(2)} * uDim * (1.0 - vFocus);
gl_FragColor.rgb = mix(uBg, gl_FragColor.rgb, cmKeep);
gl_FragColor.a *= vOpacity < 0.999 ? cmKeep : 1.0;`,
    );
}

/** District plates: raised planes with a rounded-rectangle mask and a soft rim. */
function patchPlate(shader: Shader): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec2 aSize;
varying vec2 vPlateSize;
varying vec2 vPlateUv;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vPlateSize = aSize;
vPlateUv = uv;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
varying vec2 vPlateSize;
varying vec2 vPlateUv;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
float cmR = min(6.0, 0.25 * min(vPlateSize.x, vPlateSize.y));
vec2 cmP = (vPlateUv - 0.5) * vPlateSize;
vec2 cmQ = abs(cmP) - (vPlateSize * 0.5 - cmR);
float cmD = length(max(cmQ, 0.0)) + min(max(cmQ.x, cmQ.y), 0.0) - cmR;
if (cmD > 0.0) discard;
float cmRim = smoothstep(-max(fwidth(cmD), 1e-4) * 1.5, 0.0, cmD);
diffuseColor.rgb *= 1.0 - 0.22 * cmRim;`,
    );
}

/** The ground: a faint world-space grid that fades out with distance from the city. */
function patchGround(shader: Shader, uniforms: Record<string, { value: unknown }>): void {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\nvarying vec3 vCmWorld;`)
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>\nvCmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
uniform vec3 uGrid;
uniform float uGridStep;
uniform float uFadeNear;
uniform float uFadeFar;
varying vec3 vCmWorld;`,
    )
    .replace(
      '#include <color_fragment>',
      `#include <color_fragment>
vec2 cmG = vCmWorld.xz / uGridStep;
vec2 cmL = abs(fract(cmG - 0.5) - 0.5) / max(fwidth(cmG), vec2(1e-4));
float cmLine = 1.0 - min(min(cmL.x, cmL.y), 1.0);
float cmFade = 1.0 - smoothstep(uFadeNear, uFadeFar, length(vCmWorld.xz));
diffuseColor.rgb = mix(diffuseColor.rgb, uGrid, cmLine * 0.5 * cmFade);
diffuseColor.a *= cmFade;`,
    );
}

/** Per-entry state of the building tween, flattened for the per-frame loop. */
interface Plan {
  entries: TweenEntry[];
  /** Linear-light colours, 3 per entry. */
  fromLin: Float32Array;
  toLin: Float32Array;
  /** Intro only: ms each entry waits before rising. */
  delays: Float32Array | undefined;
  /** Glass slot of each entry (glass instances are sorted far → near once per plan). */
  glassSlot: Int32Array;
}

/**
 * The three.js city. Buildings are two instanced meshes (solid and translucent "glass"), plates
 * one, the top-20 glow one; each is allocated with room to spare and reused, so a window switch
 * tweens heights and colours in place (keyed by path) without new meshes. Renders on demand: the
 * loop runs only while something moves (an animation, the glow pulse) and the page is visible.
 */
export class ThreeView implements CityView {
  readonly mode = '3d' as const;
  readonly renderer: WebGLRenderer;
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 1, 12_000);
  readonly controls: OrbitControls;
  private readonly scene = new Scene();
  private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly hemi = new HemisphereLight(0xeef3ff, 0x3a3834, 1.15);
  private readonly key = new DirectionalLight(0xfff3e6, 1.9);
  private readonly raycaster = new Raycaster();
  private readonly uniforms = {
    uFocusId: { value: -1 },
    uDim: { value: 0 },
    uBg: { value: new Color() },
    uEdge: { value: 1 },
    uEdgeDark: { value: EDGE_DARK },
    uFocusGlow: { value: new Color(1, 1, 1) },
  };
  private readonly groundUniforms = {
    uGrid: { value: new Color() },
    uGridStep: { value: 50 },
    uFadeNear: { value: 700 },
    uFadeFar: { value: 1900 },
  };
  private solid: InstancedMesh<BoxGeometry, MeshStandardMaterial> | undefined;
  private glass: InstancedMesh<BoxGeometry, MeshStandardMaterial> | undefined;
  private plates: InstancedMesh<PlaneGeometry, MeshStandardMaterial> | undefined;
  private glow: InstancedMesh<BoxGeometry, MeshBasicMaterial> | undefined;
  private capacity = 0;
  private plateCapacity = 0;
  private background: CanvasTexture | undefined;
  /** How every building looks once all animations end (layout order). */
  private visuals: Visual[] = [];
  private plan: Plan | undefined;
  /** Per-entry progress of the running building animation (0–1), or undefined when settled. */
  private buildProgress: ((i: number) => number) | undefined;
  /** 1 = full height; the 3D ↔ 2D morph flattens to 0. */
  private flatten = 1;
  /** Building boxes in world units (BOX_STRIDE floats each), for picking and fly-to. */
  private boxes = new Float32Array(0);
  private plateBoxes = new Float32Array(0);
  private glowIds: number[] = [];
  private current: AnalysisMessage | undefined;
  private theme: ThemeColours | undefined;
  private highContrast = false;
  private hoverId: number | null = null;
  private selectedId: number | null = null;
  /** The building the focus state (dim, lift, outline) is on, and how far it has come in. */
  private focusId: number | null = null;
  private focusLift = 0;
  private introDone = false;
  private savedPose: (CameraPose & { fov: number }) | undefined;
  /** Where the running camera animation (intro glide or fly-to) ends. */
  private cameraGoal: CameraPose | undefined;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private pendingFocus: string | undefined;
  /** The HUD, panels and safe area (from the page); undefined until the page lays out. */
  private overlays: Overlays | undefined;
  /** The repository last drawn: a different one is fitted to the view again. */
  private repoKey: string | undefined;
  /**
   * Where the orbit target appears, CSS px from the canvas centre: the safe area's centre at the
   * last fit (a view offset on the projection), so the city turns about its own middle there
   * rather than about a point under a panel.
   */
  private principal = { x: 0, y: 0 };
  private frameRequested = false;
  private rafId: number | undefined;
  /** True while the loop's own frame runs, so camera `change` events do not queue another. */
  private ticking = false;
  private lastFrameAt = 0;
  private readonly resize: ResizeObserver;
  private readonly reducedMotion = reducedMotionQuery();
  /** Test mode: a frozen animation clock (ms), so frames can be captured at exact times. */
  private testNow: number | undefined;
  private readonly animator = new Animator(
    () => this.reducedMotion.matches,
    () => this.testNow ?? performance.now(),
  );
  readonly quality = new AdaptiveQuality();
  private readonly labels: FloatingLabels;
  private readonly tmp = new Vector3();
  /** Duration of the last frame's render call, for the perf note. */
  lastFrameMs = 0;
  /** Frames rendered since the page loaded (test-mode stats). */
  framesRendered = 0;
  /** Frames drawn by the continuous loop (test-mode stats: must stay flat when nothing moves). */
  animationFrames = 0;
  /** Frames that advanced a building animation (intro, window switch, morph). */
  tweenFrames = 0;
  /** Times the watchdog had to finish an animation no frame had advanced (test-mode stats). */
  watchdogFinishes = 0;

  /** Throws when WebGL is unavailable. */
  constructor(
    readonly element: HTMLCanvasElement,
    private readonly onQuality: (step: QualityStep, frameMs: number) => void = () => undefined,
  ) {
    this.renderer = new WebGLRenderer({
      canvas: element,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.type = PCFShadowMap;

    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.radius = 4; // soft PCF (three ≥ 0.18x folds PCFSoft into PCF + radius)
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.6;
    const groundMaterial = new MeshStandardMaterial({
      roughness: 1,
      metalness: 0,
      transparent: true,
    });
    groundMaterial.onBeforeCompile = (shader) => {
      patchGround(shader, this.groundUniforms);
    };
    groundMaterial.customProgramCacheKey = () => 'cm-ground';
    this.ground = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), groundMaterial);
    this.ground.scale.set(8000, 1, 8000);
    this.ground.position.y = -0.05;
    this.ground.renderOrder = -1;
    this.ground.receiveShadow = true;
    this.scene.add(this.hemi, this.key, this.key.target, this.ground);

    // Registered before OrbitControls' own listeners, so they run first: Space + left-drag pans,
    // and a two-finger trackpad drag pans instead of zooming.
    element.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return;
      this.controls.mouseButtons.LEFT = spaceHeld() ? MOUSE.PAN : MOUSE.ROTATE;
    });
    element.addEventListener(
      'wheel',
      (e) => {
        this.onWheel(e);
      },
      { passive: false },
    );
    this.controls = new OrbitControls(this.camera, element);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 40;
    this.controls.maxDistance = 4000;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    // Right-, middle- and Shift + left-drag pan the city across the screen; zoom heads for the
    // pointer.
    this.controls.screenSpacePanning = true;
    this.controls.zoomToCursor = true;
    this.controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.PAN };
    this.controls.addEventListener('change', () => {
      this.keepTargetNear();
      this.requestRender();
    });
    // A user drag cancels a fly-to.
    this.controls.addEventListener('start', () => {
      this.animator.cancel('camera');
    });
    this.resetCamera();

    const parent = element.parentElement ?? document.body;
    this.labels = new FloatingLabels(parent);
    this.resize = new ResizeObserver(() => {
      this.fit();
    });
    this.resize.observe(parent);
    this.fit();

    document.addEventListener('visibilitychange', () => {
      this.updateAnimation();
    });
    this.reducedMotion.addEventListener('change', () => {
      this.updateAnimation();
      this.requestRender();
    });
    this.probeCadence();
  }

  /** The display's idle frame interval (four empty frames), so capped displays are not "slow". */
  private probeCadence(): void {
    const times: number[] = [];
    const step = (t: number): void => {
      times.push(t);
      if (times.length < 5) {
        requestAnimationFrame(step);
        return;
      }
      const gaps = times.slice(1).map((x, i) => x - (times[i] ?? x));
      this.quality.setCadence(Math.min(...gaps));
    };
    requestAnimationFrame(step);
  }

  get data(): AnalysisMessage | undefined {
    return this.current;
  }

  /** The 3D canvas is part of the page; mounting shows it and resumes the loop if needed. */
  mount(): void {
    this.element.hidden = false;
    this.labels.layer.hidden = !this.labels.isEnabled;
    this.fit();
    this.updateAnimation();
  }

  unmount(): void {
    this.element.hidden = true;
    this.labels.layer.hidden = true;
    for (const name of ['camera', 'build', 'focus', 'morph']) this.animator.finish(name);
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
  }

  get useHighContrast(): boolean {
    return this.highContrast || this.theme?.kind === 'hc';
  }

  private get variant(): PaletteVariant {
    return variantOf(this.theme?.kind ?? 'dark');
  }

  // ---- Data ----

  private visualsFor(layout: Layout): Visual[] {
    const depths = new Uint16Array(layout.buildings.length);
    for (const d of layout.districts) for (const id of d.buildings) depths[id] = d.depth;
    const halfW = layout.width / 2;
    const halfH = layout.height / 2;
    const opts = { variant: this.variant, highContrast: this.useHighContrast };
    const glass = glassColour(this.variant);
    return layout.buildings.map((b, i) => {
      const g = isGlass(b);
      return {
        path: b.path,
        x: b.rect.x + b.rect.w / 2 - halfW,
        z: b.rect.y + b.rect.h / 2 - halfH,
        w: Math.max(b.rect.w, MIN_FOOTPRINT),
        d: Math.max(b.rect.h, MIN_FOOTPRINT),
        base: (depths[i] ?? 0) * PLATE_STEP + 0.03,
        height: Math.max(MIN_BUILDING_HEIGHT, b.height) * MAX_BUILDING_HEIGHT,
        colour: g ? glass : rampColour(heatOf(b), opts),
        glass: g,
      };
    });
  }

  /** Builds (or reuses) the meshes, then animates to the new city: intro first, morphs after. */
  setData(message: AnalysisMessage, receivedAt = performance.now()): RenderStats {
    const previous = this.current;
    this.current = message;
    const repoKey = message.repoPath ?? message.repoName;
    const switchedRepo = previous !== undefined && repoKey !== this.repoKey;
    this.repoKey = repoKey;
    this.hoverId = null;
    this.selectedId = null;
    this.setFocus(null, true);
    this.animator.finish('build');
    const { layout } = message;
    const next = this.visualsFor(layout);

    this.boxes = new Float32Array(next.length * BOX_STRIDE);
    next.forEach((v, i) => {
      this.boxes.set(
        [v.x - v.w / 2, v.base, v.z - v.d / 2, v.x + v.w / 2, v.base + v.height, v.z + v.d / 2],
        i * BOX_STRIDE,
      );
    });
    this.buildPlates(layout);

    const intro = !this.introDone;
    const entries: TweenEntry[] = intro
      ? next.map((to, index) => ({ kind: 'added', from: { ...to, height: 0 }, to, index }))
      : planTween(previous ? this.visuals : [], next);
    this.visuals = next;
    this.plan = this.makePlan(entries, intro ? this.introDelays(layout) : undefined);
    this.ensureBuildingMeshes(entries.length);
    this.writeAttributes(layout);
    this.buildGlow(layout);
    this.fitShadows(layout);
    this.applyColours();
    this.setLabelAnchors(layout);

    if (intro) {
      this.introDone = true;
      this.startIntro();
    } else {
      this.buildProgress = () => 0;
      this.animator.start('build', {
        duration: DURATION.state,
        frame: (t) => {
          this.buildProgress = () => t;
          this.writeBuildings();
        },
        done: () => {
          this.settle();
        },
      });
    }
    // Another repository: frame it afresh (a new window on the same one keeps the camera).
    if (switchedRepo && !intro && !this.element.hidden) this.fitToView(true);
    this.writeBuildings();
    this.renderNow();
    this.updateAnimation();
    return { buildings: layout.buildings.length, ms: performance.now() - receivedAt };
  }

  /** District order → up to 300 ms late, so the city rises district by district. */
  private introDelays(layout: Layout): Float32Array {
    const districtOf = new Int32Array(layout.buildings.length);
    for (const d of layout.districts) for (const id of d.buildings) districtOf[id] = d.id;
    const span = Math.max(1, layout.districts.length - 1);
    return Float32Array.from(
      layout.buildings,
      (_, i) => ((districtOf[i] ?? 0) / span) * INTRO_STAGGER_MS,
    );
  }

  private startIntro(): void {
    const delays = this.plan?.delays;
    this.buildProgress = () => 0;
    this.animator.start('build', {
      duration: DURATION.intro,
      frame: (t, elapsed) => {
        this.buildProgress =
          t >= 1 || !delays
            ? () => 1
            : (i) => ease(Math.min(1, Math.max(0, (elapsed - (delays[i] ?? 0)) / INTRO_RISE_MS)));
        this.writeBuildings();
      },
      done: () => {
        this.settle();
      },
    });
    // The camera glides from a high overview down to the hero angle, the city fitted to the
    // safe area.
    const fitted = this.fittedPose();
    this.setPrincipal(fitted.principal);
    const hero = fitted.pose;
    const size = this.citySize();
    const overview: CameraPose = {
      target: [0, 0, 0],
      position: [size * 0.05, size * 2.1, size * 0.35],
    };
    if (this.reducedMotion.matches) {
      this.applyPose(hero);
      return;
    }
    this.applyPose(overview);
    this.startCamera(DURATION.intro, (t) => interpolatePose(overview, hero, t), hero);
  }

  /** The end state of every building animation: final visuals, removed ones gone. */
  private settle(): void {
    this.buildProgress = undefined;
    if (this.plan && this.plan.entries.length !== this.visuals.length) {
      this.plan = this.makePlan(
        this.visuals.map((v, index) => ({ kind: 'same', from: v, to: v, index })),
        undefined,
      );
      this.ensureBuildingMeshes(this.visuals.length);
      if (this.current) this.writeAttributes(this.current.layout);
    }
    this.writeBuildings();
  }

  private makePlan(entries: TweenEntry[], delays: Float32Array | undefined): Plan {
    const fromLin = new Float32Array(entries.length * 3);
    const toLin = new Float32Array(entries.length * 3);
    entries.forEach((e, i) => {
      for (let k = 0; k < 3; k++) {
        fromLin[i * 3 + k] = toLinear(e.from.colour[k] ?? 0);
        toLin[i * 3 + k] = toLinear(e.to.colour[k] ?? 0);
      }
    });
    // Glass is drawn in one call, so its instances are sorted once, far to near from the hero
    // direction, for the best blending from the usual viewpoints.
    const dir = [-Math.sin((40 * Math.PI) / 180), 0, -Math.cos((40 * Math.PI) / 180)];
    const order = entries
      .map((e, i) => ({ i, depth: e.to.x * (dir[0] ?? 0) + e.to.z * (dir[2] ?? 0) }))
      .sort((a, b) => b.depth - a.depth);
    const glassSlot = new Int32Array(entries.length);
    order.forEach(({ i }, slot) => {
      glassSlot[i] = slot;
    });
    return { entries, fromLin, toLin, delays, glassSlot };
  }

  private buildingMaterial(transparent: boolean): MeshStandardMaterial {
    const material = new MeshStandardMaterial({
      roughness: 0.65,
      metalness: 0,
      transparent,
      depthWrite: true,
    });
    material.onBeforeCompile = (shader) => {
      patchBuilding(shader, this.uniforms);
    };
    material.customProgramCacheKey = () => 'cm-building';
    return material;
  }

  /** Allocates the building meshes only when the city outgrows them (with 25 % to spare). */
  private ensureBuildingMeshes(count: number): void {
    if (this.solid && this.glass && count <= this.capacity) {
      this.solid.count = count;
      this.glass.count = count;
      return;
    }
    for (const mesh of [this.solid, this.glass]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    const capacity = Math.max(64, Math.ceil(count * 1.25));
    const make = (transparent: boolean): InstancedMesh<BoxGeometry, MeshStandardMaterial> => {
      const mesh = instanced(
        new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        this.buildingMaterial(transparent),
        capacity,
      );
      const geometry = mesh.geometry;
      geometry.setAttribute('aId', new InstancedBufferAttribute(new Float32Array(capacity), 1));
      geometry.setAttribute(
        'aOpacity',
        new InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1),
      );
      geometry.setAttribute('aGlow', new InstancedBufferAttribute(new Float32Array(capacity), 1));
      mesh.setColorAt(0, new Color()); // allocates instanceColor
      mesh.count = count;
      return mesh;
    };
    this.solid = make(false);
    this.glass = make(true);
    this.glass.renderOrder = 1;
    this.solid.castShadow = true;
    this.solid.receiveShadow = true;
    this.glass.receiveShadow = true;
    this.capacity = capacity;
    this.scene.add(this.solid, this.glass);
  }

  /** Per-instance id, glow strength and opacity, in each mesh's slot order. */
  private writeAttributes(layout: Layout): void {
    const plan = this.plan;
    if (!plan || !this.solid || !this.glass) return;
    const solidId = this.solid.geometry.getAttribute('aId') as InstancedBufferAttribute;
    const solidGlow = this.solid.geometry.getAttribute('aGlow') as InstancedBufferAttribute;
    const glassId = this.glass.geometry.getAttribute('aId') as InstancedBufferAttribute;
    const glassGlow = this.glass.geometry.getAttribute('aGlow') as InstancedBufferAttribute;
    const glassOpacity = this.glass.geometry.getAttribute('aOpacity') as InstancedBufferAttribute;
    plan.entries.forEach((e, i) => {
      const b = e.index >= 0 ? layout.buildings[e.index] : undefined;
      const id = e.index >= 0 ? e.index : -2;
      const glow =
        b?.rank !== undefined && b.rank <= GLOW_RANKS ? glowAmount(b.rank, heatOf(b)) : 0;
      const g = plan.glassSlot[i] ?? i;
      solidId.setX(i, id);
      solidGlow.setX(i, glow);
      glassId.setX(g, id);
      glassGlow.setX(g, 0);
      glassOpacity.setX(g, GLASS_OPACITY);
    });
    for (const a of [solidId, solidGlow, glassId, glassGlow, glassOpacity]) a.needsUpdate = true;
  }

  /**
   * Writes every building's matrix and colour for the current animation state. Matrices are
   * written straight into the instance buffers (scale and translation only), which is what keeps
   * a 10k-building tween cheap.
   */
  private writeBuildings(): void {
    const plan = this.plan;
    const solid = this.solid;
    const glass = this.glass;
    if (!plan || !solid || !glass) return;
    const sm = solid.instanceMatrix.array as Float32Array;
    const gm = glass.instanceMatrix.array as Float32Array;
    const sc = solid.instanceColor?.array as Float32Array | undefined;
    const gc = glass.instanceColor?.array as Float32Array | undefined;
    const progress = this.buildProgress;
    const flatten = this.flatten;
    let solidMembers = 0;
    let glassMembers = 0;
    const write = (m: Float32Array, slot: number, v: Visual | undefined, h: number): void => {
      const o = slot * 16;
      m.fill(0, o, o + 16);
      if (!v) return;
      m[o] = v.w;
      m[o + 5] = h;
      m[o + 10] = v.d;
      m[o + 12] = v.x;
      m[o + 13] = v.base * flatten;
      m[o + 14] = v.z;
      m[o + 15] = 1;
    };
    const { entries, fromLin, toLin, glassSlot } = plan;
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (!e) continue;
      const t = progress ? progress(i) : 1;
      const v = t >= 1 ? e.to : interpolate(e, t);
      let h = v.height * flatten;
      if (e.index >= 0 && e.index === this.focusId) h *= 1 + HOVER_LIFT * this.focusLift;
      const g = glassSlot[i] ?? i;
      write(sm, i, v.glass ? undefined : v, h);
      write(gm, g, v.glass ? v : undefined, h);
      if (v.glass) glassMembers += 1;
      else solidMembers += 1;
      const colours = v.glass ? gc : sc;
      const slot = v.glass ? g : i;
      if (colours) {
        for (let k = 0; k < 3; k++) {
          const a = fromLin[i * 3 + k] ?? 0;
          const b = toLin[i * 3 + k] ?? 0;
          colours[slot * 3 + k] = t >= 1 ? b : a + (b - a) * t;
        }
      }
    }
    solid.instanceMatrix.needsUpdate = true;
    glass.instanceMatrix.needsUpdate = true;
    if (solid.instanceColor) solid.instanceColor.needsUpdate = true;
    if (glass.instanceColor) glass.instanceColor.needsUpdate = true;
    solid.visible = solidMembers > 0;
    glass.visible = glassMembers > 0;
    this.writeGlow();
    if (progress) this.tweenFrames += 1;
  }

  private buildPlates(layout: Layout): void {
    const n = layout.districts.length;
    if (!this.plates || n > this.plateCapacity) {
      if (this.plates) {
        this.scene.remove(this.plates);
        this.plates.geometry.dispose();
        this.plates.material.dispose();
        this.plates.dispose();
      }
      const capacity = Math.max(32, Math.ceil(n * 1.25));
      const material = new MeshStandardMaterial({ roughness: 0.9, metalness: 0 });
      material.onBeforeCompile = patchPlate;
      material.customProgramCacheKey = () => 'cm-plate';
      const plates = instanced(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material, capacity);
      plates.geometry.setAttribute(
        'aSize',
        new InstancedBufferAttribute(new Float32Array(capacity * 2), 2),
      );
      plates.setColorAt(0, new Color());
      plates.receiveShadow = true;
      this.plates = plates;
      this.plateCapacity = capacity;
      this.scene.add(plates);
    }
    const plates = this.plates;
    plates.count = n;
    const halfW = layout.width / 2;
    const halfH = layout.height / 2;
    const m = plates.instanceMatrix.array as Float32Array;
    const size = plates.geometry.getAttribute('aSize') as InstancedBufferAttribute;
    this.plateBoxes = new Float32Array(n * BOX_STRIDE);
    layout.districts.forEach((d, i) => {
      const w = Math.max(d.rect.w, 0.01);
      const h = Math.max(d.rect.h, 0.01);
      const x = d.rect.x + d.rect.w / 2 - halfW;
      const z = d.rect.y + d.rect.h / 2 - halfH;
      const y = d.depth * PLATE_STEP;
      const o = i * 16;
      m.fill(0, o, o + 16);
      m[o] = w;
      m[o + 5] = 1;
      m[o + 10] = h;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      size.setXY(i, w, h);
      this.plateBoxes.set([x - w / 2, y, z - h / 2, x + w / 2, y + 0.1, z + h / 2], i * BOX_STRIDE);
    });
    plates.instanceMatrix.needsUpdate = true;
    size.needsUpdate = true;
  }

  /** Top-20 glow: a slightly larger translucent shell around each ranked building. */
  private buildGlow(layout: Layout): void {
    this.glowIds = layout.buildings
      .filter((b) => b.rank !== undefined && b.rank <= GLOW_RANKS && !isGlass(b))
      .map((b) => b.id);
    if (!this.glow) {
      const glow = instanced(
        new BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
        new MeshBasicMaterial({ transparent: true, opacity: GLOW_OPACITY, depthWrite: false }),
        GLOW_RANKS,
      );
      glow.setColorAt(0, new Color());
      glow.renderOrder = 2;
      this.glow = glow;
      this.scene.add(glow);
    }
    this.glow.count = this.glowIds.length;
    this.glow.visible = this.glowIds.length > 0;
  }

  private writeGlow(): void {
    const glow = this.glow;
    const plan = this.plan;
    if (!glow || !plan || this.glowIds.length === 0) return;
    const m = glow.instanceMatrix.array as Float32Array;
    const progress = this.buildProgress;
    const pad = 2;
    this.glowIds.forEach((id, slot) => {
      const e = plan.entries[id];
      if (!e) return;
      const t = progress ? progress(id) : 1;
      const v = t >= 1 ? e.to : interpolate(e, t);
      const h = v.height * this.flatten;
      const o = slot * 16;
      m.fill(0, o, o + 16);
      if (h <= 0.001) return;
      m[o] = v.w + 2 * pad;
      m[o + 5] = h + pad;
      m[o + 10] = v.d + 2 * pad;
      m[o + 12] = v.x;
      m[o + 13] = v.base * this.flatten;
      m[o + 14] = v.z;
      m[o + 15] = 1;
    });
    glow.instanceMatrix.needsUpdate = true;
  }

  /** One directional shadow map fitted to the city; off above `SHADOW_MAX_BUILDINGS`. */
  private fitShadows(layout: Layout): void {
    const on = this.quality.enabled('shadows') && layout.buildings.length <= SHADOW_MAX_BUILDINGS;
    const size = Math.max(layout.width, layout.height);
    const dir = new Vector3(-0.55, 1, 0.4).normalize();
    this.key.position.copy(dir.multiplyScalar(size * 1.6));
    this.key.target.position.set(0, 0, 0);
    const cam = this.key.shadow.camera;
    const half = size * 0.78;
    cam.left = -half;
    cam.right = half;
    cam.top = half;
    cam.bottom = -half;
    cam.near = 1;
    cam.far = size * 4;
    cam.updateProjectionMatrix();
    this.setShadows(on);
  }

  private setShadows(on: boolean): void {
    if (this.renderer.shadowMap.enabled === on && this.key.castShadow === on) return;
    this.renderer.shadowMap.enabled = on;
    this.key.castShadow = on;
    for (const mesh of [this.solid, this.glass, this.plates, this.ground]) {
      if (mesh) mesh.material.needsUpdate = true;
    }
  }

  private setLabelAnchors(layout: Layout): void {
    const ranked = layout.buildings
      .filter((b) => b.rank !== undefined && b.rank <= LABELLED_RANKS)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const pills: LabelAnchor[] = ranked.map((b) => {
      const v = this.visuals[b.id];
      return {
        key: b.path,
        text: b.path.split('/').at(-1) ?? b.path,
        pos: [v?.x ?? 0, (v?.base ?? 0) + (v?.height ?? 0) + 3, v?.z ?? 0],
        rank: b.rank ?? 0,
        score: heatOf(b),
        building: b.id,
      };
    });
    const infos = layout.districts.map((d) => ({
      path: d.path,
      depth: d.depth,
      area: d.rect.w * d.rect.h,
    }));
    const byPath = new Map(layout.districts.map((d) => [d.path, d]));
    const districts: LabelAnchor[] = pickDistrictLabels(infos).flatMap((info) => {
      const d = byPath.get(info.path);
      if (!d) return [];
      const x = d.rect.x + d.rect.w / 2 - layout.width / 2;
      const z = d.rect.y + d.rect.h - layout.height / 2 - Math.min(12, d.rect.h * 0.08);
      return [
        {
          key: `d:${d.path}`,
          text: `${d.path.split('/').at(-1) ?? d.path}/`,
          pos: [x, d.depth * PLATE_STEP + 0.2, z] as Vec3,
        },
      ];
    });
    this.labels.setAnchors(pills, districts, {
      variant: this.variant,
      highContrast: this.useHighContrast,
    });
  }

  setTheme(theme: ThemeColours): void {
    this.theme = theme;
    this.recolour();
  }

  setHighContrast(on: boolean): void {
    this.highContrast = on;
    this.recolour();
  }

  /** Theme or contrast changed: new colours at once (no tween), then a frame. */
  private recolour(): void {
    this.animator.finish('build');
    if (this.current) {
      this.visuals = this.visualsFor(this.current.layout);
      this.plan = this.makePlan(
        this.visuals.map((v, index) => ({ kind: 'same', from: v, to: v, index })),
        undefined,
      );
      this.ensureBuildingMeshes(this.visuals.length);
      this.writeAttributes(this.current.layout);
      this.writeBuildings();
      this.setLabelAnchors(this.current.layout);
    }
    this.applyColours();
    this.requestRender();
  }

  /** Background gradient, fog, ground, plates, glow and uniforms for the theme. */
  private applyColours(): void {
    const theme = this.theme;
    const background: RGB = theme?.background ?? [30, 30, 30];
    const foreground: RGB = theme?.foreground ?? [212, 212, 212];
    const [top, bottom] = backgroundGradient(background, foreground);
    this.background?.dispose();
    this.background = gradientTexture([rgbCss(top), rgbCss(bottom)]);
    this.scene.background = this.background;
    const colour = new Color();
    const mid = mixRgb(top, bottom, 0.6);
    this.scene.fog = new Fog(linearColour(colour, mid).getHex(SRGBColorSpace), 2600, 7500);
    const light = theme?.kind === 'light';
    this.hemi.intensity = light ? 1.35 : 1.15;
    linearColour(this.ground.material.color, mixRgb(background, foreground, light ? 0.02 : 0.035));
    linearColour(
      this.groundUniforms.uGrid.value,
      mixRgb(background, foreground, light ? 0.14 : 0.16),
    );
    linearColour(this.uniforms.uBg.value, mixRgb(background, bottom, 0.5));
    this.uniforms.uEdgeDark.value = this.useHighContrast ? EDGE_DARK_HC : EDGE_DARK;
    linearColour(this.uniforms.uFocusGlow.value, light ? [30, 40, 60] : [255, 255, 255]);

    const data = this.current;
    if (!data) return;
    if (this.plates) {
      const opts = { variant: this.variant, highContrast: this.useHighContrast };
      const hottest = this.districtHottest(data.layout);
      data.layout.districts.forEach((d, i) => {
        const base = mixRgb(background, foreground, 0.06 + 0.025 * Math.min(d.depth, 4));
        const tint = rampColour(hottest[i] ?? 0, opts);
        this.plates?.setColorAt(i, linearColour(colour, mixRgb(base, tint, 0.06)));
      });
      if (this.plates.instanceColor) this.plates.instanceColor.needsUpdate = true;
    }
    if (this.glow) {
      const hc = this.useHighContrast;
      // Additive light on dark themes; plain translucency on light ones (additive washes out).
      this.glow.material.blending = light ? NormalBlending : AdditiveBlending;
      this.glow.material.needsUpdate = true;
      this.glowIds.forEach((id, i) => {
        const b = data.layout.buildings[id];
        if (!b) return;
        // The shell stays as a faint ring on cooler ranked files and burns on the hot ones.
        const strength = Math.max(0.2, glowAmount(b.rank ?? GLOW_RANKS, heatOf(b)));
        const base: RGB = hc ? [255, 255, 255] : rampColour(heatOf(b), { variant: this.variant });
        this.glow?.setColorAt(
          i,
          linearColour(colour, [base[0] * strength, base[1] * strength, base[2] * strength]),
        );
      });
      if (this.glow.instanceColor) this.glow.instanceColor.needsUpdate = true;
    }
  }

  /** The highest heat under each district (its plate takes a 6 % tint of that colour). */
  private districtHottest(layout: Layout): number[] {
    const hottest = layout.districts.map(() => 0);
    for (let i = layout.districts.length - 1; i >= 0; i--) {
      const d = layout.districts[i];
      if (!d) continue;
      let max = 0;
      for (const id of d.buildings) {
        const b = layout.buildings[id];
        if (b && !isGlass(b)) max = Math.max(max, heatOf(b));
      }
      for (const c of d.children) max = Math.max(max, hottest[c] ?? 0);
      hottest[i] = max;
    }
    return hottest;
  }

  // ---- Picking, hover and focus ----

  /** The building (or else the deepest district) under canvas point (x, y) in CSS pixels. */
  hitTest(x: number, y: number): Building | District | null {
    const data = this.current;
    if (!data) return null;
    const rect = this.element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.raycaster.setFromCamera(
      new Vector2((x / rect.width) * 2 - 1, -(y / rect.height) * 2 + 1),
      this.camera,
    );
    const { origin, direction } = this.raycaster.ray;
    const ray = {
      origin: [origin.x, origin.y, origin.z] as Vec3,
      direction: [direction.x, direction.y, direction.z] as Vec3,
    };
    const building = pickNearest(ray, this.boxes);
    if (building) return data.layout.buildings[building.index] ?? null;
    const plate = pickNearest(ray, this.plateBoxes);
    return plate ? (data.layout.districts[plate.index] ?? null) : null;
  }

  /** The hovered building: lifts, gets an outline glow, and everything else dims (180 ms). */
  setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    this.setFocus(id ?? this.selectedId);
  }

  select(path: string | null): void {
    const id = path === null ? undefined : this.current?.layout.byPath[path];
    this.selectedId = id ?? null;
    this.hoverId = null;
    this.setFocus(this.selectedId);
  }

  private setFocus(id: number | null, instant = false): void {
    if (id === this.focusId && (id !== null || this.uniforms.uDim.value === 0)) return;
    const fromDim = this.uniforms.uDim.value;
    const previous = this.focusId;
    if (id !== null) {
      this.focusId = id;
      this.uniforms.uFocusId.value = id;
    }
    const target = id === null ? 0 : 1;
    const liftFrom = id === previous || id === null ? this.focusLift : 0;
    const finish = (): void => {
      if (id === null) {
        this.focusId = null;
        this.uniforms.uFocusId.value = -1;
        this.focusLift = 0;
      }
    };
    if (instant) {
      this.animator.cancel('focus');
      this.uniforms.uDim.value = target;
      this.focusLift = target;
      finish();
      return;
    }
    this.animator.start('focus', {
      duration: DURATION.hover,
      frame: (t) => {
        this.uniforms.uDim.value = fromDim + (target - fromDim) * t;
        this.focusLift = id === null ? liftFrom * (1 - t) : liftFrom + (1 - liftFrom) * t;
        this.writeBuildings();
      },
      done: finish,
    });
    this.updateAnimation();
    this.requestRender();
  }

  // ---- Camera ----

  private citySize(): number {
    return this.current ? Math.max(this.current.layout.width, this.current.layout.height) : 1000;
  }

  /** With no data yet: the south-east view. */
  private resetCamera(): void {
    this.animator.cancel('camera');
    const size = this.citySize();
    this.applyPose({ target: [0, 0, 0], position: [size * 0.55, size * 0.75, size * 0.95] });
    this.requestRender();
  }

  /**
   * The whole city in the safe area, seen from `back` (default: the hero angle), and the view
   * offset that puts the orbit target at the safe area's centre.
   */
  private fittedPose(back = HERO_BACK): { pose: CameraPose; principal: { x: number; y: number } } {
    const { min, max } = this.bounds();
    const { width, height } = this.canvasSize();
    const safe = this.safeRect();
    const principal = { x: safe.x + safe.w / 2 - width / 2, y: safe.y + safe.h / 2 - height / 2 };
    // With the offset, the safe area sits round the projection's centre.
    const shifted = { ...safe, x: safe.x - principal.x, y: safe.y - principal.y };
    return {
      pose: fitPose(min, max, back, BASE_FOV, width / height, toNdc(shifted, width, height)),
      principal,
    };
  }

  /** Moves where the orbit target appears on the canvas (see `principal`). */
  private setPrincipal(p: { x: number; y: number }): void {
    this.principal = { x: p.x, y: p.y };
    this.applyViewOffset();
  }

  private applyViewOffset(): void {
    const { width, height } = this.canvasSize();
    const { x, y } = this.principal;
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) this.camera.clearViewOffset();
    else this.camera.setViewOffset(width, height, -x, -y, width, height);
    this.camera.updateProjectionMatrix();
  }

  private canvasSize(): { width: number; height: number } {
    const parent = this.element.parentElement ?? document.body;
    return { width: Math.max(1, parent.clientWidth), height: Math.max(1, parent.clientHeight) };
  }

  /** The safe area the page last reported, else the canvas below a typical HUD. */
  private safeRect(): Rect {
    const { width, height } = this.canvasSize();
    const o = this.overlays;
    if (o && o.width === width && o.height === height && o.safe.w > 0 && o.safe.h > 0) {
      return o.safe;
    }
    const top = Math.min(62, height / 3);
    return { x: 12, y: top, w: Math.max(1, width - 24), h: Math.max(1, height - top - 12) };
  }

  setOverlays(overlays: Overlays): void {
    this.overlays = overlays;
    this.requestRender();
  }

  /** Fits the city into the safe area, keeping the angle round it (F, Home, ⤢ Fit). */
  fitToView(animate: boolean): void {
    if (!this.current) {
      this.resetCamera();
      return;
    }
    if (this.animator.isRunning('morph')) return;
    const from = this.pose();
    const fitted = this.fittedPose(fitDirection(this.cameraGoal ?? from));
    const to = fitted.pose;
    const p0 = this.principal;
    const p1 = fitted.principal;
    if (animate && !this.reducedMotion.matches) {
      this.startCamera(
        FLY_MS,
        (t) => {
          const e = easeInOutCubic(t);
          this.setPrincipal({ x: p0.x + (p1.x - p0.x) * e, y: p0.y + (p1.y - p0.y) * e });
          return interpolatePose(from, to, t);
        },
        to,
      );
      this.updateAnimation();
    } else {
      this.animator.cancel('camera');
      this.setPrincipal(p1);
      this.applyPose(to);
    }
    this.requestRender();
  }

  projectedBounds(): Rect | undefined {
    if (!this.current) return undefined;
    const { min, max } = this.bounds();
    const { width, height } = this.canvasSize();
    this.camera.updateMatrixWorld();
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < 8; i++) {
      const v = this.tmp.set(
        i & 1 ? max[0] : min[0],
        i & 2 ? max[1] : min[1],
        i & 4 ? max[2] : min[2],
      );
      v.project(this.camera);
      if (v.z > 1) return undefined;
      const x = ((v.x + 1) / 2) * width;
      const y = ((1 - v.y) / 2) * height;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** Panning (drag, keys, trackpad, zoom to cursor) can move the target only so far from the city. */
  private keepTargetNear(): void {
    if (!this.current || this.animator.isRunning('morph')) return;
    const { min, max } = this.bounds();
    const t = this.controls.target;
    const distance = this.camera.position.distanceTo(t);
    const [x, y, z] = clampTarget([t.x, t.y, t.z], min, max, distance, this.camera.fov);
    const dx = x - t.x;
    const dy = y - t.y;
    const dz = z - t.z;
    if (dx === 0 && dy === 0 && dz === 0) return;
    t.set(x, y, z);
    this.camera.position.set(
      this.camera.position.x + dx,
      this.camera.position.y + dy,
      this.camera.position.z + dz,
    );
  }

  /**
   * A two-finger trackpad drag pans; a pinch or a mouse wheel is left to OrbitControls, which
   * zooms towards the pointer (and boosts a pinch's small deltas itself).
   */
  private onWheel(e: WheelEvent): void {
    if (!this.controls.enabled || wheelGesture(e) === 'zoom') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.animator.cancel('camera');
    this.controls.pan(-e.deltaX, -e.deltaY);
  }

  private fit(): void {
    const parent = this.element.parentElement ?? document.body;
    const w = Math.max(1, parent.clientWidth);
    const h = Math.max(1, parent.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.applyViewOffset();
    this.requestRender();
  }

  navigate(action: NavAction): void {
    this.animator.cancel('camera');
    switch (action.kind) {
      case 'orbit':
        this.controls.rotateLeft(action.dx * 0.08);
        this.controls.rotateUp(action.dy * 0.06);
        break;
      case 'pan':
        // The arrow says where the view moves: the city slides the other way.
        this.controls.pan(-action.dx * KEY_PAN_PX, -action.dy * KEY_PAN_PX);
        break;
      case 'zoom':
        if (action.direction > 0) this.controls.dollyIn(KEY_DOLLY);
        else this.controls.dollyOut(KEY_DOLLY);
        break;
    }
    this.controls.update();
    this.requestRender();
  }

  pointOf(path: string): { x: number; y: number } | undefined {
    const id = this.current?.layout.byPath[path];
    if (id === undefined) return undefined;
    const o = id * BOX_STRIDE;
    const v = this.tmp.set(
      ((this.boxes[o] ?? 0) + (this.boxes[o + 3] ?? 0)) / 2,
      (this.boxes[o + 4] ?? 0) * this.flatten,
      ((this.boxes[o + 2] ?? 0) + (this.boxes[o + 5] ?? 0)) / 2,
    );
    v.project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return undefined;
    const rect = this.element.getBoundingClientRect();
    return { x: ((v.x + 1) / 2) * rect.width, y: ((1 - v.y) / 2) * rect.height };
  }

  /** Flies to a building by path (600 ms, instant with reduced motion). False if not drawn. */
  focusCamera(path: string): boolean {
    const id = this.current?.layout.byPath[path];
    if (id === undefined) return false;
    if (this.animator.isRunning('morph')) {
      this.pendingFocus = path;
      return true;
    }
    const o = id * BOX_STRIDE;
    const min: Vec3 = [this.boxes[o] ?? 0, this.boxes[o + 1] ?? 0, this.boxes[o + 2] ?? 0];
    const max: Vec3 = [this.boxes[o + 3] ?? 0, this.boxes[o + 4] ?? 0, this.boxes[o + 5] ?? 0];
    const from = this.pose();
    const to = focusPose(min, max, from);
    this.startCamera(FLY_MS, (t) => interpolatePose(from, to, t), to);
    this.updateAnimation();
    this.requestRender();
    return true;
  }

  /** A camera animation that ends at `goal` (a morph to 2D returns there, not mid-flight). */
  private startCamera(duration: number, at: (t: number) => CameraPose, goal: CameraPose): void {
    this.cameraGoal = goal;
    this.animator.start('camera', {
      duration,
      frame: (t) => {
        this.applyPose(at(t));
      },
      done: () => {
        this.cameraGoal = undefined;
      },
    });
  }

  private pose(): CameraPose {
    return {
      position: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.controls.target.x, this.controls.target.y, this.controls.target.z],
    };
  }

  private applyPose(pose: CameraPose): void {
    this.camera.position.set(...pose.position);
    this.controls.target.set(...pose.target);
    this.camera.lookAt(this.controls.target);
  }

  /** Straight down on the city at `fov`, framed like the 2D treemap (the layout fits the view). */
  private topDownPose(fov: number): CameraPose {
    const layout = this.current?.layout;
    const worldW = layout?.width ?? 1000;
    const worldH = layout?.height ?? 1000;
    const aspect = Math.max(0.1, this.camera.aspect);
    const visibleH = Math.max(worldH, worldW / aspect);
    const distance = visibleH / (2 * Math.tan((fov * Math.PI) / 360));
    return { target: [0, 0, 0], position: [0, distance, distance * 1e-4] };
  }

  /**
   * 3D → 2D: the camera swings to straight down while the field of view narrows (towards
   * orthographic) and the buildings flatten; `done` runs when the city looks like the treemap.
   */
  morphTo2D(done: () => void): void {
    const from = { ...this.pose(), fov: this.camera.fov };
    if (!this.animator.isRunning('morph')) {
      // Mid-glide (the intro, a fly-to), coming back to 3D lands where the glide was going.
      const goal = this.animator.isRunning('camera') ? this.cameraGoal : undefined;
      this.savedPose = goal ? { ...goal, fov: BASE_FOV } : from;
    }
    this.cameraGoal = undefined;
    const flatFrom = this.flatten;
    this.animator.cancel('camera');
    this.controls.enabled = false;
    this.labels.hideAll();
    this.animator.start('morph', {
      duration: DURATION.state,
      frame: (t) => {
        const fov = from.fov + (MORPH_FOV - from.fov) * t;
        this.setFov(fov);
        this.applyPose(interpolatePose(from, this.topDownPose(fov), t));
        this.flatten = flatFrom * (1 - t);
        this.writeBuildings();
      },
      done: () => {
        this.controls.enabled = true;
        done();
      },
    });
    this.updateAnimation();
  }

  /** 2D → 3D: from the flat, top-down city back to where the camera was, buildings rising. */
  morphFrom2D(): void {
    const reduced = this.reducedMotion.matches;
    if (!this.animator.isRunning('morph')) {
      this.setFov(MORPH_FOV);
      this.applyPose(this.topDownPose(MORPH_FOV));
      this.flatten = 0;
    }
    const from = { ...this.pose(), fov: this.camera.fov };
    const flatFrom = this.flatten;
    const to = this.savedPose ?? { ...this.fittedPose().pose, fov: BASE_FOV };
    this.controls.enabled = false;
    this.animator.start('morph', {
      duration: reduced ? 0 : DURATION.state,
      frame: (t) => {
        const fov = from.fov + (to.fov - from.fov) * t;
        this.setFov(fov);
        this.applyPose(interpolatePose(from, to, t));
        this.flatten = flatFrom + (1 - flatFrom) * t;
        this.writeBuildings();
      },
      done: () => {
        this.controls.enabled = true;
        this.controls.update();
        const pending = this.pendingFocus;
        this.pendingFocus = undefined;
        if (pending) this.focusCamera(pending);
      },
    });
    this.updateAnimation();
    this.requestRender();
  }

  private setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  // ---- Frames ----

  private animationState(): boolean {
    return shouldAnimate({
      glow: this.glowIds.length > 0,
      mounted: !this.element.hidden,
      visible: document.visibilityState === 'visible',
      reducedMotion: this.reducedMotion.matches,
      moving: this.animator.active,
    });
  }

  /** Starts the loop when something moves; it stops itself on the first frame it is not needed. */
  private updateAnimation(): void {
    if (this.animator.active && !this.element.hidden) this.armWatchdog();
    if (!this.animationState()) {
      if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
      return;
    }
    this.rafId ??= requestAnimationFrame(this.tick);
  }

  /**
   * While anything animates, a timer checks that it ends: an animation past its end (because no
   * frame advanced it) is finished and drawn. On a frozen test clock nothing is ever overdue.
   */
  private armWatchdog(): void {
    if (this.watchdog !== undefined) return;
    this.watchdog = setTimeout(() => {
      this.watchdog = undefined;
      if (this.element.hidden || !this.animator.active) return;
      if (this.animator.finishOverdue(WATCHDOG_GRACE_MS)) {
        this.watchdogFinishes += 1;
        this.renderNow();
      }
      this.updateAnimation();
    }, WATCHDOG_MS);
  }

  private readonly tick = (now: number): void => {
    this.rafId = undefined;
    this.ticking = true;
    this.animationFrames += 1;
    const cameraMoving = this.animator.isRunning('camera') || this.animator.isRunning('morph');
    if (this.testNow !== undefined) now = this.testNow;
    this.animator.step(now);
    if (!cameraMoving && this.controls.enabled) this.controls.update();
    if (this.glow) {
      this.glow.material.opacity =
        pulseOpacity(GLOW_OPACITY, now, this.reducedMotion.matches) *
        (1 - DIM_AMOUNT * this.uniforms.uDim.value);
    }
    this.renderNow();
    this.ticking = false;
    if (this.animationState()) this.rafId = requestAnimationFrame(this.tick);
  };

  /** Schedules one frame; repeated calls before it runs coalesce (the loop covers it if on). */
  requestRender(): void {
    if (this.frameRequested || this.ticking || this.rafId !== undefined) return;
    this.frameRequested = true;
    requestAnimationFrame(() => {
      this.frameRequested = false;
      // With damping, update() keeps emitting `change` (and so requesting frames) until still.
      if (this.controls.enabled) this.controls.update();
      this.renderNow();
    });
  }

  private renderNow(): void {
    const start = performance.now();
    this.renderer.render(this.scene, this.camera);
    const end = performance.now();
    this.lastFrameMs = end - start;
    this.framesRendered += 1;
    this.updateLabels(end);
    const interval = this.lastFrameAt > 0 ? start - this.lastFrameAt : 0;
    this.lastFrameAt = start;
    const dropped = this.quality.observe(interval, start);
    if (dropped) this.applyQuality(dropped, interval);
  }

  private applyQuality(step: QualityStep, frameMs: number): void {
    switch (step) {
      case 'shadows':
        this.setShadows(false);
        break;
      case 'edges':
        this.uniforms.uEdge.value = 0;
        break;
      case 'labels':
        this.labels.setEnabled(false);
        break;
    }
    this.onQuality(step, Math.round(frameMs * 10) / 10);
  }

  /** Everything back on (the screenshot capture). */
  restoreQuality(): void {
    this.quality.reset();
    this.uniforms.uEdge.value = 1;
    this.labels.setEnabled(!this.element.hidden);
    if (this.current) this.fitShadows(this.current.layout);
  }

  private updateLabels(now: number): void {
    if (!this.current || this.element.hidden || this.animator.isRunning('morph')) return;
    const rect = { w: this.element.clientWidth, h: this.element.clientHeight };
    const cam = this.camera.position;
    const origin: Vec3 = [cam.x, cam.y, cam.z];
    this.labels.update({
      now,
      bounds: { x: 0, y: 0, w: rect.w, h: rect.h },
      obstacles: this.overlays?.obstacles ?? [],
      size: this.citySize(),
      zoom: cam.distanceTo(this.controls.target),
      project: (p) => {
        const v = this.tmp.set(p[0], p[1], p[2]);
        const distance = cam.distanceTo(v);
        v.project(this.camera);
        return {
          x: ((v.x + 1) / 2) * rect.w,
          y: ((1 - v.y) / 2) * rect.h,
          hidden: v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05,
          distance,
        };
      },
      occluded: (anchor) => {
        const d: Vec3 = [
          anchor.pos[0] - origin[0],
          anchor.pos[1] - origin[1],
          anchor.pos[2] - origin[2],
        ];
        const length = Math.hypot(d[0], d[1], d[2]) || 1;
        const hit = pickNearest(
          { origin, direction: [d[0] / length, d[1] / length, d[2] / length] },
          this.boxes,
        );
        return hit !== null && hit.index !== anchor.building && hit.distance < length - 4;
      },
    });
  }

  /** Counters for test mode. */
  stats(): Record<string, number | boolean> {
    const { render } = this.renderer.info;
    return {
      framesRendered: this.framesRendered,
      animationFrames: this.animationFrames,
      tweenFrames: this.tweenFrames,
      animating: this.rafId !== undefined,
      tweening: this.animator.active,
      glowing: this.glowIds.length,
      reducedMotion: this.reducedMotion.matches,
      lastFrameMs: Math.round(this.lastFrameMs * 100) / 100,
      drawCalls: render.calls,
      triangles: render.triangles,
      buildings: this.current?.layout.buildings.length ?? 0,
      instancedMeshes,
      shadows: this.renderer.shadowMap.enabled,
      edges: this.uniforms.uEdge.value > 0,
      labelsShown: this.labels.shown,
      qualityLevel: this.quality.level,
      introDone: this.introDone,
      ...this.visibility(),
    };
  }

  /**
   * What the last written state draws (test mode): buildings with a visible height, plates in
   * the scene, and the camera. A drawn city has `buildingsVisible > 0` whenever it is mounted.
   */
  private visibility(): Record<string, number | boolean> {
    const shown = !this.element.hidden;
    let buildingsVisible = 0;
    for (const mesh of [this.solid, this.glass]) {
      if (!mesh?.visible || !mesh.parent) continue;
      const m = mesh.instanceMatrix.array;
      for (let i = 0; i < mesh.count; i++) {
        const o = i * 16;
        if ((m[o + 15] ?? 0) === 1 && (m[o + 5] ?? 0) > 0.01 && (m[o] ?? 0) > 0) {
          buildingsVisible += 1;
        }
      }
    }
    const round = (n: number): number => Math.round(n * 100) / 100;
    return {
      shown,
      buildingsVisible: shown ? buildingsVisible : 0,
      platesVisible: shown && this.plates?.visible && this.plates.parent ? this.plates.count : 0,
      flatten: round(this.flatten),
      fov: round(this.camera.fov),
      cameraDistance: round(this.camera.position.distanceTo(this.controls.target)),
      targetX: round(this.controls.target.x),
      targetY: round(this.controls.target.y),
      targetZ: round(this.controls.target.z),
      cameraX: round(this.camera.position.x),
      cameraY: round(this.camera.position.y),
      cameraZ: round(this.camera.position.z),
      controlsEnabled: this.controls.enabled,
      morphing: this.animator.isRunning('morph'),
      pageVisible: document.visibilityState === 'visible',
      watchdogFinishes: this.watchdogFinishes,
    };
  }

  /**
   * Test mode: orbits the camera one step per animation frame for `frames` frames and measures
   * the frame interval (so vsync caps it: 16.7 ms at 60 Hz) and the CPU time of each render.
   */
  bench(frames: number): Promise<Record<string, number | boolean>> {
    for (const name of ['camera', 'build', 'focus']) this.animator.finish(name);
    return new Promise((resolve) => {
      const intervals: number[] = [];
      const renders: number[] = [];
      let last = 0;
      let left = frames;
      const up = new Vector3(0, 1, 0);
      const step = (now: number): void => {
        if (last > 0) intervals.push(now - last);
        last = now;
        const start = performance.now();
        this.camera.position
          .sub(this.controls.target)
          .applyAxisAngle(up, 0.01)
          .add(this.controls.target);
        this.camera.lookAt(this.controls.target);
        this.renderer.render(this.scene, this.camera);
        renders.push(performance.now() - start);
        this.framesRendered += 1;
        if (--left > 0) {
          requestAnimationFrame(step);
          return;
        }
        const sorted = [...intervals].sort((a, b) => a - b);
        const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
        const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
        const round = (n: number): number => Math.round(n * 100) / 100;
        resolve({
          ...this.stats(),
          benchFrames: frames,
          meanFrameMs: round(mean),
          p95FrameMs: round(p95),
          fps: round(1000 / Math.max(mean, 0.001)),
          meanRenderCpuMs: round(renders.reduce((a, b) => a + b, 0) / Math.max(1, renders.length)),
          pixelRatio: this.renderer.getPixelRatio(),
          width: this.renderer.domElement.width,
          height: this.renderer.domElement.height,
        });
      };
      requestAnimationFrame(step);
    });
  }

  /**
   * Test mode: replays the intro on the current city and measures its frame intervals (the intro
   * must stay at ≥ 45 fps).
   */
  benchIntro(): Promise<Record<string, number | boolean>> {
    return new Promise((resolve) => {
      if (!this.current) {
        resolve(this.stats());
        return;
      }
      const intervals: number[] = [];
      const renders: number[] = [];
      let last = 0;
      this.animator.finish('build');
      this.plan = this.makePlan(
        this.visuals.map((to, index) => ({ kind: 'added', from: { ...to, height: 0 }, to, index })),
        this.introDelays(this.current.layout),
      );
      this.writeAttributes(this.current.layout);
      this.startIntro();
      const step = (now: number): void => {
        if (last > 0) intervals.push(now - last);
        last = now;
        const start = performance.now();
        this.animator.step(this.testNow ?? now);
        this.renderer.render(this.scene, this.camera);
        renders.push(performance.now() - start);
        if (this.animator.isRunning('build')) {
          requestAnimationFrame(step);
          return;
        }
        const mean = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);
        const round = (n: number): number => Math.round(n * 100) / 100;
        resolve({
          ...this.stats(),
          introFrames: intervals.length + 1,
          introMeanFrameMs: round(mean),
          introMaxFrameMs: round(Math.max(0, ...intervals)),
          introFps: round(1000 / Math.max(mean, 0.001)),
          introMeanCpuMs: round(renders.reduce((a, b) => a + b, 0) / Math.max(1, renders.length)),
        });
      };
      requestAnimationFrame(step);
    });
  }

  /** The box around every plate and building, and the rank-1 building's centre. */
  private bounds(): { min: Vec3; max: Vec3; focus: Vec3 | undefined } {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    for (const boxes of [this.plateBoxes, this.boxes]) {
      for (let o = 0; o + BOX_STRIDE <= boxes.length; o += BOX_STRIDE) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k] ?? 0, boxes[o + k] ?? 0);
          hi[k] = Math.max(hi[k] ?? 0, boxes[o + 3 + k] ?? 0);
        }
      }
    }
    if (!Number.isFinite(lo[0])) {
      return { min: [-500, 0, -500], max: [500, 1, 500], focus: undefined };
    }
    const min: Vec3 = [lo[0] ?? 0, lo[1] ?? 0, lo[2] ?? 0];
    const max: Vec3 = [hi[0] ?? 0, hi[1] ?? 0, hi[2] ?? 0];
    const first = this.current?.layout.buildings.find((b) => b.rank === 1);
    const o = (first?.id ?? -1) * BOX_STRIDE;
    const focus: Vec3 | undefined =
      first === undefined
        ? undefined
        : [
            ((this.boxes[o] ?? 0) + (this.boxes[o + 3] ?? 0)) / 2,
            ((this.boxes[o + 1] ?? 0) + (this.boxes[o + 4] ?? 0)) / 2,
            ((this.boxes[o + 2] ?? 0) + (this.boxes[o + 5] ?? 0)) / 2,
          ];
    return { min, max, focus };
  }

  /** Ends every animation now (captures draw the settled city). */
  private settleAll(): void {
    for (const name of ['camera', 'build', 'focus', 'morph']) this.animator.finish(name);
    this.flatten = 1;
    this.setFov(BASE_FOV);
    this.controls.enabled = true;
    this.writeBuildings();
  }

  /**
   * Test mode: the live view, settled and at full quality, drawn into `ctx` (width × height CSS
   * px). The page has already been laid out at that size.
   */
  snapshot(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.settleAll();
    this.drawInto(ctx, width, height);
  }

  /**
   * Test mode: freezes the animation clock and moves it `advance` ms forward (from now, on the
   * first call); `null` lets it run again.
   */
  setTestClock(advance: number | null): void {
    this.testNow = advance === null ? undefined : (this.testNow ?? performance.now()) + advance;
    this.updateAnimation();
  }

  /** How far the 3D ↔ 2D morph has flattened the city: 1 = full height, 0 = the treemap. */
  get flatness(): number {
    return this.flatten;
  }

  /**
   * Test mode: the live view as it is at the (frozen) clock, animations not settled, at full
   * quality, drawn into `ctx` (width × height CSS px).
   */
  frame(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.animator.step();
    this.drawInto(ctx, width, height);
  }

  private drawInto(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.restoreQuality();
    this.fit();
    this.renderNow();
    ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
  }

  /**
   * The postcard: draws the city into `ctx` at `width` × `height` from the hero angle, in the
   * postcard's own colours (the same in every editor theme), glow on, nothing highlighted. Then
   * puts the live view back exactly as it was, within the same task, so the visible canvas never
   * shows the capture.
   */
  capture(ctx: CanvasRenderingContext2D, width: number, height: number, look: PostcardLook): void {
    if (!this.current) return;
    const saved = {
      theme: this.theme,
      highContrast: this.highContrast,
      hover: this.hoverId,
      selected: this.selectedId,
      pixelRatio: this.renderer.getPixelRatio(),
      position: this.camera.position.clone(),
      target: this.controls.target.clone(),
    };
    this.settleAll();
    this.setFocus(null, true);
    this.theme = look.theme;
    this.highContrast = false;
    this.recolour();
    const backdrop = gradientTexture(look.gradient);
    this.scene.background = backdrop;
    this.scene.fog = null;
    if (this.glow) this.glow.material.opacity = GLOW_OPACITY;

    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.clearViewOffset(); // fit() puts it back
    this.camera.updateProjectionMatrix();
    const { min, max, focus } = this.bounds();
    const pose = heroPose(min, max, focus, this.camera.fov, width / height);
    this.camera.position.set(...pose.position);
    this.camera.lookAt(...pose.target);
    this.renderer.render(this.scene, this.camera);
    // Read back before the task ends (no preserveDrawingBuffer needed).
    ctx.drawImage(this.renderer.domElement, 0, 0, width, height);

    backdrop.dispose();
    this.theme = saved.theme;
    this.highContrast = saved.highContrast;
    this.recolour();
    this.renderer.setPixelRatio(saved.pixelRatio);
    this.camera.position.copy(saved.position);
    this.controls.target.copy(saved.target);
    this.controls.update();
    this.fit();
    this.selectedId = saved.selected;
    this.hoverId = saved.hover;
    const focusId = saved.hover ?? saved.selected;
    if (focusId !== null) this.setFocus(focusId, true);
    this.renderNow();
  }

  dispose(): void {
    if (this.watchdog !== undefined) clearTimeout(this.watchdog);
    if (this.rafId !== undefined) cancelAnimationFrame(this.rafId);
    this.rafId = undefined;
    this.resize.disconnect();
    this.controls.dispose();
    for (const mesh of [this.solid, this.glass, this.plates, this.glow]) {
      if (!mesh) continue;
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
      mesh.dispose();
    }
    this.background?.dispose();
    this.labels.layer.remove();
    this.renderer.dispose();
  }
}
