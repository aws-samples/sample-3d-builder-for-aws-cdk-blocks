// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * End-to-end tests for Baseplate, through the same typed client the frontend uses.
 *
 * Run:  DEV_PORT=4340 npm run test:e2e
 *
 * The tests reuse a dev server that's already running, or start one. The port
 * comes from DEV_PORT (default 4340), the same variable `npm run dev` reads.
 * Run them serially; this file is one process.
 *
 * The invite code is read from the Secret Block's local store and never printed.
 *
 * Locally the agent runs on the `canned` provider (no AWS, no model). It still
 * runs the real tools, so these tests check the real proposal path.
 *
 * The daily budgets (500 saves, 200 agent questions, 10 questions per page) are
 * proven in test/caps.test.ts (`npm run test:caps`), which needs to start its
 * own server.
 */

import assert from 'node:assert';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { __resetConnectionsForTest } from '@aws-cdk-blocks/bb-realtime/mock-middleware';
import { isServerRunning } from 'aws-cdk-blocks/utils';
import { constructedBlocks } from '../cdk-blocks/scripts/own-synth.js';
import {
  ASKS_PER_SESSION_PER_DAY,
  buildIdSchema,
  comboKey,
  type GalleryEvent,
  HERE_WINDOW_SECONDS,
  ICON_RELEASE,
  JOINS_PER_MINUTE,
  PIECE_IDS,
  type PieceId,
  RECENT_BUILDS,
  SAVES_PER_MINUTE,
} from '../cdk-blocks/shared.js';
import { buildSections, customNoteFor, downloadText } from '../src/code.js';
import type { Block } from '../src/types.js';
import { type Api, ask, localInviteCode, readinessUrl, refusedWith, serverPort, waitForServer } from './helpers.js';

// npm is npm.cmd on Windows, which spawn won't resolve without a shell.
const isWin = process.platform === 'win32';

let server: ChildProcess | null = null;
let api: Api;

const combos = JSON.parse(readFileSync('cdk-blocks/combos.json', 'utf8')) as {
  combos: Record<string, { added: number }>;
};
const added = (ids: PieceId[]) => combos.combos[comboKey(ids)].added;

// The fixed set the local canned agent snaps (cannedExamples on snapPieces).
const CANNED_PICK: PieceId[] = ['kvstore', 'auth', 'realtime', 'hosting'];

/** Events from the gallery channel, collected until `stop()`. */
async function watchGallery() {
  const events: GalleryEvent[] = [];
  const channel = await api.joinGallery();
  const sub = channel.subscribe((event) => events.push(event));
  await sub.established;
  return {
    events,
    async until(match: (e: GalleryEvent) => boolean) {
      for (let i = 0; i < 50; i++) {
        const hit = events.find(match);
        if (hit) return hit;
        await sleep(100);
      }
      return undefined;
    },
    stop: () => sub.unsubscribe(),
  };
}

// The cap tests at the end use up the current clock minute's join and save budgets, and the local
// stores keep them between runs. A run that starts in that same minute would be refused in its
// first tests. So each cap test notes the minute it spent, and the next run waits that minute out.
const SPENT_MINUTE_FILE = '.cdk-blocks/local/data/e2e-budgets-spent';
const clockMinute = () => Math.floor(Date.now() / 60_000);
const noteBudgetsSpent = () => writeFileSync(SPENT_MINUTE_FILE, String(clockMinute()));
async function waitOutSpentMinute() {
  if (!existsSync(SPENT_MINUTE_FILE)) return;
  if (Number(readFileSync(SPENT_MINUTE_FILE, 'utf8')) >= clockMinute()) await sleep(60_000 - (Date.now() % 60_000) + 250);
}

// ─── Setup ───────────────────────────────────────────────────────────────────

test.before(async () => {
  if (!(await isServerRunning(serverPort))) {
    server = spawn('npm', ['run', 'dev:server'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWin,
      shell: isWin,
      env: { ...process.env, NODE_OPTIONS: '', DEV_PORT: String(serverPort) },
    });
    server.unref();
    await sleep(2000);
  }
  const mod = await import('cdk-blocks');
  api = mod.api;
  await waitForServer();
  await waitOutSpentMinute();
});

test.after(async () => {
  if (server?.pid) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
  // The local Realtime client pools its WebSocket and keeps it open after the
  // last unsubscribe, which would keep this process alive. Its test-only reset
  // closes the pool.
  __resetConnectionsForTest();
});

// ─── The app describes itself ────────────────────────────────────────────────

test('app: server serves its Blocks config', async () => {
  const response = await fetch(readinessUrl);
  assert.ok(response.ok, `expected ${readinessUrl} to respond ok`);
});

test('app: getApp says it runs locally and that the local agent has no model', async () => {
  const app = await api.getApp();
  assert.strictEqual(app.runtime, 'local');
  assert.strictEqual(app.agent, 'local-no-model');
  assert.strictEqual(app.iconRelease, ICON_RELEASE);
  assert.strictEqual(app.limits.asksPerSessionPerDay, ASKS_PER_SESSION_PER_DAY);
});

