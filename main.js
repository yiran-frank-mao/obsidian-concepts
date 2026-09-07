var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ConceptsPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian4 = require("obsidian");

// src/callouts.ts
var HEADER = /^(\s*)>\s*\[!([^\]]+)\][+-]?\s*(.*)$/;
var BLOCK_ID = /^\s*\^([A-Za-z0-9-]+)\s*$/;
function parseCallouts(source) {
  const lines = source.split("\n");
  const result = [];
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(HEADER);
    if (!header) continue;
    const indentation = header[1];
    const quotePrefix = new RegExp(`^${escapeRegExp(indentation)}>`);
    let endLine = index;
    while (endLine + 1 < lines.length && quotePrefix.test(lines[endLine + 1])) {
      endLine++;
    }
    let blockId;
    let blockIdLine;
    for (let candidate = endLine + 1; candidate <= Math.min(endLine + 2, lines.length - 1); candidate++) {
      const match = lines[candidate].match(BLOCK_ID);
      if (match) {
        blockId = match[1];
        blockIdLine = candidate;
        break;
      }
      if (lines[candidate].trim() !== "") break;
    }
    result.push({
      title: cleanTitle(header[3]) || titleCase(header[2]),
      type: header[2].trim(),
      startLine: index,
      endLine,
      blockId,
      blockIdLine
    });
  }
  return result;
}
function calloutsInRange(source, lineStart, lineEnd) {
  return parseCallouts(source).filter(
    (callout) => callout.startLine >= lineStart && callout.startLine <= lineEnd
  );
}
function insertBlockId(source, callout, blockId) {
  if (callout.blockId) return source;
  const lines = source.split("\n");
  lines.splice(callout.endLine + 1, 0, "", `^${blockId}`);
  return lines.join("\n");
}
function createBlockId(existingIds) {
  const cryptoApi = globalThis.crypto;
  do {
    const random = (cryptoApi == null ? void 0 : cryptoApi.getRandomValues) ? Array.from(
      cryptoApi.getRandomValues(new Uint8Array(6)),
      (byte) => byte.toString(16).padStart(2, "0")
    ).join("") : Math.random().toString(16).slice(2, 14).padEnd(12, "0");
    const candidate = `concept-${random}`;
    if (!existingIds.has(candidate)) return candidate;
  } while (true);
}
function cleanTitle(value) {
  return value.replace(/\s+\^[A-Za-z0-9-]+\s*$/, "").replace(/[*_~`[\]]/g, "").trim();
}
function titleCase(value) {
  return value.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// src/concept-store.ts
var import_obsidian = require("obsidian");
var ConceptStore = class {
  constructor(app, settings) {
    __publicField(this, "app", app);
    __publicField(this, "settings", settings);
    __publicField(this, "concepts", /* @__PURE__ */ new Map());
  }
  async initialize() {
    await this.ensureFolder(this.settings.databaseFolder);
    await this.ensureBase();
    await this.reload();
  }
  all() {
    return [...this.concepts.values()].sort((a, b) => a.name.localeCompare(b.name));
  }
  existingBlockIds() {
    return new Set(this.all().map((concept) => concept.blockId));
  }
  byBlockId(blockId) {
    return this.concepts.get(blockId);
  }
  findByTerm(term, caseSensitive) {
    const sought = caseSensitive ? term : term.toLocaleLowerCase();
    return this.all().filter(
      (concept) => [concept.name, ...concept.aliases].some(
        (candidate) => (caseSensitive ? candidate : candidate.toLocaleLowerCase()) === sought
      )
    );
  }
  async reload() {
    const next = /* @__PURE__ */ new Map();
    const prefix = `${(0, import_obsidian.normalizePath)(this.settings.databaseFolder)}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      const frontmatter = await this.readFrontmatter(file);
      const concept = this.fromFrontmatter(file, frontmatter);
      if (concept) next.set(concept.blockId, concept);
    }
    this.concepts = next;
  }
  async create(name, aliases, sourcePath, blockId, calloutType) {
    const existing = this.byBlockId(blockId);
    if (existing) {
      await this.updateMetadata(existing, { name, aliases, sourcePath, calloutType });
      return existing;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const id = this.uuid();
    const recordPath = await this.availableRecordPath(name, id);
    const concept = {
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
  async updateMetadata(concept, updates) {
    const file = this.app.vault.getAbstractFileByPath(concept.recordPath);
    if (!(file instanceof import_obsidian.TFile)) return;
    Object.assign(concept, updates, { updated: (/* @__PURE__ */ new Date()).toISOString() });
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
  async updateSourcePath(blockId, sourcePath) {
    const concept = this.byBlockId(blockId);
    if (!concept || concept.sourcePath === sourcePath) return false;
    await this.updateMetadata(concept, { sourcePath });
    return true;
  }
  async reconcileLocations() {
    const wanted = this.existingBlockIds();
    if (wanted.size === 0) return 0;
    const locations = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path.startsWith(`${(0, import_obsidian.normalizePath)(this.settings.databaseFolder)}/`)) continue;
      const content = await this.app.vault.cachedRead(file);
      for (const callout of parseCallouts(content)) {
        if (callout.blockId && wanted.has(callout.blockId)) {
          locations.set(callout.blockId, file.path);
        }
      }
    }
    let changed = 0;
    for (const [blockId, sourcePath] of locations) {
      if (await this.updateSourcePath(blockId, sourcePath)) changed++;
    }
    return changed;
  }
  async handleRename(file, oldPath) {
    for (const concept of this.all()) {
      if (concept.sourcePath === oldPath) {
        await this.updateMetadata(concept, { sourcePath: file.path });
      }
    }
  }
  targetLink(concept) {
    const notePath = concept.sourcePath.replace(/\.md$/i, "");
    return `[[${notePath}#^${concept.blockId}]]`;
  }
  async ensureBase() {
    const path = (0, import_obsidian.normalizePath)(this.settings.basePath);
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    const folder = (0, import_obsidian.normalizePath)(this.settings.databaseFolder).replace(/"/g, '\\"');
    const content = [
      "filters:",
      "  and:",
      `    - 'file.inFolder("${folder}")'`,
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
  async ensureFolder(path) {
    const normalized = (0, import_obsidian.normalizePath)(path);
    if (!normalized || this.app.vault.getAbstractFileByPath(normalized)) return;
    const parent = normalized.split("/").slice(0, -1).join("/");
    if (parent) await this.ensureFolder(parent);
    if (!this.app.vault.getAbstractFileByPath(normalized)) {
      await this.app.vault.createFolder(normalized);
    }
  }
  async availableRecordPath(name, id) {
    const safe = name.replace(/[\\/:*?"<>|#[\]^]/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "Untitled concept";
    const folder = (0, import_obsidian.normalizePath)(this.settings.databaseFolder);
    const direct = `${folder}/${safe}.md`;
    return this.app.vault.getAbstractFileByPath(direct) ? `${folder}/${safe} ${id.slice(0, 8)}.md` : direct;
  }
  serialize(concept) {
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
    return `---
${(0, import_obsidian.stringifyYaml)(data)}---

# ${concept.name}

${this.targetLink(concept)}
`;
  }
  async readFrontmatter(file) {
    var _a;
    const content = await this.app.vault.cachedRead(file);
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!match) return {};
    try {
      return (_a = (0, import_obsidian.parseYaml)(match[1])) != null ? _a : {};
    } catch (e) {
      return {};
    }
  }
  fromFrontmatter(file, frontmatter) {
    var _a, _b, _c;
    if (frontmatter.concept_record !== true || !frontmatter.concept_id || !frontmatter.name || !frontmatter.source_path || !frontmatter.block_id) return void 0;
    return {
      id: frontmatter.concept_id,
      name: frontmatter.name,
      aliases: toAliases(frontmatter.aliases),
      sourcePath: frontmatter.source_path,
      blockId: frontmatter.block_id,
      calloutType: (_a = frontmatter.callout_type) != null ? _a : "note",
      recordPath: file.path,
      created: (_b = frontmatter.created) != null ? _b : "",
      updated: (_c = frontmatter.updated) != null ? _c : ""
    };
  }
  uuid() {
    var _a, _b, _c;
    return (_c = (_b = (_a = globalThis.crypto) == null ? void 0 : _a.randomUUID) == null ? void 0 : _b.call(_a)) != null ? _c : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
};
function toAliases(value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}
function uniqueAliases(aliases, name) {
  const seen = /* @__PURE__ */ new Set([name.toLocaleLowerCase()]);
  return aliases.map((alias) => alias.trim()).filter((alias) => {
    const key = alias.toLocaleLowerCase();
    if (!alias || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/modals.ts
var import_obsidian2 = require("obsidian");
var ConceptFormModal = class extends import_obsidian2.Modal {
  constructor(app, initialName, onSubmit) {
    super(app);
    __publicField(this, "onSubmit", onSubmit);
    __publicField(this, "name");
    __publicField(this, "aliases", "");
    this.name = initialName;
  }
  onOpen() {
    this.setTitle("Add concept");
    new import_obsidian2.Setting(this.contentEl).setName("Name").setDesc("The canonical name of this concept.").addText((text) => {
      text.setValue(this.name).onChange((value) => this.name = value);
      window.setTimeout(() => text.inputEl.select(), 0);
    });
    new import_obsidian2.Setting(this.contentEl).setName("Aliases").setDesc("Comma-separated alternative names, such as \u201CTopology, Topological spaces\u201D.").addText((text) => {
      text.setPlaceholder("Alias one, Alias two").onChange((value) => this.aliases = value);
    });
    new import_obsidian2.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Add concept").setCta().onClick(() => void this.submit())
    );
  }
  onClose() {
    this.contentEl.empty();
  }
  async submit() {
    const name = this.name.trim();
    if (!name) return;
    this.close();
    await this.onSubmit({
      name,
      aliases: this.aliases.split(",").map((alias) => alias.trim()).filter(Boolean)
    });
  }
};
var ConceptChooserModal = class extends import_obsidian2.SuggestModal {
  constructor(app, concepts, onChoose) {
    super(app);
    __publicField(this, "concepts", concepts);
    __publicField(this, "onChoose", onChoose);
    this.setPlaceholder("Choose the concept to link");
  }
  getSuggestions(query) {
    const normalized = query.toLocaleLowerCase();
    return this.concepts.filter(
      (concept) => [concept.name, ...concept.aliases].some(
        (term) => term.toLocaleLowerCase().includes(normalized)
      )
    );
  }
  renderSuggestion(concept, el) {
    el.createEl("div", { text: concept.name });
    el.createEl("small", {
      text: `${concept.aliases.join(", ") || "No aliases"} \xB7 ${concept.sourcePath}`
    });
  }
  onChooseSuggestion(concept) {
    this.onChoose(concept);
  }
};

// src/settings.ts
var import_obsidian3 = require("obsidian");
var DEFAULT_SETTINGS = {
  databaseFolder: "Concepts/Database",
  basePath: "Concepts/Concepts.base",
  showCalloutButtons: true,
  trackMovedCallouts: true,
  caseSensitive: false
};
var ConceptsSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin", plugin);
  }
  display() {
    this.containerEl.empty();
    new import_obsidian3.Setting(this.containerEl).setName("Database folder").setDesc("Each concept is represented by a Markdown record in this folder.").addText(
      (text) => text.setValue(this.plugin.settings.databaseFolder).onChange(async (value) => {
        this.plugin.settings.databaseFolder = value.trim() || DEFAULT_SETTINGS.databaseFolder;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(this.containerEl).setName("Base file").setDesc("The Obsidian Base that displays all concept records.").addText(
      (text) => text.setValue(this.plugin.settings.basePath).onChange(async (value) => {
        this.plugin.settings.basePath = value.trim() || DEFAULT_SETTINGS.basePath;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(this.containerEl).setName("Show callout buttons").setDesc("Add an \u201CAdd concept\u201D button to rendered callouts.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showCalloutButtons).onChange(async (value) => {
        this.plugin.settings.showCalloutButtons = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(this.containerEl).setName("Track moved callouts").setDesc("Find known block IDs after note edits and update concept targets.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.trackMovedCallouts).onChange(async (value) => {
        this.plugin.settings.trackMovedCallouts = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian3.Setting(this.containerEl).setName("Case-sensitive linking").setDesc("Require selected text to match concept names and aliases exactly.").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.caseSensitive).onChange(async (value) => {
        this.plugin.settings.caseSensitive = value;
        await this.plugin.saveSettings();
      })
    );
  }
};

// src/main.ts
var ConceptsPlugin = class extends import_obsidian4.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "settings", DEFAULT_SETTINGS);
    __publicField(this, "store");
    __publicField(this, "reconcileTimer");
  }
  async onload() {
    await this.loadSettings();
    this.store = new ConceptStore(this.app, this.settings);
    await this.store.initialize();
    this.addSettingTab(new ConceptsSettingTab(this.app, this));
    this.registerMarkdownPostProcessor(
      (element, context) => this.decorateCallouts(element, context)
    );
    this.addCommand({
      id: "link-concept-at-cursor",
      name: "Link concept at cursor or selection",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "k" }],
      editorCallback: (editor) => this.linkConcept(editor)
    });
    this.addCommand({
      id: "add-callout-at-cursor",
      name: "Add callout at cursor as concept",
      editorCheckCallback: (checking, editor, view) => {
        const available = this.calloutAtCursor(editor);
        if (available && !checking) {
          void this.openConceptForm(view.file, available);
        }
        return Boolean(available && view.file);
      }
    });
    this.addCommand({
      id: "open-concepts-base",
      name: "Open concepts base",
      callback: () => void this.openBase()
    });
    this.addCommand({
      id: "rebuild-concept-locations",
      name: "Rebuild concept locations",
      callback: () => void this.reconcileAll(true)
    });
    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu, editor) => {
        if (!this.findTextMatch(editor)) return;
        menu.addItem(
          (item) => item.setTitle("Link concept").setIcon("book-open").onClick(() => this.linkConcept(editor))
        );
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof import_obsidian4.TFile)) return;
        if (file.path.startsWith(`${this.settings.databaseFolder}/`) || oldPath.startsWith(`${this.settings.databaseFolder}/`)) {
          window.setTimeout(() => void this.store.reload(), 250);
        } else {
          void this.store.handleRename(file, oldPath);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file.path.startsWith(`${this.settings.databaseFolder}/`)) {
          window.setTimeout(() => void this.store.reload(), 250);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof import_obsidian4.TFile) || file.extension !== "md") return;
        if (file.path.startsWith(`${this.settings.databaseFolder}/`)) {
          window.setTimeout(() => void this.store.reload(), 250);
          return;
        }
        if (this.settings.trackMovedCallouts) this.scheduleFileReconcile(file);
      })
    );
    if (this.settings.trackMovedCallouts) {
      this.app.workspace.onLayoutReady(() => void this.reconcileAll(false));
    }
  }
  onunload() {
    if (this.reconcileTimer !== void 0) window.clearTimeout(this.reconcileTimer);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  async decorateCallouts(element, context) {
    if (!this.settings.showCalloutButtons) return;
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof import_obsidian4.TFile)) return;
    const rendered = [
      ...element.matches(".callout") ? [element] : [],
      ...Array.from(element.querySelectorAll(".callout"))
    ];
    if (rendered.length === 0) return;
    const source = await this.app.vault.cachedRead(file);
    const section = context.getSectionInfo(element);
    const candidates = section ? calloutsInRange(source, section.lineStart, section.lineEnd) : parseCallouts(source);
    rendered.forEach((calloutElement, index) => {
      if (calloutElement.querySelector(":scope > .concepts-add-button")) return;
      const location = this.matchRenderedCallout(calloutElement, candidates, index);
      if (!location) return;
      const button = calloutElement.createEl("button", {
        cls: "concepts-add-button",
        attr: {
          "aria-label": location.blockId && this.store.byBlockId(location.blockId) ? "Concept already registered" : "Add this callout as a concept",
          type: "button"
        }
      });
      const registered = Boolean(location.blockId && this.store.byBlockId(location.blockId));
      (0, import_obsidian4.setIcon)(button, registered ? "check" : "book-plus");
      button.toggleClass("is-registered", registered);
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (registered) {
          new import_obsidian4.Notice(`\u201C${location.title}\u201D is already a concept.`);
        } else {
          void this.openConceptForm(file, location);
        }
      });
    });
  }
  matchRenderedCallout(element, candidates, fallbackIndex) {
    var _a, _b, _c, _d;
    const domTitle = (_b = (_a = element.querySelector(":scope > .callout-title .callout-title-inner")) == null ? void 0 : _a.textContent) == null ? void 0 : _b.trim();
    const type = (_c = element.dataset.callout) == null ? void 0 : _c.toLocaleLowerCase();
    const matching = candidates.filter((candidate) => {
      const sameType = !type || candidate.type.toLocaleLowerCase() === type;
      const sameTitle = !domTitle || candidate.title === domTitle;
      return sameType && sameTitle;
    });
    return (_d = matching[0]) != null ? _d : candidates[fallbackIndex];
  }
  async openConceptForm(file, initialLocation) {
    if (!file) return;
    new ConceptFormModal(this.app, initialLocation.title, async ({ name, aliases }) => {
      var _a, _b;
      const source = await this.app.vault.read(file);
      const callouts = parseCallouts(source);
      const location = (_a = callouts.find(
        (candidate) => candidate.startLine === initialLocation.startLine && candidate.title === initialLocation.title
      )) != null ? _a : callouts.find(
        (candidate) => candidate.title === initialLocation.title && candidate.type.toLocaleLowerCase() === initialLocation.type.toLocaleLowerCase()
      );
      if (!location) {
        new import_obsidian4.Notice("Concepts could not find that callout. It may have moved or changed.");
        return;
      }
      const blockId = (_b = location.blockId) != null ? _b : createBlockId(
        /* @__PURE__ */ new Set([
          ...this.store.existingBlockIds(),
          ...callouts.flatMap((callout) => callout.blockId ? [callout.blockId] : [])
        ])
      );
      if (!location.blockId) {
        await this.app.vault.modify(file, insertBlockId(source, location, blockId));
      }
      await this.store.create(name, aliases, file.path, blockId, location.type);
      new import_obsidian4.Notice(`Added concept \u201C${name}\u201D.`);
    }).open();
  }
  linkConcept(editor) {
    const match = this.findTextMatch(editor);
    if (!match) {
      new import_obsidian4.Notice("Select a concept name or place the cursor in one.");
      return;
    }
    if (match.concepts.length === 1) {
      this.replaceWithLink(editor, match, match.concepts[0]);
      return;
    }
    new ConceptChooserModal(
      this.app,
      match.concepts,
      (concept) => this.replaceWithLink(editor, match, concept)
    ).open();
  }
  replaceWithLink(editor, match, concept) {
    const target = this.store.targetLink(concept).slice(2, -2);
    editor.replaceRange(`[[${target}|${match.text}]]`, match.from, match.to);
  }
  findTextMatch(editor) {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    if (editor.somethingSelected()) {
      const text = editor.getSelection();
      const concepts = this.store.findByTerm(text, this.settings.caseSensitive);
      return concepts.length ? { text, from, to, concepts } : void 0;
    }
    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (this.insideWikiLink(line, cursor.ch)) return void 0;
    const normalizedLine = this.settings.caseSensitive ? line : line.toLocaleLowerCase();
    const matches = [];
    for (const concept of this.store.all()) {
      for (const term of [concept.name, ...concept.aliases]) {
        const sought = this.settings.caseSensitive ? term : term.toLocaleLowerCase();
        let start = normalizedLine.indexOf(sought);
        while (start >= 0) {
          const end = start + sought.length;
          if (cursor.ch >= start && cursor.ch <= end && this.hasWordBoundaries(line, start, end)) {
            const existing = matches.find(
              (match) => match.from.ch === start && match.to.ch === end
            );
            if (existing) existing.concepts.push(concept);
            else {
              matches.push({
                text: line.slice(start, end),
                from: { line: cursor.line, ch: start },
                to: { line: cursor.line, ch: end },
                concepts: [concept]
              });
            }
          }
          start = normalizedLine.indexOf(sought, start + 1);
        }
      }
    }
    return matches.sort((a, b) => b.text.length - a.text.length)[0];
  }
  hasWordBoundaries(line, start, end) {
    const word = /[\p{L}\p{N}_]/u;
    return !(start > 0 && word.test(line[start - 1])) && !(end < line.length && word.test(line[end]));
  }
  insideWikiLink(line, position) {
    const opening = line.lastIndexOf("[[", position);
    const closing = line.lastIndexOf("]]", position);
    return opening > closing;
  }
  calloutAtCursor(editor) {
    const cursor = editor.getCursor();
    return parseCallouts(editor.getValue()).find(
      (callout) => cursor.line >= callout.startLine && cursor.line <= callout.endLine
    );
  }
  scheduleFileReconcile(file) {
    if (this.reconcileTimer !== void 0) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = void 0;
      void this.reconcileFile(file);
    }, 800);
  }
  async reconcileFile(file) {
    const current = this.app.vault.getAbstractFileByPath(file.path);
    if (!(current instanceof import_obsidian4.TFile)) return;
    const source = await this.app.vault.cachedRead(current);
    for (const callout of parseCallouts(source)) {
      if (callout.blockId && this.store.byBlockId(callout.blockId)) {
        await this.store.updateSourcePath(callout.blockId, current.path);
      }
    }
  }
  async reconcileAll(showNotice) {
    const changed = await this.store.reconcileLocations();
    if (showNotice) {
      new import_obsidian4.Notice(changed ? `Updated ${changed} concept location${changed === 1 ? "" : "s"}.` : "All concept locations are up to date.");
    }
  }
  async openBase() {
    const file = this.app.vault.getAbstractFileByPath(this.settings.basePath);
    if (!(file instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice("Concepts base file was not found. Reload the plugin to recreate it.");
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }
};
