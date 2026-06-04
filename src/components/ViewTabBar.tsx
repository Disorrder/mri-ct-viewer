import type { ViewTab } from "../lib/layout";
import type { Layout } from "../rendering";

/** Top bar of fullscreen view tabs. Phones switch between the four planes; desktop
 *  switches 3D ⇄ 2×2 MPR. The `className` positions it (full-width vs centered pill). */
export function ViewTabBar({
  tabs,
  active,
  onSelect,
  className = "",
}: {
  tabs: ViewTab[];
  active: string;
  onSelect: (v: Layout) => void;
  className?: string;
}) {
  return (
    <div className={`topbar${className ? ` ${className}` : ""}`}>
      {tabs.map((t) => (
        <button
          type="button"
          key={t.key}
          className={`topbar-tab${active === t.key ? " active" : ""}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