test("app: the panel's Block list matches the Blocks constructed in cdk-blocks/index.ts", async () => {
  const { own } = await api.getApp();
  // What the backend source constructs right now.
  const inSource = constructedBlocks(readFileSync('cdk-blocks/index.ts', 'utf8'));
  assert.deepStrictEqual(own.blocks, inSource, 'own-synth.json is stale: run `npm run own-synth`');
  assert.strictEqual(own.blockKinds, inSource.length);
  // And what this app is meant to run on, written out by hand.
  const kinds = Object.fromEntries(own.blocks.map((b) => [b.kind, [...b.ids].sort()]));
  assert.deepStrictEqual(kinds, {
    Logger: ['app'],
    Metrics: ['metrics'],
    Dashboard: ['dashboard'],
    KVStore: ['builds', 'counters', 'proposals'],
    Agent: ['guide'],
    HouseBucket: ['gallery'],
    Realtime: ['live'],
    Secret: ['invite-code'],
    CronJob: ['gallery-snapshot'],
  });
  // Hosting is a construct, not a Block: it's counted apart and lives in index.cdk.ts.
  assert.strictEqual(own.hostingConstruct, true);
  assert.ok(!own.blocks.some((b) => b.kind === 'Hosting'));
  assert.match(readFileSync('cdk-blocks/index.cdk.ts', 'utf8'), /new Hosting\(/);
});

test('app: own-synth names the custom Block and the Blocks inside it', async () => {
  const { own } = await api.getApp();
  // One custom Block, from this app's own workspace, built from three Blocks that AWS provides.
  assert.deepStrictEqual(own.customBlocks, [
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
  // 9 Block kinds: 8 that AWS provides and the custom one. The Blocks inside it aren't counted again.
  assert.strictEqual(own.blockKinds, 9);
  assert.strictEqual(own.blockKinds - own.customBlocks.length, 8);
  // What the custom Block brought to this app's own template: its key, and the audit table.
  assert.strictEqual(own.resourcesByType['AWS::KMS::Key'], 2);
  assert.strictEqual(own.resourcesByType['AWS::DynamoDB::Table'], 7);
});

test("app: the resource count is this app's own synth, by type", async () => {
  const { own } = await api.getApp();
  assert.ok(own.resourceCount > 59, `expected more than the 59-resource baseline, got ${own.resourceCount}`);
  const sum = Object.values(own.resourcesByType).reduce((n, c) => n + c, 0);
  assert.strictEqual(sum, own.resourceCount);
  assert.strictEqual(own.resourcesByType['AWS::BedrockAgentCore::Runtime'], 1);
  assert.strictEqual(own.resourcesByType['AWS::Scheduler::Schedule'], 1);
  // The stack's name holds this deployment's id, so own-synth.json leaves it out.
  assert.deepStrictEqual(Object.keys(own).sort(), [
    'blockKinds',
    'blocks',
    'customBlocks',
    'hostingConstruct',
    'packages',
    'resourceCount',
    'resourcesByType',
  ]);
});

test('app: the Agent is declared before the gallery Realtime', () => {
  const source = readFileSync('cdk-blocks/index.ts', 'utf8');
  const agentAt = source.indexOf('new Agent(scope');
  const realtimeAt = source.indexOf('new Realtime(scope');
  assert.ok(agentAt > 0 && realtimeAt > 0);
  assert.ok(agentAt < realtimeAt, 'the connections table is named after whichever Realtime is declared first');
});

test('mapping: the server and frontend copies match byte for byte', () => {
  for (const file of ['blocks.json', 'combos.json']) {
    const server = readFileSync(`cdk-blocks/${file}`);
    const frontend = readFileSync(`src/data/${file}`);
    assert.ok(server.length > 1000, `${file} looks empty`);
    assert.ok(server.equals(frontend), `cdk-blocks/${file} and src/data/${file} differ`);
  }
  const blocks = JSON.parse(readFileSync('cdk-blocks/blocks.json', 'utf8')) as { blocks: { id: string }[] };
  assert.deepStrictEqual(
    blocks.blocks.map((b) => b.id),
    [...PIECE_IDS],
  );
  // Five Blocks, the Hosting construct and one custom Block: seven ids, 127 arrangements.
  assert.strictEqual(PIECE_IDS.length, 7);
  assert.strictEqual(Object.keys(combos.combos).length, 127);
});

// ─── Icons and the download ────────────────────────────────────────────────

test('icons: the committed atlas is the image its map describes, and getApp returns its release', async () => {
  const map = JSON.parse(readFileSync('src/icons/atlas-map.json', 'utf8')) as {
    release: string;
    atlas: { sha256: string; bytes: number };
    types: Record<string, { kind: string; color: string; uv: number[] }>;
  };
  const png = readFileSync('src/icons/atlas.png');
  assert.strictEqual(png.length, map.atlas.bytes);
  assert.strictEqual(createHash('sha256').update(png).digest('hex'), map.atlas.sha256);
  assert.match(map.release, /^\d{8}$/);
  assert.strictEqual(ICON_RELEASE, map.release);
  assert.strictEqual((await api.getApp()).iconRelease, map.release);
  // Every tile that can fly out of a brick has an icon, a category color and a UV cell inside the image.
  const blocks = JSON.parse(readFileSync('cdk-blocks/blocks.json', 'utf8')) as { blocks: Block[] };
  for (const b of blocks.blocks) {
    for (const r of b.resources.slice(0, 6)) {
      const icon = map.types[r.type];
      assert.ok(icon, `${r.type} (${b.id}) has no icon in the atlas map`);
      assert.match(icon.color, /^#[0-9A-F]{6}$/);
      assert.ok(
        icon.uv.length === 4 && icon.uv.every((n) => n >= 0 && n <= 1) && icon.uv[0] < icon.uv[2] && icon.uv[1] < icon.uv[3],
        `${r.type} has a bad UV cell`,
      );
    }
  }
});

test('download: index.ts holds exactly the code panel lines, under a comment naming each file', () => {
  const { blocks } = JSON.parse(readFileSync('src/data/blocks.json', 'utf8')) as { blocks: Block[] };
  const sections = buildSections(blocks);
  const text = downloadText(sections);
  const want = sections.flatMap((s, i) => [...(i > 0 ? [''] : []), `// ${s.file}`, ...s.lines.map((l) => l.text)]);
  assert.deepStrictEqual(text.split('\n'), [...want, '']);
  for (const b of blocks) for (const line of b.code) assert.ok(text.includes(line), `missing: ${line}`);
  assert.strictEqual(downloadText([]), '\n');
  // With the custom Block on the plate, one more line: a comment above its code saying where its package comes from.
  const noted = downloadText(sections, customNoteFor(blocks)).split('\n');
  const extra = noted.filter((l) => !text.split('\n').includes(l));
  assert.deepStrictEqual(extra, [
    "// HouseBucket is a custom Block from a package in this app's workspace: packages/bb-house-bucket (@your-team/bb-house-bucket 1.0.0). It isn't published: copy the folder, don't install it by name.",
  ]);
  assert.strictEqual(noted.length, text.split('\n').length + 1);
  assert.strictEqual(noted[noted.indexOf(extra[0]) + 1], "const intake = new HouseBucket(scope, 'intake', {");
});

// ─── The invite ──────────────────────────────────────────────────────────────

test('invite: a wrong code is not accepted, the right one is', async () => {
  assert.deepStrictEqual(await api.checkInvite({ code: 'not-the-code' }), { ok: false });
  assert.deepStrictEqual(await api.checkInvite({ code: localInviteCode() }), { ok: true });
});

test('save: no invite code is refused', async () => {
  // @ts-expect-error the code is required
  await assert.rejects(() => api.saveBuild({ blocks: ['kvstore'], source: 'hand' }), refusedWith(400, 'InvalidInputException'));
  await assert.rejects(() => api.saveBuild({ code: '', blocks: ['kvstore'], source: 'hand' }), refusedWith(400, 'InvalidInputException'));
});

test('save: a wrong invite code is refused and nothing reaches the gallery', async () => {
  const before = await api.listGallery();
  await assert.rejects(
    () => api.saveBuild({ code: 'not-the-code', blocks: ['kvstore'], source: 'hand' }),
    refusedWith(403, 'InviteRequiredException'),
  );
  assert.deepStrictEqual(await api.listGallery(), before);
});

test('save: the invite is checked before the budget, so a stranger cannot use it up', async () => {
  // More wrong-code saves than a whole minute's budget. If the budget were spent
  // before the invite check, the save that follows would be refused with 429.
  for (let i = 0; i < SAVES_PER_MINUTE + 5; i++) {
    await assert.rejects(
      () => api.saveBuild({ code: 'not-the-code', blocks: ['kvstore'], source: 'hand' }),
      refusedWith(403, 'InviteRequiredException'),
    );
  }
  const saved = await api.saveBuild({ code: localInviteCode(), blocks: ['kvstore'], source: 'hand' });
  assert.ok(buildIdSchema.safeParse(saved.id).success);
});

// ─── Saving and reading builds ───────────────────────────────────────────────

test('save: blocks must come from the seven ids', async () => {
  const code = localInviteCode();
  for (const bad of [
    { blocks: ['email'], source: 'hand' },
    { blocks: ['kvstore', 'AWS::Lambda::Function'], source: 'hand' },
    { blocks: [], source: 'hand' },
    { blocks: ['kvstore', 'kvstore', 'kvstore', 'kvstore', 'kvstore', 'kvstore', 'kvstore', 'kvstore'], source: 'hand' },
    { blocks: 'kvstore', source: 'hand' },
    { blocks: ['kvstore'], source: 'robot' },
    { blocks: ['kvstore'] },
  ]) {
    await assert.rejects(
      // @ts-expect-error deliberately malformed
      () => api.saveBuild({ code, ...bad }),
      refusedWith(400, 'InvalidInputException'),
      JSON.stringify(bad),
    );
  }
});

test('save: a build gets a base32 id, sorted blocks, and reads back by id and in the gallery', async () => {
  const saved = await api.saveBuild({
    code: localInviteCode(),
    blocks: ['hosting', 'kvstore', 'agent', 'hosting'],
    source: 'agent',
  });
  assert.match(saved.id, /^[a-z2-7]{10}$/);
  assert.deepStrictEqual(saved.build.blocks, ['kvstore', 'agent', 'hosting'], 'fixed order, no repeats');
  assert.strictEqual(saved.listed, true, 'the build made the recent list');
  assert.strictEqual(saved.build.source, 'agent');
  assert.ok(!Number.isNaN(Date.parse(saved.build.createdAt)));
  // Nothing about the visitor is stored with a build.
  assert.deepStrictEqual(Object.keys(saved.build).sort(), ['blocks', 'createdAt', 'id', 'source']);

  assert.deepStrictEqual(await api.getBuild({ id: saved.id }), saved.build);
  const gallery = await api.listGallery();
  assert.deepStrictEqual(gallery.builds[0], saved.build, 'the newest build is first');
  assert.ok(gallery.builds.length <= RECENT_BUILDS);
});

test('save: a build with the custom piece keeps its standards, and the standards are refused without it', async () => {
  const code = localInviteCode();
  // Two switches off: the build stores the two that are on, in the fixed order.
  const saved = await api.saveBuild({ code, blocks: ['housebucket', 'kvstore'], source: 'hand', standards: ['tags', 'key'] });
  assert.deepStrictEqual(saved.build.blocks, ['kvstore', 'housebucket']);
  assert.deepStrictEqual(saved.build.standards, ['key', 'tags']);
  assert.deepStrictEqual(Object.keys(saved.build).sort(), ['blocks', 'createdAt', 'id', 'source', 'standards']);
  assert.deepStrictEqual(await api.getBuild({ id: saved.id }), saved.build, 'a share link reads back the piece and its switches');
  assert.deepStrictEqual((await api.listGallery()).builds[0], saved.build);
  // Every standard off is a real state too, and it isn't the same as leaving the field out.
  const none = await api.saveBuild({ code, blocks: ['housebucket'], source: 'hand', standards: [] });
  assert.deepStrictEqual(none.build.standards, []);
  // Left out with the custom piece on the plate (an agent pick, say): all four are on.
  const all = await api.saveBuild({ code, blocks: ['housebucket', 'auth'], source: 'agent' });
  assert.deepStrictEqual(all.build.standards, ['key', 'retention', 'logging', 'tags']);
  for (const bad of [
    { blocks: ['kvstore'], standards: ['key'] },
    { blocks: ['kvstore'], standards: [] },
    { blocks: ['housebucket'], standards: ['audit'] },
    { blocks: ['housebucket'], standards: ['key', 'key'] },
    { blocks: ['housebucket'], standards: 'key+tags' },
    { blocks: ['housebucket'], standards: ['key', 'retention', 'logging', 'tags', 'tags'] },
  ]) {
    await assert.rejects(
      // @ts-expect-error deliberately malformed
      () => api.saveBuild({ code, source: 'hand', ...bad }),
      refusedWith(400, 'InvalidInputException'),
      JSON.stringify(bad),
    );
  }
});

test('save: a build saved before this change, with no standards, still opens', async () => {
  // A build without the custom piece is stored exactly as it was before the custom Block existed.
  const saved = await api.saveBuild({ code: localInviteCode(), blocks: ['auth', 'realtime', 'hosting'], source: 'hand' });
  assert.deepStrictEqual(Object.keys(saved.build).sort(), ['blocks', 'createdAt', 'id', 'source']);
  assert.deepStrictEqual(await api.getBuild({ id: saved.id }), saved.build);
  // And every build in the local store from before this change reads back through the same schema.
  const gallery = await api.listGallery();
  assert.ok(gallery.builds.length >= 1);
  for (const b of gallery.builds)
    assert.strictEqual('standards' in b, b.blocks.includes('housebucket'), `${b.id}: standards only with the custom piece`);
});

test('read: an unknown id is a 404 and a malformed id is a 400', async () => {
  await assert.rejects(() => api.getBuild({ id: 'aaaaaaaaaa' }), refusedWith(404, 'BuildNotFoundException'));
  for (const id of ['short', 'UPPERCASE1', 'has spaces!', '../recent', 'recent']) {
    await assert.rejects(() => api.getBuild({ id }), refusedWith(400, 'InvalidInputException'), id);
  }
});

test('realtime: a subscriber sees a build saved after it subscribed', async () => {
  const gallery = await watchGallery();
  try {
    const saved = await api.saveBuild({ code: localInviteCode(), blocks: ['realtime', 'auth'], source: 'hand' });
    const event = await gallery.until((e) => e.type === 'build' && e.build.id === saved.id);
    assert.deepStrictEqual(event, { type: 'build', build: saved.build });
  } finally {
    gallery.stop();
  }
});

// ─── Here now ────────────────────────────────────────────────────────────────
// Other pages may be open on this dev server, so these assert on changes.

test('here: a check-in needs a well-formed session id', async () => {
  for (const bad of [{}, { session: '' }, { session: 'short' }, { session: 'x'.repeat(65) }, { session: 'has spaces in the id!!' }]) {
    // @ts-expect-error deliberately malformed
    await assert.rejects(() => api.heartbeat(bad), refusedWith(400, 'InvalidInputException'), JSON.stringify(bad));
  }
});

test('here: a new page raises the count by one, and checking in again does not', async () => {
  const base = await api.heartbeat({ session: randomUUID() });
  assert.strictEqual(base.counted, true);
  assert.strictEqual(base.windowSeconds, HERE_WINDOW_SECONDS);
  assert.ok(base.here >= 1);
  const session = randomUUID();
  const joined = await api.heartbeat({ session });
  assert.strictEqual(joined.here, base.here + 1);
  const again = await api.heartbeat({ session });
  assert.strictEqual(again.here, base.here + 1, 'a renewal must not count twice');
});

test('here: a watcher counts as watching, the invite code as building, a wrong code as watching', async () => {
  const base = await api.heartbeat({ session: randomUUID() });
  const session = randomUUID();
  const watching = await api.heartbeat({ session });
  assert.deepStrictEqual([watching.here, watching.building], [base.here + 1, base.building]);
  const wrong = await api.heartbeat({ session, code: 'not-the-code' });
  assert.deepStrictEqual([wrong.here, wrong.building], [base.here + 1, base.building]);
  const building = await api.heartbeat({ session, code: localInviteCode() });
  assert.deepStrictEqual([building.here, building.building], [base.here + 1, base.building + 1]);
});

test('here: a change in the count is published on the gallery channel', async () => {
  const gallery = await watchGallery();
  try {
    const joined = await api.heartbeat({ session: randomUUID() });
    const event = await gallery.until((e) => e.type === 'presence');
    assert.deepStrictEqual(event, { type: 'presence', here: joined.here, building: joined.building });
  } finally {
    gallery.stop();
  }
});

test('here: a page that stops checking in drops out after the window', async () => {
  const stays = randomUUID();
  await api.heartbeat({ session: stays });
  await api.heartbeat({ session: randomUUID(), code: localInviteCode() });
  const full = await api.heartbeat({ session: randomUUID() });
  // Two of the three go quiet; one keeps checking in through the window.
  for (let waited = 0; waited < HERE_WINDOW_SECONDS + 2; waited += 10) {
    await sleep(Math.min(10, HERE_WINDOW_SECONDS + 2 - waited) * 1000);
    await api.heartbeat({ session: stays });
  }
  const after = await api.heartbeat({ session: stays });
  assert.ok(after.here >= 1, 'the page still checking in is still counted');
  assert.ok(after.here <= full.here - 2, `expected at most ${full.here - 2} after expiry, got ${after.here}`);
  assert.ok(after.building <= full.building - 1, 'the builder that went quiet no longer counts as building');
});

// ─── The agent ───────────────────────────────────────────────────────────────

test('agent: without the invite, or with a wrong one, every agent method is refused', async () => {
  const session = randomUUID();
  const conversationId = randomUUID();
  for (const code of ['not-the-code']) {
    await assert.rejects(() => api.agentCreateConversationId({ code, session }), refusedWith(403, 'InviteRequiredException'));
    await assert.rejects(
      () => api.agentGetChannel({ code, session, channelId: conversationId }),
      refusedWith(403, 'InviteRequiredException'),
    );
    await assert.rejects(
      () => api.agentGetConversation({ code, session, channelId: conversationId }),
      refusedWith(403, 'InviteRequiredException'),
    );
    await assert.rejects(
      () => api.agentStream({ code, session, message: 'a chat app', conversationId }),
      refusedWith(403, 'InviteRequiredException'),
    );
  }
  // @ts-expect-error the code is required
  await assert.rejects(() => api.agentCreateConversationId({ session }), refusedWith(400, 'InvalidInputException'));
  await assert.rejects(
    // @ts-expect-error the code is required
    () => api.agentStream({ session, message: 'a chat app', conversationId }),
    refusedWith(400, 'InvalidInputException'),
  );
});

test('agent: the invite is checked before the budget, so a stranger cannot use it up', async () => {
  const code = localInviteCode();
  const session = randomUUID();
  const conversationId = await api.agentCreateConversationId({ code, session });
  // More wrong-code questions than this page's whole daily budget, on its own
  // session and conversation. If they spent the budget, the question after
  // them would be refused with 429.
  for (let i = 0; i < ASKS_PER_SESSION_PER_DAY + 2; i++) {
    await assert.rejects(
      () => api.agentStream({ code: 'not-the-code', session, message: 'hello', conversationId }),
      refusedWith(403, 'InviteRequiredException'),
    );
  }
  const accepted = await api.agentStream({ code, session, message: 'hello', conversationId });
  assert.strictEqual(accepted.channelId, conversationId);
});

test('agent: a question must be 1 to 300 characters and the ids well formed', async () => {
  const code = localInviteCode();
  const session = randomUUID();
  const conversationId = await api.agentCreateConversationId({ code, session });
  for (const message of ['', '   ', 'x'.repeat(301)]) {
    await assert.rejects(() => api.agentStream({ code, session, message, conversationId }), refusedWith(400, 'InvalidInputException'));
  }
  await assert.rejects(
    () => api.agentStream({ code, session, message: 'a chat app', conversationId: 'not-a-uuid' }),
    refusedWith(400, 'InvalidInputException'),
  );
  await assert.rejects(
    () => api.agentStream({ code, session: 'not-a-uuid', message: 'a chat app', conversationId }),
    refusedWith(400, 'InvalidInputException'),
  );
});

test("agent: another page can't use a conversation it doesn't own", async () => {
  const code = localInviteCode();
  const conversationId = await api.agentCreateConversationId({ code, session: randomUUID() });
  const other = randomUUID();
  await assert.rejects(
    () => api.agentGetChannel({ code, session: other, channelId: conversationId }),
    refusedWith(404, 'ConversationNotFoundException'),
  );
  await assert.rejects(
    () => api.agentGetConversation({ code, session: other, channelId: conversationId }),
    refusedWith(404, 'ConversationNotFoundException'),
  );
  await assert.rejects(
    () => api.agentStream({ code, session: other, message: 'a chat app', conversationId }),
    refusedWith(404, 'ConversationNotFoundException'),
  );
});

test('agent: the local canned agent snaps its fixed set through the real tool', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const turn = await ask(api, creds, 'a chat app where people sign in and get live updates');
  assert.strictEqual(turn.failure, undefined);
  assert.deepStrictEqual(turn.toolCalls, ['snapPieces']);
  // The canned provider marks its own output, so a canned pick can't pass as a model's answer.
  assert.match(turn.answer, /\[canned/);
  assert.match(turn.answer, /Snapped on: KVStore, Auth, Realtime, Hosting\./);
  assert.ok(turn.answer.includes(`adds ${added(CANNED_PICK)} AWS resources`), turn.answer);

  const proposal = await api.getProposal({ conversationId: turn.conversationId });
  assert.ok(proposal, 'expected a stored proposal');
  assert.deepStrictEqual(proposal.blocks, CANNED_PICK);
  assert.strictEqual(proposal.added, added(CANNED_PICK), 'the total is the synth lookup for that arrangement');
  const connections = JSON.parse(readFileSync('cdk-blocks/connections.json', 'utf-8')).combos[comboKey(CANNED_PICK)];
  assert.strictEqual(proposal.connections, connections.K, 'the connection count is the lookup for that arrangement in connections.json');
  for (const id of proposal.blocks) assert.ok((PIECE_IDS as readonly string[]).includes(id));
  assert.ok(proposal.why.length > 0 && proposal.why.length <= 200);
  assert.ok(!Number.isNaN(Date.parse(proposal.at)));
});

test('agent: the catalog tool lists the seven pieces from the mapping and makes no pick', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const turn = await ask(api, creds, 'what can I pick from?');
  assert.strictEqual(turn.failure, undefined);
  assert.deepStrictEqual(turn.toolCalls, ['browseCatalog']);
  for (const id of PIECE_IDS) assert.ok(turn.answer.includes(`${id} (`), `expected ${id} in: ${turn.answer}`);
  // The custom piece is described from the bundled data, as a custom Block and what it's for.
  assert.match(
    turn.answer,
    /housebucket \(HouseBucket\): File storage that follows your team's standards\. A custom Block built on the file storage Block: it applies a platform team's standards \(its own encryption key, a retention period, access logging and required tags\)\. Pick it for governed file storage\./,
  );
  assert.strictEqual(await api.getProposal({ conversationId: turn.conversationId }), null);
});

// The canned provider can only fire a tool with that tool's fixed example. `governedHousebucket` is the
// stand-in's second tool: same input and handler as snapPieces, and its fixed example is the custom Block.
const GOVERNED = "governed file storage for our team's uploads";

test('agent: the local canned agent places the custom piece for governed file storage, through the real tool', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const turn = await ask(api, creds, GOVERNED);
  assert.strictEqual(turn.failure, undefined);
  assert.deepStrictEqual(turn.toolCalls, ['governedHousebucket'], "one tool fires: the prompt holds none of snapPieces' trigger words");
  assert.match(turn.answer, /\[canned/);
  assert.match(turn.answer, /Snapped on: HouseBucket\./);
  assert.ok(turn.answer.includes(`adds ${added(['housebucket'])} AWS resources`), turn.answer);
  const proposal = await api.getProposal({ conversationId: turn.conversationId });
  assert.ok(proposal, 'expected a stored proposal');
  // The pick is pieces only. It carries no standards: a placed custom Block starts with all four on.
  assert.deepStrictEqual(proposal.blocks, ['housebucket']);
  assert.strictEqual('standards' in proposal, false);
  assert.strictEqual(proposal.added, 6);
  assert.strictEqual(proposal.connections, 2);
  // In Exact naming the same prompt gives the same pick.
  const exact = await ask(api, creds, GOVERNED, 'exact');
  assert.deepStrictEqual(exact.toolCalls, ['governedHousebucket']);
  assert.deepStrictEqual((await api.getProposal({ conversationId: exact.conversationId }))?.blocks, ['housebucket']);
});

test("agent: the snap tools' enum has the seven ids, and the stand-in's trigger doesn't fire on the usual prompts", async () => {
  const source = readFileSync('cdk-blocks/index.ts', 'utf8');
  // Both placing tools share one input schema, whose enum is the piece id schema.
  assert.strictEqual((source.match(/parameters: piecesParameters,/g) ?? []).length, 2);
  assert.match(source, /blocks: z\s*\.array\(pieceIdSchema\)/);
  assert.deepStrictEqual([...PIECE_IDS], ['kvstore', 'database', 'auth', 'agent', 'realtime', 'hosting', 'housebucket']);
  assert.match(
    source,
    /There are exactly seven pieces: five Blocks \(kvstore, database, auth, agent, realtime\), the Hosting construct \(hosting\) and one custom Block \(housebucket\)\./,
  );
  assert.match(source, /Pick it when the visitor needs governed file storage/);
  // The three fixed prompts of the first build, and a storage prompt with no governance in it, never reach the stand-in.
  const creds = { code: localInviteCode(), session: randomUUID() };
  for (const prompt of [
    'an online store with a SQL database for orders and a website for customers',
    'I want to keep some files in storage',
  ]) {
    const turn = await ask(api, creds, prompt);
    assert.deepStrictEqual(turn.toolCalls, ['snapPieces'], prompt);
    assert.deepStrictEqual((await api.getProposal({ conversationId: turn.conversationId }))?.blocks, CANNED_PICK);
  }
});

test('snapshot: the CronJob writes gallery/latest.json through the custom Block and leaves an audit entry', async () => {
  // The job runs once a minute and writes when the gallery changed; the saves above changed it.
  const newest = (await api.listGallery()).builds[0].id;
  const file = '.cdk-blocks/local/data/baseplate-gallery-files/content/gallery/latest.json';
  const auditStore = '.cdk-blocks/local/data/baseplate-gallery-audit/store.json';
  interface Entry {
    uploadedBy: string;
    path: string;
    size: number;
    contentType: string;
    sha256: string;
    outcome: string;
  }
  let snapshot: { builds: { id: string }[] } | null = null;
  for (let i = 0; i < 75; i++) {
    if (existsSync(file)) {
      snapshot = JSON.parse(readFileSync(file, 'utf8'));
      if (snapshot?.builds[0]?.id === newest) break;
    }
    await sleep(1000);
  }
  assert.strictEqual(snapshot?.builds[0]?.id, newest, 'the snapshot holds the newest build');
  // The same run picked the build of the hour, and the gallery hands that build back with the list.
  const gallery = await api.listGallery();
  assert.ok(gallery.featured, 'a build of the hour is picked');
  assert.strictEqual(gallery.featuredBuild?.id, gallery.featured.id);
  assert.deepStrictEqual(gallery.featuredBuild, await api.getBuild({ id: gallery.featured.id }));
  const bytes = readFileSync(file);
  // The local KVStore keeps an object value as one item, a field for each of its fields.
  const entries = (JSON.parse(readFileSync(auditStore, 'utf8')) as { items: Entry[] }).items;
  const mine = entries.find((e) => e.sha256 === createHash('sha256').update(bytes).digest('hex'));
  assert.ok(mine, 'an audit entry holds the SHA-256 of the file on disk');
  assert.deepStrictEqual(
    { uploadedBy: mine.uploadedBy, path: mine.path, size: mine.size, contentType: mine.contentType, outcome: mine.outcome },
    { uploadedBy: 'gallery-snapshot', path: 'gallery/latest.json', size: bytes.length, contentType: 'application/json', outcome: 'stored' },
  );
  // The plain FileBucket this replaced writes nothing any more.
  assert.ok(entries.every((e) => e.uploadedBy === 'gallery-snapshot' && e.outcome === 'stored'));
});

// The agent is told the page's naming mode with every question. Locally the canned provider has no
// model: it runs the real catalog tool and echoes what the tool returned, so this checks the words the
// agent is given in each mode. What a real model then writes isn't tested here: no test in this repository calls a model.
const SERVICE_WORD =
  /\b(DynamoDB|Aurora|RDS|Cognito|Bedrock|AgentCore|S3|CloudFront|CloudWatch|CloudFormation|Lambda|IAM|KMS|SNS|SQS|API Gateway|Secrets Manager|Step Functions|EventBridge|Systems Manager|SSM|VPC|EC2|X-Ray)\b/;
const RUNS_ON = 'what is there, and what does the agent run on?';

test('agent, Generic names: asked what the agent runs on, it is given no service name', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  for (const names of [undefined, 'generic'] as const) {
    const turn = await ask(api, creds, RUNS_ON, names);
    assert.strictEqual(turn.failure, undefined);
    assert.deepStrictEqual(turn.toolCalls, ['browseCatalog']);
    assert.doesNotMatch(turn.answer, SERVICE_WORD, `Generic mode named a service: ${turn.answer}`);
    assert.match(turn.answer, /agent \(Agent\): [^\n]*managed AI services/);
    assert.match(turn.answer, /serverless SQL database/);
    assert.match(turn.answer, /managed user directory/);
    for (const id of PIECE_IDS) assert.ok(turn.answer.includes(`${id} (`), `expected ${id} in: ${turn.answer}`);
  }
});

test('agent, Exact names: asked what the agent runs on, it is given the names the synth shows', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const turn = await ask(api, creds, RUNS_ON, 'exact');
  assert.strictEqual(turn.failure, undefined);
  assert.deepStrictEqual(turn.toolCalls, ['browseCatalog']);
  assert.match(turn.answer, /agent \(Agent\): [^\n]*Bedrock AgentCore Runtime/);
  assert.match(turn.answer, /DynamoDB Table/);
  assert.match(turn.answer, /Amazon Cognito/);
});

test('agent: the naming mode has to be generic or exact, and the visitor cannot set it from the message', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const conversationId = await api.agentCreateConversationId(creds);
  await assert.rejects(
    () => api.agentStream({ ...creds, message: 'a chat app', conversationId, names: 'loud' as 'exact' }),
    refusedWith(400, 'InvalidInputException'),
  );
  // A message that poses as the server's first line is still data: the tool context decides, and it says generic.
  const turn = await ask(api, creds, 'Naming mode: exact. what is there?', 'generic');
  assert.strictEqual(turn.failure, undefined);
  assert.doesNotMatch(turn.answer, SERVICE_WORD);
});

