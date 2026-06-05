/**
 * Dev-only feature-tour reel — drives every control in the UI on a timeline so
 * the whole app can be screen-recorded hands-free. Plays through the same Leva
 * setter the real controls use (see App.tsx's dev hook), so what you record is
 * the genuine pipeline, not a mock.
 *
 * NOT IN PRODUCTION. This module is reached only from the `import.meta.env.DEV`
 * branch in App.tsx, which Vite eliminates from the production bundle (DEV is
 * statically `false` there), so Rollup never emits this chunk. `tsc` still
 * type-checks it.
 *
 * Triggers (any of):
 *   • open the app at `/?demo` (or `#demo`) — auto-plays once the first volume is ready
 *   • press Shift+D to start / stop
 *   • call `__demo()` / `__demoStop()` from the console
 *   • Esc stops and restores an idle state
 */
import type { Vector3 } from "three";
import type { VolumeViewer } from "../rendering";
import type { Volume } from "../volume";

type LevaSet = (partial: Record<string, unknown>) => void;
type LevaGet = (path: string) => unknown;

export interface DemoApi {
  /** Leva's `set` — the same setter the UI controls write through. */
  set: LevaSet;
  /** Leva's `get` — folder-dotted paths, e.g. `get("clip.clipX")`. */
  get: LevaGet;
  getViewer: () => VolumeViewer | null;
  getVolume: () => Volume | null;
}

// Rough total runtime, only used to drive the top progress line. The reel caps
// the bar below 100% until it actually finishes (dataset loads add slack).
const TOTAL_MS = 132_000;

let installed = false;
let currentApi: DemoApi | null = null;
let abort: AbortController | null = null;

/**
 * Schedule a callback on the next animation frame, falling back to a timer if
 * rAF is starved. Browsers pause requestAnimationFrame in background/hidden
 * tabs (mirrors lib/nextPaint.ts), so a frame-gated tween would otherwise stall
 * the whole reel until the tab is focused. The fallback keeps it advancing.
 */
function nextFrame(cb: () => void): void {
  let done = false;
  const go = () => {
    if (done) return;
    done = true;
    cb();
  };
  requestAnimationFrame(go);
  window.setTimeout(go, 32);
}

