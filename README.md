# Concepts

Concepts is an Obsidian plugin for building a wiki-like concept index from definitions, theorems, and other callout blocks. It is especially useful for mathematical notes.

## Features

- Add any rendered callout to the concept database with the button in its top-right corner.
- Use the callout title as the canonical concept name and optionally record aliases.
- Give each registered callout a stable Obsidian block ID.
- Link a selected name or alias with the **Concepts: Link concept at cursor or selection** command (`Ctrl/Cmd+Shift+K` by default).
- Use **Link concept** from the editor context menu.
- Automatically update the concept record when a callout and its block ID move to another note.
- Rewrite every `[[…#^concept-…]]` link across the vault so it follows the callout to its new note.
- Browse and edit concept records through an automatically created Obsidian Base.

For example, selecting `Banach space` and running the link command produces:

```md
[[Banach Spaces#^concept-a1b2c3d4e5f6|Banach space]]
```

## Usage

Write a callout with a useful title:

```md
> [!definition] Banach Space
> A complete normed vector space.
```

In Live Preview or Reading view, hover over it and select the book-plus button. Confirm the name and add comma-separated aliases. Concepts adds a block ID after the callout:

```md
> [!definition] Banach Space
> A complete normed vector space.

^concept-a1b2c3d4e5f6
```

It then creates:

- `Concepts/Database/Banach Space.md`, a concept record with the name, aliases, source path, block ID, callout type, target, and timestamps.
- `Concepts/Concepts.base`, a table view over all concept records.

The paths can be changed in **Settings → Concepts**. Change them before registering concepts; path changes take effect after reloading the plugin.

When moving a callout, include the blank line and `^concept-...` line beneath it. The stable ID lets Concepts discover the new note, rewrite the database target, and update every link to that concept throughout the vault so none of them break. **Concepts: Rebuild concept locations** performs a full manual rescan if files were changed outside Obsidian.

Vault-wide link updates are controlled by **Update links across the vault** in **Settings → Concepts** (on by default). Each link's note path is rewritten to the callout's new location while the visible text is preserved, so `[[Analysis#^concept-a1b2c3d4e5f6|Banach space]]` becomes `[[Functional Analysis#^concept-a1b2c3d4e5f6|Banach space]]`. Embeds (`![[…]]`) are updated too. After the vault scan finishes, Concepts displays a notice with the number of links updated.

## Install with BRAT

1. Install and enable [BRAT](https://tfthacker.com/BRAT).
2. Open **Settings → BRAT → Add Beta plugin**.
3. Paste this repository's public GitHub URL.
4. Enable **Concepts** under **Community plugins**.

BRAT requires `manifest.json`, `main.js`, and optionally `styles.css` in the repository or a release. This repository's build and release workflow provide those files.

## Manual installation

Copy `manifest.json`, `main.js`, and `styles.css` into:

```text
<vault>/.obsidian/plugins/concepts/
```

Then reload Obsidian and enable **Concepts**.

## Development

```bash
npm install
npm test
npm run build
```

The production build writes `main.js` at the repository root. Tagged versions should match `manifest.json`, `package.json`, and `versions.json`.

## Data model

Concept records are plain Markdown files, so the database remains usable without this plugin. The frontmatter fields are:

| Field | Meaning |
| --- | --- |
| `name` | Canonical concept name |
| `aliases` | Alternative names recognized by the linker |
| `target` | Wikilink to the source callout |
| `source_path` | Current source note |
| `block_id` | Stable block identifier |
| `callout_type` | Callout type, such as `definition` |
| `concept_id` | Stable database identifier |
| `created`, `updated` | ISO timestamps |

## Limitations

- The callout title should be plain text. Rich Markdown in a title is normalized when used as a concept name.
- Moving only the quoted lines and leaving the block ID behind breaks identity tracking. Move the ID with the callout.
- Concepts adds buttons through Obsidian's rendered Markdown API. Some heavily customized themes or callout plugins may alter the button position.

## License

MIT