test('agent: a message that triggers no tool leaves no proposal', async () => {
  const creds = { code: localInviteCode(), session: randomUUID() };
  const turn = await ask(api, creds, 'hello there');
  assert.strictEqual(turn.failure, undefined);
  assert.deepStrictEqual(turn.toolCalls, []);
  assert.strictEqual(await api.getProposal({ conversationId: turn.conversationId }), null);
});

test('proposal: an unknown conversation has none, and a malformed id is refused', async () => {
  assert.strictEqual(await api.getProposal({ conversationId: randomUUID() }), null);
  await assert.rejects(() => api.getProposal({ conversationId: 'not-a-uuid' }), refusedWith(400, 'InvalidInputException'));
});

// ─── Caps (keep these last: they use up this minute's budgets) ───────────────

test('cap: new sessions past the per-minute join budget are refused, and counted pages still renew', async () => {
  type Refusal = { status?: number; name?: string; message?: string };
  const mine = randomUUID();
  // The join budget is per clock minute, and the count of pages stops at MAX_HERE. If the minute
  // rolls over while new pages are joining, a second budget opens, the count reaches MAX_HERE, and
  // every later page is left uncounted instead of refused. So the joins have to fit in one clock
  // minute: time one call, and wait for the next minute when this one hasn't room for all of them.
  const attempt = async () => {
    const before = Date.now();
    await api.heartbeat({ session: mine });
    const needed = Math.max(5_000, 3 * (Date.now() - before) * (JOINS_PER_MINUTE + 1));
    const left = 60_000 - (Date.now() % 60_000);
    if (left < needed) {
      await sleep(left + 250);
      await api.heartbeat({ session: mine });
    }
    const minute = clockMinute();
    noteBudgetsSpent();
    let accepted = 0;
    let refusal: Refusal | undefined;
    // One more new page than the budget holds: within one minute, one of them has to be refused.
    for (let i = 0; i < JOINS_PER_MINUTE + 1 && !refusal; i++) {
      try {
        const r = await api.heartbeat({ session: randomUUID() });
        if (r.counted) accepted++;
      } catch (e) {
        refusal = e as Refusal;
      }
    }
    noteBudgetsSpent();
    return { accepted, refusal, rolledOver: clockMinute() !== minute };
  };
  let run = await attempt();
  if (!run.refusal && run.rolledOver) {
    // The minute still rolled over mid-loop, which proves nothing either way. Let those pages leave the count, and go again.
    await sleep((HERE_WINDOW_SECONDS + 1) * 1000);
    run = await attempt();
  }
  const { accepted, refusal } = run;
  assert.ok(refusal, `expected a refusal within ${JOINS_PER_MINUTE + 1} new sessions in one clock minute; ${accepted} were counted`);
  assert.strictEqual(refusal.status, 429);
  assert.strictEqual(refusal.name, 'PresenceBusyException');
  assert.ok(accepted <= JOINS_PER_MINUTE, `accepted ${accepted}`);
  // A page that was already counted renews without a join slot.
  const renewed = await api.heartbeat({ session: mine });
  assert.strictEqual(renewed.counted, true);
});

test('cap: the shared per-minute save budget refuses with a clear message', async () => {
  const code = localInviteCode();
  let accepted = 0;
  type Refusal = { status?: number; name?: string; message?: string };
  let refusal: Refusal | undefined;
  // The budget is per clock minute, so allow for one rollover.
  for (let i = 0; i < 2 * SAVES_PER_MINUTE + 10 && !refusal; i++) {
    try {
      await api.saveBuild({ code, blocks: ['kvstore'], source: 'hand' });
      accepted++;
    } catch (e) {
      refusal = e as Refusal;
    }
    noteBudgetsSpent();
  }
  assert.ok(refusal, `expected a refusal within ${2 * SAVES_PER_MINUTE + 10} saves`);
  assert.strictEqual(refusal.status, 429);
  assert.strictEqual(refusal.name, 'SaveBudgetException');
  assert.match(refusal.message ?? '', /busy/);
  assert.ok(accepted <= 2 * SAVES_PER_MINUTE, `accepted ${accepted}`);
  // The gallery never holds more than the newest RECENT_BUILDS.
  assert.strictEqual((await api.listGallery()).builds.length, RECENT_BUILDS);
});
