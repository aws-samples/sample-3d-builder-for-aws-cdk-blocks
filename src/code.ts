// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ALL_ON } from "../cdk-blocks/shared";
import { appCode } from "./custom";
import type { Block } from "./types";

export interface CodeLine {
  text: string;
  blockId: string | null;
  key: string;
}

export interface FileSection {
  file: string;
  lines: CodeLine[];
}

/**
 * A block's own lines. The custom Block's depend on its standards key: with required tags off, the
 * app team passes no tag options. Both forms were typechecked and synthesized; the all-on form is the
 * one in blocks.json, and the others come from the custom piece's shared file once it's loaded.
 */
export function codeOf(block: Block, standards: string = ALL_ON): string[] {
  if (!block.custom || standards === ALL_ON) return block.code;
  return appCode(standards)?.lines ?? [];
}

/** Group the snapped blocks' lines by file: one import line per module, then each block's code. */
export function buildSections(blocks: Block[], standards: string = ALL_ON): FileSection[] {
  const files: string[] = [];
  for (const b of blocks) if (!files.includes(b.codeFile)) files.push(b.codeFile);
  return files.map((file) => {
    const mine = blocks.filter((b) => b.codeFile === file);
    const modules: string[] = [];
    for (const b of mine) if (!modules.includes(b.importFrom)) modules.push(b.importFrom);
    const lines: CodeLine[] = modules.map((mod) => {
      const names: string[] = [];
      for (const b of mine) if (b.importFrom === mod && !names.includes(b.importName)) names.push(b.importName);
      return { text: `import { ${names.join(", ")} } from '${mod}';`, blockId: null, key: `import:${mod}` };
    });
    for (const b of mine)
      for (const text of b.extraImports ?? [])
        if (!lines.some((l) => l.text === text)) lines.push({ text, blockId: null, key: `extra:${text}` });
    lines.push({ text: "", blockId: null, key: "gap" });
    for (const b of mine) for (const [i, text] of codeOf(b, standards).entries()) lines.push({ text, blockId: b.id, key: `${b.id}:${i}` });
    return { file, lines };
  });
}

/**
 * The file "Download index.ts" saves, built in the browser with no server call: the code panel's
 * lines, each file's lines under a comment that names the file they belong in.
 */
export function downloadText(sections: FileSection[], customNote: (blockId: string) => string | null = () => null): string {
  const body = (s: FileSection) =>
    s.lines.flatMap((l, i) => {
      // Above a custom Block's first line, one comment says where its package comes from.
      const first = l.blockId !== null && s.lines[i - 1]?.blockId !== l.blockId;
      const note = first ? customNote(l.blockId!) : null;
      return note ? [`// ${note}`, l.text] : [l.text];
    });
  return `${sections.map((s) => [`// ${s.file}`, ...body(s)].join("\n")).join("\n\n")}\n`;
}

/** The comment "Download index.ts" puts above a custom Block's lines. */
export function customNoteFor(blocks: Block[]): (blockId: string) => string | null {
  return (blockId) => {
    const b = blocks.find((x) => x.id === blockId);
    return b?.custom
      ? `${b.label} is a custom Block from a package in this app's workspace: packages/bb-house-bucket (${b.package} ${b.version}). It isn't published: copy the folder, don't install it by name.`
      : null;
  };
}

export type TokenKind = "kw" | "str" | "type" | "num" | "com" | "punct" | "plain";

const KEYWORDS = new Set(["import", "from", "const", "let", "new", "export", "await", "async", "return", "true", "false"]);
const TOKEN =
  /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)|([A-Za-z_$][\w$]*)|(\d+(?:\.\d+)?)|(\s+)|([^\sA-Za-z_$\d]+?)/g;

/** Six token colors by hand; small enough that a highlighter library would only add weight. */
export function tokenize(line: string): { kind: TokenKind; text: string }[] {
  const out: { kind: TokenKind; text: string }[] = [];
  for (const m of line.matchAll(TOKEN)) {
    if (m[1]) out.push({ kind: "com", text: m[1] });
    else if (m[2]) out.push({ kind: "str", text: m[2] });
    else if (m[3]) out.push({ kind: KEYWORDS.has(m[3]) ? "kw" : /^[A-Z]/.test(m[3]) ? "type" : "plain", text: m[3] });
    else if (m[4]) out.push({ kind: "num", text: m[4] });
    else if (m[5]) out.push({ kind: "plain", text: m[5] });
    else out.push({ kind: "punct", text: m[0] });
  }
  return out;
}
