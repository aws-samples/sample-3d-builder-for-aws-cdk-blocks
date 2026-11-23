// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { ALL_ON, PIECE_IDS, type PieceId } from "../cdk-blocks/shared";
import { hasCustom, standardsEntry } from "./custom";
import raw from "./data/page/connections.json";
import { type NamingMode, nodeName, sentenceOf } from "./naming";
import { keyOf } from "./plate";

// Read-only access to the connection data: src/data/page/connections.json, the fields the page reads,
// cut by scripts/split-page-data.mjs from connections.json (a byte copy of the analysis output; a
// test rebuilds the cut and compares it). Every link the page draws, lists or counts is an edge id
// from this data; the page never adds one.
//
// An arrangement with the custom piece has 16 entries, one per standards key. Functions here take
// the key as `std`. All-on (and no key) reads the arrangement's own entry; any other key reads that
// key's K and edge ids from the arrangement's lazily loaded file (src/custom.ts), and is null until
// that file is in memory. It never falls back to the all-on entry.

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: string;
  meaning: string;
  carriers: { from: string[]; to: string[] };
  addedBy: string[];
  evidence: { via: string; detail?: { coversType?: string } }[];
}
interface Pair {
  relation: "direct" | "shared" | "core" | "none";
  commonCoreNodes: string[];
  corePath?: string[];
  sharedParts: string[];
  directEdgeIds: string[];
}
export interface Combo {
  K: number;
  edgeIds: string[];
  membershipEdgeIds: string[];
  nodes: string[];
  pairs: Record<string, Pair>;
  resourcesAdded: number;
}
interface DataNode {
  id: string;
  kind: "piece" | "core" | "shared";
  onPlate: boolean;
  phrase: { exact: string; generic: string };
  resources: { logicalId: string; type: string }[];
  sharedBy?: string[];
}
const file = raw as unknown as { nodes: DataNode[]; edges: Edge[]; combos: Record<string, Combo>; definitions: { K: string } };

const edgeById = new Map(file.edges.map((e) => [e.id, e]));
const nodeById = new Map(file.nodes.map((n) => [n.id, n]));
const typeOfLogicalId = new Map(file.nodes.flatMap((n) => n.resources.map((r) => [r.logicalId, r.type] as const)));

export const isPiece = (id: string): id is PieceId => (PIECE_IDS as readonly string[]).includes(id);

/** The arrangement's entry, or null for an empty plate. A lookup by key, never a sum of single pieces. */
export function comboOf(on: readonly string[], std?: string): Combo | null {
  const key = keyOf(on);
  const base = file.combos[key] ?? null;
  if (!base || !hasCustom(on) || std === undefined || std === ALL_ON) return base;
  const entry = standardsEntry(key, std);
  return entry ? { ...base, K: entry.K, edgeIds: entry.edgeIds, resourcesAdded: entry.resourcesAdded } : null;
}

/** K: the arrangement's count of distinct runtime connections, looked up by key. */
export function connectionCount(on: readonly string[], std?: string): number {
  return comboOf(on, std)?.K ?? 0;
}

/** The arrangement's runtime connections, in the data's order. */
export function edgesOn(on: readonly string[], std?: string): Edge[] {
  return (comboOf(on, std)?.edgeIds ?? []).map((id) => edgeById.get(id)).filter((e): e is Edge => e !== undefined);
}

/**
 * Resources the arrangement adds, for a standards key: a lookup in the pair's own entry, never a sum
 * and never another key's number. Null when the pair's data isn't loaded.
 */
export function pairTotal(on: readonly string[], std: string): number | null {
  return comboOf(on, std)?.resourcesAdded ?? null;
}

/**
 * A grant the template writes as a pattern, not as a reference to one resource, reaches further than
 * the link drawn: the shared role's grant to invoke the agent runtime is "runtime/*", every agent
 * runtime in the account. The Agent Block also lets that role call every foundation model and
 * inference profile, in every arrangement that has it. The data marks such an edge (every evidence row is `via: "wildcard"`), and
 * the page says so in plain words wherever it names the link.
 */
