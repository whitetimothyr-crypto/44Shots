/**
 * TopBar
 *
 * Header shell. Preserves grid-col-1 brand slot pattern from legacy
 * index.html:667 (portrait grid col 1, hidden on landscape).
 *
 * Brand slot: legacy used a Felix photo asset. Rebrand to 44Shots
 * means asset is no longer accurate. Slot is retained as a layout
 * anchor; content is a brand mark placeholder until logo asset lands.
 *
 * Server component. Static for now. Future phase wires user menu,
 * game-state pulse indicator, and rink-rotation toggle.
 */

export default function TopBar() {
  return (
    <header
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        alignItems: "center",
        gap: "12px",
        padding: "10px 16px",
        background: "#0F0F1A",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        position: "sticky",
        top: 0,
        zIndex: 30,
      }}
      aria-label="44Shots top bar"
    >
      <div
        aria-hidden="true"
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          background:
            "linear-gradient(135deg, #C9A84C 0%, #8a6f23 100%)",
          display: "grid",
          placeItems: "center",
          color: "#0F0F1A",
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontWeight: 800,
          fontSize: 13,
          letterSpacing: "0.04em",
        }}
      >
        44
      </div>

      <div
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "#E8E8E0",
        }}
      >
        44Shots
      </div>

      <div
        style={{
          fontFamily: "var(--font-inter), system-ui, sans-serif",
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "#888899",
        }}
      >
        Live
      </div>
    </header>
  );
}
