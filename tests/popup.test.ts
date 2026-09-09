// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import ConceptsPlugin from "../src/main";
import { DEFAULT_SETTINGS } from "../src/settings";
import { MENU_DOM_HEIGHT, createdMenus, notices, openedModals } from "./obsidian-mock";
import type { Concept, PopupPlacement } from "../src/types";

// Obsidian augments DOM nodes with these helpers at runtime.
type SpanOptions = { text?: string; cls?: string };
for (const proto of [DocumentFragment.prototype, HTMLElement.prototype]) {
  (proto as unknown as Record<string, unknown>).createSpan = function (
    this: Node,
    options: SpanOptions = {}
  ) {
    const span = document.createElement("span");
    if (options.text) span.textContent = options.text;
    if (options.cls) span.className = options.cls;
    this.appendChild(span);
    return span;
  };
}

function concept(name: string, aliases: string[], note: string, blockId: string): Concept {
  return {
    id: blockId,
    name,
    aliases,
    sourcePath: `${note}.md`,
    blockId,
    calloutType: "definition",
    recordPath: `Concepts/Database/${name}.md`,
    created: "",
    updated: ""
  };
}

const productTopology = concept("Product topology", ["product"], "Spaces/Product", "concept-spaces");
const cartesianProduct = concept("Cartesian product", ["product"], "Sets/Product", "concept-sets");
const productObject = concept("Product object", ["/products?/"], "Cats/Product", "concept-cats");
const banachSpace = concept("Banach space", ["banach"], "Analysis/Banach", "concept-banach");

const CARET = { top: 300, bottom: 320, left: 120 };

interface Replacement {
  text: string;
  from?: { line: number; ch: number };
  to?: { line: number; ch: number };
}

class FakeEditor {
  replacements: Replacement[] = [];

  constructor(
    private readonly line: string,
    private readonly ch: number,
    private readonly selection = "",
    private readonly coords: typeof CARET | null = CARET
  ) {}

  getCursor(): { line: number; ch: number } {
    return { line: 0, ch: this.ch };
  }
  getLine(): string {
    return this.line;
  }
  somethingSelected(): boolean {
    return this.selection.length > 0;
  }
  getSelection(): string {
    return this.selection;
  }
  replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }): void {
    this.replacements.push({ text, from, to });
  }
  replaceSelection(text: string): void {
    this.replacements.push({ text });
  }
  posToOffset(pos: { ch: number }): number {
    return pos.ch;
  }
  coordsAtPos(): typeof CARET | undefined {
    return this.coords ?? undefined;
  }
}

function makePlugin(concepts: Concept[], placement: PopupPlacement = "below") {
  const plugin = new ConceptsPlugin({} as never, {} as never);
  plugin.settings = { ...DEFAULT_SETTINGS, popupPlacement: placement };
  (plugin as unknown as Record<string, unknown>).store = {
    all: () => concepts,
    findByTerm: (term: string) =>
      concepts.filter((candidate) =>
        [candidate.name, ...candidate.aliases].some((alias) => alias.toLowerCase() === term.toLowerCase())
      ),
    targetLink: (candidate: Concept) =>
      `[[${candidate.sourcePath.replace(/\.md$/, "")}#^${candidate.blockId}]]`
  };
  return plugin;
}

const linkConcept = (plugin: ConceptsPlugin, editor: FakeEditor) =>
  (plugin as unknown as { linkConcept(editor: unknown): void }).linkConcept(editor);

const chooseConceptLink = (plugin: ConceptsPlugin, editor: FakeEditor) =>
  (plugin as unknown as { chooseConceptLink(editor: unknown): void }).chooseConceptLink(editor);

const line = "The product of two spaces";
const insideProduct = line.indexOf("product") + 3;

beforeEach(() => {
  createdMenus.length = 0;
  openedModals.length = 0;
  notices.length = 0;
});

describe("linking a term claimed by one concept", () => {
  it("replaces the term without opening a popup", () => {
    const editor = new FakeEditor(line, insideProduct);
    linkConcept(makePlugin([productTopology, banachSpace]), editor);

    expect(createdMenus).toHaveLength(0);
    expect(editor.replacements).toEqual([
      {
        text: "[[Spaces/Product#^concept-spaces|product]]",
        from: { line: 0, ch: 4 },
        to: { line: 0, ch: 11 }
      }
    ]);
  });
});

