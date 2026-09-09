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
import {
  calloutsInRange,
  createBlockId,
  insertBlockId,
  parseCallouts,
  resolveSubmittedCallout
} from "./callouts";
import { ConceptStore } from "./concept-store";
import { formatLinkUpdateNotice } from "./links";
import { findConceptMatch, insideWikiLink } from "./matching";
import { resolveMenuTop } from "./menu-position";
import { ConceptChooserModal, ConceptFormModal } from "./modals";
import { ConceptsSettingTab, DEFAULT_SETTINGS } from "./settings";
import type { CalloutLocation, Concept, ConceptsSettings } from "./types";

interface TextMatch {
  text: string;
  from: EditorPosition;
  to: EditorPosition;
  concepts: Concept[];
}

interface AnchorRect {
  top: number;
  bottom: number;
  left: number;
}

/** Beyond this many entries the popup stops being quicker than searching. */
const MENU_LIMIT = 50;

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
      id: "choose-concept-link",
      name: "Choose concept to link from popup",
      hotkeys: [{ modifiers: ["Mod", "Shift"], key: "l" }],
      editorCallback: (editor) => this.chooseConceptLink(editor)
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
            ? "Update this concept"
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
        void this.openConceptForm(file, location);
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
    const existing = initialLocation.blockId
      ? this.store.byBlockId(initialLocation.blockId)
      : undefined;
    new ConceptFormModal(this.app, existing?.name ?? initialLocation.title, async ({ name, aliases }) => {
      const source = await this.app.vault.read(file);
      const callouts = parseCallouts(source);
      const location = resolveSubmittedCallout(callouts, initialLocation, existing?.blockId);
      if (!location) {
        new Notice("Concepts could not find that callout. It may have moved or changed.");
        return;
      }

      if (existing) {
        const result = await this.store.updateConcept(existing.blockId, {
          name,
          aliases,
          sourcePath: file.path,
          calloutType: location.type
        });
        const linkNotice = result.moved && this.settings.updateVaultLinks
          ? ` ${formatLinkUpdateNotice(result.linksUpdated)}`
          : "";
        new Notice(`Updated concept “${name}”.${linkNotice}`);
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
    }, {
      aliases: existing?.aliases,
      mode: existing ? "update" : "add"
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
    this.showConceptPopup(editor, match.concepts, match.from, `Link “${match.text}”`, (concept) =>
      this.replaceWithLink(editor, match, concept)
    );
  }

  /**
   * Opens the chooser on demand. A term under the cursor narrows the list and
   * is replaced in place; otherwise the picked concept is inserted at the
   * cursor under its own name.
   */
  private chooseConceptLink(editor: Editor): void {
    const match = this.findTextMatch(editor);
    const concepts = match?.concepts ?? this.store.all();
    if (concepts.length === 0) {
      new Notice("No concepts have been registered yet.");
      return;
    }
    const anchor = match?.from ?? editor.getCursor("from");
    const title = match ? `Link “${match.text}”` : "Insert concept link";
    this.showConceptPopup(editor, concepts, anchor, title, (concept) => {
      if (match) this.replaceWithLink(editor, match, concept);
      else this.insertLink(editor, concept);
    });
  }

  private replaceWithLink(editor: Editor, match: TextMatch, concept: Concept): void {
    editor.replaceRange(this.linkTo(concept, match.text), match.from, match.to);
  }

  private insertLink(editor: Editor, concept: Concept): void {
    editor.replaceSelection(this.linkTo(concept, concept.name));
  }

  private linkTo(concept: Concept, display: string): string {
    const target = this.store.targetLink(concept).slice(2, -2);
    return `[[${target}|${display}]]`;
  }

  private showConceptPopup(
    editor: Editor,
    concepts: Concept[],
    anchor: EditorPosition,
    title: string,
    onChoose: (concept: Concept) => void
  ): void {
    const rect = this.anchorRect(editor, anchor);
    if (!rect) {
      new ConceptChooserModal(this.app, concepts, onChoose).open();
      return;
    }

    const menu = new Menu();
    menu.addItem((item) => item.setTitle(title).setIsLabel(true));
    for (const concept of concepts.slice(0, MENU_LIMIT)) {
      menu.addItem((item) =>
        item
          .setTitle(this.describeConcept(concept))
          .setIcon("book-open")
          .onClick(() => onChoose(concept))
      );
    }
    if (concepts.length > MENU_LIMIT) {
      menu.addItem((item) =>
        item
          .setTitle(`Search all ${concepts.length} concepts…`)
          .setIcon("search")
          .onClick(() => new ConceptChooserModal(this.app, concepts, onChoose).open())
      );
    }

    const placement = this.settings.popupPlacement;
    menu.showAtPosition({
      x: rect.left,
      y: placement === "above" ? rect.top : rect.bottom
    });
    this.alignPopup(menu, rect);
  }

  /**
   * `showAtPosition` cannot place a menu by its bottom edge, so the rendered
   * height is measured and the final offset applied afterwards.
   */
  private alignPopup(menu: Menu, rect: AnchorRect): void {
    const dom = (menu as unknown as { dom?: HTMLElement }).dom;
    if (!dom) return;
    const menuHeight = dom.getBoundingClientRect().height || dom.offsetHeight;
    if (!menuHeight) return;
    dom.style.top = `${resolveMenuTop({
      anchorTop: rect.top,
      anchorBottom: rect.bottom,
      menuHeight,
      viewportHeight: window.innerHeight,
      placement: this.settings.popupPlacement
    })}px`;
  }

  private describeConcept(concept: Concept): DocumentFragment {
    const fragment = document.createDocumentFragment();
    fragment.createSpan({ text: concept.name });
    const detail = [concept.calloutType, concept.sourcePath.replace(/\.md$/i, "")]
      .filter(Boolean)
      .join(" · ");
    if (detail) {
      fragment.createSpan({ cls: "concepts-menu-detail", text: detail });
    }
    return fragment;
  }

  /**
   * Obsidian's editor exposes caret coordinates directly on some versions and
   * only through the underlying CodeMirror view on others.
   */
  private anchorRect(editor: Editor, position: EditorPosition): AnchorRect | undefined {
    const candidate = editor as unknown as {
      coordsAtPos?: (pos: EditorPosition) => AnchorRect | null | undefined;
      cm?: { coordsAtPos?: (offset: number) => AnchorRect | null | undefined };
    };
    const direct = candidate.coordsAtPos?.(position);
    if (direct) return direct;
    const viaCodeMirror = candidate.cm?.coordsAtPos?.(editor.posToOffset(position));
    return viaCodeMirror ?? undefined;
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
    if (insideWikiLink(line, cursor.ch)) return undefined;

    const match = findConceptMatch(
      line,
      cursor.ch,
      this.store.all(),
      this.settings.caseSensitive
    );
    if (!match) return undefined;
    return {
      text: match.text,
      from: { line: cursor.line, ch: match.start },
      to: { line: cursor.line, ch: match.end },
      concepts: match.concepts
    };
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
    let moved = 0;
    let linksUpdated = 0;
    for (const callout of parseCallouts(source)) {
      if (callout.blockId && this.store.byBlockId(callout.blockId)) {
        const result = await this.store.updateSourcePath(callout.blockId, current.path);
        if (result.moved) moved++;
        linksUpdated += result.linksUpdated;
      }
    }
    if (moved > 0 && this.settings.updateVaultLinks) {
      new Notice(formatLinkUpdateNotice(linksUpdated));
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
