// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { CUSTOM_PIECE, type NamingMode, STANDARD_IDS, type StandardId, standardsOfKey } from "../cdk-blocks/shared";
import { typeLabel } from "./naming";

// The custom piece: HouseBucket, a custom Block built on FileBucket, with four standards a visitor
// can switch. Every (arrangement, standards) pair was synthesized, and this file only looks things
// up in the page files that scripts/split-page-data.mjs cut from custom.json and connections.json.
// It never computes a resource, a property or a link. No three.js and no import.meta here, so the
// tests can import it; src/custom-loader.ts does the lazy loading and hands the files to register().

export type Standards = StandardId[] | "always";
export type MarkKind = "base" | "changed" | "added";

export interface Change {
  property: string;
  standards: Standards;
  before?: unknown;
  beforeNotSet?: boolean;
  after?: unknown;
  afterNotSet?: boolean;
}
export interface ResourceRecord {
  logicalId: string;
  type: string;
  /** The construct path under the app, from the template: it says which part of the Block this is. */
  path: string;
  mark: MarkKind;
  /** What brought an added resource: standards, or "always". A base or changed resource has none. */
  standards?: Standards;
  /** Properties of an added resource that need more standards than the resource itself (its tags). */
  propertyStandards?: { property: string; standards: StandardId[] }[];
  changes?: Change[];
}
export interface Statement {
  actions: string[];
  /** Logical ids the statement's Resource points at. */
  targets: string[];
  standards?: Standards;
}
export interface OutsideRecord {
  logicalId: string;
  type: string;
  kind: "added" | "changed";
  standards?: Standards;
  statementsAdded?: Statement[];
  statementsRemoved?: Statement[];
  changes?: Change[];
}
interface FileEntry {
  resourcesAdded: number;
  resourcesAddedToBaseline: number;
  K: number;
  edges: number;
  resources: string[];
  outside: string[];
}
export interface ArrangementFile {
  arrangement: string;
  standards: Record<string, FileEntry>;
  edgeSets: string[][];
  records: Record<string, ResourceRecord>;
  outside: Record<string, OutsideRecord>;
  types: Record<string, string>;
}
export interface AddedBy {
  standard: StandardId;
  kind: "added" | "changed";
}
export interface SharedFile {
  piece: { id: string; label: string; package: string; builtOn: string };
  standardsOrder: StandardId[];
  standardsKeys: string[];
  allOn: string;
  standards: { id: StandardId; label: string }[];
  runtimeRules: { heading: string; rules: string[] };
  code: {
    app: Record<string, { file: string; imports: string[]; lines: string[] }>;
    platform: Record<string, { file: string; startLine: number; lines: string[]; addedBy: (AddedBy | null)[] }>;
  };
  reference: { code: string[]; importFrom: string; resources: { logicalId: string; type: string }[] };
  missingTag: { code: string[]; exitCode: number; error: string };
}

const files = new Map<string, ArrangementFile>();
let shared: SharedFile | null = null;

export function register(file: ArrangementFile): void {
  files.set(file.arrangement, file);
}
export function registerShared(file: SharedFile): void {
  shared = file;
}
export const sharedData = (): SharedFile | null => shared;
/** True when this arrangement's standards data is in memory (and the shared file with it). */
export const isLoaded = (arrangement: string): boolean => shared !== null && files.has(arrangement);
export const hasCustom = (on: readonly string[]): boolean => on.includes(CUSTOM_PIECE);
const isStandardsKey = (key: string): boolean => standardsOfKey(key) !== null;

export interface StandardsEntry {
  arrangement: string;
  standards: string;
  /** Resources the arrangement adds to an app with no Blocks, for this standards key. A lookup. */
  resourcesAdded: number;
  K: number;
  edgeIds: string[];
  /** The custom piece's own resources, each with its mark. */
  resources: ResourceRecord[];
  /** What the custom piece adds or changes outside its own construct. */
  outside: OutsideRecord[];
  /** Logical id to type, for what the outside statements point at. */
  types: Record<string, string>;
}

/**
 * One (arrangement, standards) pair, or null when its file isn't loaded or the key isn't one of the
 * 16. Never falls back to another key's data.
 */
export function standardsEntry(arrangement: string, standards: string): StandardsEntry | null {
  const file = files.get(arrangement);
  const entry = file?.standards[standards];
  if (!file || !entry || !isStandardsKey(standards)) return null;
  return {
    arrangement,
    standards,
    resourcesAdded: entry.resourcesAdded,
    K: entry.K,
    edgeIds: file.edgeSets[entry.edges],
    // In the order of the Block's parts: the files, their policy, the access logs, the key, the audit trail.
    resources: entry.resources.map((id) => file.records[id]).sort((a, b) => partOrder(a) - partOrder(b)),
    outside: entry.outside.map((id) => file.outside[id]),
    types: file.types,
  };
}

