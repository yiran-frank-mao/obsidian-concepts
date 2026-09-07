import { beforeEach, describe, expect, it } from "vitest";
import { parseCallouts, resolveSubmittedCallout } from "../src/callouts";
import { ConceptStore } from "../src/concept-store";
import { DEFAULT_SETTINGS } from "../src/settings";
import { TFile, TFolder, normalizePath, parseYaml, stringifyYaml } from "./obsidian-mock";
import type { ConceptsSettings } from "../src/types";

/** In-memory vault faithful enough to drive the real ConceptStore. */
class FakeVault {
  files = new Map<string, string>();
  folders = new Set<string>();

  getMarkdownFiles(): TFile[] {
    return [...this.files.keys()]
      .filter((path) => path.endsWith(".md"))
      .map((path) => new TFile(path));
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    const key = normalizePath(path);
    if (this.files.has(key)) return new TFile(key);
    if (this.folders.has(key)) return new TFolder(key);
    return null;
  }

  async cachedRead(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? "";
  }

  async read(file: TFile): Promise<string> {
    return this.files.get(file.path) ?? "";
  }

  async modify(file: TFile, content: string): Promise<void> {
    this.files.set(file.path, content);
  }

  async create(path: string, content: string): Promise<TFile> {
    const key = normalizePath(path);
    this.files.set(key, content);
    return new TFile(key);
  }

  async createFolder(path: string): Promise<void> {
    this.folders.add(normalizePath(path));
  }
}

class FakeFileManager {
  constructor(private readonly vault: FakeVault) {}