export function edgeNote(edgeId: string): string | null {
  const e = edgeById.get(edgeId);
  if (!e || e.evidence.length === 0 || !e.evidence.every((row) => row.via === "wildcard")) return null;
  const agent = e.evidence.every((row) => row.detail?.coversType === "AWS::BedrockAgentCore::Runtime");
  return agent
    ? "The grant in the template covers any agent runtime in the account, not only this one. The same role may also call any AI model the account can use, not only the agent's."
    : "The grant in the template is a pattern: it covers every resource of that kind in the account, not only this one.";
}

/** A connection's sentence, followed by its note when the data has one. */
export function meaningOf(edgeId: string, mode: NamingMode): string {
  const note = edgeNote(edgeId);
  return note ? `${sentenceOf(edgeId, mode)} ${note}` : sentenceOf(edgeId, mode);
}

/** What a visitor has tapped: a node (piece, core socket or shared part) or one link. */
export type Focus = { kind: "node"; id: string } | { kind: "edge"; id: string } | null;

/**
 * The edge ids a focus lights. A link lights itself. A node lights every link that ends on it. A piece
 * also lights the links of the shared parts it brings, since those parts are part of what it adds.
 */
export function litEdges(focus: Focus, on: readonly string[], std?: string): string[] {
  const combo = comboOf(on, std);
  if (!focus || !combo) return [];
  if (focus.kind === "edge") return combo.edgeIds.includes(focus.id) ? [focus.id] : [];
  const ends = new Set([focus.id]);
  if (isPiece(focus.id)) for (const part of partsOf(focus.id, on)) ends.add(part);
  return combo.edgeIds.filter((id) => {
    const e = edgeById.get(id);
    return e !== undefined && (ends.has(e.from) || ends.has(e.to));
  });
}

/** The shared parts a piece brings in this arrangement. */
function partsOf(piece: string, on: readonly string[]): string[] {
  const combo = comboOf(on);
  if (!combo) return [];
  return combo.membershipEdgeIds
    .map((id) => edgeById.get(id))
    .filter((e): e is Edge => e !== undefined && e.from === piece)
    .map((e) => e.to);
}

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const pieceName = (id: string, mode: NamingMode) => nodeById.get(id)?.phrase[mode] ?? id;

/**
 * How two pieces on the plate relate, in plain words, from the arrangement's `pairs` entry. No template
 * has a direct link between two pieces, so this says what they do have in common and never hints at a wire.
 */
export function pairLine(a: string, b: string, on: readonly string[], mode: NamingMode): string | null {
  const combo = comboOf(on);
  const pair = combo?.pairs[keyOf([a, b])];
  if (!pair) return null;
  const [first, second] = keyOf([a, b]).split("+");
  const names = `${pieceName(first, mode)} and ${pieceName(second, mode)}`;
  const both = names.charAt(0).toUpperCase() + names.slice(1);
  if (pair.relation === "direct") return `${both} have a direct link: ${pair.directEdgeIds.map((id) => meaningOf(id, mode)).join(" ")}`;
  if (pair.relation === "shared")
    return `${both} have no direct link. They share ${list(pair.sharedParts.map((p) => nodeName(p, mode).replace(/^the shared /, "the ")))}, created once, and both plug into the app.`;
  if (pair.relation === "core") {
    const through =
      pair.commonCoreNodes.length > 0
        ? `both plug into ${list(pair.commonCoreNodes.map((n) => nodeName(n, mode)))}`
        : `they plug into different parts of it (${list((pair.corePath ?? []).map((n) => nodeName(n, mode)))})`;
    return `${both} connect only through the app: ${through}.`;
  }
  return `${both} have nothing between them.`;
}

/** The pair lines for one piece against every other piece on the plate. */
export function pairLines(piece: string, on: readonly string[], mode: NamingMode): string[] {
  return on
    .filter((other) => other !== piece)
    .map((other) => pairLine(piece, other, on, mode))
    .filter((l): l is string => l !== null);
}

export interface Mark {
  edgeId: string;
  meaning: string;
  sentence: string;
  /** True when the resource belongs to a shared part the piece brings, not to the piece alone. */
  shared: boolean;
}

