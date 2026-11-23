// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Tests for the connections view and the naming switch. No server and no browser: these read the
 * data files and run the same layout, camera fit, count line and naming code the page runs.
 *
 * Run:  npm run test:connections
 *
 * One process, run serially. PLANT_BREAK=link-without-edge plants a drawn link with no edge id in one
 * layout, to show the layout check fails on it. The run then exits 1 on purpose.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PerspectiveCamera, Vector3 } from 'three';
import { ALL_ON, CUSTOM_PIECE, NAMING_MODES, PIECE_IDS } from '../cdk-blocks/shared.js';
import {
  carrierMarks,
  comboOf,
  connectionCount,
  countLine,
  edgeNote,
  edgesOn,
  LEAD_TYPE,
  leadTypeInData,
  litEdges,
  meaningOf,
  pairLine,
  plugNodes,
} from '../src/connections.js';
import { blockText, data, stackTotal } from '../src/data.js';
import { iconFor } from '../src/icons/map.js';
import { hudLayout } from '../src/layout.js';
import { DEFAULT_MODE, initialMode, nodeLabel, nodeName, SERVICE_WORD, sentenceOf, typeLabel, typeName, withNames } from '../src/naming.js';
import {
  BRICK,
  CUSTOM_LAYER,
  keyOf,
  LABEL_ANCHOR,
  LIFT,
  LINK_PATH,
  LINK_WIDTH,
  layoutFor,
  offerSlots,
  PART_SHAPE,
  PIECE_SLOT,
  PLATE,
  PLATE_CENTER_X,
  type PlateLayout,
  type Point,
  type Rect,
  SOCKET_SHAPE,
} from '../src/plate.js';
import { FOV, fitShot, plateBox, STAGE_INSET, type StageState, stageShot, VIEW } from '../src/scene/camera.js';

const read = (p: string) => readFileSync(p);
const json = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

interface Row {
  template: string;
  holder: { logicalId: string; type: string };
  target: { logicalId: string; type: string };
  propertyPath: string;
  via: string;
}
interface DataEdge {
  id: string;
  from: string;
  to: string;
  kind: string;
  meaning: string;
  evidence: Row[];
  sentence: { exact: string; generic: string };
  carriers: { from: string[]; to: string[] };
}
const connections = json('src/data/connections.json') as {
  nodes: { id: string; kind: string; onPlate: boolean; resources: { logicalId: string; type: string }[] }[];
  edges: DataEdge[];
  combos: Record<
    string,
    {
      K: number;
      edgeIds: string[];
      nodes: string[];
      resourcesAdded: number;
      pairs: Record<string, { relation: string; directEdgeIds: string[] }>;
    }
  >;
  summary: { distinctRuntimeConnections: number; directPieceToPieceRuntimeEdges: string[] };
  /** For an arrangement with the custom piece: per standards key, only the fields that differ from the all-on entry. */
  combosByStandards: Record<string, Record<string, { K?: number; edgeIds?: string[] }>>;
};
const naming = json('src/data/naming.json') as {
  default: string;
  types: Record<string, { exact: string; generic: string }>;
  nodes: Record<string, { exact: string; generic: string }>;
  edgeSentences: Record<string, { exact: string; generic: string }>;
};
const combosJson = json('src/data/combos.json') as { combos: Record<string, { added: number }> };
const ownSynth = json('cdk-blocks/own-synth.json') as { resourcesByType: Record<string, number> };

const ALL_KEYS = Object.keys(connections.combos);
const runtime = connections.edges.filter((e) => e.kind === 'runtime');
const edgeById = new Map(connections.edges.map((e) => [e.id, e]));

// ─── Data ────────────────────────────────────────────────────────────────────

test('data: the server and page copies of connections.json and naming.json match byte for byte', () => {
  for (const name of ['connections.json', 'naming.json']) {
    const server = read(join('cdk-blocks', name));
    const page = read(join('src/data', name));
    assert.ok(server.length > 1000, `${name} is not empty`);
    assert.ok(server.equals(page), `cdk-blocks/${name} and src/data/${name} differ`);
  }
});

test('data: 127 arrangements, keyed like combos.json both ways, with K and the resource total as lookups', () => {
  assert.strictEqual(ALL_KEYS.length, 127);
  assert.strictEqual(ALL_KEYS.filter((k) => k.split('+').includes(CUSTOM_PIECE)).length, 64);
  assert.deepStrictEqual([...ALL_KEYS].sort(), Object.keys(combosJson.combos).sort());
  for (const key of ALL_KEYS) {
    const combo = connections.combos[key];
    assert.strictEqual(combo.K, combo.edgeIds.length, `${key}: K equals the number of runtime edges listed`);
    assert.strictEqual(new Set(combo.edgeIds).size, combo.edgeIds.length, `${key}: no edge listed twice`);
    assert.strictEqual(combo.resourcesAdded, combosJson.combos[key].added, `${key}: resources added match combos.json`);
    for (const id of combo.edgeIds) assert.strictEqual(edgeById.get(id)?.kind, 'runtime', `${key}: ${id} is a runtime edge in the data`);
  }
});

