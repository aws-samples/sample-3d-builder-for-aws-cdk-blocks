// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * npm run data:split
 *
 * Cuts the page's data out of the two big byte copies, src/data/custom.json and
 * src/data/connections.json, so the first screen doesn't download every arrangement:
 *
 *   src/data/page/connections.json      only the fields the page reads, loaded with the page
 *   src/data/page/custom/shared.json    the standards, the run-time rules and both code sides
 *   src/data/page/custom/<key>.json     one file per arrangement with the custom piece: its 16
 *                                       standards states, loaded when the piece goes on the plate
 *
 * Nothing is added and no value is changed: every field is copied, or left out. The paths of the synth-run
 * files the data was read from are left out. The output is committed, and test/custom.test.ts runs split() again
 * and compares every file byte for byte, so the split can't drift from the byte copies.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const PAGE_DIR = 'src/data/page';

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

/** Logical ids a policy statement's Resource points at, in order, without repeats. */
function targetsOf(value, out = []) {
  if (Array.isArray(value)) for (const v of value) targetsOf(v, out);
  else if (value && typeof value === 'object') {
    if (typeof value.Ref === 'string' && !out.includes(value.Ref)) out.push(value.Ref);
    const att = value['Fn::GetAtt'];
    if (Array.isArray(att) && typeof att[0] === 'string' && !out.includes(att[0])) out.push(att[0]);
    for (const [k, v] of Object.entries(value)) if (k !== 'Ref' && k !== 'Fn::GetAtt') targetsOf(v, out);
  }
  return out;
}

const statement = (s) => ({
  actions: [].concat(s.statement.Action),
  targets: targetsOf(s.statement.Resource),
  ...(s.standards !== undefined ? { standards: s.standards } : {}),
});

/** A resource record of the custom piece. `path` is the construct path from the template, not a file path. */
const resourceRecord = (r) => ({
  ...pick(r, ['logicalId', 'type', 'path', 'mark', 'standards', 'propertyStandards']),
  ...(r.changes
    ? { changes: r.changes.map((c) => pick(c, ['property', 'standards', 'before', 'beforeNotSet', 'after', 'afterNotSet'])) }
    : {}),
});

/** A change the custom piece makes outside its own construct. */
const outsideRecord = (o) => ({
  ...pick(o, ['logicalId', 'type', 'kind', 'standards']),
  ...(o.statementsAdded ? { statementsAdded: o.statementsAdded.map(statement) } : {}),
  ...(o.statementsRemoved ? { statementsRemoved: o.statementsRemoved.map(statement) } : {}),
  ...(o.changes ? { changes: o.changes.map((c) => pick(c, ['property', 'standards', 'before', 'after'])) } : {}),
});

/**
 * Every page file, as a map from its path under the app root to its exact text.
 * @param {any} custom       parsed src/data/custom.json
 * @param {any} connections  parsed src/data/connections.json
 * @returns {Map<string, string>}
 */
export function split(custom, connections) {
  const files = new Map();
  const put = (name, value) => files.set(`${PAGE_DIR}/${name}`, `${JSON.stringify(value)}\n`);

  // The connection data the page reads on every visit.
  put('connections.json', {
    definitions: { K: connections.definitions.K },
    nodes: connections.nodes.map((n) => ({
      ...pick(n, ['id', 'kind', 'onPlate', 'phrase', 'sharedBy']),
      resources: n.resources.map((r) => pick(r, ['logicalId', 'type'])),
    })),
    edges: connections.edges.map((e) => ({
      ...pick(e, ['id', 'from', 'to', 'kind', 'meaning', 'carriers', 'addedBy']),
      evidence: e.evidence.map((row) => ({
        via: row.via,
        ...(row.detail?.coversType ? { detail: { coversType: row.detail.coversType } } : {}),
      })),
    })),
    combos: Object.fromEntries(
      Object.entries(connections.combos).map(([key, c]) => [
        key,
        pick(c, ['K', 'edgeIds', 'membershipEdgeIds', 'nodes', 'pairs', 'resourcesAdded']),
      ]),
    ),
  });

  // What every arrangement with the custom piece shares.
  put('custom/shared.json', {
    piece: pick(custom.piece, ['id', 'label', 'package', 'builtOn']),
    standardsOrder: custom.standardsOrder,
    standardsKeys: custom.standardsKeys,
    allOn: custom.allOn,
    standards: custom.standards.map((s) => pick(s, ['id', 'label'])),
    runtimeRules: { heading: custom.runtimeRules.heading, rules: custom.runtimeRules.rules.map((r) => r.label) },
    code: {
      app: Object.fromEntries(Object.entries(custom.code.app).map(([k, v]) => [k, pick(v, ['file', 'imports', 'lines'])])),
      platform: Object.fromEntries(
        Object.entries(custom.code.platform).map(([k, v]) => [k, pick(v, ['file', 'startLine', 'lines', 'addedBy'])]),
      ),
    },
    reference: {
      code: custom.reference.code,
      importFrom: custom.reference.importFrom,
      resources: custom.reference.resources.map((r) => pick(r, ['logicalId', 'type'])),
    },
    missingTag: pick(custom.missingTag, ['code', 'exitCode', 'error']),
  });

  const typeOf = new Map(connections.nodes.flatMap((n) => n.resources.map((r) => [r.logicalId, r.type])));
  for (const [arrangement, byStandards] of Object.entries(custom.pairs)) {
    const allOn = connections.combos[arrangement];
    const edgeSets = [];
    const records = {};
    const outside = {};
    const types = {};
    const standards = {};
    for (const key of custom.standardsKeys) {
      const pair = byStandards[key];
      // connections.py's rule: combosByStandards holds only the fields that differ from the all-on entry.
      const merged = { ...allOn, ...(key === custom.allOn ? {} : connections.combosByStandards[arrangement][key]) };
      const text = JSON.stringify(merged.edgeIds);
      let set = edgeSets.findIndex((s) => JSON.stringify(s) === text);
      if (set < 0) set = edgeSets.push(merged.edgeIds) - 1;
      for (const id of pair.resources) records[id] ??= resourceRecord(custom.resources[id]);
      for (const id of pair.outside) outside[id] ??= outsideRecord(custom.outside[id]);
      standards[key] = {
        resourcesAdded: merged.resourcesAdded,
        resourcesAddedToBaseline: pair.resourcesAddedToBaseline,
        K: merged.K,
        edges: set,
        resources: pair.resources,
        outside: pair.outside,
      };
    }
    for (const o of Object.values(outside))
      for (const s of [...(o.statementsAdded ?? []), ...(o.statementsRemoved ?? [])])
        for (const t of s.targets) if (typeOf.has(t)) types[t] = typeOf.get(t);
    put(`custom/${arrangement}.json`, { arrangement, standards, edgeSets, records, outside, types });
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const read = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const files = split(read('src/data/custom.json'), read('src/data/connections.json'));
  rmSync(join(root, PAGE_DIR), { recursive: true, force: true });
  let bytes = 0;
  for (const [path, text] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
    bytes += Buffer.byteLength(text);
  }
  const custom = readdirSync(join(root, PAGE_DIR, 'custom')).length;
  console.log(`data:split wrote ${files.size} files (${custom} under custom/), ${bytes} bytes, to ${PAGE_DIR}`);
}
