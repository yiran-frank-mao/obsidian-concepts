export type PopupPlacement = "above" | "below";

export interface MenuAnchor {
  anchorTop: number;
  anchorBottom: number;
  menuHeight: number;
  viewportHeight: number;
  placement: PopupPlacement;
}

/**
 * Places the popup directly above or below the caret's line, flipping to the
 * other side when the preferred one would run past the viewport. When neither
 * side fits, the popup is clamped so its top stays visible.
 */
export function resolveMenuTop({
  anchorTop,
  anchorBottom,
  menuHeight,
  viewportHeight,
  placement
}: MenuAnchor): number {
  const above = anchorTop - menuHeight;
  const fitsAbove = above >= 0;
  const fitsBelow = anchorBottom + menuHeight <= viewportHeight;

  if (placement === "above") {
    return fitsAbove || !fitsBelow ? Math.max(above, 0) : anchorBottom;
  }
  return fitsBelow || !fitsAbove ? anchorBottom : above;
}
