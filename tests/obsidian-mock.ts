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
