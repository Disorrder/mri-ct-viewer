/** Hint shown while a file is dragged over the window (drop loads a local volume). */
export function DropOverlay() {
  return (
    <div className="drop-overlay">
      <div className="drop-card">
        Drop a <b>.nii</b> / <b>.nii.gz</b> file to load it
      </div>
    </div>
  );
}