test('data: every edge has evidence, both sentences and its two ends in the node list', () => {
  const nodeIds = new Set(connections.nodes.map((n) => n.id));
  for (const e of connections.edges) {
    assert.ok(e.evidence.length >= 1, `${e.id} has at least one evidence row`);
    assert.ok(nodeIds.has(e.from) && nodeIds.has(e.to), `${e.id} ends on known nodes`);
    assert.ok(e.sentence.exact.length > 10 && e.sentence.generic.length > 10, `${e.id} has both sentences`);
    for (const row of e.evidence)
      assert.ok(row.template && row.holder.logicalId && row.target.logicalId && row.propertyPath, `${e.id}: an evidence row is complete`);
  }
  assert.strictEqual(runtime.length, connections.summary.distinctRuntimeConnections);
  // 20 across the five Blocks and the Hosting construct, and two for the custom Block.
  assert.strictEqual(runtime.length, 23);
  assert.strictEqual(runtime.filter((e) => e.from !== CUSTOM_PIECE && e.to !== CUSTOM_PIECE).length, 21);
});

test('data: no piece links straight to another piece in any arrangement', () => {
  assert.deepStrictEqual(connections.summary.directPieceToPieceRuntimeEdges, []);
  const pieces = new Set<string>(PIECE_IDS);
  for (const e of runtime) assert.ok(!(pieces.has(e.from) && pieces.has(e.to)), `${e.id} isn't piece to piece`);
  for (const key of ALL_KEYS)
    for (const [pair, p] of Object.entries(connections.combos[key].pairs))
      assert.ok(p.relation !== 'direct' && p.directEdgeIds.length === 0, `${key} ${pair}`);
});

// ─── The count line ──────────────────────────────────────────────────────────

test('count line: "N resources, K connections from M lines of TypeScript" equals the data for all 127 arrangements, in both modes', () => {
  for (const key of ALL_KEYS) {
    const on = key.split('+');
    const lines = data.blocks.filter((b) => on.includes(b.id)).reduce((n, b) => n + b.code.length, 0);
    const n = combosJson.combos[key].added;
    const k = connections.combos[key].K;
    assert.strictEqual(stackTotal(on), n);
    assert.strictEqual(connectionCount(on), k);
    const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
    assert.strictEqual(
      countLine(on, stackTotal(on), lines, 'generic').text,
      `${plural(n, 'resource')}, ${plural(k, 'connection')} from ${plural(lines, 'line')} of TypeScript`,
    );
    assert.strictEqual(
      countLine(on, stackTotal(on), lines, 'exact').text,
      `${plural(n, 'AWS resource')}, ${plural(k, 'connection')} from ${plural(lines, 'line')} of TypeScript`,
    );
  }
  // K is a lookup, not a sum: the singles add up to more than the pieces together. First the five
  // Blocks and the Hosting construct, as before the custom Block; then with the custom Block (all on).
  const six = PIECE_IDS.filter((id) => id !== CUSTOM_PIECE);
  assert.strictEqual(six.length, 6);
  assert.strictEqual(
    six.reduce((sum, id) => sum + connectionCount([id]), 0),
    24,
  );
  assert.strictEqual(connectionCount(six), 18);
  assert.strictEqual(connectionCount([CUSTOM_PIECE]), 2);
  assert.strictEqual(connectionCount([...PIECE_IDS]), 20);
  // The baseline's 59 resources stay out of N.
  assert.strictEqual(stackTotal(six), 109);
  assert.strictEqual(stackTotal([...PIECE_IDS]), 115);
});

// ─── Layout ──────────────────────────────────────────────────────────────────

const EPS = 1e-6;
const overlap = (a: Rect, b: Rect) => a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.z0 < b.z1 - EPS && b.z0 < a.z1 - EPS;
const onEdge = (p: Point, r: Rect) => {
  const inX = p[0] >= r.x0 - EPS && p[0] <= r.x1 + EPS;
  const inZ = p[1] >= r.z0 - EPS && p[1] <= r.z1 + EPS;
  return (
    inX && inZ && (Math.abs(p[0] - r.x0) < EPS || Math.abs(p[0] - r.x1) < EPS || Math.abs(p[1] - r.z0) < EPS || Math.abs(p[1] - r.z1) < EPS)
  );
};
const rectsOf = (id: string): Rect[] =>
  id in PIECE_SLOT
    ? [PIECE_SLOT[id as keyof typeof PIECE_SLOT]]
    : id in SOCKET_SHAPE
      ? SOCKET_SHAPE[id as keyof typeof SOCKET_SHAPE]
      : id in PART_SHAPE
        ? [PART_SHAPE[id as keyof typeof PART_SHAPE]]
        : [];
const MASTER: { id: string; rect: Rect }[] = [...Object.keys(PIECE_SLOT), ...Object.keys(SOCKET_SHAPE), ...Object.keys(PART_SHAPE)].flatMap(
  (id) => rectsOf(id).map((rect) => ({ id, rect })),
);
/** True when the segment a-b passes through the inside of a box (touching its edge doesn't count). */
const crossesInside = (a: Point, b: Point, r: Rect) => {
  const x0 = Math.min(a[0], b[0]);
  const x1 = Math.max(a[0], b[0]);
  const z0 = Math.min(a[1], b[1]);
  const z1 = Math.max(a[1], b[1]);
  return x0 < r.x1 - EPS && x1 > r.x0 + EPS && z0 < r.z1 - EPS && z1 > r.z0 + EPS;
};

