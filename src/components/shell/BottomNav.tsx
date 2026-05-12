/**
 * BottomNav
 *
 * Visible bottom-nav rail. Matches js/nav.js DEFAULT_ORDER_COACH:
 *   ["rink", "whiteboard", "lineup", "more"]
 *
 * Off-rail destinations (Stats, Report, Feed, Calendar, Settings,
 * Profile) live behind "More" in legacy and stay there. Visible
 * surface is exactly 4 buttons.
 *
 * SVG icon markup ported verbatim from js/nav.js TABS registry so
 * visual parity is preserved during cutover.
 *
 * Behaviour: only "Rink" is active. Other tabs render with
 * aria-disabled so a click does not 404 a non-existent route.
 * Tab routing wires up in a follow-up phase per Tim's directive.
 *
 * Server component. No interactivity yet.
 */

type TabId = "rink" | "whiteboard" | "lineup" | "more";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
}

const TABS: TabDef[] = [
  {
    id: "rink",
    label: "Rink",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="6" width="19" height="12" rx="6" />
        <line x1="12" y1="6" x2="12" y2="18" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: "whiteboard",
    label: "Whiteboard",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3" y="4" width="18" height="14" rx="1.5" />
        <line x1="3" y1="20" x2="21" y2="20" />
        <line x1="7" y1="9" x2="13" y2="9" />
        <line x1="7" y1="13" x2="17" y2="13" />
      </svg>
    ),
  },
  {
    id: "lineup",
    label: "Lineup",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="7" cy="8" r="2.5" />
        <circle cx="17" cy="8" r="2.5" />
        <circle cx="12" cy="16" r="2.5" />
        <line x1="9" y1="9.5" x2="11" y2="14" />
        <line x1="15" y1="9.5" x2="13" y2="14" />
      </svg>
    ),
  },
  {
    id: "more",
    label: "More",
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <circle cx="6" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="18" cy="12" r="1.6" />
      </svg>
    ),
  },
];

const ACTIVE_ID: TabId = "rink";

export default function BottomNav() {
  return (
    <nav
      aria-label="Primary views"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${TABS.length}, 1fr)`,
        gap: 0,
        background: "#0F0F1A",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        position: "sticky",
        bottom: 0,
        zIndex: 30,
      }}
    >
      {TABS.map((tab) => {
        const active = tab.id === ACTIVE_ID;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-disabled={!active}
            data-tab={tab.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              padding: "10px 4px 8px",
              minHeight: 56,
              background: "transparent",
              border: 0,
              color: active ? "#C9A84C" : "#888899",
              cursor: active ? "default" : "not-allowed",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
              opacity: active ? 1 : 0.65,
              touchAction: "manipulation",
            }}
          >
            <span aria-hidden="true">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
