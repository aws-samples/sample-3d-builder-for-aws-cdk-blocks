// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Tests for the custom Block in the builder: its data, its 16 standards states, the marks, both code
 * sides, the save schema and the package. No server and no browser: these read the data files and
 * run the same lookups the page runs.
 *
 * Run:  npm run test:custom
 *
 * One process, run serially.
 */

import assert from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { constructedBlocks, customBlocks } from '../cdk-blocks/scripts/own-synth.js';
import {
  ALL_ON,
  buildSchema,
  CUSTOM_PIECE,
  gallerySnapshotSchema,
  PIECE_IDS,
  pieceIdSchema,
  STANDARD_IDS,
  STANDARDS_KEYS,
  saveBuildInputSchema,
  standardsKeyOf,
  standardsOfKey,
} from '../cdk-blocks/shared.js';
// @ts-expect-error a plain .mjs script with no types
import { PAGE_DIR, split } from '../scripts/split-page-data.mjs';
import { buildSections, codeOf, customNoteFor, downloadText } from '../src/code.js';
import { carrierMarksById, comboOf, countLine, edgesOn, pairTotal } from '../src/connections.js';
import {
  type ArrangementFile,
  changeLine,
  isLoaded,
  leavesOf,
  markText,
  partName,
  platformCode,
  register,
  registerShared,
  SERVICE_TEXT,
  type SharedFile,
  standardLabel,
  standardsEntry,
  standardsText,
  statementText,
  toggled,
} from '../src/custom.js';
import { blockText, CUSTOM_LAYER_COLOR, CUSTOM_PLATE_COLOR, data, stackTotal, TEAM_LABEL } from '../src/data.js';
import { SERVICE_WORD, typeLabel } from '../src/naming.js';
import { layoutFor } from '../src/plate.js';

const text = (p: string) => readFileSync(p, 'utf8');
const json = (p: string) => JSON.parse(text(p));

interface CustomJson {
  standardsOrder: string[];
  standardsKeys: string[];
  allOn: string;
  standards: { id: string; label: string }[];
  runtimeRules: { heading: string; rules: { label: string }[] };
  code: {
    app: Record<string, { lines: string[]; imports: string[]; typecheckedFile: string }>;
    platform: Record<string, { lines: string[]; addedBy: unknown[]; synthesizedFile: string; typecheckedFile: string; startLine: number }>;
  };
  reference: { template: string };
  resources: Record<
    string,
    {
      logicalId: string;
      type: string;
      mark: string;
      referenceLogicalId?: string;
      standards?: string[] | 'always';
      changes?: { property: string; pointer: string; standards: string[]; before?: unknown; beforeNotSet?: boolean; after?: unknown }[];
      propertyStandards?: { property: string; standards: string[] }[];
    }
  >;
  outside: Record<string, { logicalId: string; type: string; kind: string }>;
  pairs: Record<
    string,
    Record<
      string,
      { template: string; resourceTotal: number; resourcesAddedToBaseline: number; resources: string[]; outside: string[]; on: string[] }
    >
  >;
}
const custom = json('src/data/custom.json') as CustomJson;
const connections = json('src/data/connections.json') as {
  combos: Record<string, { K: number; edgeIds: string[]; resourcesAdded: number }>;
  combosByStandards: Record<string, Record<string, { K?: number; edgeIds?: string[]; resourcesAdded?: number }>>;
};
const combosJson = json('src/data/combos.json') as { combos: Record<string, { added: number }> };
const blocksJson = json('src/data/blocks.json') as { blocks: { id: string; note?: string }[]; comboAdded: Record<string, number> };
const CUSTOM_KEYS = Object.keys(custom.pairs);
const house = data.blocks.find((b) => b.id === CUSTOM_PIECE)!;
const merged = (arrangement: string, std: string) => ({
  ...connections.combos[arrangement],
  ...(std === custom.allOn ? {} : connections.combosByStandards[arrangement][std]),
});

// The page loads these lazily (src/custom-loader.ts). Here they're read from disk and handed to the same registry.
registerShared(json(join(PAGE_DIR, 'custom/shared.json')) as SharedFile);
for (const key of CUSTOM_KEYS) register(json(join(PAGE_DIR, `custom/${key}.json`)) as ArrangementFile);

