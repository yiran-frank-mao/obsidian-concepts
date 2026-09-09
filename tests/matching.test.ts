import { describe, expect, it } from "vitest";
import { findConceptMatch, insideWikiLink } from "../src/matching";
import type { Concept } from "../src/types";

function concept(name: string, aliases: string[] = []): Concept {
  return {
    id: name,
    name,
    aliases,
    sourcePath: `Notes/${name}.md`,
    blockId: `concept-${name.replace(/\s+/g, "-")}`,
    calloutType: "definition",
    recordPath: `Concepts/Database/${name}.md`,
    created: "",
    updated: ""
  };
}

const productOfSpaces = concept("Product topology", ["product"]);
const cartesianProduct = concept("Cartesian product", ["product"]);
const categoryProduct = concept("Product object", ["product"]);

describe("findConceptMatch", () => {
  const line = "The product of two spaces";
  const cursor = line.indexOf("product") + 3;

  it("returns the single concept that claims the term", () => {
    const match = findConceptMatch(line, cursor, [productOfSpaces], false);
    expect(match?.text).toBe("product");
    expect(match?.concepts).toEqual([productOfSpaces]);
  });

  it("groups every concept sharing an alias into one ambiguous match", () => {
    const match = findConceptMatch(
      line,
      cursor,
      [productOfSpaces, cartesianProduct, categoryProduct],
      false
    );
    expect(match?.concepts).toEqual([productOfSpaces, cartesianProduct, categoryProduct]);
    expect(match?.start).toBe(4);
    expect(match?.end).toBe(11);
  });

  it("ignores concepts whose term is elsewhere on the line", () => {
    const match = findConceptMatch(line, cursor, [concept("Space", ["spaces"])], false);
    expect(match).toBeUndefined();
  });

  it("prefers the longest term when several overlap the cursor", () => {
    const specific = concept("Product topology", ["product topology"]);
    const match = findConceptMatch(
      "The product topology is coarse",
      6,
      [specific, cartesianProduct],
      false
    );
    expect(match?.text).toBe("product topology");
    expect(match?.concepts).toEqual([specific]);
  });

  it("rejects a literal alias that is only part of a longer word", () => {
    const match = findConceptMatch("counterproductive", 8, [cartesianProduct], false);
    expect(match).toBeUndefined();
  });

  it("matches a regex alias and reports the matched text", () => {
    const plural = concept("Cartesian product", ["/products?/"]);
    const match = findConceptMatch("Two products here", 8, [plural], false);
    expect(match?.text).toBe("products");
    expect(match?.concepts).toEqual([plural]);
  });

  it("treats a regex and a literal alias for the same term as a conflict", () => {
    const plural = concept("Cartesian product", ["/products?/"]);
    const match = findConceptMatch("The product rule", 8, [plural, productOfSpaces], false);
    expect(match?.concepts).toEqual([plural, productOfSpaces]);
  });

  it("lets a regex alias match inside a word because it owns its boundaries", () => {
    const inner = concept("Product", ["/product/"]);
    expect(findConceptMatch("counterproductive", 12, [inner], false)?.text).toBe("product");
  });

  it("honors case-sensitive linking", () => {
    const upper = concept("Product", ["Product"]);
    expect(findConceptMatch("the product rule", 6, [upper], true)).toBeUndefined();
    expect(findConceptMatch("the Product rule", 6, [upper], true)?.text).toBe("Product");
  });

  it("skips an alias whose regex cannot compile", () => {
    const broken = concept("Tensor", ["/product(/"]);
    expect(findConceptMatch("the product rule", 6, [broken], false)).toBeUndefined();
  });
});

describe("insideWikiLink", () => {
  it("detects a cursor inside an unclosed wikilink", () => {
    expect(insideWikiLink("see [[Product", 12)).toBe(true);
  });

  it("allows a cursor after a completed wikilink", () => {
    expect(insideWikiLink("see [[Product]] now", 18)).toBe(false);
  });
});