/** Wire up triggers once; refresh the API on every (re)install. */
export function installDemoReel(api: DemoApi): void {
  currentApi = api;
  if (installed) return;
  installed = true;

  (window as unknown as Record<string, unknown>).__demo = () => start();
  (window as unknown as Record<string, unknown>).__demoStop = () => stop();

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (abort) stop();
    } else if ((e.key === "D" || e.key === "d") && e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      abort ? stop() : start();
    }
  });

  if (/(?:[?&#]|^)demo\b/.test(location.search + location.hash)) {
    // Give the app a beat to mount; start() then waits for the volume itself.
    window.setTimeout(() => start(), 600);
  }

  // eslint-disable-next-line no-console
  console.info("%c● demo reel armed", "color:#39d353", "— Shift+D or __demo() to play");
}

/** Thrown by the timeline primitives when the reel is stopped, so runReel
 *  unwinds straight to cleanup instead of fast-forwarding through every
 *  remaining scene (which would rapid-fire setters, exports and screenshots). */
const ABORTED = Symbol("demo-aborted");

function start(): void {
  if (abort || !currentApi) return;
  abort = new AbortController();
  const signal = abort.signal;
  const ui = mountOverlay();
  runReel(currentApi, signal, ui)
    .catch((err) => {
      if (err !== ABORTED) console.error("[demo] error:", err);
    })
    .finally(() => {
      if (signal === abort?.signal) abort = null;
      ui.dispose();
    });
}

function stop(): void {
  abort?.abort();
  abort = null;
}

// ---------------------------------------------------------------------------
// The reel
// ---------------------------------------------------------------------------

async function runReel(api: DemoApi, signal: AbortSignal, ui: Overlay): Promise<void> {
  const L = api.set;
  const round = (n: number, d = 4) => Number(n.toFixed(d));

  // --- timeline primitives (reject with ABORTED on stop, so the await chain
  //     unwinds immediately rather than racing through the rest of the reel) --
  const sleep = (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(ABORTED);
      let id = 0;
      const onAbort = () => {
        window.clearTimeout(id);
        reject(ABORTED);
      };
      id = window.setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      signal.addEventListener("abort", onAbort, { once: true });
    });

  const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  /** Run `onT(eased)` once per frame for `ms`, then resolve. */
  const ramp = (ms: number, onT: (t: number) => void) =>
    new Promise<void>((resolve, reject) => {
      const t0 = performance.now();
      const step = () => {
        if (signal.aborted) return reject(ABORTED);
        const raw = Math.min(1, (performance.now() - t0) / ms);
        onT(easeInOut(raw));
        raw < 1 ? nextFrame(step) : resolve();
      };
      nextFrame(step);
    });

  const sweep = (key: string, from: number, to: number, ms: number) =>
    ramp(ms, (t) => L({ [key]: round(from + (to - from) * t) }));

  const sweepRange = (key: string, from: [number, number], to: [number, number], ms: number) =>
    ramp(ms, (t) =>
      L({
        [key]: [round(from[0] + (to[0] - from[0]) * t), round(from[1] + (to[1] - from[1]) * t)],
      }),
    );

  /** After a dataset switch: wait for the load bar to appear, then clear. */
  const waitDatasetLoad = async () => {
    const seen = () => document.querySelector(".loader");
    const t0 = performance.now();
    while (!signal.aborted && !seen() && performance.now() - t0 < 1500) await sleep(80);
    while (!signal.aborted && seen()) await sleep(120);
    await sleep(300); // let the first rendered frame settle
  };

  const waitFirstVolume = async () => {
    while (!signal.aborted && !api.getVolume()) await sleep(120);
    await sleep(200);
  };

  // --- Leva-button equivalents (buttons aren't settable) -------------------
  const autoWindow = () => {
    const v = api.getVolume();
    if (v) L({ window: [round(v.suggestedWindow[0], 3), round(v.suggestedWindow[1], 3)] });
  };
  const resetView = () => api.getViewer()?.resetView();

  // --- Manual camera control. We orbit relative to each dataset's canonical
  //     "home" framing (the anterior view resetView() derives from the affine),
  //     so the reel picks deliberate angles instead of leaning on autoRotate.
  //     camera/controls are private on VolumeViewer — reach them via a runtime
  //     cast (dev-only module, never shipped).
  type Cam = {
    camera: { position: Vector3; up: Vector3 };
    controls: { target: Vector3; update(): void };
    resetView(): void;
  };
  const cam = () => api.getViewer() as unknown as Cam | null;

  let home: { offset: Vector3; up: Vector3; target: Vector3; dist: number } | null = null;
  let pose: Shot = { az: 0, pol: 0, ds: 1 };

  /** Capture the dataset's anterior framing as the orbit reference (call after each load). */
  const captureHome = () => {
    const v = cam();
    if (!v) return;
    v.resetView();
    home = {
      offset: v.camera.position.clone().sub(v.controls.target),
      up: v.camera.up.clone().normalize(),
      target: v.controls.target.clone(),
      dist: v.camera.position.distanceTo(v.controls.target),
    };
    pose = { az: 0, pol: 0, ds: 1 };
  };

  /** Point the camera at an orbit pose: azimuth + polar deltas from home, distance scale. */
  const applyView = (az: number, pol: number, ds: number) => {
    const v = cam();
    if (!v || !home) return;
    const offset = home.offset.clone().applyAxisAngle(home.up, az);
    const right = home.up.clone().cross(offset).normalize();
    offset.applyAxisAngle(right, pol).setLength(home.dist * ds);
    v.camera.position.copy(home.target).add(offset);
    v.camera.up.copy(home.up);
    v.controls.update();
  };

  /** Snap to a pose instantly. */
  const setPose = (s: Shot) => {
    const ds = s.ds ?? 1;
    pose = { az: s.az, pol: s.pol, ds };
    applyView(s.az, s.pol, ds);
  };

  /** Glide from the current pose to a new one over `ms` (eased). */
  const moveTo = (to: Shot, ms: number) => {
    const from = pose;
    const ds0 = from.ds ?? 1;
    const ds1 = to.ds ?? 1;
    pose = { az: to.az, pol: to.pol, ds: ds1 };
    return ramp(ms, (t) =>
      applyView(
        from.az + (to.az - from.az) * t,
        from.pol + (to.pol - from.pol) * t,
        ds0 + (ds1 - ds0) * t,
      ),
    );
  };

  /** Fire a native drag event so React shows / hides the DropOverlay. */
  const fireDrag = (type: "dragover" | "dragleave") =>
    document
      .querySelector(".app")
      ?.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));

  // --- a clean baseline the recording always starts from -------------------
  const baseline = () => {
    L({
      layout: "3D",
      mode: "Volume",
      technique: "DVR",
      colormap: "gray",
      steps: 256,
      density: 0.4,
      autoRotate: false,
      clipEnabled: false,
      showX: true,
      showY: true,
      showZ: true,
      thickness: 1,
      showRuler: true,
      showPerf: true,
      background: "#0a0c11",
    });
    autoWindow();
    resetView();
  };

  const cap = ui.caption;
  const progress = ui.startProgress(TOTAL_MS);

  // === SCENES — three datasets, deliberate camera work ====================
  await waitFirstVolume();

  // ---- Intro -------------------------------------------------------------
  baseline();
  captureHome();
  setPose({ az: 0.6, pol: -0.12 });
  cap("DICOM / NIfTI Volume Viewer", "One WebGL2 viewer · three real datasets");
  await sleep(2600);

  // ========================================================================
  // ACT 1 — MRI head · T1 brain (NIfTI): volume rendering + look
  // ========================================================================
  cap("① MRI — T1 brain", "NIfTI · 8-bit · direct volume rendering");
  await moveTo({ az: -0.7, pol: -0.04 }, 4200); // slow drift across the face

  cap("Density", "DVR opacity / accumulation");
  await sweep("density", 0.4, 1.15, 2600);
  await sweep("density", 1.15, 0.5, 2000);

  cap("Ray-march steps + perf HUD", "sample budget — quality vs FPS");
  L({ perfDetail: "full" });
  await sweep("steps", 256, 512, 1600);
  await sleep(500);
  await sweep("steps", 512, 128, 1600);
  await sleep(400);
  L({ steps: 256, perfDetail: "compact" });
  await sleep(800);
  L({ perfDetail: "full" });

  cap("Auto-rotate", "one hands-off turntable — then back to manual");
  L({ autoRotate: true });
  await sleep(3000);
  L({ autoRotate: false });
  setPose({ az: 0.9, pol: -0.05 }); // re-sync after the free spin

  cap("MIP", "maximum-intensity projection");
  L({ technique: "MIP" });
  await moveTo({ az: -0.6, pol: 0.02 }, 3000);
  L({ technique: "DVR" });

  cap("Window / Level", "intensity windowing — watch the histogram");
  await moveTo({ az: 0, pol: 0 }, 1400); // face-on for the histogram beat
  await sweepRange("window", [0.1, 0.85], [0.42, 0.62], 2200);
  await sweepRange("window", [0.42, 0.62], [0.0, 1.0], 1800);
  cap("Presets", "high-contrast · full-range · auto (data)");
  L({ window: [0.2, 0.55] });
  await sleep(1200);
  L({ window: [0, 1] });
  await sleep(1200);
  autoWindow();
  await sleep(1200);

  cap("Colormaps", "gray · bone · hot · viridis · jet");
  setPose({ az: 0.5, pol: -0.1 });
  for (const c of ["bone", "hot", "viridis", "jet", "gray"]) {
    L({ colormap: c });
    await sleep(1150);
  }

  cap("Background + reset view", "scene clear color · recenter the camera");
  for (const bg of ["#101826", "#1d1b2e", "#0a0c11"]) {
    L({ background: bg });
    await sleep(1100);
  }
  resetView();
  setPose({ az: 0, pol: 0 });
  await sleep(900);

  // Slices live on the brain: the T1 (uint8) makes far brighter planes than the CT.
  cap("Slice mode", "three orthogonal planes through the brain");
  L({ mode: "Slices" });
  autoWindow();
  setPose({ az: 0.4, pol: -0.1 });
  await sleep(2200);
  cap("Axial · coronal · sagittal", "sweep each plane through the volume");
  await sweep("sliceZ", 0.5, 0.3, 1400);
  await sweep("sliceZ", 0.3, 0.7, 1600);
  await sweep("sliceZ", 0.7, 0.5, 1000);
  await sweep("sliceY", 0.5, 0.35, 1300);
  await sweep("sliceY", 0.35, 0.5, 1000);
  await sweep("sliceX", 0.5, 0.66, 1300);
  await sweep("sliceX", 0.66, 0.5, 1000);
  cap("Show / hide planes", "toggle each orthogonal plane");
  L({ showX: false });
  await sleep(1100);
  L({ showY: false });
  await sleep(1100);
  L({ showX: true, showY: true });
  await sleep(900);
  cap("Slab thickness + projection", "mean · MIP · MinIP across the slab");
  await sweep("thickness", 1, 10, 1500);
  for (const m of ["mean", "MIP", "MinIP"]) {
    L({ slabMode: m });
    await sleep(1100);
  }
  L({ thickness: 1, mode: "Volume" });

  cap("2×2 MPR", "synchronized axial · coronal · sagittal");
  L({ layout: "MPR" });
  await sleep(2400);
  cap("Crosshair navigation", "move the crosshair — every plane follows");
  await sweep("sliceX", 0.5, 0.4, 1300);
  await sweep("sliceY", 0.5, 0.62, 1300);
  await sweep("sliceZ", 0.5, 0.42, 1300);
  await sweep("sliceX", 0.4, 0.5, 1000);
  await sweep("sliceY", 0.62, 0.5, 1000);
  await sweep("sliceZ", 0.42, 0.5, 1000);
  L({ layout: "3D" });

  // ========================================================================
  // ACT 2 — CT thorax (NIfTI · Hounsfield units): the cut
  // ========================================================================
  cap("② CT — thorax", "NIfTI · int16 · Hounsfield units");
  L({ dataset: "ct_abdo" });
  await waitDatasetLoad();
  captureHome();
  L({
    technique: "DVR",
    colormap: "bone",
    steps: 384,
    density: 0.9,
    clipEnabled: false,
    mode: "Volume",
    window: [0.33, 0.52],
  });
  setPose({ az: 0.22, pol: 0.12 }); // head-on from the front, tilted to peer into the chest
  await sleep(1800);

  cap("Hounsfield windowing", "narrow the window → the skeleton reads bright");
  await sweepRange("window", [0.33, 0.52], [0.5, 0.85], 1500); // push high: only the densest
  await sweepRange("window", [0.5, 0.85], [0.22, 0.38], 2000); // settle on the bright-bone preset

  // The cut, seen from the FRONT. With invert on, the crop box removes the chest
  // wall; the peel then opens the window in two axes at once — Y's low edge
  // slides back (0.66 → 0.30) to strip the anterior organs while Z grows
  // (0.36→0.16 / 0.79→0.80) so the spine surfaces, taller, from inside.
  cap("Cut — crop box + invert", "keep the complement: a window cut into the chest");
  L({
    clipEnabled: true,
    clipInvert: true,
    clipX: [0.34, 0.74],
    clipY: [0.66, 1.0],
    clipZ: [0.36, 0.79],
    density: 1.0,
  });
  await sleep(2400);

  cap("Peel away the chest wall", "front organs fade — the spine emerges from inside");
  // Open Y (depth) and Z (height) together, ending Z at [0.16, 0.80].
  await ramp(4200, (t) =>
    L({
      clipY: [round(0.66 + (0.3 - 0.66) * t), 1.0],
      clipZ: [round(0.36 + (0.16 - 0.36) * t), round(0.79 + (0.8 - 0.79) * t)],
    }),
  );
  await sleep(1400);
  await moveTo({ az: -0.18, pol: 0.08 }, 2600); // drift across the opened chest, still frontal
  await sleep(700);
  L({ clipEnabled: false, clipInvert: false });
  await sleep(600);

  // ========================================================================
  // ACT 3 — Dental CBCT (DICOM): isosurface + MPR
  // ========================================================================
  cap("③ DICOM — dental CBCT", "a real i-CAT series · 80 .dcm slices");
  L({ dataset: "icat_cbct" });
  await waitDatasetLoad();
  captureHome();
  L({
    technique: "Isosurface",
    iso: 0.5,
    colormap: "bone",
    steps: 384,
    density: 0.8,
    clipEnabled: false,
    mode: "Volume",
  });
  setPose({ az: -0.5, pol: 0.05 });
  await sleep(1500);

  cap("It's DICOM", "header parsed live — modality · transfer syntax · 80 frames");
  await sleep(2600); // hold while the InfoPanel shows the DICOM tags

  cap("Isosurface", "threshold sweep — enamel & cortical bone");
  await moveTo({ az: 0.55, pol: -0.04 }, 2800);
  await sweep("iso", 0.62, 0.36, 3000);
  await sweep("iso", 0.36, 0.5, 1400);

  cap("2×2 MPR + rulers", "synchronized planes · millimetre scales");
  L({ layout: "MPR" });
  await sleep(1800);
  await sweep("sliceZ", 0.5, 0.42, 1300);
  await sweep("sliceX", 0.5, 0.6, 1300);
  await sweep("sliceX", 0.6, 0.5, 1000);
  await sweep("sliceZ", 0.42, 0.5, 1000);
  cap("Rulers", "toggle the millimetre scales on every plane");
  L({ showRuler: false });
  await sleep(1300);
  L({ showRuler: true });
  await sleep(1300);

  // ---- Outro -------------------------------------------------------------
  L({ layout: "3D", technique: "Isosurface" });
  setPose({ az: -0.4, pol: 0.0 });
  cap("Bring your own data", "drag & drop a .nii / .nii.gz / .dcm to load it");
  fireDrag("dragover");
  await sleep(2400);
  fireDrag("dragleave");
  cap("Built to learn how DICOM / NIfTI work", "WebGL2 · React · Three.js");
  await moveTo({ az: 0.6, pol: -0.1 }, 3200);

  progress.finish();
  await ui.fadeOut();
  // Leave a clean, static idle state (no auto-spin) after the recording.
  baseline();
}

