import { PHONE_TABS } from "../lib/layout";
import type { Layout } from "../rendering";

/** Phone-only top bar: switch between the four fullscreen views. */
export function MobileTopBar({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (v: Layout) => void;
}) {
  return (
    <div className="topbar">
      {PHONE_TABS.map((t) => (
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