/** A switch flip: the key with one standard turned on or off. */
export function toggled(standards: string, id: StandardId): string {
  const now = standardsOfKey(standards) ?? [...STANDARD_IDS];
  const next = now.includes(id) ? now.filter((s) => s !== id) : [...now, id];
  const ordered = STANDARD_IDS.filter((s) => next.includes(s));
  return ordered.length === 0 ? "none" : ordered.join("+");
}

/** The app team's lines for a standards key, as typechecked and synthesized. Null until the shared file is loaded. */
export function appCode(standards: string): { imports: string[]; lines: string[] } | null {
  return shared?.code.app[standards] ?? null;
}
/** The platform team's constructor for a standards key, cut from the generated Block file, with what each standard added. */
export function platformCode(standards: string): { file: string; startLine: number; lines: string[]; addedBy: (AddedBy | null)[] } | null {
  return shared?.code.platform[standards] ?? null;
}

export const standardLabel = (id: StandardId): string => shared?.standards.find((s) => s.id === id)?.label ?? id;

/** "always there", "Access logging", "Encryption with your own key and Required tags". */
export function standardsText(standards: Standards | undefined): string {
  if (standards === undefined) return "";
  if (standards === "always") return "always there";
  const names = standards.map(standardLabel);
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// ─── Words for the parts of the Block ────────────────────────────────────────
// Which part of the Block a resource is, from its construct path in the template. These short names
// are ours; the type name next to them comes from naming.json.
const PARTS: [RegExp, string][] = [
  [/\/files\/bucket\/Resource$/, "Your files"],
  [/\/files\/bucket\/Policy\/Resource$/, "Your files, access policy"],
  [/\/files\/access-logs\/Resource$/, "Access logs"],
  [/\/files\/access-logs\/Policy\/Resource$/, "Access logs, access policy"],
  [/\/files\/key\/Resource$/, "Your own key"],
  [/\/audit\/table\/Resource$/, "Audit trail"],
];
export const partName = (record: { path: string }): string => PARTS.find(([re]) => re.test(record.path))?.[1] ?? "Part of the Block";
function partOrder(record: { path: string }): number {
  const i = PARTS.findIndex(([re]) => re.test(record.path));
  return i < 0 ? PARTS.length : i;
}

/** The standards that changed a resource, across its changes, in the fixed order. */
function changedBy(record: ResourceRecord): StandardId[] {
  const all = (record.changes ?? []).flatMap((c) => (c.standards === "always" ? [] : c.standards));
  return STANDARD_IDS.filter((id) => all.includes(id));
}

/** The mark under a tile and in the lists: the mark word and what caused it, in a few words. */
export function markText(record: ResourceRecord): { kind: MarkKind; text: string } {
  if (record.mark === "base") return { kind: "base", text: "base, as FileBucket makes it" };
  if (record.mark === "added")
    return {
      kind: "added",
      text: record.standards === "always" ? "added, always there" : `added by ${(record.standards ?? []).join(" + ")}`,
    };
  const by = changedBy(record);
  return { kind: "changed", text: by.length > 2 ? `changed by ${by.length} standards` : `changed by ${by.join(" + ")}` };
}

// ─── Before and after, as the leaves that differ ─────────────────────────────

export interface Leaf {
  path: string;
  before: string | null;
  after: string | null;
  /** The logical id a value points at, when it's a reference to another resource in the template. */
  pointsAt?: string;
}

const refOf = (v: unknown): string | null => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== 1) return null;
  if (typeof o.Ref === "string") return o.Ref;
  const att = o["Fn::GetAtt"];
  return Array.isArray(att) && typeof att[0] === "string" ? att[0] : null;
};
const isTagList = (v: unknown): v is { Key: string; Value: unknown }[] =>
  Array.isArray(v) &&
  v.length > 0 &&
  v.every((t) => t && typeof t === "object" && typeof (t as { Key?: unknown }).Key === "string" && "Value" in (t as object));

function flatten(value: unknown, path: string, out: Map<string, { text: string; ref?: string }>): void {
  const ref = refOf(value);
  if (ref) out.set(path, { text: ref, ref });
  else if (isTagList(value)) for (const t of value) flatten(t.Value, `${path}${path ? "." : ""}${t.Key}`, out);
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) flatten(v, `${path}[${i}]`, out);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) flatten(v, `${path}${path ? "." : ""}${k}`, out);
  else out.set(path, { text: String(value) });
}