// ─── Data ────────────────────────────────────────────────────────────────────

test('data: the server and page copies of custom.json match byte for byte, and so do the other four', () => {
  for (const name of ['custom.json', 'blocks.json', 'combos.json', 'connections.json', 'naming.json']) {
    const server = readFileSync(join('cdk-blocks', name));
    const page = readFileSync(join('src/data', name));
    assert.ok(server.length > 1000, `${name} is not empty`);
    assert.ok(server.equals(page), `cdk-blocks/${name} and src/data/${name} differ`);
  }
});

test('data: 127 arrangement keys in blocks.json, combos.json and connections.json, 64 of them with the custom piece', () => {
  assert.strictEqual(Object.keys(blocksJson.comboAdded).length, 127);
  assert.strictEqual(Object.keys(combosJson.combos).length, 127);
  assert.strictEqual(Object.keys(connections.combos).length, 127);
  assert.strictEqual(CUSTOM_KEYS.length, 64);
  for (const key of Object.keys(combosJson.combos))
    assert.strictEqual(key.split('+').includes(CUSTOM_PIECE), CUSTOM_KEYS.includes(key), key);
  assert.strictEqual(blocksJson.blocks.length, 7);
  assert.strictEqual(blocksJson.blocks[6].id, CUSTOM_PIECE);
});

test('data: every one of the 1,024 (arrangement, standards) pairs has an entry that names its template', () => {
  let pairs = 0;
  for (const key of CUSTOM_KEYS) {
    assert.deepStrictEqual(Object.keys(custom.pairs[key]).sort(), [...custom.standardsKeys].sort(), `${key} has all 16 keys`);
    assert.deepStrictEqual(
      Object.keys(connections.combosByStandards[key]).sort(),
      custom.standardsKeys.filter((k) => k !== custom.allOn).sort(),
      `${key}: connections has the 15 other keys`,
    );
    pairs += Object.keys(custom.pairs[key]).length;
  }
  assert.strictEqual(pairs, 1024);
  // Each pair names the template of the synth run it was read from. Those templates aren't in this repository.
  for (const std of custom.standardsKeys)
    for (const key of CUSTOM_KEYS)
      assert.strictEqual(custom.pairs[key][std].template, `synth-runs/custom-block/synth/templates/custom/${std}/${key}.json`);
});

test("data: the split files under src/data/page equal the splitter's output from the byte copies", () => {
  const files = split(json('src/data/custom.json'), json('src/data/connections.json')) as Map<string, string>;
  const list = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? list(join(dir, name)) : [join(dir, name)]));
  assert.deepStrictEqual(list(PAGE_DIR).sort(), [...files.keys()].sort(), 'the same files, and no other');
  assert.strictEqual(files.size, 66);
  for (const [path, body] of files) assert.ok(text(path) === body, `${path} differs from the splitter's output`);
  // No synth-run path reaches the page, and neither does a data file's name.
  for (const [path, body] of files) assert.doesNotMatch(body, /synth-runs|synth\/templates|typechecked|custom\.json/, path);
});

test("standards: the four ids in shared.ts are custom.json's standardsOrder, and the 16 keys are its standardsKeys", () => {
  assert.deepStrictEqual([...STANDARD_IDS], custom.standardsOrder);
  assert.deepStrictEqual(STANDARDS_KEYS, custom.standardsKeys);
  assert.strictEqual(ALL_ON, custom.allOn);
  assert.strictEqual(new Set(STANDARDS_KEYS).size, 16);
  for (const key of STANDARDS_KEYS) assert.strictEqual(standardsKeyOf(standardsOfKey(key)!), key);
  for (const bad of ['tags+key', 'key+key', 'audit', '', 'key+'])
    assert.strictEqual(standardsOfKey(bad), null, `"${bad}" isn't a standards key`);
  assert.deepStrictEqual(
    custom.standards.map((s) => s.id),
    custom.standardsOrder,
  );
});

// ─── The switches ────────────────────────────────────────────────────────────

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