  async processFrontMatter(
    file: TFile,
    fn: (frontmatter: Record<string, unknown>) => void
  ): Promise<void> {
    const content = this.vault.files.get(file.path) ?? "";
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const frontmatter = match ? parseYaml(match[1]) : {};
    fn(frontmatter);
    const body = match ? content.slice(match[0].length) : content;
    this.vault.files.set(file.path, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
  }
}

function makeApp() {
  const vault = new FakeVault();
  return { app: { vault, fileManager: new FakeFileManager(vault) } as never, vault };
}

const BLOCK = "concept-a1b2c3d4e5f6";

async function seedStore(settings: ConceptsSettings) {
  const { app, vault } = makeApp();
  const store = new ConceptStore(app, settings);
  await store.initialize();
  await store.create("Banach space", ["Banach spaces"], "Analysis/Original.md", BLOCK, "definition");
  // Notes elsewhere in the vault that link to the concept's callout.
  vault.files.set(
    "Notes/Uses.md",
    "A [[Analysis/Original#^concept-a1b2c3d4e5f6|Banach space]] is complete.\n" +
      "Also see [[Analysis/Original#^concept-a1b2c3d4e5f6]] and embed ![[Analysis/Original#^concept-a1b2c3d4e5f6]]."
  );
  vault.files.set(
    "Notes/Other.md",
    "Unrelated [[Analysis/Original#^concept-other000000|thing]] stays put."
  );
  return { store, vault };
}

describe("ConceptStore link updates when a callout moves", () => {
  let store: ConceptStore;
  let vault: FakeVault;

  beforeEach(async () => {
    ({ store, vault } = await seedStore({ ...DEFAULT_SETTINGS, updateVaultLinks: true }));
  });

  it("rewrites every vault link to the concept's new location", async () => {
    const result = await store.updateSourcePath(BLOCK, "Analysis/Moved.md");

    expect(result.moved).toBe(true);
    // 3 links in Uses.md + the record's own body definition link.
    expect(result.linksUpdated).toBe(4);

    const uses = vault.files.get("Notes/Uses.md");
    expect(uses).toContain("[[Analysis/Moved#^concept-a1b2c3d4e5f6|Banach space]]");
    expect(uses).toContain("[[Analysis/Moved#^concept-a1b2c3d4e5f6]]");
    expect(uses).toContain("![[Analysis/Moved#^concept-a1b2c3d4e5f6]]");
    expect(uses).not.toContain("Original");

    // Unrelated concept link is untouched.
    expect(vault.files.get("Notes/Other.md")).toContain(
      "[[Analysis/Original#^concept-other000000|thing]]"
    );

    // The concept record follows the callout too (frontmatter + body link).
    const record = vault.files.get("Concepts/Database/Banach space.md") ?? "";
    expect(record).toContain('target: "[[Analysis/Moved#^concept-a1b2c3d4e5f6]]"');
    expect(record).toContain('source_path: "Analysis/Moved.md"');
    expect(record).toContain("[[Analysis/Moved#^concept-a1b2c3d4e5f6]]");
    expect(record).not.toContain("Original");
  });

  it("does nothing when the source path is unchanged", async () => {
    const result = await store.updateSourcePath(BLOCK, "Analysis/Original.md");
    expect(result).toEqual({ moved: false, linksUpdated: 0 });
    expect(vault.files.get("Notes/Uses.md")).toContain("[[Analysis/Original#^concept-a1b2c3d4e5f6|Banach space]]");
  });

  it("leaves vault links alone when the setting is disabled", async () => {
    ({ store, vault } = await seedStore({ ...DEFAULT_SETTINGS, updateVaultLinks: false }));
    const result = await store.updateSourcePath(BLOCK, "Analysis/Moved.md");

    expect(result.moved).toBe(true);
    expect(result.linksUpdated).toBe(0);
    // Links across the vault remain pointed at the old note.
    expect(vault.files.get("Notes/Uses.md")).toContain(
      "[[Analysis/Original#^concept-a1b2c3d4e5f6|Banach space]]"
    );
    // But the concept record's own target frontmatter still updates.
    const record = vault.files.get("Concepts/Database/Banach space.md") ?? "";
    expect(record).toContain('target: "[[Analysis/Moved#^concept-a1b2c3d4e5f6]]"');
  });

  it("updates a moved registered concept's metadata and every vault reference", async () => {
    const result = await store.updateConcept(BLOCK, {
      name: "Complete normed space",
      aliases: ["Banach space", "Banach spaces"],
      sourcePath: "Analysis/Moved.md",
      calloutType: "theorem"
    });

    const record = vault.files.get("Concepts/Database/Banach space.md") ?? "";
    expect(result).toMatchObject({ moved: true, linksUpdated: 4 });
    expect(result.concept).toMatchObject({
      name: "Complete normed space",
      aliases: ["Banach space", "Banach spaces"],
      sourcePath: "Analysis/Moved.md",
      blockId: BLOCK,
      calloutType: "theorem"
    });
    expect(record).toContain('name: "Complete normed space"');
    expect(record).toContain('callout_type: "theorem"');
    expect(record).toContain('source_path: "Analysis/Moved.md"');
    expect(vault.files.get("Notes/Uses.md")).toContain(
      "[[Analysis/Moved#^concept-a1b2c3d4e5f6|Banach space]]"
    );
  });

  // Mirrors clicking the callout button: the note is parsed, the concept is
  // looked up by the block ID found there, and the submitted form updates it.
  it.each([
    ["a quoted line inside the callout", "> [!definition] Banach space\n> Content.\n> ^concept-a1b2c3d4e5f6"],
    ["the callout's last quoted line", "> [!definition] Banach space\n> Content. ^concept-a1b2c3d4e5f6"],
    ["its own line after the callout", "> [!definition] Banach space\n> Content.\n\n^concept-a1b2c3d4e5f6"]
  ])("recognizes and updates a moved concept whose block ID is on %s", async (_form, callout) => {
    vault.files.set("Analysis/Moved.md", `# Moved\n\n${callout}\n`);
    const location = parseCallouts(vault.files.get("Analysis/Moved.md") ?? "")[0];

    const existing = store.byBlockId(location.blockId ?? "");
    expect(existing).toBeDefined();

    const submitted = resolveSubmittedCallout([location], location, existing?.blockId);
    expect(submitted).toBeDefined();

    const result = await store.updateConcept(BLOCK, {
      name: existing?.name ?? "",
      aliases: existing?.aliases ?? [],
      sourcePath: "Analysis/Moved.md",
      calloutType: submitted?.type ?? ""
    });

    expect(result.moved).toBe(true);
    expect(result.linksUpdated).toBe(4);
    expect(vault.files.get("Notes/Uses.md")).toContain(
      "[[Analysis/Moved#^concept-a1b2c3d4e5f6|Banach space]]"
    );
  });

  it("keeps create idempotent while moving an already registered block", async () => {
    const concept = await store.create(
      "Banach space",
      ["Banach spaces"],
      "Analysis/Moved.md",
      BLOCK,
      "definition"
    );

    expect(concept.blockId).toBe(BLOCK);
    expect(vault.files.get("Notes/Uses.md")).toContain(
      "[[Analysis/Moved#^concept-a1b2c3d4e5f6|Banach space]]"
    );
  });
});
