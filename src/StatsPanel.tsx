import { useEffect, useRef } from "react";
import type { VolumeViewer } from "./VolumeViewer";

/**
 * Live performance overlay: FPS (+ sparkline), CPU frame time, real GPU time
 * (WebGL2 timer query), JS heap, and renderer counters.
 *
 * It runs its own requestAnimationFrame loop and writes straight to DOM refs +
 * a canvas, so it never triggers a React re-render — the numbers update at
 * 60 Hz without churning the component tree.
 */
const GRAPH_W = 150;
const GRAPH_H = 38;
const MAX_FPS = 120;

export function fpsColor(fps: number): string {
  if (fps >= 55) return "#5ef08a";
  if (fps >= 30) return "#f0d24e";
  return "#f0644e";
}

export function shortGpu(name: string): string {
  // "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, ...)" -> "Apple M1 Max"
  const m = name.match(/ANGLE \(([^,]+),\s*([^,]+)/);
  const raw = m ? m[2] : name;
  const clean = raw
    .replace(/\s*\(.*$/, "")
    .replace(/^ANGLE.*Renderer:\s*/i, "")
    .trim();
  return clean.length > 30 ? `${clean.slice(0, 29)}…` : clean;
}

export function StatsPanel({ viewer }: { viewer: VolumeViewer }) {
  const fpsRef = useRef<HTMLSpanElement>(null);
  const cpuRef = useRef<HTMLSpanElement>(null);
  const gpuRef = useRef<HTMLSpanElement>(null);
  const ramRef = useRef<HTMLSpanElement>(null);
  const drawRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = canvasRef.current!;
    cv.width = GRAPH_W * dpr;
    cv.height = GRAPH_H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.scale(dpr, dpr);

    const history: number[] = [];
    let raf = 0;
    let lastText = 0;

    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      const s = viewer.stats;

      // --- sparkline (every frame) ---
      history.push(s.fps);
      if (history.length > GRAPH_W) history.shift();
      ctx.clearRect(0, 0, GRAPH_W, GRAPH_H);
      // 60 / 30 fps guide lines
      ctx.strokeStyle = "rgba(120,160,220,0.18)";
      ctx.lineWidth = 1;
      for (const guide of [60, 30]) {
        const y = GRAPH_H - (guide / MAX_FPS) * GRAPH_H;
        ctx.beginPath();
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(GRAPH_W, y + 0.5);
        ctx.stroke();
      }
      const x0 = GRAPH_W - history.length;
      for (let i = 0; i < history.length; i++) {
        const f = history[i];
        const h = Math.min(f / MAX_FPS, 1) * GRAPH_H;
        ctx.fillStyle = fpsColor(f);
        ctx.fillRect(x0 + i, GRAPH_H - h, 1, h);
      }

      // --- numbers (throttled to ~8 Hz) ---
      if (t - lastText > 120) {
        lastText = t;
        if (fpsRef.current) {
          fpsRef.current.textContent = s.fps.toFixed(0);
          fpsRef.current.style.color = fpsColor(s.fps);
        }
        if (cpuRef.current) cpuRef.current.textContent = `${s.cpuMs.toFixed(1)} ms`;
        if (gpuRef.current)
          gpuRef.current.textContent = viewer.gpuTimingSupported
            ? `${s.gpuMs.toFixed(1)} ms`
            : "n/a";
        if (ramRef.current)
          ramRef.current.textContent =
            s.jsHeapMB > 0 ? `${s.jsHeapMB.toFixed(0)} / ${s.jsHeapLimitMB.toFixed(0)} MB` : "n/a";
        if (drawRef.current)
          drawRef.current.textContent = `${s.drawCalls} · ${(s.triangles / 1000).toFixed(1)}k△`;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [viewer]);

  return (
    <div className="stats">
      <div className="stats-top">
        <span className="stats-fps" ref={fpsRef}>
          –
        </span>
        <span className="stats-fps-unit">FPS</span>
        <span className="stats-gpu-name" title={viewer.gpuName}>
          {shortGpu(viewer.gpuName)}
        </span>
      </div>
      <canvas className="stats-graph" ref={canvasRef} />
      <div className="stats-rows">
        <div>
          <span className="k">CPU</span>
          <span className="v" ref={cpuRef}>
            –
          </span>
        </div>
        <div>
          <span className="k">GPU</span>
          <span className="v" ref={gpuRef}>
            –
          </span>
        </div>
        <div>
          <span className="k">RAM</span>
          <span className="v" ref={ramRef}>
            –
          </span>
        </div>
        <div>
          <span className="k">draws</span>
          <span className="v" ref={drawRef}>
            –
          </span>
        </div>
      </div>
    </div>
  );
}
