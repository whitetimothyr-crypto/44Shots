"use client";

/**
 * MorePanel
 *
 * Final off-ramp tab. Lists legacy views not yet ported to Next.js
 * with status badges and short descriptions. Mirrors legacy
 * panel-more list (index.html:1218-1256) minus items already
 * promoted to top-level tabs in this build (Stats, Feed).
 *
 * No working links here. Production apex 44shots.com points at
 * legacy felix-tracker deployment until cutover completes, so
 * routing to a hypothetical /calendar would 404 inside this
 * Next.js app. Cards are informational only.
 */

interface MoreItem {
  id: string;
  label: string;
  description: string;
  status: "deferred" | "stub" | "supabase";
  legacyRef: string;
}

const ITEMS: MoreItem[] = [
  {
    id: "calendar",
    label: "Calendar",
    description:
      "Game schedule with TeamSnap pull + iCal subscription fallback.",
    status: "supabase",
    legacyRef: "js/calendar.js",
  },
  {
    id: "media",
    label: "Media",
    description:
      "Photo + 15s video capture. IndexedDB blob storage; Supabase Storage sync planned.",
    status: "deferred",
    legacyRef: "js/media.js",
  },
  {
    id: "settings",
    label: "Settings",
    description:
      "Rebound mode, export/import, account management, app preferences.",
    status: "deferred",
    legacyRef: "index.html:1353-1422 (modal)",
  },
  {
    id: "profile",
    label: "Profile",
    description: "Coach + scorer profile. Legacy was stub in production.",
    status: "stub",
    legacyRef: "index.html:1245 (more-list)",
  },
  {
    id: "report",
    label: "Report",
    description:
      "Claude-powered game report from shot patterns, scoring zones, and period trends.",
    status: "deferred",
    legacyRef: "index.html:1152-1213",
  },
];

const ACCENT = "#C9A84C";

const STATUS_STYLE: Record<
  MoreItem["status"],
  { label: string; color: string; bg: string }
> = {
  deferred: { label: "Deferred", color: "#888899", bg: "rgba(255,255,255,0.04)" },
  stub: { label: "Stub", color: "#666677", bg: "rgba(255,255,255,0.04)" },
  supabase: { label: "Supabase", color: "#3FB0AC", bg: "rgba(63,176,172,0.10)" },
};

export default function MorePanel() {
  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        overflowY: "auto",
        padding: "12px 16px",
        boxSizing: "border-box",
        color: "#E8E8E0",
      }}
      role="region"
      aria-label="More views"
    >
      <div
        style={{
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <header style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 4 }}>
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 16,
              fontWeight: 800,
              letterSpacing: "0.06em",
              color: "#E8E8E0",
            }}
          >
            More Views
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: 11,
              color: "#666677",
              letterSpacing: "0.04em",
              lineHeight: 1.5,
            }}
          >
            Legacy modules awaiting port to Next.js. Cards are informational
            only; routing to a port lands once each module is wired.
          </p>
        </header>

        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
          {ITEMS.map((item) => {
            const s = STATUS_STYLE[item.status];
            return (
              <li
                key={item.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 8,
                  padding: "12px 14px",
                  background: "#0F0F1A",
                  border: "1px solid rgba(255,255,255,0.06)",
                  borderRadius: 10,
                  fontFamily: "var(--font-inter), system-ui, sans-serif",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 800,
                        letterSpacing: "0.06em",
                        color: ACCENT,
                      }}
                    >
                      {item.label}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: s.color,
                        background: s.bg,
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontWeight: 700,
                      }}
                    >
                      {s.label}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: 11,
                      color: "#E8E8E0",
                      letterSpacing: "0.02em",
                      lineHeight: 1.5,
                    }}
                  >
                    {item.description}
                  </p>
                  <span
                    style={{
                      fontSize: 10,
                      color: "#444450",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                      letterSpacing: "0.02em",
                    }}
                  >
                    {item.legacyRef}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
