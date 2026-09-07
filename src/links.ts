export interface BlockLinkRewrite {
  content: string;
  changed: number;
}

export function formatLinkUpdateNotice(linksUpdated: number): string {
  return `Concepts finished updating links: ${linksUpdated} link${
    linksUpdated === 1 ? "" : "s"
  } updated.`;
}

/**
 * Rewrites the note-path portion of every wikilink (or embed) that targets
 * `#^blockId` so it points at `newTarget`, a vault-relative path without the
 * `.md` suffix. Display aliases and the embed marker are preserved.
 *
 * Same-file references written as `[[#^blockId]]` are only expanded to an
 * explicit path when `currentTarget` is provided and differs from `newTarget`;
 * this fills in the location once the block moves out of the note that
 * referenced it locally, while leaving genuine in-note links untouched.
 *
 * The `blockId` boundary check prevents a shorter ID from matching inside a
 * longer one (for example `concept-abc` must not match `concept-abcde`).
 */
export function rewriteBlockLinks(
  source: string,
  blockId: string,
  newTarget: string,
  currentTarget?: string
): BlockLinkRewrite {
  const pattern = new RegExp(
    `\\[\\[([^\\[\\]]*?)#\\^${escapeRegExp(blockId)}(?![0-9A-Za-z-])(\\|[^\\[\\]]*?)?\\]\\]`,
    "g"
  );

  let changed = 0;
  const content = source.replace(pattern, (match, path: string, alias: string | undefined) => {
    const display = alias ?? "";
    if (path === "") {
      if (currentTarget === undefined || currentTarget === newTarget) return match;
    } else if (path === newTarget) {
      return match;
    }
    changed++;
    return `[[${newTarget}#^${blockId}${display}]]`;
  });

  return { content, changed };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
