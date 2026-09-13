// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import ConceptsPlugin from "../src/main";
import { TFile, TFolder, normalizePath, notices, parseYaml, stringifyYaml } from "./obsidian-mock";

/**
 * Obsidian loads plugins while it is still indexing the vault, so the file
 * index can be empty even though the files exist on disk. Creating a path in
 * that window throws "already exists", which is what breaks plugin start-up.
 */
class StartupVault {
  files = new Map<string, string>();
  folders = new Set<string>();
  indexReady = true;
  createAttempts: string[] = [];

  private handlers = new Map<string, (...args: unknown[]) => void>();

  on(event: string, handler: (...args: unknown[]) => void): { event: string } {
    this.handlers.set(event, handler);
    return { event };
  }

  getMarkdownFiles(): TFile[] {
    if (!this.indexReady) return [];
    return [...this.files.keys()]
      .filter((path) => path.endsWith(".md"))
      .map((path) => new TFile(path));
  }

  getAbstractFileByPath(path: string): TFile | TFolder | null {
    if (!this.indexReady) return null;
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
    this.createAttempts.push(key);
    if (this.files.has(key)) throw new Error("File already exists.");
    this.files.set(key, content);
    return new TFile(key);
  }

  async createFolder(path: string): Promise<TFolder> {
    const key = normalizePath(path);
    this.createAttempts.push(key);
    if (this.folders.has(key)) throw new Error("Folder already exists.");
    this.folders.add(key);
    return new TFolder(key);
  }
}

class StartupWorkspace {
  private layoutReady: Array<() => void> = [];
  ready = false;
  rerenders = 0;

  on(): { event: string } {
    return { event: "workspace" };
  }

  getLeavesOfType(): Array<{ view: { previewMode: { rerender: () => void } } }> {
    return [{ view: { previewMode: { rerender: () => void this.rerenders++ } } }];
  }

  onLayoutReady(callback: () => void): void {
    if (this.ready) callback();
    else this.layoutReady.push(callback);
  }

  /** Mirrors Obsidian finishing its start-up work. */
  finishLayout(vault: StartupVault): void {
    this.ready = true;
    vault.indexReady = true;
    const callbacks = [...this.layoutReady];
    this.layoutReady = [];
    for (const callback of callbacks) callback();
  }
}

/** Waits for the deferred database start the plugin kicked off. */
async function settleDatabase(plugin: ConceptsPlugin): Promise<void> {
  await (plugin as unknown as { databaseStart?: Promise<void> }).databaseStart;
}

function makePlugin(vault: StartupVault) {
  const workspace = new StartupWorkspace();
  const fileManager = {
    async processFrontMatter(file: TFile, fn: (frontmatter: Record<string, unknown>) => void) {
      const content = vault.files.get(file.path) ?? "";
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
      const frontmatter = match ? parseYaml(match[1]) : {};
      fn(frontmatter);
      const body = match ? content.slice(match[0].length) : content;
      vault.files.set(file.path, `---\n${stringifyYaml(frontmatter)}---\n${body}`);
    }
  };
  const plugin = new ConceptsPlugin({ vault, workspace, fileManager } as never, {} as never);
  return { plugin, workspace };
}

/** A vault that already holds the plugin's folder, base file, and a concept. */
function seededVault(): StartupVault {
  const vault = new StartupVault();
  vault.folders.add("Concepts");
  vault.folders.add("Concepts/Database");
  vault.files.set("Concepts/Concepts.base", "filters:\n");
  vault.files.set(
    "Concepts/Database/Banach space.md",
    [
      "---",
      'concept_record: true',
      'concept_id: "abc"',
      'name: "Banach space"',
      "aliases:",
      '  - "Banach spaces"',
      'source_path: "Analysis/Banach.md"',
      'block_id: "concept-banach"',
      'callout_type: "definition"',
      "---",
      ""
    ].join("\n")
  );
  return vault;
}

beforeEach(() => {
  notices.length = 0;
});

describe("loading while Obsidian is still indexing the vault", () => {
  it("registers commands, settings, and handlers even though the index is empty", async () => {
    const vault = seededVault();
    vault.indexReady = false;
    const { plugin } = makePlugin(vault);

    await plugin.onload();

    expect(plugin.commands.map((command) => command.id)).toEqual([
      "link-concept-at-cursor",
      "choose-concept-link",
      "add-callout-at-cursor",
      "open-concepts-base",
      "rebuild-concept-locations"
    ]);
    expect(plugin.settingTabs).toHaveLength(1);
    expect(plugin.postProcessors).toHaveLength(1);
    expect(plugin.registeredEvents.length).toBeGreaterThan(0);
  });

  it("does not recreate the database folder or base file that already exist", async () => {
    const vault = seededVault();
    vault.indexReady = false;
    const { plugin, workspace } = makePlugin(vault);

    await plugin.onload();
    workspace.finishLayout(vault);
    await settleDatabase(plugin);

    expect(vault.createAttempts).toEqual([]);
    expect(notices).toEqual([]);
  });

  it("loads the concept database once the vault index is ready", async () => {
    const vault = seededVault();
    vault.indexReady = false;
    const { plugin, workspace } = makePlugin(vault);

    await plugin.onload();
    const store = (plugin as unknown as { store: { all(): unknown[] } }).store;
    expect(store.all()).toHaveLength(0);

    workspace.finishLayout(vault);
    await settleDatabase(plugin);
    expect(store.all()).toHaveLength(1);
    // Notes rendered before the database opened are refreshed.
    expect(workspace.rerenders).toBe(1);
  });

  it("stays loaded and recovers through the rebuild command after a real failure", async () => {
    const vault = seededVault();
    // The folder is missing, so the plugin has to create it and hits the error.
    vault.folders.clear();
    let failures = 1;
    const createFolder = vault.createFolder.bind(vault);
    vault.createFolder = async (path: string) => {
      if (failures-- > 0) throw new Error("EACCES: permission denied");
      return createFolder(path);
    };
    const { plugin, workspace } = makePlugin(vault);

    await plugin.onload();
    workspace.finishLayout(vault);
    await settleDatabase(plugin);

    expect(plugin.commands).toHaveLength(5);
    expect(notices).toEqual([
      "Concepts could not open its database. Run “Rebuild concept locations” to try again."
    ]);

    const rebuild = plugin.commands.find((command) => command.id === "rebuild-concept-locations");
    await (rebuild as unknown as { callback(): unknown }).callback();
    await settleDatabase(plugin);

    const store = (plugin as unknown as { store: { all(): unknown[] } }).store;
    expect(store.all()).toHaveLength(1);
  });

  it("loads with default settings when stored settings cannot be read", async () => {
    const vault = seededVault();
    const { plugin } = makePlugin(vault);
    plugin.loadData = async () => {
      throw new Error("Unexpected end of JSON input");
    };

    await plugin.onload();

    expect(plugin.settings.popupPlacement).toBe("below");
    expect(plugin.commands).toHaveLength(5);
  });

  it("still creates the folder and base file in a vault that lacks them", async () => {
    const vault = new StartupVault();
    const { plugin, workspace } = makePlugin(vault);

    await plugin.onload();
    workspace.finishLayout(vault);
    await settleDatabase(plugin);

    expect(vault.folders.has("Concepts/Database")).toBe(true);
    expect(vault.files.has("Concepts/Concepts.base")).toBe(true);
  });
});