/**
 * The leaves of a changed property that differ between the plain FileBucket and this variant. Both
 * values are the template's own; this only walks them. A tag list is read as key and value pairs, and
 * a reference to another resource is kept as its logical id.
 */
export function leavesOf(change: Change): Leaf[] {
  const before = new Map<string, { text: string; ref?: string }>();
  const after = new Map<string, { text: string; ref?: string }>();
  if (!change.beforeNotSet && change.before !== undefined) flatten(change.before, "", before);
  if (!change.afterNotSet && change.after !== undefined) flatten(change.after, "", after);
  const out: Leaf[] = [];
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path);
    const a = after.get(path);
    if (b?.text === a?.text) continue;
    out.push({ path, before: b?.text ?? null, after: a?.text ?? null, ...(a?.ref ? { pointsAt: a.ref } : {}) });
  }
  return out;
}

/** A word that names an AWS service, in any letter case, for text made from template values. */
export const SERVICE_TEXT =
  /(dynamodb|aurora|\brds\b|cognito|bedrock|agentcore|\bs3\b|s3:|cloudfront|cloudwatch|cloudformation|lambda|\biam\b|kms|\bsns\b|\bsqs\b|api ?gateway|secrets ?manager|step ?functions|eventbridge|\bssm\b|\bvpc\b|\bec2\b|aws:)/i;

// Plain names for the four properties the standards touch. Ours, and the same in both naming modes.
const PROPERTY_WORDS: Record<string, string> = {
  "Properties.BucketEncryption": "Encryption",
  "Properties.LifecycleConfiguration": "Expiry rules",
  "Properties.LoggingConfiguration": "Access logging",
  "Properties.Tags": "Tags",
  DependsOn: "Deploy order",
};
export const propertyWord = (property: string): string => PROPERTY_WORDS[property] ?? property.replace(/^Properties\./, "");

export interface ChangeLine {
  /** The property, in plain words. */
  word: string;
  /** The template's own property path. Shown in Exact naming only. */
  property: string;
  standards: Standards;
  rows: { path: string; before: string; after: string }[];
  /** Rows left out in Generic naming because their text names a service. */
  hidden: number;
}

/**
 * One changed property as lines of text. Exact naming shows every leaf as the template has it. Generic
 * naming shows a reference as the generic name of what it points at, and leaves out a leaf whose text
 * names a service (the count of those is kept, so the page can say they're there).
 */
export function changeLine(change: Change, mode: NamingMode, typeOfId: (logicalId: string) => string | undefined): ChangeLine {
  const rows: ChangeLine["rows"] = [];
  let hidden = 0;
  for (const leaf of leavesOf(change)) {
    const before = leaf.before ?? "not set";
    const target = leaf.pointsAt ? typeOfId(leaf.pointsAt) : undefined;
    if (mode === "exact") {
      rows.push({
        path: leaf.path,
        before,
        after: leaf.pointsAt ? `${leaf.pointsAt}${target ? ` (${typeLabel(target, mode)})` : ""}` : (leaf.after ?? "not set"),
      });
      continue;
    }
    if (leaf.pointsAt && target) {
      rows.push({ path: "points at", before, after: `this Block's ${typeLabel(target, mode).toLowerCase()}` });
      continue;
    }
    const text = `${leaf.path} ${before} ${leaf.after ?? ""}`;
    if (leaf.pointsAt || SERVICE_TEXT.test(text)) hidden += 1;
    else rows.push({ path: leaf.path, before, after: leaf.after ?? "not set" });
  }
  return { word: propertyWord(change.property), property: change.property, standards: change.standards, rows, hidden };
}

/** One statement the custom piece adds to (or moves out of) a policy outside its construct, in words. */
export function statementText(s: Statement, mode: NamingMode, types: Record<string, string>): string {
  const targets = [...new Set(s.targets.map((id) => types[id]).filter((t): t is string => t !== undefined))].map((t) =>
    typeLabel(t, mode).toLowerCase(),
  );
  const on = targets.length > 0 ? ` on ${targets.length === 1 ? "the" : "these:"} ${targets.join(", ")}` : "";
  if (mode === "exact") return `${s.actions.join(", ")}${on}`;
  return `${s.actions.length} ${s.actions.length === 1 ? "action" : "actions"}${on}`;
}
