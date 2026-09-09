import {
  App,
  normalizePath,
  parseYaml,
  stringifyYaml,
  TFile
} from "obsidian";
import type { Concept, ConceptsSettings } from "./types";
import { compileAlias } from "./aliases";
import { parseCallouts } from "./callouts";
import { rewriteBlockLinks } from "./links";

export interface SourcePathUpdate {
  moved: boolean;
  linksUpdated: number;
}

export interface ConceptUpdate extends SourcePathUpdate {
  concept: Concept;
}

export interface ReconcileResult {
  moved: number;
  linksUpdated: number;
}

type ConceptFrontmatter = {
  concept_record?: boolean;
  concept_id?: string;
  name?: string;
  aliases?: unknown;
  source_path?: string;
  block_id?: string;
  callout_type?: string;
  created?: string;
  updated?: string;
};

export class ConceptStore {
  private concepts = new Map<string, Concept>();

  constructor(
    private readonly app: App,
    private readonly settings: ConceptsSettings
  ) {}

  async initialize(): Promise<void> {
    await this.ensureFolder(this.settings.databaseFolder);
    await this.ensureBase();
    await this.reload();
  }

  all(): Concept[] {
    return [...this.concepts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  existingBlockIds(): Set<string> {
    return new Set(this.all().map((concept) => concept.blockId));
  }

  byBlockId(blockId: string): Concept | undefined {
    return this.concepts.get(blockId);
  }

  findByTerm(term: string, caseSensitive: boolean): Concept[] {
    const sought = caseSensitive ? term : term.toLocaleLowerCase();
    return this.all().filter((concept) => {
      const name = caseSensitive ? concept.name : concept.name.toLocaleLowerCase();
      if (name === sought) return true;
      return concept.aliases.some((alias) =>
        compileAlias(alias, caseSensitive)?.matchesWhole(term) ?? false
      );
    });
  }

  async reload(): Promise<void> {
    const next = new Map<string, Concept>();
    const prefix = `${normalizePath(this.settings.databaseFolder)}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = await this.readFrontmatter(file);
      const concept = this.fromFrontmatter(file, frontmatter);
      if (concept) next.set(concept.blockId, concept);
    }
    this.concepts = next;
  }

  async create(
    name: string,
    aliases: string[],
    sourcePath: string,
    blockId: string,
    calloutType: string
  ): Promise<Concept> {
    const existing = this.byBlockId(blockId);
    if (existing) {
      return (await this.updateConcept(blockId, {
        name,
        aliases,
        sourcePath,
        calloutType
      })).concept;
    }

    const now = new Date().toISOString();
    const id = this.uuid();
    const recordPath = await this.availableRecordPath(name, id);
    const concept: Concept = {
      id,
      name,
      aliases: uniqueAliases(aliases, name),
      sourcePath,
      blockId,
      calloutType,
      recordPath,
      created: now,
      updated: now
    };
    await this.app.vault.create(recordPath, this.serialize(concept));
    this.concepts.set(blockId, concept);
    return concept;
  }

  async updateConcept(
    blockId: string,
    updates: Pick<Concept, "name" | "aliases" | "sourcePath" | "calloutType">
  ): Promise<ConceptUpdate> {
    const concept = this.byBlockId(blockId);
    if (!concept) {
      throw new Error(`Concept with block ID "${blockId}" was not found.`);
    }

    const moved = concept.sourcePath !== updates.sourcePath;
    await this.updateMetadata(concept, updates);
    const linksUpdated = moved && this.settings.updateVaultLinks
      ? await this.updateVaultLinks(blockId, updates.sourcePath)
      : 0;
    return { concept, moved, linksUpdated };
  }

  async updateMetadata(
    concept: Concept,
    updates: Partial<Pick<Concept, "name" | "aliases" | "sourcePath" | "calloutType">>
  ): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(concept.recordPath);
    if (!(file instanceof TFile)) return;

    Object.assign(concept, updates, { updated: new Date().toISOString() });
    concept.aliases = uniqueAliases(concept.aliases, concept.name);
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      frontmatter.name = concept.name;
      frontmatter.aliases = concept.aliases;
      frontmatter.source_path = concept.sourcePath;
      frontmatter.block_id = concept.blockId;
      frontmatter.callout_type = concept.calloutType;
      frontmatter.target = this.targetLink(concept);
      frontmatter.updated = concept.updated;
    });
  }

  async updateSourcePath(blockId: string, sourcePath: string): Promise<SourcePathUpdate> {
    const concept = this.byBlockId(blockId);
    if (!concept || concept.sourcePath === sourcePath) {
      return { moved: false, linksUpdated: 0 };
    }
    const result = await this.updateConcept(blockId, {
      name: concept.name,
      aliases: concept.aliases,
      sourcePath,
      calloutType: concept.calloutType
    });
    return { moved: result.moved, linksUpdated: result.linksUpdated };
  }

  /**
   * Rewrites every wikilink in the vault that references `blockId` so its
   * note-path points at the block's new location. Returns the number of links
   * that changed. Record files are included so a concept's own definition link
   * follows the callout as well.
   */
  async updateVaultLinks(blockId: string, newSourcePath: string): Promise<number> {
    const newTarget = this.notePathOf(newSourcePath);
    let linksUpdated = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.read(file);
      const { content, changed } = rewriteBlockLinks(
        source,
        blockId,
        newTarget,
        this.notePathOf(file.path)
      );
      if (changed > 0 && content !== source) {
        await this.app.vault.modify(file, content);
        linksUpdated += changed;
      }
    }
    return linksUpdated;
  }

  async reconcileLocations(): Promise<ReconcileResult> {
    const wanted = this.existingBlockIds();
    if (wanted.size === 0) return { moved: 0, linksUpdated: 0 };

    const locations = new Map<string, string>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith(`${normalizePath(this.settings.databaseFolder)}/`)) continue;
      const content = await this.app.vault.cachedRead(file);
      for (const callout of parseCallouts(content)) {
        if (callout.blockId && wanted.has(callout.blockId)) {
          locations.set(callout.blockId, file.path);
        }
      }
    }

    let moved = 0;
    let linksUpdated = 0;
    for (const [blockId, sourcePath] of locations) {
      const result = await this.updateSourcePath(blockId, sourcePath);
      if (result.moved) moved++;
      linksUpdated += result.linksUpdated;
    }
    return { moved, linksUpdated };
  }

  async handleRename(file: TFile, oldPath: string): Promise<void> {
    for (const concept of this.all()) {
      if (concept.sourcePath === oldPath) {
        await this.updateMetadata(concept, { sourcePath: file.path });
      }
    }
  }

  targetLink(concept: Pick<Concept, "sourcePath" | "blockId">): string {
    return `[[${this.notePathOf(concept.sourcePath)}#^${concept.blockId}]]`;
  }

  private notePathOf(path: string): string {
    return path.replace(/\.md$/i, "");
  }

  private async ensureBase(): Promise<void> {
    const path = normalizePath(this.settings.basePath);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    const folder = normalizePath(this.settings.databaseFolder).replace(/"/g, '\\"');
    const content = [
      "filters:",
      "  and:",
      `    - 'file.inFolder(\"${folder}\")'`,
      '    - "concept_record == true"',
      "properties:",
      "  name:",
      '    displayName: "Concept"',
      "  aliases:",
      '    displayName: "Aliases"',
      "  target:",
      '    displayName: "Definition"',
      "  callout_type:",
      '    displayName: "Type"',
      "  updated:",
      '    displayName: "Updated"',
      "views:",
      "  - type: table",
      '    name: "All concepts"',
      "    order:",
      "      - name",
      "      - aliases",
      "      - target",
      "      - callout_type",
      "      - updated",
      ""
    ].join("\n");
    await this.app.vault.create(path, content);
  }

  private async ensureFolder(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }

  private async availableRecordPath(name: string, id: string): Promise<string> {
    const safe = name
      .replace(/[\\/:*?"<>|#[\]^]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Untitled concept";
    const folder = normalizePath(this.settings.databaseFolder);
    const direct = `${folder}/${safe}.md`;
    return this.app.vault.getAbstractFileByPath(direct)
      ? `${folder}/${safe} ${id.slice(0, 8)}.md`
      : direct;
  }

  private serialize(concept: Concept): string {
    const data = {
      concept_record: true,
      concept_id: concept.id,
      name: concept.name,
      aliases: concept.aliases,
      target: this.targetLink(concept),
      source_path: concept.sourcePath,
      block_id: concept.blockId,
      callout_type: concept.calloutType,
      created: concept.created,
      updated: concept.updated
    };
    return `---\n${stringifyYaml(data)}---\n\n# ${concept.name}\n\n${this.targetLink(concept)}\n`;
  }

  private async readFrontmatter(file: TFile): Promise<ConceptFrontmatter> {
    const content = await this.app.vault.cachedRead(file);
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    try {
      return (parseYaml(match[1]) ?? {}) as ConceptFrontmatter;
    } catch {
      return {};
    }
  }

  private fromFrontmatter(
    file: TFile,
    frontmatter: ConceptFrontmatter
  ): Concept | undefined {
    if (
      frontmatter.concept_record !== true ||
      !frontmatter.concept_id ||
      !frontmatter.name ||
      !frontmatter.source_path ||
      !frontmatter.block_id
    ) return undefined;
    return {
      id: frontmatter.concept_id,
      name: frontmatter.name,
      aliases: toAliases(frontmatter.aliases),
      sourcePath: frontmatter.source_path,
      blockId: frontmatter.block_id,
      calloutType: frontmatter.callout_type ?? "note",
      recordPath: file.path,
      created: frontmatter.created ?? "",
      updated: frontmatter.updated ?? ""
    };
  }

  private uuid(): string {
    return globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}

function toAliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueAliases(aliases: string[], name: string): string[] {
  const seen = new Set([name.toLocaleLowerCase()]);
  return aliases.map((alias) => alias.trim()).filter((alias) => {
    const key = alias.toLocaleLowerCase();
    if (!alias || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
