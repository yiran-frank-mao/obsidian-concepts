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
