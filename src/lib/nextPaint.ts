/**
 * Resolve on the next animation frame, but fall back to a timer if rAF is
 * starved. Browsers pause requestAnimationFrame in background/hidden tabs, so a
 * frame-gated step — fading the boot splash, or applying a decoded volume after
 * letting the progress bar paint — would otherwise hang until the tab is shown.
 * The fallback guarantees forward progress either way.
 */
export function nextPaint(fallbackMs = 80): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(go);
    setTimeout(go, fallbackMs);
  });
}
