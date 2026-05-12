/**
 * Home route. Server Component wrapper that centers ShotCanvas
 * inside a viewport-filling container while preserving 1000x425
 * aspect ratio. ShotCanvas is itself a Client Component, so this
 * page does not declare "use client" on its own.
 *
 * Layout sizing: width clamps to min(100%, viewport-height-scaled-to-aspect).
 * On wide viewports height binds; on narrow viewports width binds.
 * aspect-ratio CSS keeps proportions exact regardless.
 */

import ShotCanvas from "@/components/features/ShotCanvas";

export default function Page() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#080810",
        color: "#E8E8E0",
        padding: "8px",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "min(100%, calc(100dvh * 1000 / 425))",
          aspectRatio: "1000 / 425",
        }}
      >
        <ShotCanvas />
      </div>
    </main>
  );
}
