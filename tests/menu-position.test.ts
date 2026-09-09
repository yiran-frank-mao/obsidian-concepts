import { describe, expect, it } from "vitest";
import { resolveMenuTop } from "../src/menu-position";

// A caret on a 20px line, 300px down a 800px tall viewport.
const line = { anchorTop: 300, anchorBottom: 320, viewportHeight: 800 };

describe("resolveMenuTop", () => {
  it("opens below the line when asked", () => {
    expect(resolveMenuTop({ ...line, menuHeight: 200, placement: "below" })).toBe(320);
  });

  it("opens above the line when asked", () => {
    expect(resolveMenuTop({ ...line, menuHeight: 200, placement: "above" })).toBe(100);
  });

  it("flips above when there is no room below", () => {
    expect(
      resolveMenuTop({ anchorTop: 600, anchorBottom: 620, viewportHeight: 800, menuHeight: 250, placement: "below" })
    ).toBe(350);
  });

  it("flips below when there is no room above", () => {
    expect(
      resolveMenuTop({ anchorTop: 40, anchorBottom: 60, viewportHeight: 800, menuHeight: 200, placement: "above" })
    ).toBe(60);
  });

  it("keeps the popup on screen when neither side fits", () => {
    expect(
      resolveMenuTop({ anchorTop: 40, anchorBottom: 60, viewportHeight: 200, menuHeight: 400, placement: "above" })
    ).toBe(0);
  });

  it("stays below when neither side fits and below is preferred", () => {
    expect(
      resolveMenuTop({ anchorTop: 40, anchorBottom: 60, viewportHeight: 200, menuHeight: 400, placement: "below" })
    ).toBe(60);
  });
});