/** Every rule a drawn layout has to meet. Throws on the first one it breaks. */
function checkLayout(layout: PlateLayout, edgeIds?: string[]) {
  const key = layout.key;
  const want = edgeIds ?? (key === '' ? [] : connections.combos[key].edgeIds);
  // One drawn link for every edge in the arrangement's data, and an edge id in the data for every drawn link.
  for (const link of layout.links) {
    assert.ok(typeof link.edgeId === 'string' && link.edgeId.length > 0, `${key}: a drawn link has no edge id`);
    assert.ok(edgeById.get(link.edgeId)?.kind === 'runtime', `${key}: drawn link ${link.edgeId} is not a runtime edge in the data`);
    assert.ok(want.includes(link.edgeId), `${key}: drawn link ${link.edgeId} is not in this arrangement's data`);
  }
  assert.deepStrictEqual(layout.links.map((l) => l.edgeId).sort(), [...want].sort(), `${key}: exactly one drawn link per edge`);
  // Pieces and shared parts are exactly the arrangement's.
  assert.deepStrictEqual(
    layout.pieces.map((p) => p.id),
    key === '' ? [] : key.split('+'),
    `${key}: pieces`,
  );
  assert.deepStrictEqual(
    layout.parts.map((p) => p.id).sort(),
    (key === '' ? [] : connections.combos[key].nodes.filter((n) => n.startsWith('shared:'))).sort(),
    `${key}: shared parts`,
  );
  // No two pieces, sockets or parts overlap.
  const boxes = [
    ...layout.pieces.map((p) => ({ id: p.id as string, rect: p.rect })),
    ...layout.sockets.flatMap((s) => s.rects.map((rect) => ({ id: s.id as string, rect }))),
    ...layout.parts.map((p) => ({ id: p.id as string, rect: p.rect })),
  ];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++)
      if (boxes[i].id !== boxes[j].id) assert.ok(!overlap(boxes[i].rect, boxes[j].rect), `${key}: ${boxes[i].id} overlaps ${boxes[j].id}`);
  // Everything stays on the plate, with a margin.
  for (const b of boxes)
    assert.ok(
      b.rect.x0 >= PLATE_CENTER_X - PLATE.w / 2 + 0.3 &&
        b.rect.x1 <= PLATE_CENTER_X + PLATE.w / 2 - 0.3 &&
        b.rect.z0 >= -PLATE.d / 2 + 0.3 &&
        b.rect.z1 <= PLATE.d / 2 - 0.3,
      `${key}: ${b.id} is on the plate`,
    );
  for (const link of layout.links) {
    const e = edgeById.get(link.edgeId)!;
    const [first, last] = [link.path[0], link.path[link.path.length - 1]];
    // A link runs between the two nodes its edge names, and both are on the plate in this arrangement.
    const ends = [e.from, e.to];
    const drawn = new Set(boxes.map((b) => b.id));
    assert.ok(
      ends.every((id) => drawn.has(id)),
      `${key}: both ends of ${link.edgeId} are drawn`,
    );
    const touches = (p: Point, id: string) => rectsOf(id).some((r) => onEdge(p, r));
    assert.ok(
      (touches(first, e.from) && touches(last, e.to)) || (touches(first, e.to) && touches(last, e.from)),
      `${key}: ${link.edgeId} starts and ends on the edges of its own two nodes`,
    );
    for (let i = 1; i < link.path.length; i++) {
      const [a, b] = [link.path[i - 1], link.path[i]];
      assert.ok(Math.abs(a[0] - b[0]) < EPS || Math.abs(a[1] - b[1]) < EPS, `${key}: ${link.edgeId} runs along x or z`);
      assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) > 0.1, `${key}: ${link.edgeId} has no zero-length segment`);
      // No link path crosses a footprint: not a brick, a socket or a shared part, on the plate now or not.
      // Those footprints are where the icon tiles and icon chips sit, so a link never runs over an icon face.
      for (const m of MASTER) assert.ok(!crossesInside(a, b, m.rect), `${key}: ${link.edgeId} crosses the footprint of ${m.id}`);
      assert.ok(
        Math.abs(a[0] - PLATE_CENTER_X) < PLATE.w / 2 - 0.3 &&
          Math.abs(b[0] - PLATE_CENTER_X) < PLATE.w / 2 - 0.3 &&
          Math.abs(a[1]) < PLATE.d / 2 - 0.3 &&
          Math.abs(b[1]) < PLATE.d / 2 - 0.3,
        `${key}: ${link.edgeId} stays on the plate`,
      );
    }
  }
}

