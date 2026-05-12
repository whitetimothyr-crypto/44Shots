/**
 * Home route. Server Component that centers ShotCanvas inside
 * remaining main area, between layout shell chrome (TopBar +
 * BottomNav + Footer). ShotCanvas is a Client Component, so this
 * page does not declare "use client".
 *
 * Sizing: flex:1 fills available vertical space inside <main>.
 * maxWidth subtracts approximate chrome heights (56 + 56 + 28 px)
 * from viewport so 1000x425 aspect ratio stays exact without
 * overflow. 1000x425 ratio is locked per NOMOS_AUDIT.md.
 */

import ShotCanvas from "@/components/features/ShotCanvas";

export default function Page() {
  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "8px",
        boxSizing: "border-box",
        minHeight: 0,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "min(100%, calc((100dvh - 56px - 56px - 28px) * 1000 / 425))",
          aspectRatio: "1000 / 425",
        }}
      >
        <ShotCanvas />
      </div>
    </div>
  );
}
