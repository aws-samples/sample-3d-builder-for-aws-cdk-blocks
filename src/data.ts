// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { NamingMode } from "../cdk-blocks/shared";
import raw from "./data/blocks.json";
import copy from "./data/copy.json";
import type { Block, BlocksData } from "./types";

// Every block fact on the page comes from blocks.json, a byte copy of synth/blocks.json.
// copy.json replaces wording only (caseNote, and a block's note or tagline), never a number, type or code line.
const base = raw as BlocksData;
type BlockWording = Record<string, { note?: string; tagline?: string }>;
const wording = copy as { caseNote?: string; blocks?: BlockWording; generic?: { blocks?: BlockWording } };
export const data: BlocksData = {
  ...base,
  caseNote: wording.caseNote ?? base.caseNote,
  blocks: base.blocks.map((b) => ({ ...b, ...wording.blocks?.[b.id] })),
};

// Presentation only: brick colors by position, slot grid on the baseplate.
const BRICK_COLORS = ["#ff8a4c", "#35b8a6", "#f5c044", "#ea6fa8", "#5aa9f0", "#86c95b", "#b79cf5", "#f2917f"];

export { BRICK, CUSTOM_LAYER, STUD } from "./plate";

// The custom layer on a custom Block's brick. A cool neutral gray: not an AWS category color, since a
// custom Block isn't an AWS service, and the layer carries no icon. A test checks the value.
export const CUSTOM_LAYER_COLOR = "#A7B0BA";
export const CUSTOM_PLATE_COLOR = "#EEF1F4";
/** The words on the custom layer's label plate. An HTML label, the same for everyone; no visitor text is taken or stored. */
export const TEAM_LABEL = "Your team";
const HEADLINE_MAX = 6;

let brickColors = BRICK_COLORS;

export function colorOf(index: number): string {
  return brickColors[index % brickColors.length];
}

/** Swap the brick colors. A theme does this (src/variants.ts). */
export function setBrickColors(colors: string[]): void {
  brickColors = colors;
}

export function headline(block: Block) {
  return block.resources.slice(0, HEADLINE_MAX);
}

export function resourceTotal(block: Block): number {
  return block.resources.reduce((sum, r) => sum + r.count, 0) + block.supportingCount;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Resources the snapped arrangement adds to the stack, looked up from the synth results.
 * Blocks share resources, so this is never a sum of per-block totals; null when the JSON has no entry.
 */
export function stackTotal(on: string[]): number | null {
  if (on.length === 0) return 0;
  const key = data.blocks
    .filter((b) => on.includes(b.id))
    .map((b) => b.id)
    .join("+");
  return data.comboAdded?.[key] ?? null;
}

/**
 * A block's tagline and note in a naming mode. Generic mode swaps in the wording under "generic" in
 * copy.json where the usual wording names a service; everything else is the same in both modes.
 */
export function blockText(block: Block, mode: NamingMode): { tagline: string; note: string | null } {
  const generic = mode === "generic" ? wording.generic?.blocks?.[block.id] : undefined;
  return { tagline: generic?.tagline ?? block.tagline, note: generic?.note ?? block.note ?? null };
}
