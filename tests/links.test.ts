import { describe, expect, it } from "vitest";
import { formatLinkUpdateNotice, rewriteBlockLinks } from "../src/links";

const BLOCK = "concept-a1b2c3d4e5f6";

describe("rewriteBlockLinks", () => {
  it("rewrites the path of a cross-note link while keeping the display alias", () => {
    const source = "See [[Old Note#^concept-a1b2c3d4e5f6|Banach space]] for details.";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "Analysis/New Note");
    expect(content).toBe(
      "See [[Analysis/New Note#^concept-a1b2c3d4e5f6|Banach space]] for details."
    );
    expect(changed).toBe(1);
  });

  it("rewrites a link that has no display alias", () => {
    const source = "[[Old Note#^concept-a1b2c3d4e5f6]]";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "New Note");
    expect(content).toBe("[[New Note#^concept-a1b2c3d4e5f6]]");
    expect(changed).toBe(1);
  });

  it("updates every occurrence, including embeds, across the text", () => {
    const source = [
      "Intro [[A#^concept-a1b2c3d4e5f6|x]] middle.",
      "![[A#^concept-a1b2c3d4e5f6]]",
      "Trailing [[A#^concept-a1b2c3d4e5f6]]."
    ].join("\n");
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "B");
    expect(content).toBe(
      [
        "Intro [[B#^concept-a1b2c3d4e5f6|x]] middle.",
        "![[B#^concept-a1b2c3d4e5f6]]",
        "Trailing [[B#^concept-a1b2c3d4e5f6]]."
      ].join("\n")
    );
    expect(changed).toBe(3);
  });

  it("leaves other concepts' links untouched", () => {
    const source = "[[A#^concept-a1b2c3d4e5f6|x]] and [[A#^concept-other999999|y]]";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "B");
    expect(content).toBe("[[B#^concept-a1b2c3d4e5f6|x]] and [[A#^concept-other999999|y]]");
    expect(changed).toBe(1);
  });

  it("does not match a block ID that is a prefix of a longer ID", () => {
    const source = "[[A#^concept-a1b2c3d4e5f6extra|x]]";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "B");
    expect(content).toBe(source);
    expect(changed).toBe(0);
  });

  it("counts nothing when the link already points at the new target", () => {
    const source = "[[New Note#^concept-a1b2c3d4e5f6|x]]";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "New Note");
    expect(content).toBe(source);
    expect(changed).toBe(0);
  });

  it("expands a same-file reference once the block has moved elsewhere", () => {
    const source = "Local [[#^concept-a1b2c3d4e5f6|x]] link.";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "New Note", "Old Note");
    expect(content).toBe("Local [[New Note#^concept-a1b2c3d4e5f6|x]] link.");
    expect(changed).toBe(1);
  });

  it("preserves a genuine same-file reference in the note that still holds the block", () => {
    const source = "Local [[#^concept-a1b2c3d4e5f6]] link.";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "New Note", "New Note");
    expect(content).toBe(source);
    expect(changed).toBe(0);
  });

  it("leaves same-file references alone when the current note is unknown", () => {
    const source = "Local [[#^concept-a1b2c3d4e5f6]] link.";
    const { content, changed } = rewriteBlockLinks(source, BLOCK, "New Note");
    expect(content).toBe(source);
    expect(changed).toBe(0);
  });
});

describe("formatLinkUpdateNotice", () => {
  it.each([
    [0, "Concepts finished updating links: 0 links updated."],
    [1, "Concepts finished updating links: 1 link updated."],
    [3, "Concepts finished updating links: 3 links updated."]
  ])("reports completion after updating %i links", (count, expected) => {
    expect(formatLinkUpdateNotice(count)).toBe(expected);
  });
});
