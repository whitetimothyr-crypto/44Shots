/**
 * Footer
 *
 * Slim footer rail. Mirrors legacy index.html:1348 pattern
 * ("44 Shots vX.Y · Goalie #?") but stripped to brand + version
 * for shell-only pass. Goalie indicator wires up when goalie
 * state lifts into Next.js layer.
 *
 * Server component. Static.
 */

export default function Footer() {
  return (
    <footer
      style={{
        padding: "8px 16px",
        background: "#0F0F1A",
        borderTop: "1px solid rgba(255,255,255,0.06)",
        fontFamily: "var(--font-inter), system-ui, sans-serif",
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "#666677",
        textAlign: "center",
      }}
    >
      44Shots <span style={{ color: "#C9A84C" }}>v3.0</span>
    </footer>
  );
}