test('layout: the master layout has a slot for every piece, a path for every runtime edge and nothing else', () => {
  assert.deepStrictEqual(Object.keys(PIECE_SLOT).sort(), [...PIECE_IDS].sort());
  assert.deepStrictEqual(Object.keys(LINK_PATH).sort(), runtime.map((e) => e.id).sort());
  const onPlate = connections.nodes
    .filter((n) => n.onPlate && n.kind !== 'piece')
    .map((n) => n.id)
    .sort();
  assert.deepStrictEqual([...Object.keys(SOCKET_SHAPE), ...Object.keys(PART_SHAPE)].sort(), onPlate);
  for (const id of onPlate) {
    assert.ok(leadTypeInData(id), `${id}: its lead type ${LEAD_TYPE[id]} is one of its resources in the data`);
    const [x, z] = LABEL_ANCHOR[id as keyof typeof LABEL_ANCHOR];
    assert.ok(
      rectsOf(id).some((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1),
      `${id}: its label is pinned on it`,
    );
  }
  for (let i = 0; i < MASTER.length; i++)
    for (let j = i + 1; j < MASTER.length; j++)
      if (MASTER[i].id !== MASTER[j].id) assert.ok(!overlap(MASTER[i].rect, MASTER[j].rect), `${MASTER[i].id} overlaps ${MASTER[j].id}`);
});

test('layout: pieces that share a part touch it, and it sits with whichever of them is on the plate', () => {
  const touching = (a: Rect, b: Rect) =>
    !overlap(a, b) && a.x0 <= b.x1 + EPS && b.x0 <= a.x1 + EPS && a.z0 <= b.z1 + EPS && b.z0 <= a.z1 + EPS;
  for (const e of connections.edges.filter((x) => x.kind === 'membership'))
    assert.ok(
      touching(PIECE_SLOT[e.from as keyof typeof PIECE_SLOT], PART_SHAPE[e.to as keyof typeof PART_SHAPE]),
      `${e.from} touches ${e.to}`,
    );
});

test('layout: all 127 arrangements and the empty plate pass every layout rule, in every standards state that changes the links', () => {
  let states = 0;
  for (const key of ['', ...ALL_KEYS]) {
    const layout = layoutFor(key);
    if (process.env.PLANT_BREAK === 'link-without-edge' && key === 'kvstore+hosting') {
      // Planted on purpose: a drawn link that has no edge id in the data.
      layout.links.push({
        edgeId: '',
        path: [
          [0, 0],
          [1, 0],
        ],
      });
    }
    checkLayout(layout);
    states++;
    // An arrangement with the custom piece has 16 standards states. Check the layout for each
    // distinct list of links among them, drawn from that state's own edge ids.
    const seen = new Set([JSON.stringify(layout.links.map((l) => l.edgeId))]);
    for (const [std, delta] of Object.entries(connections.combosByStandards[key] ?? {})) {
      const edgeIds = delta.edgeIds ?? connections.combos[key].edgeIds;
      if (seen.has(JSON.stringify(edgeIds))) continue;
      seen.add(JSON.stringify(edgeIds));
      assert.notStrictEqual(std, ALL_ON);
      checkLayout(layoutFor(key, edgeIds), edgeIds);
      states++;
    }
  }
  // 127 arrangements and the empty plate, plus one more link list for each of the 64 with the custom piece (its key link on or off).
  assert.strictEqual(states, 128 + 64);
});

test('layout: the plate grew to the right for the custom piece and nothing that was on it moved', () => {
  // The six earlier slots, the sockets and the shared parts, as they were before the custom piece (commit e1f1bae).
  assert.deepStrictEqual(PIECE_SLOT.kvstore, { x0: 1.3, x1: 3.66, z0: -4.21, z1: -2.65 });
  assert.deepStrictEqual(PIECE_SLOT.auth, { x0: -0.28, x1: 2.08, z0: 2.65, z1: 4.21 });
  assert.deepStrictEqual(PIECE_SLOT.hosting, { x0: -4.7, x1: -2.34, z0: -4.21, z1: -2.65 });
  assert.deepStrictEqual(SOCKET_SHAPE['core:role'][0], { x0: -1.4, x1: 4.7, z0: -2.05, z1: -1.5 });
  // The plate's left edge is where it was when the plate was 13 studs wide and centered on x = 0.
  assert.ok(Math.abs(PLATE_CENTER_X - PLATE.w / 2 - -(13 * 0.8 + 0.5) / 2) < 1e-9);
  // The custom piece sits in the back row beside KVStore, clear of it.
  assert.ok(PIECE_SLOT.housebucket.x0 - PIECE_SLOT.kvstore.x1 >= 0.29);
  assert.strictEqual(PIECE_SLOT.housebucket.z0, PIECE_SLOT.kvstore.z0);
});

test('layout: positions and paths are the same on two runs, and a piece never moves when another is added', () => {
  for (const key of ALL_KEYS) assert.strictEqual(JSON.stringify(layoutFor(key)), JSON.stringify(layoutFor(key)), key);
  const all = layoutFor(keyOf([...PIECE_IDS]));
  for (const key of ALL_KEYS) {
    const layout = layoutFor(key);
    for (const p of layout.pieces)
      assert.deepStrictEqual(p.rect, all.pieces.find((x) => x.id === p.id)!.rect, `${key}: ${p.id} is in its master slot`);
    for (const p of layout.parts) assert.deepStrictEqual(p.rect, PART_SHAPE[p.id], `${key}: ${p.id} is in its master slot`);
    for (const l of layout.links) assert.deepStrictEqual(l.path, LINK_PATH[l.edgeId], `${key}: ${l.edgeId} follows its master path`);
  }
});

test('layout: adding or removing a piece changes the drawn links by exactly the difference in the data', () => {
  for (const key of ALL_KEYS) {
    const on = key.split('+');
    for (const id of PIECE_IDS) {
      if (on.includes(id)) continue;
      const bigger = keyOf([...on, id]);
      const before = new Set(layoutFor(key).links.map((l) => l.edgeId));
      const after = new Set(layoutFor(bigger).links.map((l) => l.edgeId));
      const dataBefore = new Set(connections.combos[key].edgeIds);
      const dataAfter = new Set(connections.combos[bigger].edgeIds);
      assert.deepStrictEqual(
        [...after].filter((e) => !before.has(e)).sort(),
        [...dataAfter].filter((e) => !dataBefore.has(e)).sort(),
        `${key} + ${id}: links drawn`,
      );
      assert.deepStrictEqual(
        [...before].filter((e) => !after.has(e)).sort(),
        [...dataBefore].filter((e) => !dataAfter.has(e)).sort(),
        `${key} + ${id}: links retracted`,
      );
    }
  }
});

test('layout: links cross only where the notes say, at right angles, and never run along each other', () => {
  const segs = Object.entries(LINK_PATH).flatMap(([id, p]) => p.slice(1).map((b, i) => ({ id, a: p[i], b })));
  const crossings: string[] = [];
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++) {
      const [s, t] = [segs[i], segs[j]];
      if (s.id === t.id) continue;
      const box = (q: (typeof segs)[number], pad: number): Rect => ({
        x0: Math.min(q.a[0], q.b[0]) - pad,
        x1: Math.max(q.a[0], q.b[0]) + pad,
        z0: Math.min(q.a[1], q.b[1]) - pad,
        z1: Math.max(q.a[1], q.b[1]) + pad,
      });
      if (!overlap(box(s, LINK_WIDTH / 2), box(t, LINK_WIDTH / 2))) continue;
      const sAlongX = Math.abs(s.a[1] - s.b[1]) < EPS;
      const tAlongX = Math.abs(t.a[1] - t.b[1]) < EPS;
      assert.notStrictEqual(sAlongX, tAlongX, `${s.id} and ${t.id} run along each other`);
      crossings.push([s.id, t.id].sort().join(' x '));
    }
  const ws = 'core:config>shared:websocket:tells-the-app-s-code-where-to-find';
  assert.deepStrictEqual(
    crossings.sort(),
    [
      'agent>core:role:runs-as',
      'core:role>agent:can-invoke',
      'core:role>agent:can-read-and-write',
      'core:role>agent:can-read-the-secret-kept-by',
    ]
      .map((id) => [id, ws].sort().join(' x '))
      .sort(),
  );
});

