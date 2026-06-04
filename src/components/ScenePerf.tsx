import { memo, type RefObject, useEffect, useMemo, useRef } from "react";
import { formatBytes, formatCount, fpsColor, frameStats, shortGpu } from "../lib/gpu";
import type { VolumeViewer } from "../rendering";

/**
 * Live performance overlay for the Three.js scene. Two layouts, chosen by the
 * `detail` prop (driven from the Leva "scene perf" folder):
 *
 *  - "compact": FPS + sparkline + a CPU/GPU/RAM strip (absolute + % each).
 *  - "full": adds frame-rate stability (avg/min/1%-low), estimated VRAM, and the
 *    renderer/ray-march counters laid out in 2–3 columns to stay short.
 *
 * Hardware is grouped per device (CPU / GPU / RAM) with both an absolute value
 * and a percentage: CPU/GPU as a share of the frame budget (so the bigger one is
 * the bottleneck — it's tinted), RAM as a share of the JS heap limit.
 *
 * Numbers are written straight to DOM refs from a private rAF loop, so the panel
 * never triggers a React re-render. Slots absent in the current layout are null
 * and skipped. memo() keeps frequent App re-renders (control tweaks, crosshair
 * drags) from restarting that loop.
 */
const GRAPH_W = 150;
const GRAPH_H = 34;
const MAX_FPS = 120;
const HISTORY = 150; // frames kept for the sparkline + stability math

const ACCENT = "#9ecbff"; // marks the current bottleneck (CPU vs GPU)
const NORMAL = "#e6ecf6";

type Detail = "compact" | "full";

/** A key/value line used inside the 2-column counter grids (or full-width). */
function Row({
  k,
  vref,
  full,
}: {
  k: string;
  vref: RefObject<HTMLSpanElement | null>;
  full?: boolean;
}) {
  return (
    <div className={full ? "perf-row" : undefined}>
      <span className="k">{k}</span>
      <span className="v" ref={vref}>
        –
      </span>
    </div>
  );
}

