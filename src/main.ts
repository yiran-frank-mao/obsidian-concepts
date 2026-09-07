import {
  Editor,
  EditorPosition,
  MarkdownPostProcessorContext,
  Menu,
  Notice,
  Plugin,
  setIcon,
  TFile
} from "obsidian";
import { calloutsInRange, createBlockId, insertBlockId, parseCallouts } from "./callouts";
import { ConceptStore } from "./concept-store";
import { ConceptChooserModal, ConceptFormModal } from "./modals";
import { ConceptsSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { CalloutLocation, Concept, ConceptsSettings } from "./types";

interface TextMatch {
  text: string;
  from: EditorPosition;
  to: EditorPosition;
  concepts: Concept[];
}

export default class ConceptsPlugin extends Plugin {
  settings: ConceptsSettings = DEFAULT_SETTINGS;
  private store!: ConceptStore;
  private reconcileTimer: number | undefined;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new ConceptStore(this.app, this.settings);
    await this.store.initialize();
    this.addSettingTab(new ConceptsSettingTab(this.app, this));

    this.registerMarkdownPostProcessor((element, context) =>
      this.decorateCallouts(element, context)
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
      this.app.workspace.on("editor-menu", (menu: Menu, editor: Editor) => {
        if (!this.findTextMatch(editor)) return;
        menu.addItem((item) =>
          item
            .setTitle("Link concept")
            .setIcon("book-open")
            .onClick(() => this.linkConcept(editor))
        );
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        if (
          file.path.startsWith(`${this.settings.databaseFolder}/`) ||
          oldPath.startsWith(`${this.settings.databaseFolder}/`)
        ) {
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
        if (!(file instanceof TFile) || file.extension !== "md") return;
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

  onunload(): void {
    if (this.reconcileTimer !== undefined) window.clearTimeout(this.reconcileTimer);
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private async decorateCallouts(
    element: HTMLElement,
    context: MarkdownPostProcessorContext
  ): Promise<void> {
    if (!this.settings.showCalloutButtons) return;
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    if (!(file instanceof TFile)) return;

    const rendered = [
      ...(element.matches(".callout") ? [element] : []),
      ...Array.from(element.querySelectorAll<HTMLElement>(".callout"))
    ];
    if (rendered.length === 0) return;

    const source = await this.app.vault.cachedRead(file);
    const section = context.getSectionInfo(element);
    const candidates = section
      ? calloutsInRange(source, section.lineStart, section.lineEnd)
      : parseCallouts(source);

    rendered.forEach((calloutElement, index) => {
      if (calloutElement.querySelector(":scope > .concepts-add-button")) return;
      const location = this.matchRenderedCallout(calloutElement, candidates, index);
      if (!location) return;

      const button = calloutElement.createEl("button", {
        cls: "concepts-add-button",
        attr: {
          "aria-label": location.blockId && this.store.byBlockId(location.blockId)
            ? "Concept already registered"
            : "Add this callout as a concept",
          type: "button"
        }
      });
      const registered = Boolean(location.blockId && this.store.byBlockId(location.blockId));
      setIcon(button, registered ? "check" : "book-plus");
      button.toggleClass("is-registered", registered);
      button.addEventListener("mousedown", (event) => event.stopPropagation());
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (registered) {
          new Notice(`“${location.title}” is already a concept.`);
        } else {
          void this.openConceptForm(file, location);
        }
      });
    });
  }

  private matchRenderedCallout(
    element: HTMLElement,
    candidates: CalloutLocation[],
    fallbackIndex: number
  ): CalloutLocation | undefined {
    const domTitle = element
      .querySelector<HTMLElement>(":scope > .callout-title .callout-title-inner")
      ?.textContent?.trim();
    const type = element.dataset.callout?.toLocaleLowerCase();
    const matching = candidates.filter((candidate) => {
      const sameType = !type || candidate.type.toLocaleLowerCase() === type;
      const sameTitle = !domTitle || candidate.title === domTitle;
      return sameType && sameTitle;
    });
    return matching[0] ?? candidates[fallbackIndex];
  }

  private async openConceptForm(
    file: TFile | null,
    initialLocation: CalloutLocation
  ): Promise<void> {
    if (!file) return;
    new ConceptFormModal(this.app, initialLocation.title, async ({ name, aliases }) => {
      const source = await this.app.vault.read(file);
      const callouts = parseCallouts(source);
      const location = callouts.find(
        (candidate) =>
          candidate.startLine === initialLocation.startLine &&
          candidate.title === initialLocation.title
      ) ?? callouts.find(
        (candidate) =>
          candidate.title === initialLocation.title &&
          candidate.type.toLocaleLowerCase() === initialLocation.type.toLocaleLowerCase()
      );
      if (!location) {
        new Notice("Concepts could not find that callout. It may have moved or changed.");
        return;
      }

      const blockId = location.blockId ?? createBlockId(
        new Set([
          ...this.store.existingBlockIds(),
          ...callouts.flatMap((callout) => callout.blockId ? [callout.blockId] : [])
        ])
      );
      if (!location.blockId) {
        await this.app.vault.modify(file, insertBlockId(source, location, blockId));
      }
      await this.store.create(name, aliases, file.path, blockId, location.type);
      new Notice(`Added concept “${name}”.`);
    }).open();
  }

  private linkConcept(editor: Editor): void {
    const match = this.findTextMatch(editor);
    if (!match) {
      new Notice("Select a concept name or place the cursor in one.");
      return;
    }
    if (match.concepts.length === 1) {
      this.replaceWithLink(editor, match, match.concepts[0]);
      return;
    }
    new ConceptChooserModal(this.app, match.concepts, (concept) =>
      this.replaceWithLink(editor, match, concept)
    ).open();
  }

  private replaceWithLink(editor: Editor, match: TextMatch, concept: Concept): void {
    const target = this.store.targetLink(concept).slice(2, -2);
    editor.replaceRange(`[[${target}|${match.text}]]`, match.from, match.to);
  }

  private findTextMatch(editor: Editor): TextMatch | undefined {
    const from = editor.getCursor("from");
    const to = editor.getCursor("to");
    if (editor.somethingSelected()) {
      const text = editor.getSelection();
      const concepts = this.store.findByTerm(text, this.settings.caseSensitive);
      return concepts.length ? { text, from, to, concepts } : undefined;
    }

    const cursor = editor.getCursor();
    const line = editor.getLine(cursor.line);
    if (this.insideWikiLink(line, cursor.ch)) return undefined;
    const normalizedLine = this.settings.caseSensitive ? line : line.toLocaleLowerCase();
    const matches: TextMatch[] = [];

    for (const concept of this.store.all()) {
      for (const term of [concept.name, ...concept.aliases]) {
        const sought = this.settings.caseSensitive ? term : term.toLocaleLowerCase();
        let start = normalizedLine.indexOf(sought);
        while (start >= 0) {
          const end = start + sought.length;
          if (
            cursor.ch >= start &&
            cursor.ch <= end &&
            this.hasWordBoundaries(line, start, end)
          ) {
            const existing = matches.find((match) =>
              match.from.ch === start && match.to.ch === end
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

  private hasWordBoundaries(line: string, start: number, end: number): boolean {
    const word = /[\p{L}\p{N}_]/u;
    return !(start > 0 && word.test(line[start - 1]))
      && !(end < line.length && word.test(line[end]));
  }

  private insideWikiLink(line: string, position: number): boolean {
    const opening = line.lastIndexOf("[[", position);
    const closing = line.lastIndexOf("]]", position);
    return opening > closing;
  }

  private calloutAtCursor(editor: Editor): CalloutLocation | undefined {
    const cursor = editor.getCursor();
    return parseCallouts(editor.getValue()).find(
      (callout) => cursor.line >= callout.startLine && cursor.line <= callout.endLine
    );
  }

  private scheduleFileReconcile(file: TFile): void {
    if (this.reconcileTimer !== undefined) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => {
      this.reconcileTimer = undefined;
      void this.reconcileFile(file);
    }, 800);
  }

  private async reconcileFile(file: TFile): Promise<void> {
    const current = this.app.vault.getAbstractFileByPath(file.path);
    if (!(current instanceof TFile)) return;
    const source = await this.app.vault.cachedRead(current);
    let linksUpdated = 0;
    for (const callout of parseCallouts(source)) {
      if (callout.blockId && this.store.byBlockId(callout.blockId)) {
        const result = await this.store.updateSourcePath(callout.blockId, current.path);
        linksUpdated += result.linksUpdated;
      }
    }
    if (linksUpdated > 0) {
      new Notice(`Concepts: updated ${linksUpdated} link${linksUpdated === 1 ? "" : "s"}.`);
    }
  }

  private async reconcileAll(showNotice: boolean): Promise<void> {
    const { moved, linksUpdated } = await this.store.reconcileLocations();
    if (showNotice) {
      if (!moved) {
        new Notice("All concept locations are up to date.");
        return;
      }
      const locations = `${moved} concept location${moved === 1 ? "" : "s"}`;
      const links = linksUpdated
        ? ` and ${linksUpdated} link${linksUpdated === 1 ? "" : "s"}`
        : "";
      new Notice(`Updated ${locations}${links}.`);
    }
  }

  private async openBase(): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(this.settings.basePath);
    if (!(file instanceof TFile)) {
      new Notice("Concepts base file was not found. Reload the plugin to recreate it.");
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }
}