describe("linking an ambiguous term", () => {
  it("opens a popup listing every competing concept", () => {
    const plugin = makePlugin([productTopology, cartesianProduct, productObject]);
    linkConcept(plugin, new FakeEditor(line, insideProduct));

    expect(createdMenus).toHaveLength(1);
    const [menu] = createdMenus;
    expect(menu.items[0].isLabel).toBe(true);
    expect(menu.items[0].title).toBe("Link “product”");

    const choices = menu.items.slice(1).map((item) => {
      const title = item.title as DocumentFragment;
      return title.firstChild?.textContent;
    });
    expect(choices).toEqual(["Product topology", "Cartesian product", "Product object"]);
  });

  it("keeps the typed text as the link's display name", () => {
    const editor = new FakeEditor(line, insideProduct);
    linkConcept(makePlugin([productTopology, cartesianProduct]), editor);

    createdMenus[0].items[2].clickHandler?.();
    expect(editor.replacements).toEqual([
      {
        text: "[[Sets/Product#^concept-sets|product]]",
        from: { line: 0, ch: 4 },
        to: { line: 0, ch: 11 }
      }
    ]);
  });

  it("shows each concept's type and note so the choice is unambiguous", () => {
    linkConcept(
      makePlugin([productTopology, cartesianProduct]),
      new FakeEditor(line, insideProduct)
    );

    const title = createdMenus[0].items[1].title as DocumentFragment;
    expect(title.textContent).toBe("Product topologydefinition · Spaces/Product");
  });
});

describe("popup placement", () => {
  it("opens below the caret's line by default", () => {
    linkConcept(
      makePlugin([productTopology, cartesianProduct], "below"),
      new FakeEditor(line, insideProduct)
    );

    const [menu] = createdMenus;
    expect(menu.shownAt).toEqual({ x: CARET.left, y: CARET.bottom });
    expect(menu.dom.style.top).toBe(`${CARET.bottom}px`);
  });

  it("opens above the caret's line when configured", () => {
    linkConcept(
      makePlugin([productTopology, cartesianProduct], "above"),
      new FakeEditor(line, insideProduct)
    );

    const [menu] = createdMenus;
    expect(menu.shownAt).toEqual({ x: CARET.left, y: CARET.top });
    expect(menu.dom.style.top).toBe(`${CARET.top - MENU_DOM_HEIGHT}px`);
  });

  it("falls back to the searchable chooser when the caret has no coordinates", () => {
    const editor = new FakeEditor(line, insideProduct, "", null);
    linkConcept(makePlugin([productTopology, cartesianProduct]), editor);

    expect(createdMenus).toHaveLength(0);
    expect(openedModals).toHaveLength(1);
  });
});

describe("manually triggering the popup", () => {
  it("lists every concept when the cursor is not on a known term", () => {
    const plugin = makePlugin([productTopology, banachSpace]);
    chooseConceptLink(plugin, new FakeEditor("Nothing familiar here", 3));

    expect(createdMenus).toHaveLength(1);
    expect(createdMenus[0].items[0].title).toBe("Insert concept link");
    expect(createdMenus[0].items).toHaveLength(3);
  });

  it("inserts the chosen concept under its own name", () => {
    const editor = new FakeEditor("Nothing familiar here", 3);
    chooseConceptLink(makePlugin([productTopology, banachSpace]), editor);

    createdMenus[0].items[2].clickHandler?.();
    expect(editor.replacements).toEqual([
      { text: "[[Analysis/Banach#^concept-banach|Banach space]]" }
    ]);
  });

  it("narrows to the matching concepts when the cursor is on a known term", () => {
    const plugin = makePlugin([productTopology, cartesianProduct, banachSpace]);
    chooseConceptLink(plugin, new FakeEditor(line, insideProduct));

    expect(createdMenus[0].items[0].title).toBe("Link “product”");
    expect(createdMenus[0].items).toHaveLength(3);
  });

  it("reports when the database is empty instead of opening an empty popup", () => {
    chooseConceptLink(makePlugin([]), new FakeEditor("Nothing here", 3));

    expect(createdMenus).toHaveLength(0);
    expect(notices).toEqual(["No concepts have been registered yet."]);
  });
});