test('switches: each of the 16 keys shows exactly its own resources, marks, code lines, count line and links', () => {
  for (const key of CUSTOM_KEYS) {
    const on = key.split('+');
    for (const std of custom.standardsKeys) {
      const pair = custom.pairs[key][std];
      const want = merged(key, std);
      const entry = standardsEntry(key, std);
      assert.ok(entry, `${key} [${std}] has an entry`);
      // Resources and marks: the pair's own records.
      assert.deepStrictEqual(
        entry.resources.map((r) => r.logicalId).sort(),
        pair.resources.map((id) => custom.resources[id].logicalId).sort(),
        `${key} [${std}]: resources`,
      );
      for (const r of entry.resources) {
        const rec = pair.resources.map((id) => custom.resources[id]).find((x) => x.logicalId === r.logicalId)!;
        assert.strictEqual(r.mark, rec.mark, `${key} [${std}] ${r.logicalId}: mark`);
        assert.deepStrictEqual(
          r.changes?.map((c) => [c.property, c.standards, c.after]),
          rec.changes?.map((c) => [c.property, c.standards, c.after]),
          `${key} [${std}] ${r.logicalId}: changes`,
        );
        assert.deepStrictEqual(r.standards, rec.standards, `${key} [${std}] ${r.logicalId}: standards`);
      }
      assert.deepStrictEqual(
        entry.outside.map((o) => o.logicalId),
        pair.outside.map((id) => custom.outside[id].logicalId),
        `${key} [${std}]: outside`,
      );
      // Totals and links: lookups for the pair, equal in custom.json and connections.json.
      assert.strictEqual(entry.resourcesAdded, pair.resourcesAddedToBaseline, `${key} [${std}]: N`);
      assert.strictEqual(pairTotal(on, std), pair.resourcesAddedToBaseline);
      assert.strictEqual(pairTotal(on, std), want.resourcesAdded);
      assert.strictEqual(comboOf(on, std)!.K, want.K, `${key} [${std}]: K`);
      assert.deepStrictEqual(
        edgesOn(on, std).map((e) => e.id),
        want.edgeIds,
        `${key} [${std}]: links`,
      );
      assert.deepStrictEqual(
        layoutFor(key, entry.edgeIds).links.map((l) => l.edgeId),
        want.edgeIds,
        `${key} [${std}]: links drawn`,
      );
      // Code: the app side for this key, inside the arrangement's sections.
      assert.deepStrictEqual(codeOf(house, std), custom.code.app[std].lines, `[${std}]: app lines`);
      const blocks = data.blocks.filter((b) => on.includes(b.id));
      const lines = blocks.reduce((n, b) => n + codeOf(b, std).length, 0);
      const shown = buildSections(blocks, std).flatMap((s) => s.lines.filter((l) => l.blockId === CUSTOM_PIECE).map((l) => l.text));
      assert.deepStrictEqual(shown, custom.code.app[std].lines);
      // The count line.
      for (const [mode, noun] of [
        ['generic', 'resource'],
        ['exact', 'AWS resource'],
      ] as const)
        assert.strictEqual(
          countLine(on, pairTotal(on, std), lines, mode, std).text,
          `${plural(pair.resourcesAddedToBaseline, noun)}, ${plural(want.K, 'connection')} from ${plural(lines, 'line')} of TypeScript`,
          `${key} [${std}] ${mode}`,
        );
    }
    // All-on is the arrangement's own entry in combos.json.
    assert.strictEqual(pairTotal(on, ALL_ON), combosJson.combos[key].added);
    assert.strictEqual(stackTotal(on), combosJson.combos[key].added);
  }
  // The platform side for each key, and the 16 states really are 16 different things to show.
  const seen = new Set<string>();
  for (const std of custom.standardsKeys) {
    assert.deepStrictEqual(platformCode(std)!.lines, custom.code.platform[std].lines, `[${std}]: platform lines`);
    assert.deepStrictEqual(platformCode(std)!.addedBy, custom.code.platform[std].addedBy);
    const e = standardsEntry(CUSTOM_PIECE, std)!;
    seen.add(
      JSON.stringify([
        e.resources.map((r) => [r.logicalId, r.mark, r.changes?.map((c) => c.property), r.propertyStandards]),
        platformCode(std)!.lines,
      ]),
    );
  }
  assert.strictEqual(seen.size, 16, 'no two standards keys show the same resources, marks and platform code');
  // What the data says about the piece alone.
  assert.strictEqual(standardsEntry(CUSTOM_PIECE, 'none')!.resourcesAdded, 3);
  assert.strictEqual(standardsEntry(CUSTOM_PIECE, ALL_ON)!.resourcesAdded, 6);
  assert.strictEqual(standardsEntry(CUSTOM_PIECE, 'key')!.K, 2);
  assert.strictEqual(standardsEntry(CUSTOM_PIECE, 'retention+logging+tags')!.K, 1);
  assert.strictEqual(codeOf(house, 'key').length, 1);
  assert.strictEqual(codeOf(house, 'tags').length, 5);
});

