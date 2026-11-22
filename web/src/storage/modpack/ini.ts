// Applies the INI part of a mod pack (docs/mod-packs.md §2, `enc_diff`): the
// pack stores only changed keys, so the player's own copy is the base and the
// diff is laid over it. Independent implementation; MIT.

export interface IniSection {
  /** the header as written, including the brackets */
  header: string;
  lines: string[];
}

export interface IniDocument {
  eol: string;
  preamble: string[];
  sections: IniSection[];
}

export function parseIniDocument(data: Uint8Array): IniDocument {
  const text = latin1(data);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const doc: IniDocument = { eol, preamble: [], sections: [] };
  let current: IniSection | null = null;
  for (const line of lines) {
    const header = /^\s*\[([^\]]*)\]/.exec(line);
    if (header) {
      current = { header: line.trim(), lines: [] };
      doc.sections.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      doc.preamble.push(line);
    }
  }
  return doc;
}

export function serializeIniDocument(doc: IniDocument): Uint8Array {
  const lines = [...doc.preamble];
  for (const section of doc.sections) {
    if (lines.length && lines[lines.length - 1] !== "") lines.push("");
    lines.push(section.header);
    lines.push(...section.lines);
  }
  if (lines.length && lines[lines.length - 1] !== "") lines.push("");
  return encodeLatin1(lines.join(doc.eol));
}

/**
 * Lays `diff` over `base`: each changed key is replaced where it already is,
 * each new key and section is appended. Deleting a key is not representable in
 * a pack diff, so nothing is removed.
 */
export function applyIniDiff(base: Uint8Array, diff: Uint8Array): Uint8Array {
  const target = parseIniDocument(base);
  const changes = parseIniDocument(diff);
  for (const section of changes.sections) {
    const name = sectionName(section.header);
    let targetSection = target.sections.find(
      (candidate) => sectionName(candidate.header).toLowerCase() === name.toLowerCase(),
    );
    if (!targetSection) {
      targetSection = { header: `[${name}]`, lines: [] };
      target.sections.push(targetSection);
    }
    for (const line of section.lines) {
      const pair = splitKey(line);
      if (!pair) continue;
      const at = targetSection.lines.findIndex((candidate) => {
        const existing = splitKey(candidate);
        return existing !== null && existing.key.toLowerCase() === pair.key.toLowerCase();
      });
      if (at >= 0) {
        const existing = splitKey(targetSection.lines[at]!);
        targetSection.lines[at] = `${existing?.key ?? pair.key}=${pair.value}`;
      } else {
        targetSection.lines.push(`${pair.key}=${pair.value}`);
      }
    }
  }
  return serializeIniDocument(target);
}

/** `name=value` lines (a text entry in the string-table category). */
export function parseTextPairs(data: Uint8Array): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const line of latin1(data).split(/\r?\n/)) {
    const pair = splitKey(line);
    if (pair) out.push({ name: pair.key, value: pair.value });
  }
  return out;
}

function splitKey(line: string): { key: string; value: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#") || trimmed.startsWith("["))
    return null;
  const equals = line.indexOf("=");
  if (equals < 0) return null;
  return { key: line.slice(0, equals).trim(), value: line.slice(equals + 1).trim() };
}

function sectionName(header: string): string {
  return /^\s*\[([^\]]*)\]/.exec(header)?.[1]?.trim() ?? header;
}

function latin1(data: Uint8Array): string {
  let text = "";
  for (const value of data) text += String.fromCharCode(value);
  return text;
}

function encodeLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}