// The bricks are the hero (2026-11-19): the camera frames the bricks that are on the plate, not the
// plate. These run the page's own fit (stageShot) for every arrangement and hold the sizes in place.
// The stage is 63% of an 832 px first screen on a phone (524 px), and about 982 x 700 at 1440 x 900.
const HERO_STAGES = [
  [360, 524],
  [384, 524],
  [412, 524],
  [982, 700],
] as const;
// Floors for a placed brick's on-screen width in CSS px at 384 px (scaled by width for 360 and 412) and
// on the desktop stage, a little under what the fit gives today. Measured on 2026-11-19 at 384: one brick
// 189 to 197; two 85 to 184 (median 125); three 68 to 159 (median 99); all seven 68 to 78. The bricks'
// slots are fixed, so bricks at opposite ends of the plate set the floor. Before this change the camera
// fit the whole plate and a brick was 58 to 68 px wide at 384 and 92 to 116 px at 1440, whatever was on it.
// HERO_BREAK=whole-plate (for showing the test fails) fits the camera to the whole plate again.
const HERO_FLOOR = {
  phoneOne: 180,
  phoneAny: 66,
  phoneMedianUpToThree: 95,
  desktopOne: 330,
  desktopAny: 135,
  desktopMedianUpToThree: 185,
  offerPhone: 80,
  offerDesktop: 160,
};
const brickTop = (id: string) => BRICK.body + BRICK.lid + 0.2 + (id === CUSTOM_PIECE ? CUSTOM_LAYER.gap + CUSTOM_LAYER.h : 0);
function projector(w: number, h: number, shot: { position: Vector3; target: Vector3 }) {
  const cam = new PerspectiveCamera(FOV, w / h, 0.5, 400);
  cam.position.copy(shot.position);
  cam.lookAt(shot.target);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  return (x: number, y: number, z: number): [number, number] => {
    const v = new Vector3(x, y, z).project(cam);
    return [((v.x + 1) / 2) * w, ((1 - v.y) / 2) * h];
  };
}
function brickBox(px: (x: number, y: number, z: number) => [number, number], r: Rect, top: number, lift = 0) {
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const x of [r.x0, r.x1])
    for (const y of [lift, lift + top])
      for (const z of [r.z0, r.z1]) {
        const [sx, sy] = px(x, y, z);
        x0 = Math.min(x0, sx);
        x1 = Math.max(x1, sx);
        y0 = Math.min(y0, sy);
        y1 = Math.max(y1, sy);
      }
  return { x0, x1, y0, y1, width: x1 - x0 };
}
const shotFor = (w: number, h: number, on: readonly string[], extra: Partial<StageState> = {}) => {
  const combo = on.length ? comboOf(on)! : null;
  const state: StageState = {
    w,
    h,
    on,
    parts: combo?.nodes ?? [],
    edges: combo?.edgeIds ?? [],
    lit: [],
    fanned: null,
    hudBottom: 0,
    ...extra,
  };
  return process.env.HERO_BREAK === 'whole-plate'
    ? fitShot(w, h, { top: 34, bottom: h - 10 }, plateBox(1.3), w < 620 ? VIEW.phone : VIEW.desktop)
    : stageShot(state);
};