test("switches: no reachable pair lacks data, and a key that isn't one of the 16 can't be set", () => {
  for (const key of CUSTOM_KEYS) {
    assert.ok(isLoaded(key));
    // Every flip from every key lands on one of the 16, and that pair has data.
    for (const std of STANDARDS_KEYS)
      for (const id of STANDARD_IDS) {
        const next = toggled(std, id);
        assert.ok(STANDARDS_KEYS.includes(next), `${std} flip ${id} gives ${next}`);
        assert.notStrictEqual(next, std);
        assert.ok(standardsEntry(key, next), `${key} [${next}] has data`);
      }
    for (const bad of ['tags+key', 'audit', 'key+audit', ''])
      assert.strictEqual(standardsEntry(key, bad), null, `${key} ["${bad}"] isn't reachable`);
  }
  // An arrangement without the custom piece has no standards data and ignores a key.
  assert.strictEqual(standardsEntry('kvstore', ALL_ON), null);
  assert.strictEqual(comboOf(['kvstore'], 'none')!.K, connections.combos.kvstore.K);
  // A key other than all-on never falls back to the all-on entry: with no data it's null.
  assert.strictEqual(comboOf(['kvstore', CUSTOM_PIECE], 'tags+key'), null);
});

// ─── Code ────────────────────────────────────────────────────────────────────

test("code: the download holds the app team's side for the custom piece, under a comment that says where its package comes from", () => {
  for (const std of ['none', ALL_ON]) {
    const blocks = data.blocks.filter((b) => ['kvstore', CUSTOM_PIECE].includes(b.id));
    const out = downloadText(buildSections(blocks, std), customNoteFor(data.blocks)).split('\n');
    const first = out.indexOf(custom.code.app[std].lines[0]);
    assert.ok(first > 0, `[${std}]: the constructor line is in the download`);
    assert.strictEqual(
      out[first - 1],
      "// HouseBucket is a custom Block from a package in this app's workspace: packages/bb-house-bucket (@your-team/bb-house-bucket 1.0.0). It isn't published: copy the folder, don't install it by name.",
    );
    assert.deepStrictEqual(out.slice(first, first + custom.code.app[std].lines.length), custom.code.app[std].lines);
    assert.ok(out.includes("import { HouseBucket } from '@your-team/bb-house-bucket';"));
    assert.strictEqual(out.filter((l) => l.startsWith('// HouseBucket')).length, 1);
    // A piece that isn't custom gets no such comment.
    assert.strictEqual(out[out.indexOf(data.blocks[0].code[0]) - 1].startsWith('//'), false);
  }
});

// ─── Marks ───────────────────────────────────────────────────────────────────

