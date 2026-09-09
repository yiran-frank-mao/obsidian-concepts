export interface AliasSpan {
  start: number;
  end: number;
}

export interface CompiledAlias {
  readonly alias: string;
  readonly isRegex: boolean;
  /**
   * Literal aliases must sit between word boundaries to match, while a regex
   * alias is expected to express its own boundaries.
   */
  readonly requiresWordBoundaries: boolean;
  matchesWhole(text: string): boolean;
  findSpans(line: string): AliasSpan[];
}

const REGEX_ALIAS = /^\/(.+)\/([A-Za-z]*)$/s;

const cache = new Map<string, CompiledAlias | undefined>();

/**
 * Aliases written as `/pattern/flags` are treated as JavaScript regular
 * expressions, the flavour that regex101 calls “JavaScript”. Everything else
 * is matched literally. An unparsable pattern compiles to `undefined` so one
 * bad alias cannot break linking for the rest of the vault.
 */
export function compileAlias(
  alias: string,
  caseSensitive: boolean
): CompiledAlias | undefined {
  const key = `${caseSensitive ? "cs" : "ci"}:${alias}`;
  if (!cache.has(key)) cache.set(key, buildAlias(alias, caseSensitive));
  return cache.get(key);
}

export function isRegexAlias(alias: string): boolean {
  return REGEX_ALIAS.test(alias.trim());
}

function buildAlias(alias: string, caseSensitive: boolean): CompiledAlias | undefined {
  const trimmed = alias.trim();
  if (!trimmed) return undefined;
  const pattern = trimmed.match(REGEX_ALIAS);
  return pattern
    ? regexAlias(trimmed, pattern[1], pattern[2], caseSensitive)
    : literalAlias(trimmed, caseSensitive);
}

function regexAlias(
  alias: string,
  source: string,
  flags: string,
  caseSensitive: boolean
): CompiledAlias | undefined {
  const requested = new Set(flags.split(""));
  if (!caseSensitive) requested.add("i");
  const base = [...requested].filter((flag) => flag !== "g").join("");
  try {
    const scanning = new RegExp(source, `${base}g`);
    const whole = new RegExp(`^(?:${source})$`, base);
    return {
      alias,
      isRegex: true,
      requiresWordBoundaries: false,
      matchesWhole: (text) => whole.test(text),
      findSpans: (line) => {
        const spans: AliasSpan[] = [];
        scanning.lastIndex = 0;
        let match = scanning.exec(line);
        while (match) {
          if (match[0].length > 0) {
            spans.push({ start: match.index, end: match.index + match[0].length });
          } else {
            scanning.lastIndex++;
          }
          match = scanning.exec(line);
        }
        return spans;
      }
    };
  } catch {
    return undefined;
  }
}

function literalAlias(alias: string, caseSensitive: boolean): CompiledAlias {
  const sought = caseSensitive ? alias : alias.toLocaleLowerCase();
  return {
    alias,
    isRegex: false,
    requiresWordBoundaries: true,
    matchesWhole: (text) =>
      (caseSensitive ? text : text.toLocaleLowerCase()) === sought,
    findSpans: (line) => {
      const haystack = caseSensitive ? line : line.toLocaleLowerCase();
      const spans: AliasSpan[] = [];
      let start = haystack.indexOf(sought);
      while (start >= 0) {
        spans.push({ start, end: start + sought.length });
        start = haystack.indexOf(sought, start + 1);
      }
      return spans;
    }
  };
}
