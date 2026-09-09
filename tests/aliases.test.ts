import { describe, expect, it } from "vitest";
import { compileAlias, isRegexAlias } from "../src/aliases";

const compile = (alias: string, caseSensitive = false) => {
  const pattern = compileAlias(alias, caseSensitive);
  if (!pattern) throw new Error(`Alias "${alias}" failed to compile.`);
  return pattern;
};

describe("isRegexAlias", () => {
  it.each([
    ["/products?/", true],
    ["/product/i", true],
    ["product", false],
    ["1/2 product", false],
    ["//", false]
  ])("classifies %s", (alias, expected) => {
    expect(isRegexAlias(alias)).toBe(expected);
  });
});

describe("literal aliases", () => {
  it("matches a whole term without regard to case by default", () => {
    expect(compile("Banach space").matchesWhole("banach SPACE")).toBe(true);
  });

  it("respects case-sensitive matching when requested", () => {
    expect(compile("Banach space", true).matchesWhole("banach space")).toBe(false);
  });

  it("finds every occurrence in a line", () => {
    expect(compile("product").findSpans("A product times a product")).toEqual([
      { start: 2, end: 9 },
      { start: 18, end: 25 }
    ]);
  });

  it("requires word boundaries so the caller can reject partial hits", () => {
    expect(compile("product").requiresWordBoundaries).toBe(true);
  });
});

describe("regex aliases", () => {
  it("matches a whole term against an anchored pattern", () => {
    const pattern = compile("/products?/");
    expect(pattern.matchesWhole("product")).toBe(true);
    expect(pattern.matchesWhole("products")).toBe(true);
    expect(pattern.matchesWhole("product topology")).toBe(false);
  });

  it("finds spans for each occurrence in a line", () => {
    expect(compile("/products?/").findSpans("the product and products")).toEqual([
      { start: 4, end: 11 },
      { start: 16, end: 24 }
    ]);
  });

  it("honors an explicit case-sensitive flag set", () => {
    const pattern = compile("/Product/", true);
    expect(pattern.matchesWhole("Product")).toBe(true);
    expect(pattern.matchesWhole("product")).toBe(false);
  });

  it("adds the ignore-case flag when case-sensitive linking is off", () => {
    expect(compile("/Product/").matchesWhole("product")).toBe(true);
  });

  it("keeps an inline ignore-case flag under case-sensitive linking", () => {
    expect(compile("/product/i", true).matchesWhole("PRODUCT")).toBe(true);
  });

  it("supports patterns that span words", () => {
    const pattern = compile("/product\\s+of\\s+spaces/");
    expect(pattern.matchesWhole("product  of   spaces")).toBe(true);
  });

  it("owns its boundaries instead of relying on the caller", () => {
    expect(compile("/products?/").requiresWordBoundaries).toBe(false);
  });

  it("ignores an unparsable pattern rather than breaking linking", () => {
    expect(compileAlias("/product(/", false)).toBeUndefined();
  });

  it("does not hang on a pattern that matches an empty string", () => {
    expect(compile("/x*/").findSpans("axbx")).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 4 }
    ]);
  });
});
