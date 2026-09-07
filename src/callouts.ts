import type { CalloutLocation } from "./types";

const HEADER = /^(\s*)>\s*\[!([^\]]+)\][+-]?\s*(.*)$/;
const BLOCK_ID = /^\s*\^([A-Za-z0-9-]+)\s*$/;
const QUOTED_BLOCK_ID = /^\s*>\s*\^([A-Za-z0-9-]+)\s*$/;
const TRAILING_BLOCK_ID = /\s\^([A-Za-z0-9-]+)\s*$/;

/**
 * Finds top-level and indented callouts while preserving source line numbers.
 *
 * A block ID may sit on its own line after the callout, on a quoted line
 * inside it, or at the end of its last quoted line. Obsidian produces all
 * three, and a moved callout keeps whichever form the note already used, so
 * every form has to resolve to the same identity.
 */
export function parseCallouts(source: string): CalloutLocation[] {
  const lines = source.split("\n");
  const result: CalloutLocation[] = [];

  for (let index = 0; index < lines.length; index++) {
    const header = lines[index].match(HEADER);
    if (!header) continue;

    const indentation = header[1];
    const quotePrefix = new RegExp(`^${escapeRegExp(indentation)}>`);
    let endLine = index;
    while (endLine + 1 < lines.length && quotePrefix.test(lines[endLine + 1])) {
      endLine++;
    }

    let blockId: string | undefined;
    let blockIdLine: number | undefined;
    for (let candidate = endLine; candidate >= index; candidate--) {
      const quoted = lines[candidate].match(QUOTED_BLOCK_ID);
      const trailing = lines[candidate].match(TRAILING_BLOCK_ID);
      const match = quoted ?? (isBlockIdLike(trailing?.[1]) ? trailing : null);
      if (match) {
        blockId = match[1];
        blockIdLine = candidate;
        break;
      }
    }
    for (
      let candidate = endLine + 1;
      blockId === undefined && candidate <= Math.min(endLine + 2, lines.length - 1);
      candidate++
    ) {
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

export function calloutsInRange(
  source: string,
  lineStart: number,
  lineEnd: number
): CalloutLocation[] {
  return parseCallouts(source).filter(
    (callout) => callout.startLine >= lineStart && callout.startLine <= lineEnd
  );
}

export function resolveSubmittedCallout(
  callouts: CalloutLocation[],
  initialLocation: CalloutLocation,
  stableBlockId?: string
): CalloutLocation | undefined {
  if (stableBlockId) {
    return callouts.find((candidate) => candidate.blockId === stableBlockId);
  }
  return callouts.find(
    (candidate) =>
      candidate.startLine === initialLocation.startLine &&
      candidate.title === initialLocation.title
  ) ?? callouts.find(
    (candidate) =>
      candidate.title === initialLocation.title &&
      candidate.type.toLocaleLowerCase() === initialLocation.type.toLocaleLowerCase()
  );
}

export function insertBlockId(
  source: string,
  callout: CalloutLocation,
  blockId: string
): string {
  if (callout.blockId) return source;
  const lines = source.split("\n");
  lines.splice(callout.endLine + 1, 0, "", `^${blockId}`);
  return lines.join("\n");
}

export function createBlockId(existingIds: Set<string>): string {
  const cryptoApi = globalThis.crypto;
  do {
    const random = cryptoApi?.getRandomValues
      ? Array.from(cryptoApi.getRandomValues(new Uint8Array(6)), (byte) =>
          byte.toString(16).padStart(2, "0")
        ).join("")
      : Math.random().toString(16).slice(2, 14).padEnd(12, "0");
    const candidate = `concept-${random}`;
    if (!existingIds.has(candidate)) return candidate;
  } while (true);
}

/**
 * A trailing `^token` is only treated as a block ID when it cannot plausibly
 * be exponent notation such as `x ^n`, so math content keeps its meaning.
 */
function isBlockIdLike(value: string | undefined): value is string {
  return value !== undefined && (value.includes("-") || value.length >= 6);
}

function cleanTitle(value: string): string {
  return value
    .replace(/\s+\^[A-Za-z0-9-]+\s*$/, "")
    .replace(/[*_~`[\]]/g, "")
    .trim();
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