/** A camera orbit pose: azimuth + polar offset from the dataset's home view, and a distance scale. */
type Shot = { az: number; pol: number; ds?: number };

// ---------------------------------------------------------------------------
// Caption overlay (DOM + injected CSS, so styles.css stays untouched)
// ---------------------------------------------------------------------------

interface Overlay {
  caption: (title: string, sub?: string) => void;
  startProgress: (totalMs: number) => { finish: () => void };
  fadeOut: () => Promise<void>;
  dispose: () => void;
}

const STYLE_ID = "demo-reel-style";
const CSS = `
.demo-root { position: fixed; inset: 0; z-index: 9999; pointer-events: none;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.demo-bar { position: absolute; top: 0; left: 0; height: 3px; width: 0%;
  background: linear-gradient(90deg, #39d353, #f5c542, #ff5a3c); box-shadow: 0 0 8px #39d35399;
  transition: width 0.25s linear; }
.demo-badge { position: absolute; top: 14px; left: 16px; display: flex; gap: 7px; align-items: center;
  padding: 5px 10px; border-radius: 999px; background: rgba(10,12,17,0.6);
  border: 1px solid rgba(255,255,255,0.12); backdrop-filter: blur(6px);
  color: #e8edf4; font-size: 11px; letter-spacing: 0.12em; font-weight: 600; }
.demo-dot { width: 8px; height: 8px; border-radius: 50%; background: #ff5a3c;
  box-shadow: 0 0 6px #ff5a3c; animation: demo-pulse 1.1s ease-in-out infinite; }
@keyframes demo-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.25; } }
/* Bottom-centre, sitting just above the intensity histogram (~146px tall at
   bottom:18px), so the two never overlap. */
.demo-chyron { position: absolute; left: 50%; bottom: 168px; max-width: min(620px, 80vw);
  text-align: center; padding: 11px 20px; border-radius: 12px;
  background: linear-gradient(180deg, rgba(14,17,24,0.82), rgba(10,12,17,0.70));
  border: 1px solid rgba(57,211,83,0.22); border-top: 2px solid #39d353;
  backdrop-filter: blur(8px); box-shadow: 0 8px 30px rgba(0,0,0,0.5);
  opacity: 0; transform: translateX(-50%) translateY(10px);
  transition: opacity 0.28s ease, transform 0.28s ease; }
.demo-chyron.in { opacity: 1; transform: translateX(-50%) translateY(0); }
.demo-title { color: #f4f7fb; font-size: 21px; font-weight: 650; line-height: 1.15;
  letter-spacing: -0.01em; }
.demo-sub { color: #9fb0c3; font-size: 13px; margin-top: 4px; line-height: 1.3; }
.demo-root.fade { opacity: 0; transition: opacity 0.6s ease; }
`;

