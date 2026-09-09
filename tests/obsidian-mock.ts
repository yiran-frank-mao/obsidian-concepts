// Minimal in-memory stand-in for the parts of the `obsidian` API that
// ConceptStore touches, so the real store logic can be exercised in tests.

export class TFile {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
  get extension(): string {
    const dot = this.path.lastIndexOf(".");
    return dot >= 0 ? this.path.slice(dot + 1) : "";
  }
}

export class TFolder {
  path: string;
  constructor(path: string) {
    this.path = path;
  }
}

// UI stubs: only needed so modules that import them (e.g. settings.ts) load.
export class PluginSettingTab {
  containerEl = { empty(): void {} };
  constructor(_app?: unknown, _plugin?: unknown) {}
}

export class Setting {
  constructor(_containerEl?: unknown) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  addText(): this { return this; }
  addToggle(): this { return this; }
  addDropdown(): this { return this; }
}

export class Modal {
  contentEl = { empty(): void {} };
  opened = false;
  constructor(_app?: unknown) {}
  setTitle(_title: string): this { return this; }
  open(): void {
    this.opened = true;
    openedModals.push(this);
  }
  close(): void {
    this.opened = false;
  }
}

export class SuggestModal<T> extends Modal {
  constructor(app?: unknown) {
    super(app);
  }
  setPlaceholder(_text: string): void {}
}

/** Modals opened during a test, so a fallback path can be asserted. */
export const openedModals: Modal[] = [];

export class MenuItem {
  title: string | DocumentFragment = "";
  icon: string | null = null;
  isLabel = false;
  clickHandler: (() => void) | undefined;

  setTitle(title: string | DocumentFragment): this {
    this.title = title;
    return this;
  }
  setIcon(icon: string | null): this {
    this.icon = icon;
    return this;
  }
  setIsLabel(isLabel: boolean): this {
    this.isLabel = isLabel;
    return this;
  }
  onClick(handler: () => void): this {
    this.clickHandler = handler;
    return this;
  }
}

export interface MenuPositionDef {
  x: number;
  y: number;
}

/**
 * Records the items and placement the plugin asks for, and exposes a `dom`
 * element the way the real menu does so positioning can be asserted.
 */
export class Menu {
  items: MenuItem[] = [];
  shownAt: MenuPositionDef | undefined;
  dom = createMenuDom();

  constructor() {
    createdMenus.push(this);
  }

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    this.items.push(item);
    return this;
  }
  addSeparator(): this { return this; }
  showAtPosition(position: MenuPositionDef): this {
    this.shownAt = position;
    return this;
  }
  hide(): this { return this; }
  close(): void {}
}

/** Menus constructed during a test, in creation order. */
export const createdMenus: Menu[] = [];

/** Height is fixed so tests can reason about above/below placement. */
export const MENU_DOM_HEIGHT = 180;

function createMenuDom(): HTMLElement {
  const dom = document.createElement("div");
  dom.getBoundingClientRect = () =>
    ({ height: MENU_DOM_HEIGHT }) as DOMRect;
  return dom;
}

export class Notice {
  constructor(message: string | DocumentFragment) {
    notices.push(typeof message === "string" ? message : (message.textContent ?? ""));
  }
}

/** Notice text raised during a test. */
export const notices: string[] = [];

export function setIcon(_el: HTMLElement, _icon: string): void {}

export class Plugin {
  constructor(public app: unknown, public manifest: unknown) {}
  addCommand(command: unknown): unknown { return command; }
  addSettingTab(_tab: unknown): void {}
  registerEvent(_ref: unknown): void {}
  registerMarkdownPostProcessor(_processor: unknown): unknown { return _processor; }
  async loadData(): Promise<unknown> { return {}; }
  async saveData(_data: unknown): Promise<void> {}
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

export function parseYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const arrayHeader = line.match(/^(\w+):\s*$/);
    if (arrayHeader) {
      const items: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        items.push(parseScalar(lines[++i].replace(/^\s*-\s+/, "")) as string);
      }
      result[arrayHeader[1]] = items;
      continue;
    }
    const scalar = line.match(/^(\w+):\s*(.*)$/);
    if (scalar) result[scalar[1]] = parseScalar(scalar[2]);
  }
  return result;
}

export function stringifyYaml(data: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${quote(String(item))}`);
    } else if (typeof value === "boolean") {
      lines.push(`${key}: ${value}`);
    } else {
      lines.push(`${key}: ${quote(String(value))}`);
    }
  }
  return lines.join("\n") + "\n";
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "true") return true;
  if (value === "false") return false;
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return value;
}

function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
