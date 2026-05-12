"use client";

/**
 * BottomNav
 *
 * Visible bottom-nav rail. Tab IDs match legacy js/nav.js TABS
 * registry (rink, feed, stats, whiteboard, lineup, more).
 * DEFAULT_ORDER_COACH in legacy is 4 rails (rink/whiteboard/lineup/
 * more) with feed + stats off-rail behind MORE. Phase 3 directive
 * promotes feed + stats to a visible-clickable position so a coach
 * can switch between rink, feed, and stats without an extra hop.
 *
 * Enabled tabs (clickable): rink, feed, stats.
 * Disabled placeholders: whiteboard, lineup, more (Phase 2 ports
 * not yet landed; aria-disabled so a click is a no-op).
 *
 * SVG icon markup ported verbatim from js/nav.js TABS registry.
 */

export type TabId = "rink" | "feed" | "stats" | "whiteboard" | "lineup" | "more";

interface TabDef {
  id: TabId;
  label: string;
  icon: React.ReactNode;
  enabled: boolean;
}

const TABS: TabDef[] = [
  {
    id: "rink",
    label: "Rink",
    enabled: true,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="6" width="19" height="12" rx="6" />
        <line x1="12" y1="6" x2="12" y2="18" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    ),
  },
  {
    id: "feed",
    label: "Feed",
    enabled: true,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="18" x2="21" y2="18" />
      </svg>
    ),
  },
  {
    id: "stats",
    label: "Stats",
    enabled: true,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6">
        <line x1="6" y1="20" x2="6" y2="12" />
        <line x1="12" y1="20" x2="12" y2="6" />
        <line x1="18" y1="20" x2="18" y2="14" />
        <line x1="3" y1="20" x2="21" y2="20" />
      </svg>
    ),
  },
  {
    id: "whiteboard",
    label: "Whiteboard",
    enabled: false,
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
    enabled: false,
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
    enabled: false,
    icon: (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
        <circle cx="6" cy="12" r="1.6" />
        <circle cx="12" cy="12" r="1.6" />
        <circle cx="18" cy="12" r="1.6" />
      </svg>
    ),
  },
];

interface Props {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
}

export default function BottomNav({ activeTab, onSelect }: Props) {
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
        const active = tab.id === activeTab;
        const clickable = tab.enabled;
        return (
          <button
            key={tab.id}
            type="button"
            aria-current={active ? "page" : undefined}
            aria-disabled={!clickable}
            data-tab={tab.id}
            onClick={clickable ? () => onSelect(tab.id) : undefined}
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
              color: active ? "#C9A84C" : clickable ? "#E8E8E0" : "#444450",
              cursor: clickable ? (active ? "default" : "pointer") : "not-allowed",
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 10,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
              opacity: clickable ? 1 : 0.5,
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