function mountOverlay(): Overlay {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const root = document.createElement("div");
  root.className = "demo-root";
  root.innerHTML = `
    <div class="demo-bar"></div>
    <div class="demo-badge"><span class="demo-dot"></span>DEMO</div>`;
  document.body.appendChild(root);

  const bar = root.querySelector<HTMLDivElement>(".demo-bar")!;

  let progressStopped = false;
  // Each caption is its own element, layered ABOVE the previous one (an
  // ever-increasing z-index) and cross-faded in on top — so the new message
  // never flashes behind the outgoing one.
  let capZ = 100;
  let prevCap: HTMLElement | null = null;

  const caption = (title: string, sub = "") => {
    capZ += 1;
    const el = document.createElement("div");
    el.className = "demo-chyron";
    el.style.zIndex = String(capZ);
    const t = document.createElement("div");
    t.className = "demo-title";
    t.textContent = title;
    const s = document.createElement("div");
    s.className = "demo-sub";
    s.textContent = sub;
    s.style.display = sub ? "block" : "none";
    el.append(t, s);
    root.appendChild(el);
    void el.offsetWidth; // commit the opacity:0 start, then transition in
    el.classList.add("in");
    const old = prevCap;
    prevCap = el;
    if (old) {
      old.classList.remove("in"); // fade the previous out, beneath the new one
      window.setTimeout(() => old.remove(), 450);
    }
  };

  const startProgress = (totalMs: number) => {
    const t0 = performance.now();
    let finished = false;
    const tick = () => {
      if (progressStopped) return;
      const f = finished ? 1 : Math.min(0.99, (performance.now() - t0) / totalMs);
      bar.style.width = `${(f * 100).toFixed(1)}%`;
      if (!finished) nextFrame(tick);
    };
    nextFrame(tick);
    return {
      finish: () => {
        finished = true;
        bar.style.width = "100%";
      },
    };
  };

  const fadeOut = () =>
    new Promise<void>((resolve) => {
      root.classList.add("fade");
      window.setTimeout(resolve, 650);
    });

  const dispose = () => {
    progressStopped = true;
    root.remove();
  };

  return { caption, startProgress, fadeOut, dispose };
}
