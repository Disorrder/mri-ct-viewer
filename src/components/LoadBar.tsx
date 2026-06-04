/** Determinate progress bar shown while a dataset is loading / building. */
export function LoadBar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div className="loader">
      <div className="loader-row">
        <span className="loader-label">{label}</span>
        <span className="loader-pct">{Math.round(fraction * 100)}%</span>
      </div>
      <div className="loader-track">
        <div className="loader-fill" style={{ width: `${Math.max(3, fraction * 100)}%` }} />
      </div>
    </div>
  );
}
