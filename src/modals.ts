import { App, Modal, Setting, SuggestModal } from "obsidian";
import type { Concept } from "./types";

export interface ConceptFormResult {
  name: string;
  aliases: string[];
}

export interface ConceptFormOptions {
  aliases?: string[];
  mode?: "add" | "update";
}

export class ConceptFormModal extends Modal {
  private name: string;
  private aliases: string;

  constructor(
    app: App,
    initialName: string,
    private readonly onSubmit: (result: ConceptFormResult) => Promise<void>,
    private readonly options: ConceptFormOptions = {}
  ) {
    super(app);
    this.name = initialName;
    this.aliases = options.aliases?.join(", ") ?? "";
  }

  onOpen(): void {
    const updating = this.options.mode === "update";
    this.setTitle(updating ? "Update concept" : "Add concept");
    new Setting(this.contentEl)
      .setName("Name")
      .setDesc("The canonical name of this concept.")
      .addText((text) => {
        text.setValue(this.name).onChange((value) => (this.name = value));
        window.setTimeout(() => text.inputEl.select(), 0);
      });
    new Setting(this.contentEl)
      .setName("Aliases")
      .setDesc("Comma-separated alternative names, such as “Topology, Topological spaces”.")
      .addText((text) => {
        text.setPlaceholder("Alias one, Alias two")
          .setValue(this.aliases)
          .onChange((value) => (this.aliases = value));
      });
    new Setting(this.contentEl)
      .addButton((button) =>
        button
          .setButtonText(updating ? "Update concept" : "Add concept")
          .setCta()
          .onClick(() => void this.submit())
      );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async submit(): Promise<void> {
    const name = this.name.trim();
    if (!name) return;
    this.close();
    await this.onSubmit({
      name,
      aliases: this.aliases.split(",").map((alias) => alias.trim()).filter(Boolean)
    });
  }
}

export class ConceptChooserModal extends SuggestModal<Concept> {
  constructor(
    app: App,
    private readonly concepts: Concept[],
    private readonly onChoose: (concept: Concept) => void
  ) {
    super(app);
    this.setPlaceholder("Choose the concept to link");
  }

  getSuggestions(query: string): Concept[] {
    const normalized = query.toLocaleLowerCase();
    return this.concepts.filter((concept) =>
      [concept.name, ...concept.aliases].some((term) =>
        term.toLocaleLowerCase().includes(normalized)
      )
    );
  }

  renderSuggestion(concept: Concept, el: HTMLElement): void {
    el.createEl("div", { text: concept.name });
    el.createEl("small", {
      text: `${concept.aliases.join(", ") || "No aliases"} · ${concept.sourcePath}`
    });
  }

  onChooseSuggestion(concept: Concept): void {
    this.onChoose(concept);
  }
}