test('marks: base, changed and added match custom.json for every resource, and the two two-standard properties name both', () => {
  for (const std of custom.standardsKeys) {
    const entry = standardsEntry(CUSTOM_PIECE, std)!;
    const on = standardsOfKey(std)!;
    for (const r of entry.resources) {
      const mark = markText(r);
      assert.strictEqual(mark.kind, r.mark);
      assert.ok(mark.text.startsWith(r.mark), `${r.logicalId} [${std}]: "${mark.text}" starts with its mark word`);
      assert.notStrictEqual(partName(r), 'Part of the Block', `${r.logicalId} has a part name`);
      // A changed resource names only standards that are on, and every leaf it shows really differs.
      for (const c of r.changes ?? []) {
        for (const s of c.standards as string[])
          assert.ok((on as string[]).includes(s), `${r.logicalId} [${std}]: ${c.property} is caused by a standard that's on`);
        const leaves = leavesOf(c);
        assert.ok(leaves.length > 0, `${r.logicalId} [${std}] ${c.property}: something differs`);
        for (const l of leaves) assert.notStrictEqual(l.before, l.after);
      }
    }
    // The data bucket and its policy are always there; the bucket is base only with every standard off.
    const bucket = entry.resources.find((r) => partName(r) === 'Your files')!;
    assert.strictEqual(bucket.mark, std === 'none' ? 'base' : 'changed');
    assert.strictEqual(entry.resources.find((r) => partName(r) === 'Your files, access policy')!.mark, 'base');
    const audit = entry.resources.find((r) => partName(r) === 'Audit trail')!;
    assert.deepStrictEqual([audit.mark, audit.standards], ['added', 'always']);
    assert.strictEqual(
      entry.resources.some((r) => partName(r) === 'Your own key'),
      on.includes('key'),
    );
    assert.strictEqual(
      entry.resources.some((r) => partName(r) === 'Access logs'),
      on.includes('logging'),
    );
  }
  const all = standardsEntry(CUSTOM_PIECE, ALL_ON)!;
  const key = all.resources.find((r) => r.type === 'AWS::KMS::Key')!;
  const logs = all.resources.find((r) => partName(r) === 'Access logs')!;
  assert.deepStrictEqual(key.propertyStandards, [{ property: 'Properties.Tags', standards: ['key', 'tags'] }]);
  assert.deepStrictEqual(logs.propertyStandards, [{ property: 'Properties.Tags', standards: ['logging', 'tags'] }]);
  assert.strictEqual(standardsText(key.propertyStandards![0].standards), 'Encryption with your own key and Required tags');
  assert.strictEqual(standardsText(logs.propertyStandards![0].standards), 'Access logging and Required tags');
  // With tags off, neither carries the house tags.
  assert.strictEqual(
    standardsEntry(CUSTOM_PIECE, 'key+logging')!.resources.every((r) => !r.propertyStandards),
    true,
  );
  // The links the piece's resources carry: the bucket and the table carry the read-and-write link, the key carries the key link.
  const links = carrierMarksById(CUSTOM_PIECE, [CUSTOM_PIECE], 'generic', ALL_ON);
  assert.deepStrictEqual(
    links.get(key.logicalId)!.map((m) => m.edgeId),
    ['core:role>housebucket:can-encrypt-and-decrypt-with'],
  );
  assert.strictEqual(carrierMarksById(CUSTOM_PIECE, [CUSTOM_PIECE], 'generic', 'none').has(key.logicalId), false);
});

test("marks: a change shows the template's own values, and what the custom piece changes outside itself is listed", () => {
  const all = standardsEntry(CUSTOM_PIECE, ALL_ON)!;
  const bucket = all.resources.find((r) => partName(r) === 'Your files')!;
  const typeOfId = (id: string) => all.resources.find((r) => r.logicalId === id)?.type;
  const exact = Object.fromEntries(bucket.changes!.map((c) => [c.property, changeLine(c, 'exact', typeOfId)]));
  assert.deepStrictEqual(exact['Properties.LifecycleConfiguration'].rows, [
    { path: 'Rules[0].NoncurrentVersionExpiration.NoncurrentDays', before: '90', after: '7' },
    { path: 'Rules[1].ExpirationInDays', before: 'not set', after: '30' },
    { path: 'Rules[1].Status', before: 'not set', after: 'Enabled' },
  ]);
  assert.ok(exact['Properties.BucketEncryption'].rows.some((r) => r.before === 'AES256' && r.after === 'aws:kms'));
  assert.ok(exact['Properties.LoggingConfiguration'].rows.some((r) => r.path === 'LogFilePrefix' && r.after === 'access-logs/'));
  assert.deepStrictEqual(
    exact['Properties.Tags'].rows.map((r) => `${r.path}=${r.after}`),
    ['cost-center=cc-4410', 'data-classification=internal', 'owner=intake-team'],
  );
  // Every arrangement adds statements to the app's shared role. On CDK Blocks 1.0.0 none of them spills into a second
  // policy; on the earlier release 12 arrangements with the Agent Block did.
  let overflow = 0;
  for (const key of CUSTOM_KEYS) {
    const e = standardsEntry(key, ALL_ON)!;
    assert.ok(
      e.outside.some((o) => (o.statementsAdded ?? []).length > 0),
      `${key}: statements added outside the Block`,
    );
    if (e.outside.some((o) => o.kind === 'added' && o.type === 'AWS::IAM::ManagedPolicy')) {
      overflow++;
      assert.ok(key.split('+').includes('agent'), `${key}: a second policy only appears with the Agent Block`);
    }
  }
  assert.strictEqual(overflow, 0);
});