test('hero: in all 127 arrangements every placed brick is whole on the stage, clear of the caption and the controls, and large', () => {
  const least: Record<string, number> = {};
  const upToThree: Record<number, number[]> = {};
  for (const [w, h] of HERO_STAGES) {
    const phone = w < 620;
    const inset = phone ? STAGE_INSET.phone : STAGE_INSET.desktop;
    for (const key of ALL_KEYS) {
      const on = key.split('+');
      const px = projector(w, h, shotFor(w, h, on));
      let setLo = Infinity;
      let setHi = -Infinity;
      for (const id of on) {
        const b = brickBox(px, PIECE_SLOT[id as keyof typeof PIECE_SLOT], brickTop(id));
        assert.ok(b.x0 >= 0 && b.x1 <= w, `${w} px, ${key}: ${id} is inside the stage's sides (${b.x0.toFixed(1)} to ${b.x1.toFixed(1)})`);
        assert.ok(
          b.y0 >= inset.top - 2 && b.y1 <= h - inset.bottom + 2,
          `${w} px, ${key}: ${id} is between the caption and the controls (${b.y0.toFixed(1)} to ${b.y1.toFixed(1)} of ${h})`,
        );
        const floor = phone
          ? ((on.length === 1 ? HERO_FLOOR.phoneOne : HERO_FLOOR.phoneAny) * w) / 384
          : on.length === 1
            ? HERO_FLOOR.desktopOne
            : HERO_FLOOR.desktopAny;
        assert.ok(b.width >= floor, `${w} px, ${key}: ${id} is ${b.width.toFixed(1)} px wide on screen, at least ${floor.toFixed(0)}`);
        if (on.length <= 3) {
          upToThree[w] ??= [];
          upToThree[w].push(b.width);
        }
        const bucket = `${w}:${on.length === 1 ? 'one' : on.length <= 3 ? 'upToThree' : 'more'}`;
        least[bucket] = Math.min(least[bucket] ?? Infinity, b.width);
        setLo = Math.min(setLo, b.x0);
        setHi = Math.max(setHi, b.x1);
      }
      // One brick alone is capped so it isn't closer than its links' first stretch; from two bricks on, the set is the picture.
      // A phone's stage is narrow and tall, so the set spans a good part of its width. Two bricks one behind the other set the floor.
      if (on.length >= 2 && phone)
        assert.ok(
          (setHi - setLo) / w >= 0.35,
          `${w} px, ${key}: the placed set spans ${(((setHi - setLo) / w) * 100).toFixed(0)}% of the stage's width, at least 35%`,
        );
    }
  }
  for (const [w, widths] of Object.entries(upToThree)) {
    const median = widths.sort((a, b) => a - b)[widths.length >> 1];
    const floor = Number(w) < 620 ? (HERO_FLOOR.phoneMedianUpToThree * Number(w)) / 384 : HERO_FLOOR.desktopMedianUpToThree;
    assert.ok(
      median >= floor,
      `${w} px: with one to three bricks on, the median brick is ${median.toFixed(1)} px wide, at least ${floor.toFixed(0)}`,
    );
  }
  console.log(
    'hero: narrowest placed brick in CSS px, by stage width and bricks on the plate:',
    JSON.stringify(Object.fromEntries(Object.entries(least).map(([k, v]) => [k, Math.round(v)]))),
  );
});

test('hero: with nothing snapped on, all seven bricks stand side by side on the stage, large', () => {
  for (const [w, h] of HERO_STAGES) {
    const phone = w < 620;
    const slots = offerSlots(phone ? 2 : 4);
    assert.deepStrictEqual(Object.keys(slots), [...PIECE_IDS]);
    const rects = Object.values(slots);
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i], rects[j]), `offer: bricks ${i} and ${j} don't overlap`);
    const px = projector(w, h, shotFor(w, h, []));
    for (const id of PIECE_IDS) {
      const b = brickBox(px, slots[id], brickTop(id));
      assert.ok(b.x0 >= 0 && b.x1 <= w && b.y0 >= 0 && b.y1 <= h, `${w} px: ${id} is on the stage in the offer`);
      const floor = phone ? (HERO_FLOOR.offerPhone * w) / 384 : HERO_FLOOR.offerDesktop;
      assert.ok(b.width >= floor, `${w} px: ${id} is ${b.width.toFixed(1)} px wide in the offer, at least ${floor}`);
    }
  }
});