export const ScenePerf = memo(function ScenePerf({
  viewer,
  detail,
}: {
  viewer: VolumeViewer;
  detail: Detail;
}) {
  const full = detail === "full";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  // One ref per readout slot. Bundled (once, via useMemo) into a stable object so
  // the rAF effect's deps don't change identity on every render.
  const fpsR = useRef<HTMLSpanElement>(null);
  const frameR = useRef<HTMLSpanElement>(null);
  const cpuMsR = useRef<HTMLSpanElement>(null);
  const cpuPctR = useRef<HTMLSpanElement>(null);
  const gpuMsR = useRef<HTMLSpanElement>(null);
  const gpuPctR = useRef<HTMLSpanElement>(null);
  const vramR = useRef<HTMLSpanElement>(null);
  const ramAbsR = useRef<HTMLSpanElement>(null);
  const ramPctR = useRef<HTMLSpanElement>(null);
  const avgR = useRef<HTMLSpanElement>(null);
  const minR = useRef<HTMLSpanElement>(null);
  const lowR = useRef<HTMLSpanElement>(null);
  const drawsR = useRef<HTMLSpanElement>(null);
  const trisR = useRef<HTMLSpanElement>(null);
  const linesR = useRef<HTMLSpanElement>(null);
  const pointsR = useRef<HTMLSpanElement>(null);
  const geomR = useRef<HTMLSpanElement>(null);
  const texR = useRef<HTMLSpanElement>(null);
  const progR = useRef<HTMLSpanElement>(null);
  const stepsR = useRef<HTMLSpanElement>(null);
  const vpR = useRef<HTMLSpanElement>(null);
  const samplesR = useRef<HTMLSpanElement>(null);
  const renderR = useRef<HTMLSpanElement>(null);
  const r = useMemo(
    () => ({
      fps: fpsR,
      frame: frameR,
      cpuMs: cpuMsR,
      cpuPct: cpuPctR,
      gpuMs: gpuMsR,
      gpuPct: gpuPctR,
      vram: vramR,
      ramAbs: ramAbsR,
      ramPct: ramPctR,
      avg: avgR,
      min: minR,
      low: lowR,
      draws: drawsR,
      tris: trisR,
      lines: linesR,
      points: pointsR,
      geom: geomR,
      tex: texR,
      prog: progR,
      steps: stepsR,
      vp: vpR,
      samples: samplesR,
      render: renderR,
    }),
    [],
  );

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;

    const fpsHistory: number[] = []; // smoothed fps, for the calm sparkline
    const frameHistory: number[] = []; // raw frame intervals (ms), for stability
    let raf = 0;
    let lastText = 0;
    let graphW = GRAPH_W; // canvas CSS width — tracks the panel so the graph spans it

    // Size the drawing buffer to the canvas's real width (it's width:100%), so the
    // sparkline fills the panel crisply at DPR. Re-runs on any resize (mode/viewport).
    const sizeCanvas = () => {
      graphW = Math.max(1, Math.round(cv.clientWidth) || GRAPH_W);
      cv.width = graphW * dpr;
      cv.height = GRAPH_H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // a resize clears the buffer + transform
      if (fpsHistory.length > graphW) fpsHistory.splice(0, fpsHistory.length - graphW);
    };
    const ro = new ResizeObserver(sizeCanvas);
    ro.observe(cv);
    sizeCanvas();

    const write = (ref: RefObject<HTMLSpanElement | null>, text: string, color?: string) => {
      const el = ref.current;
      if (!el) return;
      el.textContent = text;
      if (color) el.style.color = color;
    };

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const s = viewer.stats;

      // --- sparkline (every frame) ---
      fpsHistory.push(s.fps);
      if (fpsHistory.length > graphW) fpsHistory.shift();
      frameHistory.push(s.frameMs);
      if (frameHistory.length > HISTORY) frameHistory.shift();
      ctx.clearRect(0, 0, graphW, GRAPH_H);
      ctx.strokeStyle = "rgba(120,160,220,0.18)";
      ctx.lineWidth = 1;
      for (const guide of [60, 30]) {
        const y = GRAPH_H - (guide / MAX_FPS) * GRAPH_H;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(graphW, y + 0.5);
        ctx.stroke();
      }
      const x0 = graphW - fpsHistory.length;
      for (let i = 0; i < fpsHistory.length; i++) {
        const f = fpsHistory[i];
        const hgt = Math.min(f / MAX_FPS, 1) * GRAPH_H;
        ctx.fillStyle = fpsColor(f);
        ctx.fillRect(x0 + i, GRAPH_H - hgt, 1, hgt);
      }

      // --- numbers (throttled to ~8 Hz) ---
      if (t - lastText <= 120) return;
      lastText = t;

      const fr = s.frameMs; // 0 until a real (sub-300ms) frame has been timed
      const gpuOK = viewer.gpuTimingSupported;
      const gpuBound = gpuOK && s.gpuMs >= s.cpuMs;
      const pct = (v: number) => (fr > 0 ? `${((v / fr) * 100).toFixed(0)}%` : "–");

      write(r.fps, s.fps.toFixed(0), fpsColor(s.fps));
      write(r.frame, fr > 0 ? `${fr.toFixed(1)} ms` : "–");

      // CPU / GPU / RAM — absolute + percentage; bottleneck tinted.
      write(r.cpuMs, `${s.cpuMs.toFixed(1)} ms`, gpuBound ? NORMAL : ACCENT);
      write(r.cpuPct, pct(s.cpuMs));
      write(r.gpuMs, gpuOK ? `${s.gpuMs.toFixed(1)} ms` : "n/a", gpuBound ? ACCENT : NORMAL);
      write(r.gpuPct, gpuOK ? pct(s.gpuMs) : "n/a");
      const heapPct = s.jsHeapLimitMB > 0 ? (s.jsHeapMB / s.jsHeapLimitMB) * 100 : 0;
      write(r.ramAbs, s.jsHeapMB > 0 ? `${s.jsHeapMB.toFixed(0)} MB` : "n/a");
      write(r.ramPct, s.jsHeapMB > 0 ? `${heapPct.toFixed(0)}%` : "n/a");

      if (!full) return; // the rest of the slots aren't mounted in compact mode

      write(r.vram, formatBytes(s.texBytes));
      const fs = frameStats(frameHistory);
      write(r.avg, fs.avg.toFixed(0));
      write(r.min, fs.min.toFixed(0));
      write(r.low, fs.low.toFixed(0), fpsColor(fs.low));
      write(r.draws, `${s.drawCalls}`);
      write(r.tris, `${(s.triangles / 1000).toFixed(1)}k`);
      write(r.lines, `${s.lines}`);
      write(r.points, `${s.points}`);
      write(r.geom, `${s.geometries}`);
      write(r.tex, `${s.textures}`);
      write(r.prog, `${s.programs}`);
      write(r.steps, `${s.steps}`);
      write(r.vp, `${s.viewports}`);
      write(r.samples, formatCount(s.volumePixels * s.steps));
      write(r.render, s.drawW > 0 ? `${s.drawW}×${s.drawH} @${s.dpr}x` : "–");
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [viewer, full, r]);

  return (
    <div className="scene-perf" data-detail={detail}>
      <div className="perf-top">
        <span className="perf-fps" ref={r.fps}>
          –
        </span>
        <span className="perf-unit">FPS</span>
        <span className="perf-frame" ref={r.frame} />
        <span className="perf-gpu" title={viewer.gpuName}>
          {shortGpu(viewer.gpuName)}
        </span>
      </div>
      <canvas className="perf-graph" ref={canvasRef} />

      {/* CPU / GPU / RAM — shown in both layouts. */}
      <div className="perf-cols">
        <div>
          <span className="lbl">CPU</span>
          <span className="abs" ref={r.cpuMs}>
            –
          </span>
          <span className="pct" ref={r.cpuPct}>
            –
          </span>
        </div>
        <div>
          <span className="lbl">GPU</span>
          <span className="abs" ref={r.gpuMs}>
            –
          </span>
          <span className="pct" ref={r.gpuPct}>
            –
          </span>
          {full && (
            <span className="pct" ref={r.vram}>
              –
            </span>
          )}
        </div>
        <div>
          <span className="lbl">RAM</span>
          <span className="abs" ref={r.ramAbs}>
            –
          </span>
          <span className="pct" ref={r.ramPct}>
            –
          </span>
        </div>
      </div>

      {full && (
        <>
          <div className="perf-sec">rate (fps)</div>
          <div className="perf-cols">
            <div>
              <span className="lbl">avg</span>
              <span className="abs" ref={r.avg}>
                –
              </span>
            </div>
            <div>
              <span className="lbl">min</span>
              <span className="abs" ref={r.min}>
                –
              </span>
            </div>
            <div>
              <span className="lbl">1% low</span>
              <span className="abs" ref={r.low}>
                –
              </span>
            </div>
          </div>

          <div className="perf-sec">scene</div>
          <div className="perf-grid">
            <Row k="draws" vref={r.draws} />
            <Row k="tris" vref={r.tris} />
            <Row k="lines" vref={r.lines} />
            <Row k="points" vref={r.points} />
          </div>
          <div className="perf-cols">
            <div>
              <span className="lbl">geom</span>
              <span className="abs" ref={r.geom}>
                –
              </span>
            </div>
            <div>
              <span className="lbl">tex</span>
              <span className="abs" ref={r.tex}>
                –
              </span>
            </div>
            <div>
              <span className="lbl">prog</span>
              <span className="abs" ref={r.prog}>
                –
              </span>
            </div>
          </div>

          <div className="perf-sec">volume</div>
          <div className="perf-grid">
            <Row k="steps" vref={r.steps} />
            <Row k="views" vref={r.vp} />
            <Row k="samples" vref={r.samples} />
          </div>
          <Row k="render" vref={r.render} full />
        </>
      )}
    </div>
  );
});