test("color: the custom layer's color is no AWS category color", () => {
  const aws = ['ED7100', '7AA116', 'C925D1', '8C4FFF', 'DD344C', 'E7157B', '01A88D', '232F3E'];
  for (const color of [CUSTOM_LAYER_COLOR, CUSTOM_PLATE_COLOR]) {
    assert.match(color, /^#[0-9A-F]{6}$/);
    assert.ok(!aws.includes(color.slice(1)), `${color} is its own neutral`);
  }
  // A neutral: its red, green and blue sit close together.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(CUSTOM_LAYER_COLOR.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 24);
  // The stylesheet's copy of the two colors matches.
  const css = text('src/styles.css').toUpperCase();
  assert.ok(css.includes(`--LAYER: ${CUSTOM_LAYER_COLOR};`) && css.includes(`--LAYER-PLATE: ${CUSTOM_PLATE_COLOR};`));
  assert.strictEqual(TEAM_LABEL, 'Your team');
});

// ─── The package ─────────────────────────────────────────────────────────────

test('block: this app constructs the custom Block for its gallery, and own-synth names the Blocks inside it', () => {
  const source = text('cdk-blocks/index.ts');
  const blocks = constructedBlocks(source);
  assert.deepStrictEqual(
    blocks.find((b) => b.kind === 'HouseBucket'),
    { kind: 'HouseBucket', ids: ['gallery'] },
  );
  assert.strictEqual(
    blocks.some((b) => b.kind === 'FileBucket'),
    false,
    'the plain FileBucket is gone from the backend',
  );
  const found = customBlocks(source, blocks, [{ name: '@your-team/bb-house-bucket', dir: 'packages/bb-house-bucket' }], text);
  assert.deepStrictEqual(found, [
    {
      kind: 'HouseBucket',
      package: '@your-team/bb-house-bucket',
      ids: ['gallery'],
      inside: [
        { kind: 'FileBucket', ids: ['files'] },
        { kind: 'KVStore', ids: ['audit'] },
        { kind: 'Logger', ids: ['audit-log'] },
      ],
    },
  ]);
  const own = json('cdk-blocks/own-synth.json');
  assert.deepStrictEqual(own.customBlocks, found, 'cdk-blocks/own-synth.json is current; run npm run own-synth');
  assert.deepStrictEqual(own.blocks, blocks);
  // The snapshot goes through put() with a Buffer and is read back through get().
  assert.match(
    source,
    /await gallery\.put\(GALLERY_SNAPSHOT_PATH, Buffer\.from\(JSON\.stringify\(body\), 'utf8'\), \{\s*contentType: 'application\/json',\s*uploadedBy: SNAPSHOT_WRITER,\s*\}\)/,
  );
  assert.match(source, /await gallery\.get\(GALLERY_SNAPSHOT_PATH\)/);
  assert.deepStrictEqual(json('package.json').workspaces, ['cdk-blocks', 'packages/bb-house-bucket']);
});

// ─── Naming and copy ─────────────────────────────────────────────────────────

test('naming: every label the custom piece adds has an exact and a generic form, and no generic text names a service, case-insensitively', () => {
  const shared = json(join(PAGE_DIR, 'custom/shared.json')) as SharedFile;
  const fixed = [
    ...shared.standards.map((s) => s.label),
    shared.runtimeRules.heading,
    ...shared.runtimeRules.rules,
    TEAM_LABEL,
    'Your custom Block',
    'Outside this Block',
    'base',
    'changed',
    'added',
  ];
  for (const label of fixed) {
    assert.doesNotMatch(label, SERVICE_WORD, label);
    assert.doesNotMatch(label, SERVICE_TEXT, label);
  }
  for (const id of STANDARD_IDS) assert.strictEqual(standardLabel(id), custom.standards.find((s) => s.id === id)!.label);
  let rows = 0;
  for (const key of CUSTOM_KEYS)
    for (const std of custom.standardsKeys) {
      const e = standardsEntry(key, std)!;
      const typeOfId = (id: string) => e.resources.find((r) => r.logicalId === id)?.type;
      for (const r of e.resources) {
        for (const said of [partName(r), markText(r).text, typeLabel(r.type, 'generic')]) assert.doesNotMatch(said, SERVICE_TEXT, said);
        assert.notStrictEqual(typeLabel(r.type, 'generic'), r.type, `${r.type} has a generic name`);
        assert.notStrictEqual(typeLabel(r.type, 'exact'), r.type, `${r.type} has an exact name`);
        for (const c of r.changes ?? []) {
          const generic = changeLine(c, 'generic', typeOfId);
          const exact = changeLine(c, 'exact', typeOfId);
          assert.doesNotMatch(generic.word, SERVICE_TEXT);
          for (const row of generic.rows)
            assert.doesNotMatch(`${row.path} ${row.before} ${row.after}`, SERVICE_TEXT, `${r.logicalId} ${c.property}: generic row`);
          // Generic hides only what names a service; nothing is lost between the two modes.
          assert.strictEqual(generic.rows.length + generic.hidden, exact.rows.length, `${r.logicalId} ${c.property}`);
          assert.strictEqual(exact.hidden, 0);
          rows += exact.rows.length;
        }
      }
      for (const o of e.outside) {
        assert.notStrictEqual(typeLabel(o.type, 'generic'), o.type);
        assert.doesNotMatch(typeLabel(o.type, 'generic'), SERVICE_TEXT);
        for (const s of [...(o.statementsAdded ?? []), ...(o.statementsRemoved ?? [])]) {
          assert.doesNotMatch(statementText(s, 'generic', e.types), SERVICE_TEXT);
          assert.match(statementText(s, 'exact', e.types), /^[a-z0-9-]+:/);
        }
      }
    }
  assert.ok(rows > 1000);
});

test('copy: the counting words, the lead line, and no data file name on the page', () => {
  // The synth mapping's note names a data file. The page shows its own wording instead.
  assert.match(blocksJson.blocks[6].note ?? '', /custom\.json/);
  for (const mode of ['generic', 'exact'] as const) assert.doesNotMatch(blockText(house, mode).note ?? '', /\.json|custom\.json/);
  const sources = [
    'src/App.tsx',
    'src/MakeItYours.tsx',
    'src/Mapping.tsx',
    'src/RunsOn.tsx',
    'src/StaticFallback.tsx',
    'src/Connections.tsx',
    'src/Gallery.tsx',
    'src/AgentBox.tsx',
    'src/custom.ts',
    'src/data/copy.json',
    'cdk-blocks/index.ts',
    'cdk-blocks/shared.ts',
  ];
  for (const file of sources) {
    const body = text(file);
    assert.doesNotMatch(body, /\b(six|seven) (CDK )?Blocks\b/i, `${file}: never "six Blocks" or "seven Blocks"`);
    assert.doesNotMatch(body, /—/, `${file}: no long dash`);
    assert.doesNotMatch(body, /full-stack|in seconds|in minutes/i, file);
  }
  // The formatter wraps long JSX text, so the copy is matched with runs of whitespace joined.
  const oneSpaced = (p: string) => text(p).replace(/\s+/g, ' ');
  const app = oneSpaced('src/App.tsx');
  assert.match(app, /Five Blocks and the Hosting construct, and one custom Block\./);
  assert.match(app, /Five CDK Blocks, the Hosting construct and one custom Block you can snap on/);
  assert.match(app, /Best practices built in\./);
  const yours = oneSpaced('src/MakeItYours.tsx');
  assert.match(yours, /<h2 id="yours-title">Your standards as custom Blocks<\/h2>/);
  assert.match(
    yours,
    /Platform developers package their own standards as custom Blocks, so app teams start from the same approved pattern\./,
  );
  assert.match(yours, /the FileBucket Block that AWS provides/);
  // Ours isn't published, and the page doesn't say it is.
  assert.match(yours, /is the step a platform developer would take next/);
  assert.doesNotMatch(yours + app, /published to npm|shared through npm|is on npm/i);
  // Four switches, each a real button with a switch role, and no fifth.
  assert.match(yours, /STANDARD_IDS\.map/);
  assert.match(yours, /role="switch" aria-checked=\{isOn\}/);
  assert.strictEqual(STANDARD_IDS.length, 4);
});

// ─── Saving ──────────────────────────────────────────────────────────────────

test('save schema: a build with the custom piece keeps its standards, they are refused without it, and a build saved before this change still opens', () => {
  const base = { id: 'abcdefghij', source: 'hand' as const, createdAt: '2026-11-19T00:00:00.000Z' };
  // Saved before the custom Block existed: no standards field.
  const old = buildSchema.parse({ ...base, blocks: ['kvstore', 'auth'] });
  assert.strictEqual('standards' in old, false);
  // With the piece, with and without standards.
  assert.deepStrictEqual(buildSchema.parse({ ...base, blocks: ['kvstore', 'housebucket'], standards: ['key', 'tags'] }).standards, [
    'key',
    'tags',
  ]);
  assert.deepStrictEqual(buildSchema.parse({ ...base, blocks: ['housebucket'], standards: [] }).standards, []);
  assert.strictEqual(buildSchema.parse({ ...base, blocks: ['housebucket'] }).standards, undefined);
  // Refused: standards without the piece, an unknown id, a repeat, a fifth entry.
  assert.strictEqual(buildSchema.safeParse({ ...base, blocks: ['kvstore'], standards: ['key'] }).success, false);
  assert.strictEqual(buildSchema.safeParse({ ...base, blocks: ['housebucket'], standards: ['audit'] }).success, false);
  assert.strictEqual(buildSchema.safeParse({ ...base, blocks: ['housebucket'], standards: ['key', 'key'] }).success, false);
  assert.strictEqual(
    buildSchema.safeParse({ ...base, blocks: ['housebucket'], standards: ['key', 'retention', 'logging', 'tags', 'key'] }).success,
    false,
  );
  assert.strictEqual(buildSchema.safeParse({ ...base, blocks: ['housebucket'], standards: 'key+tags' }).success, false);
  const input = { code: 'x', source: 'hand' as const };
  assert.strictEqual(saveBuildInputSchema.safeParse({ ...input, blocks: ['housebucket'], standards: ['retention'] }).success, true);
  assert.strictEqual(saveBuildInputSchema.safeParse({ ...input, blocks: ['kvstore'] }).success, true);
  assert.strictEqual(saveBuildInputSchema.safeParse({ ...input, blocks: ['kvstore'], standards: [] }).success, false);
  assert.strictEqual(saveBuildInputSchema.safeParse({ ...input, blocks: ['housebucket'], standards: ['Key'] }).success, false);
  // The gallery snapshot holds builds of both kinds.
  const snapshot = {
    version: 1,
    writtenAt: base.createdAt,
    hash: 'h',
    featured: null,
    builds: [old, { ...base, id: 'bcdefghijk', blocks: ['housebucket'], standards: ['logging'] }],
  };
  assert.strictEqual(gallerySnapshotSchema.safeParse(snapshot).success, true);
  // The piece ids: seven, the custom piece last, and the first six in their old order.
  assert.deepStrictEqual(pieceIdSchema.options, ['kvstore', 'database', 'auth', 'agent', 'realtime', 'hosting', 'housebucket']);
  assert.deepStrictEqual([...PIECE_IDS], pieceIdSchema.options);
});