/**
 * For an open piece: which of its resource types carry a link, and which links. Read from each edge's
 * `carriers` (logical ids at each end) for the piece's own end and for the shared parts it brings.
 */
export function carrierMarks(piece: string, on: readonly string[], mode: NamingMode, std?: string): Map<string, Mark[]> {
  const marks = new Map<string, Mark[]>();
  const parts = new Set(partsOf(piece, on));
  for (const e of edgesOn(on, std)) {
    for (const [end, ids] of [
      [e.from, e.carriers.from],
      [e.to, e.carriers.to],
    ] as const) {
      const shared = parts.has(end);
      if (end !== piece && !shared) continue;
      for (const type of new Set(ids.map((id) => typeOfLogicalId.get(id)).filter((t): t is string => t !== undefined))) {
        const row = marks.get(type) ?? [];
        if (!row.some((m) => m.edgeId === e.id)) row.push({ edgeId: e.id, meaning: e.meaning, sentence: meaningOf(e.id, mode), shared });
        marks.set(type, row);
      }
    }
  }
  return marks;
}

/** The same marks for one piece, by the logical id of the resource that carries each link. */
export function carrierMarksById(piece: string, on: readonly string[], mode: NamingMode, std?: string): Map<string, Mark[]> {
  const marks = new Map<string, Mark[]>();
  for (const e of edgesOn(on, std)) {
    for (const [end, ids] of [
      [e.from, e.carriers.from],
      [e.to, e.carriers.to],
    ] as const) {
      if (end !== piece) continue;
      for (const id of ids)
        marks.set(id, [...(marks.get(id) ?? []), { edgeId: e.id, meaning: e.meaning, sentence: meaningOf(e.id, mode), shared: false }]);
    }
  }
  return marks;
}

/** The nodes on the plate that aren't pieces, for the Connections list: the core sockets, then the shared parts present. */
export function plugNodes(on: readonly string[], std?: string): { id: string; kind: "core" | "shared"; links: number }[] {
  const combo = comboOf(on);
  const edges = edgesOn(on, std);
  const count = (id: string) => edges.filter((e) => e.from === id || e.to === id).length;
  const core = file.nodes
    .filter((n) => n.kind === "core" && n.onPlate)
    .map((n) => ({ id: n.id, kind: "core" as const, links: count(n.id) }));
  const shared = (combo?.nodes ?? [])
    .filter((id) => nodeById.get(id)?.kind === "shared")
    .map((id) => ({ id, kind: "shared" as const, links: count(id) }));
  return [...core, ...shared];
}

/** A node as the subject of a sentence: "the Agent Block", "the Hosting construct", "the app's shared role". */
export const nodePhrase = (id: string, mode: NamingMode): string => nodeById.get(id)?.phrase[mode] ?? nodeName(id, mode);

/** The lead resource type of a core socket or shared part: the type whose icon stands for it. */
export const LEAD_TYPE: Record<string, string> = {
  "core:role": "AWS::IAM::Role",
  "core:handler": "AWS::Lambda::Function",
  "core:config": "AWS::S3::Bucket",
  "core:api": "AWS::ApiGateway::RestApi",
  "shared:websocket": "AWS::ApiGatewayV2::Api",
  "shared:index-setup": "AWS::StepFunctions::StateMachine",
};

/** Guard for LEAD_TYPE: each lead type really is a resource of its node in the data. */
export const leadTypeInData = (id: string) => nodeById.get(id)?.resources.some((r) => r.type === LEAD_TYPE[id]) ?? false;

/** The count line's parts and its text, from the data. N and K are lookups by arrangement key. */
export function countLine(
  on: readonly string[],
  resources: number | null,
  lines: number,
  mode: NamingMode,
  std?: string,
): { resources: number | null; connections: number; lines: number; text: string } {
  const k = connectionCount(on, std);
  const noun = mode === "exact" ? "AWS resource" : "resource";
  const text = `${resources ?? "?"} ${noun}${resources === 1 ? "" : "s"}, ${k} connection${k === 1 ? "" : "s"} from ${lines} line${lines === 1 ? "" : "s"} of TypeScript`;
  return { resources, connections: k, lines, text };
}
