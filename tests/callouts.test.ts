import { describe, expect, it } from "vitest";
import {
  calloutsInRange,
  insertBlockId,
  parseCallouts,
  resolveSubmittedCallout
} from "../src/callouts";

describe("parseCallouts", () => {
  const note = [
    "# Functional analysis",
    "",
    "> [!definition] Banach Space",
    "> A complete normed vector space.",
    "",
    "^7196a5",
    "",
    "Some text.",
    "",
    "> [!theorem]- Open Mapping Theorem",
    "> A surjective bounded linear map is open."
  ].join("\n");

  it("reads titles, types, locations, and block IDs", () => {
    expect(parseCallouts(note)).toEqual([
      {
        title: "Banach Space",
        type: "definition",
        startLine: 2,
        endLine: 3,
        blockId: "7196a5",
        blockIdLine: 5
      },
      {
        title: "Open Mapping Theorem",
        type: "theorem",
        startLine: 9,
        endLine: 10,
        blockId: undefined,
        blockIdLine: undefined
      }
    ]);
  });

  it("limits callouts to a rendered source section", () => {
    expect(calloutsInRange(note, 8, 11)).toHaveLength(1);
    expect(calloutsInRange(note, 8, 11)[0].title).toBe("Open Mapping Theorem");
  });

  it("uses the callout type when no custom title exists", () => {
    expect(parseCallouts("> [!topological-space]\n> Content")[0].title)
      .toBe("Topological Space");
  });

  it("reads a block ID written on a quoted line inside the callout", () => {
    const callout = parseCallouts(
      "> [!definition] Banach Space\n> A complete normed vector space.\n> ^concept-5144b7350d14"
    )[0];
    expect(callout.blockId).toBe("concept-5144b7350d14");
  });

  it("reads a block ID appended to the callout's last quoted line", () => {
    const callout = parseCallouts(
      "> [!definition] Banach Space\n> A complete normed vector space. ^concept-5144b7350d14"
    )[0];
    expect(callout.blockId).toBe("concept-5144b7350d14");
  });

  it("reads a block ID inside a callout that is followed by other content", () => {
    const callout = parseCallouts(
      "> [!definition] Banach Space\n> Content.\n> ^concept-5144b7350d14\n\nMore text."
    )[0];
    expect(callout.blockId).toBe("concept-5144b7350d14");
  });

  it("keeps exponent notation from being read as a block ID", () => {
    const callout = parseCallouts("> [!theorem] Growth\n> The bound is x ^n")[0];
    expect(callout.blockId).toBeUndefined();
  });

  it("prefers the callout's own block ID over the next block's ID", () => {
    const callout = parseCallouts([
      "> [!definition] Banach Space",
      "> Content.",
      "> ^concept-inside",
      "",
      "^concept-nextblock"
    ].join("\n"))[0];
    expect(callout.blockId).toBe("concept-inside");
  });

  it("resolves a moved registered callout by its stable block ID", () => {
    const initial = parseCallouts(
      "> [!definition] Original title\n> Content\n\n^concept-stable"
    )[0];
    const moved = parseCallouts([
      "> [!definition] Duplicate title",
      "> Wrong callout.",
      "",
      "^concept-other",
      "",
      "> [!theorem] Renamed concept",
      "> Moved and edited.",
      "",
      "^concept-stable"
    ].join("\n"));

    expect(resolveSubmittedCallout(moved, initial, "concept-stable")).toEqual(moved[1]);
  });

  it("does not fall back to a title match when a stable block ID is missing", () => {
    const initial = parseCallouts(
      "> [!definition] Shared title\n> Content\n\n^concept-stable"
    )[0];
    const candidates = parseCallouts("> [!definition] Shared title\n> Different callout");

    expect(resolveSubmittedCallout(candidates, initial, "concept-stable")).toBeUndefined();
  });
});

describe("insertBlockId", () => {
  it("places a structured block ID after a blank line", () => {
    const source = "> [!definition] Group\n> A set with an operation.\n\nNext";
    const callout = parseCallouts(source)[0];
    expect(insertBlockId(source, callout, "concept-abc123")).toBe(
      "> [!definition] Group\n> A set with an operation.\n\n^concept-abc123\n\nNext"
    );
  });

  it("does not replace an existing block ID", () => {
    const source = "> [!definition] Group\n> Content\n\n^group";
    expect(insertBlockId(source, parseCallouts(source)[0], "other")).toBe(source);
  });
});