test('hero: an open brick sits whole under its tiles, with its own links in the picture, and the tiles are large', () => {
  for (const [w, h0] of HERO_STAGES) {
    const phone = w < 620;
    // A phone's stage grows to 74% of the first screen while a brick is open.
    const h = phone ? 616 : h0;
    for (const id of PIECE_IDS) {
      const block = data.blocks.find((b) => b.id === id)!;
      // The custom piece fans out four tiles with two mark lines and a link line; the others their headline types, with a link line where they carry one.
      const n = id === CUSTOM_PIECE ? 4 : Math.min(block.resources.length, 6);
      const hud = hudLayout(w, h, n, id === CUSTOM_PIECE ? 3 : 1);
      assert.ok(hud.piece >= (phone ? 64 : 72), `${w} px: an open brick's tiles are ${hud.piece} px`);
      for (const it of hud.items)
        assert.ok(it.cx - hud.piece / 2 >= 0 && it.cx + hud.piece / 2 <= w, `${w} px, ${id}: every tile is inside the stage's sides`);
      const on = [id];
      const own = litEdges({ kind: 'node', id }, on);
      const px = projector(w, h, shotFor(w, h, on, { lit: own, fanned: id, hudBottom: hud.bottom }));
      const b = brickBox(px, PIECE_SLOT[id], BRICK.body, LIFT);
      const bottom = h - (phone ? STAGE_INSET.phone.bottom : STAGE_INSET.desktop.bottom);
      assert.ok(
        b.x0 >= 0 && b.x1 <= w && b.y0 >= hud.bottom && b.y1 <= bottom + 2,
        `${w} px: open ${id} sits under its tiles and over the controls (${b.y0.toFixed(1)} to ${b.y1.toFixed(1)}, tiles end at ${hud.bottom}, controls start at ${bottom})`,
      );
      assert.ok(b.width >= (phone ? 80 : 110), `${w} px: open ${id} is ${b.width.toFixed(1)} px wide`);
      for (const edge of own)
        for (const [x, z] of LINK_PATH[edge]) {
          const [sx, sy] = px(x, 0.05, z);
          assert.ok(sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${w} px: open ${id}'s link ${edge} is on the stage`);
        }
    }
  }
});

test('hero: a tapped socket or link is brought into the picture with the bricks', () => {
  const on = [...PIECE_IDS];
  for (const [w, h] of HERO_STAGES) {
    for (const node of Object.keys(SOCKET_SHAPE)) {
      const lit = litEdges({ kind: 'node', id: node }, on);
      const px = projector(w, h, shotFor(w, h, on, { lit }));
      for (const edge of lit)
        for (const [x, z] of LINK_PATH[edge]) {
          const [sx, sy] = px(x, 0.05, z);
          assert.ok(sx >= 0 && sx <= w && sy >= 0 && sy <= h, `${w} px: ${edge}, lit by ${node}, is on the stage`);
        }
    }
  }
});

// ─── What a tap lights ───────────────────────────────────────────────────────

test('focus: a node lights the links that end on it, a link lights itself, and a piece names every other piece on the plate', () => {
  const on = [...PIECE_IDS];
  const combo = comboOf(on)!;
  for (const id of combo.edgeIds) assert.deepStrictEqual(litEdges({ kind: 'edge', id }, on), [id]);
  for (const node of plugNodes(on)) {
    const lit = litEdges({ kind: 'node', id: node.id }, on);
    assert.deepStrictEqual(
      lit,
      combo.edgeIds.filter((id) => edgeById.get(id)!.from === node.id || edgeById.get(id)!.to === node.id),
    );
    assert.strictEqual(lit.length, node.links);
  }
  // Ten links end on the shared role with the six earlier pieces on, and the custom Block (all standards on) adds two.
  assert.strictEqual(
    litEdges(
      { kind: 'node', id: 'core:role' },
      on.filter((id) => id !== CUSTOM_PIECE),
    ).length,
    10,
  );
  assert.strictEqual(litEdges({ kind: 'node', id: 'core:role' }, on).length, 12);
  assert.deepStrictEqual(
    litEdges({ kind: 'edge', id: 'core:role>realtime:can-read-and-write' }, on),
    [],
    'an edge that is not in the arrangement lights nothing',
  );
  for (const mode of NAMING_MODES)
    for (const a of PIECE_IDS)
      for (const b of PIECE_IDS) {
        if (a === b) continue;
        const line = pairLine(a, b, on, mode)!;
        assert.match(line, /connect only through the app|have no direct link/, `${a}+${b}: ${line}`);
      }
  // The open view marks the resources that carry a link, from the edge's carriers.
  const marks = carrierMarks('kvstore', ['kvstore'], 'generic');
  assert.deepStrictEqual([...marks.keys()], ['AWS::DynamoDB::Table']);
  assert.deepStrictEqual(
    marks.get('AWS::DynamoDB::Table')!.map((m) => m.edgeId),
    ['core:role>kvstore:can-read-and-write'],
  );
  for (const id of PIECE_IDS) assert.ok(carrierMarks(id, on, 'exact').size >= 1, `${id} has at least one marked resource`);
});

test('wildcard grant: the one link the template grants by pattern says it covers any agent runtime and any model in the account', () => {
  const wild = connections.edges.filter((e) => e.evidence.every((row) => row.via === 'wildcard')).map((e) => e.id);
  assert.deepStrictEqual(wild, ['core:role>agent:can-invoke']);
  for (const e of connections.edges) assert.strictEqual(edgeNote(e.id) !== null, wild.includes(e.id), e.id);
  for (const mode of NAMING_MODES) {
    assert.strictEqual(
      meaningOf(wild[0], mode),
      `${sentenceOf(wild[0], mode)} The grant in the template covers any agent runtime in the account, not only this one. The same role may also call any AI model the account can use, not only the agent's.`,
    );
    assert.strictEqual(meaningOf('core:role>kvstore:can-read-and-write', mode), sentenceOf('core:role>kvstore:can-read-and-write', mode));
  }
  assert.doesNotMatch(edgeNote(wild[0])!, SERVICE_WORD);
});

// ─── Naming ──────────────────────────────────────────────────────────────────

test('naming: every resource type in the data has an exact name and a generic name, and no generic text names a service', () => {
  const types = new Set<string>();
  for (const n of connections.nodes) for (const r of n.resources) types.add(r.type);
  for (const b of data.blocks) {
    for (const r of b.resources) types.add(r.type);
    for (const s of b.supporting) types.add(s.type);
  }
  for (const t of Object.keys(ownSynth.resourcesByType)) types.add(t);
  assert.ok(types.size >= 39);
  for (const t of types) {
    const row = naming.types[t];
    assert.ok(row && row.exact.length > 2 && row.generic.length > 2, `${t} has both names`);
    assert.strictEqual(typeName(t, 'exact'), row.exact);
    assert.strictEqual(typeName(t, 'generic'), row.generic);
    assert.doesNotMatch(row.generic, SERVICE_WORD, `${t}: generic name`);
    assert.doesNotMatch(typeLabel(t, 'generic'), /^(a|an) /i, `${t}: the label has no article`);
  }
  for (const n of connections.nodes) {
    assert.ok(naming.nodes[n.id]?.exact && naming.nodes[n.id]?.generic, `${n.id} has both names`);
    assert.doesNotMatch(nodeName(n.id, 'generic'), SERVICE_WORD);
    assert.doesNotMatch(nodeLabel(n.id, 'generic'), SERVICE_WORD);
  }
  for (const e of connections.edges) {
    assert.strictEqual(sentenceOf(e.id, 'exact'), e.sentence.exact);
    assert.strictEqual(sentenceOf(e.id, 'generic'), e.sentence.generic);
    assert.doesNotMatch(e.sentence.generic, SERVICE_WORD, e.id);
  }
  // A piece's tagline and note, and the case note under the plate, name no service in Generic mode either.
  for (const b of data.blocks) {
    const text = blockText(b, 'generic');
    assert.doesNotMatch(text.tagline, SERVICE_WORD, `${b.id}: generic tagline`);
    assert.doesNotMatch(text.note ?? '', SERVICE_WORD, `${b.id}: generic note`);
  }
  // Exact mode does name services, so the two modes really differ.
  assert.match(sentenceOf('agent>core:role:runs-as', 'exact'), /Bedrock AgentCore/);
  assert.match(typeLabel('AWS::BedrockAgentCore::Runtime', 'exact'), /Bedrock AgentCore/);
  assert.strictEqual(typeLabel('AWS::BedrockAgentCore::Runtime', 'generic'), 'Managed AI services');
});

test('naming: counts and structure are the same in both modes', () => {
  for (const key of ALL_KEYS) {
    const on = key.split('+');
    assert.deepStrictEqual(
      edgesOn(on).map((e) => e.id),
      connections.combos[key].edgeIds,
    );
    assert.strictEqual(countLine(on, stackTotal(on), 1, 'generic').connections, countLine(on, stackTotal(on), 1, 'exact').connections);
  }
});

test('naming: in Generic mode no tile carries a service-level icon; in Exact mode the icons are the ones the build shipped', () => {
  const types = new Set<string>([
    ...Object.values(LEAD_TYPE),
    ...data.blocks.flatMap((b) => b.resources.map((r) => r.type)),
    ...Object.keys(ownSynth.resourcesByType),
  ]);
  for (const t of types) {
    const exact = iconFor(t, 'exact');
    const generic = iconFor(t, 'generic');
    assert.strictEqual(exact === null, generic === null, `${t}: an icon in one mode means an icon in the other`);
    if (!exact || !generic) continue;
    assert.notStrictEqual(generic.kind, 'service', `${t}: Generic mode shows no service icon`);
    assert.notStrictEqual(exact.kind, 'category', `${t}: Exact mode shows no category icon`);
    if (exact.kind === 'service') assert.strictEqual(generic.kind, 'category', `${t}: a service icon gives way to its category icon`);
  }
  assert.strictEqual(iconFor('AWS::BedrockAgentCore::Runtime', 'generic')?.key, 'category:Artificial-Intelligence');
  assert.strictEqual(iconFor('AWS::BedrockAgentCore::Runtime', 'exact')?.key, 'AWS::BedrockAgentCore::Runtime');
  assert.strictEqual(iconFor('AWS::Lambda::Function', 'generic')?.key, 'category:Compute');
  assert.strictEqual(iconFor('AWS::DynamoDB::Table', 'generic')?.key, 'AWS::DynamoDB::Table');
});

test('naming switch: Generic is the default, ?names= wins, the browser remembers, and a link carries the mode only as ?names=', () => {
  assert.strictEqual(naming.default, 'generic');
  assert.strictEqual(DEFAULT_MODE, 'generic');
  const store = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    location: { search: '' },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
  };
  assert.strictEqual(initialMode(''), 'generic');
  assert.strictEqual(initialMode('?names=exact'), 'exact');
  assert.strictEqual(initialMode('?names=generic'), 'generic');
  assert.strictEqual(initialMode('?names=loud'), 'generic', 'an unknown value is ignored');
  store.set('baseplate:names', 'exact');
  assert.strictEqual(initialMode(''), 'exact', 'the browser remembers');
  assert.strictEqual(initialMode('?b=abcdefghij&names=generic'), 'generic', 'the link wins over what the browser remembers');
  delete (globalThis as { window?: unknown }).window;
  const link = withNames('https://example.test/?b=abcdefghij', 'exact');
  assert.strictEqual(link, 'https://example.test/?b=abcdefghij&names=exact');
  assert.deepStrictEqual([...new URL(withNames(link, 'generic')).searchParams.keys()], ['b', 'names']);
});
