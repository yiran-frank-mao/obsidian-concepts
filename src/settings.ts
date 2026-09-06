import { App, PluginSettingTab, Setting } from "obsidian";
import type ConceptsPlugin from "./main";
import type { ConceptsSettings } from "./types";

export const DEFAULT_SETTINGS: ConceptsSettings = {
  databaseFolder: "Concepts/Database",
  basePath: "Concepts/Concepts.base",
  showCalloutButtons: true,
  trackMovedCallouts: true,
  caseSensitive: false
};

export class ConceptsSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ConceptsPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Database folder")
      .setDesc("Each concept is represented by a Markdown record in this folder.")
      .addText((text) =>
        text.setValue(this.plugin.settings.databaseFolder).onChange(async (value) => {
          this.plugin.settings.databaseFolder = value.trim() || DEFAULT_SETTINGS.databaseFolder;
          await this.plugin.saveSettings();
        })
      );
    new Setting(this.containerEl)
      .setName("Base file")
      .setDesc("The Obsidian Base that displays all concept records.")
      .addText((text) =>
        text.setValue(this.plugin.settings.basePath).onChange(async (value) => {
          this.plugin.settings.basePath = value.trim() || DEFAULT_SETTINGS.basePath;
          await this.plugin.saveSettings();
        })
      );
    new Setting(this.containerEl)
      .setName("Show callout buttons")
      .setDesc("Add an “Add concept” button to rendered callouts.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showCalloutButtons).onChange(async (value) => {
          this.plugin.settings.showCalloutButtons = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(this.containerEl)
      .setName("Track moved callouts")
      .setDesc("Find known block IDs after note edits and update concept targets.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.trackMovedCallouts).onChange(async (value) => {
          this.plugin.settings.trackMovedCallouts = value;
          await this.plugin.saveSettings();
        })
      );
    new Setting(this.containerEl)
      .setName("Case-sensitive linking")
      .setDesc("Require selected text to match concept names and aliases exactly.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.caseSensitive).onChange(async (value) => {
          this.plugin.settings.caseSensitive = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
