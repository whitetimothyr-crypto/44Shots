"use client";

/**
 * QuickStats
 *
 * Real-time dashboard metrics computed live from
 * tracker.state.events. Calculations port verbatim from legacy
 * renderStats (index.html:3019-3055):
 *
 *   usEvents       = events filtered to forOrAgainst === "for"
 *   themEvents     = events filtered to forOrAgainst === "against"
 *   usGoals        = usEvents where result === "goal"
 *   usShotsOnNet   = (result === "shot") + usGoals
 *                    (legacy result="shot" means "shot on goal, saved")
 *   shootingPct    = usGoals / usShotsOnNet * 100
 *   savePct        = (themShotsOnNet - themGoals) / themShotsOnNet * 100
 *   periodCounts   = [P1, P2, P3, OT] event counts
 *
 * Metric set per Phase 3 spec: SOG, Goals, Shooting % (for us) +
 * complementary goalie save view (against us).
 */

import type { UseShotTrackerReturn } from "@/hooks/useShotTracker";

interface Props {
  tracker: UseShotTrackerReturn;
}

const CARD_BG = "#0F0F1A";
const CARD_BORDER = "1px solid rgba(255,255,255,0.06)";
const ACCENT = "#C9A84C";
const ACCENT_2 = "#FF5A1F";
const MUTED = "#666677";

interface StatBlockProps {
  label: string;
  value: string;
  hint?: string;
  color?: string;
}

function StatBlock({ label, value, hint, color }: StatBlockProps) {
  return (
    <div
      style={{
        background: CARD_BG,
        border: CARD_BORDER,
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        minWidth: 110,
        fontFamily: "var(--font-inter), system-ui, sans-serif",
      }}
    >
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: MUTED,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 24,
          fontWeight: 800,
          letterSpacing: "0.02em",
          color: color ?? "#E8E8E0",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        }}
      >
        {value}
      </span>
      {hint ? (
        <span
          style={{
            fontSize: 10,
            color: MUTED,
            letterSpacing: "0.06em",
          }}
        >
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export default function QuickStats({ tracker }: Props) {
  const events = tracker.state.events;

  const usEvents = events.filter((x) => x.forOrAgainst === "for");
  const themEvents = events.filter(
    (x) => x.forOrAgainst === "against" || !x.forOrAgainst
  );

  const usGoals = usEvents.filter((x) => x.result === "goal").length;
  const usSaves = usEvents.filter((x) => x.result === "shot").length;
  const usShotsOnNet = usSaves + usGoals;
  const usMiss = usEvents.filter((x) => x.result === "miss").length;

  const themGoals = themEvents.filter((x) => x.result === "goal").length;
  const themSaves = themEvents.filter((x) => x.result === "shot").length;
  const themShotsOnNet = themSaves + themGoals;
  const themMiss = themEvents.filter((x) => x.result === "miss").length;

  const shootingPct =
    usShotsOnNet > 0 ? Math.round((usGoals * 100) / usShotsOnNet) : 0;
  const savePct =
    themShotsOnNet > 0
      ? Math.round(((themShotsOnNet - themGoals) * 100) / themShotsOnNet)
      : 0;

  const periodCounts: number[] = [1, 2, 3, 4].map(
    (p) => events.filter((x) => x.period === p).length
  );

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
      aria-label="Quick stats"
    >
      <div
        style={{
          maxWidth: 720,
          marginLeft: "auto",
          marginRight: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <section>
          <h3
            style={{
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: ACCENT,
              margin: "0 0 8px",
              fontWeight: 800,
            }}
          >
            Our Team
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 8,
            }}
          >
            <StatBlock label="SOG" value={String(usShotsOnNet)} hint={`${usSaves} saved`} />
            <StatBlock
              label="Goals"
              value={String(usGoals)}
              color={ACCENT}
            />
            <StatBlock
              label="Shooting %"
              value={usShotsOnNet > 0 ? `${shootingPct}%` : "--"}
              hint={`${usGoals} / ${usShotsOnNet}`}
            />
            <StatBlock label="Misses" value={String(usMiss)} />
          </div>
        </section>

        <section>
          <h3
            style={{
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: ACCENT_2,
              margin: "0 0 8px",
              fontWeight: 800,
            }}
          >
            Goalie Faces
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
              gap: 8,
            }}
          >
            <StatBlock label="SOG Against" value={String(themShotsOnNet)} hint={`${themSaves} saved`} />
            <StatBlock
              label="Goals Against"
              value={String(themGoals)}
              color={ACCENT_2}
            />
            <StatBlock
              label="Save %"
              value={themShotsOnNet > 0 ? `${savePct}%` : "--"}
              hint={`${themSaves} / ${themShotsOnNet}`}
            />
            <StatBlock label="Misses" value={String(themMiss)} />
          </div>
        </section>

        <section>
          <h3
            style={{
              fontFamily: "var(--font-inter), system-ui, sans-serif",
              fontSize: 11,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: MUTED,
              margin: "0 0 8px",
              fontWeight: 800,
            }}
          >
            By Period
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 8,
            }}
          >
            {(["1", "2", "3", "OT"] as const).map((label, i) => (
              <StatBlock key={label} label={`P${label}`} value={String(periodCounts[i])} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
