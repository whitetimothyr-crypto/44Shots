/**
 * Rink geometry helpers.
 *
 * Pure functions covering side allocation across periods and tap-to-attacking-net
 * derivation. Ported from window.getOurDefendingSide and window.getTheirDefendingSide
 * in legacy index.html lines 1894-1907.
 *
 * Hockey side-swap convention:
 *   - P1: home defends LEFT, away defends RIGHT
 *   - P2: ends switch, home defends RIGHT
 *   - P3: ends switch again, back to P1 layout (home LEFT)
 *   - P4 (overtime): stays on P3 ends (home LEFT) per legacy code
 *
 * Coordinate space: 1000x425 viewBox per NOMOS_AUDIT.
 */

import type { Period, TeamSide, AttackingNet, ForOrAgainst } from "@/types/hockey";

export const VIEWBOX_W = 1000;
export const VIEWBOX_H = 425;
export const RINK_X_LEFT = 60;
export const RINK_X_RIGHT = 940;
export const RINK_Y_TOP = 28;
export const RINK_Y_BOTTOM = 397;
export const CENTER_X = 500;

/** Home team starts P1 defending this side. Locked by legacy convention. */
const HOME_START: AttackingNet = "left";

export function oppositeSide(side: AttackingNet): AttackingNet {
  return side === "left" ? "right" : "left";
}

/**
 * Which side home is defending in a given period. P2 is a swap from start;
 * P3 and P4 revert to start. Mirrors legacy:
 *   const swap = (period === 2);
 *   const homeSide = swap ? "right" : "left";
 */
export function homeDefendingSide(period: Period): AttackingNet {
  return period === 2 ? oppositeSide(HOME_START) : HOME_START;
}

export function awayDefendingSide(period: Period): AttackingNet {
  return oppositeSide(homeDefendingSide(period));
}

/**
 * Which side OUR goalie occupies in a given period. weAre is which team
 * we are scoring as (home or away).
 */
export function ourDefendingSide(weAre: TeamSide, period: Period): AttackingNet {
  return weAre === "home" ? homeDefendingSide(period) : awayDefendingSide(period);
}

export function theirDefendingSide(weAre: TeamSide, period: Period): AttackingNet {
  return oppositeSide(ourDefendingSide(weAre, period));
}

/**
 * Naive geometric attackingNet derivation from x position alone. Splits
 * at viewBox horizontal midpoint. Used by useShotTracker default path.
 */
export function attackingNetFromX(x: number): AttackingNet {
  return x < CENTER_X ? "left" : "right";
}

/**
 * Game-context attackingNet derivation. When forOrAgainst is "for", our
 * team is attacking opponent net (their defending side). When "against",
 * opponent is attacking our net (our defending side).
 */
export function attackingNetFromContext(
  weAre: TeamSide,
  period: Period,
  forOrAgainst: ForOrAgainst
): AttackingNet {
  return forOrAgainst === "for"
    ? theirDefendingSide(weAre, period)
    : ourDefendingSide(weAre, period);
}

/**
 * Return true if (x, y) is inside playable rink area (excludes board buffer).
 * Bounds match legacy handleRinkTap clamp at index.html line 2151 after
 * 2026-05-11 1000x425 rescale.
 */
export function isInsideRink(x: number, y: number): boolean {
  return (
    x >= RINK_X_LEFT &&
    x <= RINK_X_RIGHT &&
    y >= RINK_Y_TOP &&
    y <= RINK_Y_BOTTOM
  );
}

/**
 * Convert a client pointer event coordinate to SVG viewBox coordinates.
 * Returns null if SVG has no current screen CTM (detached or hidden).
 */
export function clientToViewBox(
  svg: SVGSVGElement,
  clientX: number,
  clientY: number
): { x: number; y: number } | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { x: p.x, y: p.y };
}
