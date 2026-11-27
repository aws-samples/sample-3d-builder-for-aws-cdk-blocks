// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Tests that need no server: the deploy options read from the environment, the first-run setup of
 * .cdk-blocks/config.json, the budgets, the here-now count, the gallery's picks, and a few facts about
 * the stack, the page and the licenses that are read from the source.
 * The budget and presence code runs here on a store in memory with the KVStore's conditional writes.
 *
 * Run:  npm run test:backend
 */
import assert from 'node:assert';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { ApiError, Scope } from 'aws-cdk-blocks';
import { bump, type CounterStore, giveBack, isFull, takeSlot } from '../cdk-blocks/budget.js';
import { readDeployOptions } from '../cdk-blocks/deploy-options.js';
import { addressRefresher, freshSecretReader, secretArnKey } from '../cdk-blocks/fresh-secret.js';
import { nextFeatured, pickFeatured, withNewest } from '../cdk-blocks/gallery-pick.js';
import {
  API_ERROR_PREFIX,
  type ConsoleLike,
  isRefusal,
  logRefusalsAsWarnings,
  skipScheduledRunsUntilConfigIsReady,
} from '../cdk-blocks/handler-guards.js';
import { checkIn, distinct } from '../cdk-blocks/presence.js';
import { AGENT_MAX_TOKENS, AGENT_MODEL_ID, readAgain } from '../cdk-blocks/shared.js';
// @ts-expect-error a plain .mjs script with no types
import { ensureBlocksConfig } from '../scripts/setup.mjs';
import { FLAT } from '../src/theme-flat.js';
import { THEMES, themeOf } from '../src/variants.js';

// ─── Deploy options ──────────────────────────────────────────────────────────

test('deploy options: with nothing set, one neutral tag, data removed on destroy, no WAF and no email', () => {
  assert.deepStrictEqual(readDeployOptions({}), { tags: [['project', 'baseplate']], retainData: false, apiWaf: false, alarmEmail: null });
});

test('deploy options: BASEPLATE_TAGS replaces the default tag, and a malformed entry stops the synth', () => {
  assert.deepStrictEqual(readDeployOptions({ BASEPLATE_TAGS: 'team=web, cost-center = cc-1234 ,' }).tags, [
    ['team', 'web'],
    ['cost-center', 'cc-1234'],
  ]);
  assert.deepStrictEqual(readDeployOptions({ BASEPLATE_TAGS: '' }).tags, [], 'an empty value means no tags');
  for (const bad of ['team', '=web', 'team=', 'a=b,c'])
    assert.throws(() => readDeployOptions({ BASEPLATE_TAGS: bad }), /BASEPLATE_TAGS/, bad);
});

test('deploy options: the switches accept 1, true and yes, and nothing else', () => {
  for (const on of ['1', 'true', 'YES', ' yes ']) {
    assert.strictEqual(readDeployOptions({ BASEPLATE_RETAIN_DATA: on }).retainData, true, on);
    assert.strictEqual(readDeployOptions({ BASEPLATE_API_WAF: on }).apiWaf, true, on);
  }
  for (const off of ['0', 'false', 'no', '', 'on']) {
    assert.strictEqual(readDeployOptions({ BASEPLATE_RETAIN_DATA: off }).retainData, false, off);
    assert.strictEqual(readDeployOptions({ BASEPLATE_API_WAF: off }).apiWaf, false, off);
  }
});

test('deploy options: the alarm email must look like one', () => {
  assert.strictEqual(readDeployOptions({ BASEPLATE_ALARM_EMAIL: ' ops@example.com ' }).alarmEmail, 'ops@example.com');
  assert.strictEqual(readDeployOptions({ BASEPLATE_ALARM_EMAIL: '' }).alarmEmail, null);
  assert.throws(() => readDeployOptions({ BASEPLATE_ALARM_EMAIL: 'not an address' }), /BASEPLATE_ALARM_EMAIL/);
});

// ─── First-run setup ─────────────────────────────────────────────────────────

test('setup: a clone with no .cdk-blocks/config.json gets a stack id of its own, and a second run keeps it', () => {
  const root = mkdtempSync(join(tmpdir(), 'baseplate-setup-'));
  try {
    const first = ensureBlocksConfig(root) as { created: boolean; stackId: string };
    assert.strictEqual(first.created, true);
    assert.match(first.stackId, /^baseplate-[0-9a-f]{6}$/);
    const onDisk = JSON.parse(readFileSync(join(root, '.cdk-blocks/config.json'), 'utf8'));
    assert.deepStrictEqual(onDisk, { stackId: first.stackId }, 'the stack id and nothing else: no telemetry project id is copied in');
    assert.deepStrictEqual(ensureBlocksConfig(root), { created: false, stackId: first.stackId });
    // Two clones don't share an id.
    const other = mkdtempSync(join(tmpdir(), 'baseplate-setup-'));
    try {
      assert.notStrictEqual((ensureBlocksConfig(other) as { stackId: string }).stackId, first.stackId);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup: an existing config is left alone, and one with no stack id gains only that', () => {
  const root = mkdtempSync(join(tmpdir(), 'baseplate-setup-'));
  try {
    mkdirSync(join(root, '.cdk-blocks'));
    const path = join(root, '.cdk-blocks/config.json');
    const mine = `${JSON.stringify({ stackId: 'my-app', telemetry: { enabled: false } }, null, 2)}\n`;
    writeFileSync(path, mine);
    assert.deepStrictEqual(ensureBlocksConfig(root), { created: false, stackId: 'my-app' });
    assert.strictEqual(readFileSync(path, 'utf8'), mine);
    writeFileSync(path, JSON.stringify({ telemetry: { enabled: false } }));
    const filled = ensureBlocksConfig(root) as { created: boolean; stackId: string };
    assert.strictEqual(filled.created, true);
    assert.deepStrictEqual(JSON.parse(readFileSync(path, 'utf8')), { telemetry: { enabled: false }, stackId: filled.stackId });
    // The shipped example is a placeholder, never a usable id.
    writeFileSync(path, readFileSync('.cdk-blocks/config.example.json'));
    assert.match((ensureBlocksConfig(root) as { stackId: string }).stackId, /^baseplate-[0-9a-f]{6}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ─── Teardown ────────────────────────────────────────────────────────────────

test("teardown: no Block sets its own removal policy, so the stack's one default (and its retain opt-in) covers them all", () => {
  const backend = readFileSync('cdk-blocks/index.ts', 'utf8');
  assert.doesNotMatch(backend, /removalPolicy\s*:|deletionProtection\s*:/);
  const stack = readFileSync('cdk-blocks/index.cdk.ts', 'utf8');
  assert.match(stack, /options\.retainData \? \{\} : \{ removalPolicy: cdk\.RemovalPolicy\.DESTROY, deletionProtection: false \}/);
});

// ─── A counter store in memory ───────────────────────────────────────────────

/** The KVStore's get and conditional put, with a clock the test moves. `scan` throws: nothing here may call it. */
class MemoryStore implements CounterStore {
  now = 0;
  reads = 0;
  writes = 0;
  /** Called before each put; a test uses it to slip another writer in first. */
  beforePut: ((key: string) => void) | null = null;
  private items = new Map<string, { value: number; expires: number }>();
  private live(key: string) {
    const item = this.items.get(key);
    return item && item.expires > this.now ? item : undefined;
  }
  async get(key: string) {
    this.reads++;
    return this.live(key)?.value ?? null;
  }
  async put(key: string, value: number, options: { ifNotExists?: boolean; ifValueEquals?: number; ttlSeconds?: number } = {}) {
    this.beforePut?.(key);
    const current = this.live(key);
    if ((options.ifNotExists && current) || (options.ifValueEquals !== undefined && current?.value !== options.ifValueEquals))
      throw Object.assign(new Error('conditional check failed'), { name: 'ConditionalCheckFailedException' });
    this.writes++;
    this.items.set(key, { value, expires: options.ttlSeconds ? this.now + options.ttlSeconds * 1000 : Number.POSITIVE_INFINITY });
  }
  set(key: string, value: number) {
    this.items.set(key, { value, expires: Number.POSITIVE_INFINITY });
  }
  scan(): never {
    throw new Error('scan called');
  }
  get size() {
    return this.items.size;
  }
}

// ─── Budgets ─────────────────────────────────────────────────────────────────

test('budget: a slot is taken up to the limit, then the budget is full, and a full budget writes nothing', async () => {
  const store = new MemoryStore();
  for (let i = 0; i < 3; i++) assert.strictEqual(await takeSlot(store, 'k', 3, 60), 'taken');
  const writes = store.writes;
  assert.strictEqual(await takeSlot(store, 'k', 3, 60), 'full');
  assert.strictEqual(store.writes, writes);
  assert.strictEqual(await isFull(store, 'k', 3), true);
  assert.strictEqual(await isFull(store, 'other', 3), false);
  assert.strictEqual(store.size, 1, 'asking whether a budget is full creates no key');
});

test('budget: a lost race is retried, and the last slot goes to one caller only', async () => {
  const store = new MemoryStore();
  store.set('k', 1);
  // Another writer takes a slot just before our first put.
  let raced = false;
  store.beforePut = (key) => {
    if (raced) return;
    raced = true;
    store.set(key, 2);
  };
  assert.strictEqual(await takeSlot(store, 'k', 3, 60), 'taken');
  assert.strictEqual(await store.get('k'), 3);
  // And when the other writer takes the last slot, we're told the budget is full.
  store.set('k', 2);
  raced = false;
  store.beforePut = (key) => {
    if (!raced) store.set(key, 3);
    raced = true;
  };
  assert.strictEqual(await takeSlot(store, 'k', 3, 60), 'full');
});

test('budget: contention on every attempt reports busy, not full, and takes nothing', async () => {
  const store = new MemoryStore();
  let other = 0;
  // Another writer moves the counter before each of our puts, but never reaches the limit.
  store.beforePut = (key) => {
    other = other === 5 ? 6 : 5;
    store.set(key, other);
  };
  assert.strictEqual(await takeSlot(store, 'k', 100, 60), 'busy');
  assert.ok((await store.get('k'))! < 100);
  assert.strictEqual(store.writes, 0);
});

test('budget: a slot given back can be taken again, and giving back never goes below zero', async () => {
  const store = new MemoryStore();
  assert.strictEqual(await takeSlot(store, 'k', 1, 60), 'taken');
  assert.strictEqual(await takeSlot(store, 'k', 1, 60), 'full');
  await giveBack(store, 'k', 60);
  assert.strictEqual(await takeSlot(store, 'k', 1, 60), 'taken');
  await giveBack(store, 'k', 60);
  await giveBack(store, 'k', 60);
  assert.strictEqual(await store.get('k'), 0);
  assert.strictEqual(await bump(store, 'fresh', -1, 60, (used) => used > 0), 'refused');
});

// ─── Here now ────────────────────────────────────────────────────────────────

const LIMITS = { bucketSeconds: 15, windowSeconds: 45, maxHere: 200 };
const noJoinLimit = async () => {};

test('here: the count is distinct pages over three buckets', () => {
  const t = (n: number, r1 = 0, r2 = 0) => ({ n, r1, r2 });
  assert.strictEqual(distinct([t(0), t(0), t(0)]), 0);
  assert.strictEqual(distinct([t(2), t(0), t(0)]), 2);
  // Three pages last bucket; two of them are back, plus one new page.
  assert.strictEqual(distinct([t(3, 2), t(3), t(0)]), 4);
  // One page seen two buckets ago skipped a bucket and is back: still one page.
  assert.strictEqual(distinct([t(1, 0, 1), t(0), t(1)]), 1);
});

test('here: a check-in never scans, and a renewal in the same bucket writes nothing', async () => {
  const store = new MemoryStore();
  // A table full of other keys changes nothing about what a check-in reads.
  for (let i = 0; i < 5000; i++) store.set(`ask:${i}:2026-01-01`, 1);
  store.now = 1_000_000;
  const first = await checkIn(store, 'a', false, store.now, LIMITS, noJoinLimit);
  assert.deepStrictEqual(first, { here: 1, building: 0, counted: true });
  const reads = store.reads;
  const writes = store.writes;
  assert.deepStrictEqual(await checkIn(store, 'a', false, store.now + 1000, LIMITS, noJoinLimit), first);
  assert.strictEqual(store.writes, writes, 'a renewal in the same bucket is reads only');
  assert.ok(store.reads - reads <= 7, `a check-in is a fixed number of keyed reads, got ${store.reads - reads}`);
});

test('here: any order of joins, renewals, code changes and departures gives the exact count', async () => {
  // A fixed-seed generator: the same sequence every run.
  let seed = 0x2f6e2b1;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const store = new MemoryStore();
  store.now = 1_700_000_000_000;
  // The model: for each page, the bucket of its last check-in and whether it was building then.
  const model = new Map<string, { bucket: number; building: boolean }>();
  const pages = Array.from({ length: 12 }, (_, i) => `page-${i}`);
  for (let step = 0; step < 4000; step++) {
    store.now += Math.floor(rand() * 9000); // up to 9 s between check-ins, so pages skip buckets and expire
    const bucket = Math.floor(store.now / 15000);
    const page = pages[Math.floor(rand() * pages.length)];
    const building = rand() < 0.4;
    const got = await checkIn(store, page, building, store.now, LIMITS, noJoinLimit);
    const before = model.get(page);
    // Within one bucket a page that held the code keeps counting as building.
    model.set(page, { bucket, building: building || (before?.bucket === bucket && before.building) });
    const live = [...model.values()].filter((m) => m.bucket >= bucket - 2);
    assert.deepStrictEqual(
      got,
      { here: live.length, building: live.filter((m) => m.building).length, counted: true },
      `step ${step}, ${page}, bucket ${bucket}`,
    );
  }
});

test('here: a new page past the cap is not recorded, and a new page needs a join slot', async () => {
  const store = new MemoryStore();
  store.now = 1_000_000;
  const small = { ...LIMITS, maxHere: 2 };
  await checkIn(store, 'a', false, store.now, small, noJoinLimit);
  await checkIn(store, 'b', false, store.now, small, noJoinLimit);
  const writes = store.writes;
  assert.deepStrictEqual(await checkIn(store, 'c', false, store.now, small, noJoinLimit), { here: 2, building: 0, counted: false });
  assert.strictEqual(store.writes, writes);
  // A known page renews without asking for a join slot, even in a later bucket; a new one asks.
  let asked = 0;
  const join = async () => {
    asked++;
  };
  await checkIn(store, 'a', false, store.now + 15_000, LIMITS, join);
  assert.strictEqual(asked, 0);
  await checkIn(store, 'd', false, store.now + 15_000, LIMITS, join);
  assert.strictEqual(asked, 1);
  // A refused join leaves no trace.
  const refuse = async () => {
    throw new Error('no slot');
  };
  const before = store.writes;
  await assert.rejects(() => checkIn(store, 'e', false, store.now + 15_000, LIMITS, refuse), /no slot/);
  assert.strictEqual(store.writes, before);
});

// ─── Gallery picks ───────────────────────────────────────────────────────────

test('featured: the pick depends only on the hour and the set of ids', () => {
  const ids = ['bbbbbbbbbb', 'aaaaaaaaaa', 'cccccccccc'];
  const pick = pickFeatured(ids, '2026-11-19T10');
  assert.ok(ids.includes(pick));
  assert.strictEqual(pickFeatured([...ids].reverse(), '2026-11-19T10'), pick, 'order does not matter');
  const hours = Array.from({ length: 48 }, (_, h) =>
    pickFeatured(ids, `2026-11-${19 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}`),
  );
  assert.strictEqual(new Set(hours).size, 3, 'over two days every build gets picked');
});

test('featured: a pick holds for its hour even when it left the recent list, and a new hour picks again', () => {
  const at = '2026-11-19T10:00:00.000Z';
  const first = nextFeatured(null, ['aaaaaaaaaa', 'bbbbbbbbbb'], at);
  assert.deepStrictEqual(first, { id: pickFeatured(['aaaaaaaaaa', 'bbbbbbbbbb'], '2026-11-19T10'), pickedAt: at });
  // Later the same hour, 24 newer saves have pushed the pick off the list: it stands.
  assert.strictEqual(nextFeatured(first, ['cccccccccc', 'dddddddddd'], '2026-11-19T10:37:00.000Z'), null);
  const next = nextFeatured(first, ['cccccccccc', 'dddddddddd'], '2026-11-19T11:00:00.000Z');
  assert.ok(next && next.pickedAt === '2026-11-19T11:00:00.000Z' && ['cccccccccc', 'dddddddddd'].includes(next.id));
});

test('featured: a run delivered late, stamped with an earlier hour, does not replace a newer pick', () => {
  const current = { id: 'aaaaaaaaaa', pickedAt: '2026-11-19T11:00:00.000Z' };
  assert.strictEqual(nextFeatured(current, ['bbbbbbbbbb'], '2026-11-19T10:59:00.000Z'), null);
  assert.strictEqual(nextFeatured(null, [], '2026-11-19T10:59:00.000Z'), null, 'nothing to pick from');
});

test('recent: the newest id goes first, once, and the list keeps its length', () => {
  assert.deepStrictEqual(withNewest([], 'a', 3), ['a']);
  assert.deepStrictEqual(withNewest(['b', 'a'], 'a', 3), ['a', 'b']);
  assert.deepStrictEqual(withNewest(['c', 'b', 'a'], 'd', 3), ['d', 'c', 'b']);
});

// ─── Reading right after a write ─────────────────────────────────────────────

test('read again: an empty first read is tried once more, a full one is not', async () => {
  let calls = 0;
  const lagging = async () => (++calls === 1 ? null : 'found');
  assert.strictEqual(await readAgain(lagging, (v) => v === null, 1), 'found');
  assert.strictEqual(calls, 2);
  calls = 0;
  const present = async () => {
    calls++;
    return 'found';
  };
  assert.strictEqual(await readAgain(present, (v) => v === null, 1), 'found');
  assert.strictEqual(calls, 1);
  calls = 0;
  const absent = async () => {
    calls++;
    return null;
  };
  assert.strictEqual(await readAgain(absent, (v) => v === null, 1), null);
  assert.strictEqual(calls, 2, 'still missing after one more read: give up');
});

// ─── A secret whose address changes under a running copy ─────────────────────

/** Secrets Manager as one role sees it: a value for each ARN the role may read, AccessDenied for any other. */
function fakeSecretsManager(readable: Record<string, string>) {
  const reads: string[] = [];
  const send = async (command: { input: { SecretId: string } }) => {
    const arn = command.input.SecretId;
    reads.push(arn);
    if (!(arn in readable)) throw Object.assign(new Error(`not authorized to read ${arn}`), { name: 'AccessDeniedException' });
    return { SecretString: readable[arn] };
  };
  return { reads, send };
}

/** The Secret Block's deployed class, as the function runs it, with Secrets Manager replaced. */
async function deployedSecret(send: unknown) {
  const path = '../node_modules/@aws-cdk-blocks/bb-secret/dist/index.aws.js';
  const { Secret } = (await import(path)) as {
    Secret: new (scope: Scope, id: string, options: object) => { fullId: string; get(): Promise<string | null>; client: { send: unknown } };
  };
  const secret = new Secret(new Scope('baseplate'), 'invite-code', { generate: true, cacheTtlSeconds: 0 });
  secret.client.send = send;
  return secret;
}

test('secret: a warm copy that holds the old address reads the new one after a deploy replaces the secret', async () => {
  const key = secretArnKey('baseplate-invite-code');
  const before = process.env[key];
  try {
    // The copy started while the config file still named the old secret.
    process.env[key] = 'arn:old';
    // The deploy then replaced the secret: the role reads the new one only, and the config file names it.
    const aws = fakeSecretsManager({ 'arn:new': 'the-new-code' });
    const secret = await deployedSecret(aws.send);
    assert.strictEqual(secretArnKey(secret.fullId), key, 'the key is derived the way the Block derives it');
    await assert.rejects(() => secret.get(), { name: 'AccessDeniedException' }, 'the Block alone keeps failing on the old address');

    let configReads = 0;
    let recovered = 0;
    const read = freshSecretReader({
      read: () => secret.get(),
      refresh: addressRefresher({
        key,
        fetchConfig: async () => {
          configReads++;
          return { [key]: 'arn:new' };
        },
      }),
      ttlMs: 300_000,
      onRecovered: () => recovered++,
    });
    aws.reads.length = 0;
    assert.strictEqual(await read(), 'the-new-code');
    assert.deepStrictEqual(aws.reads, ['arn:old', 'arn:new'], 'one denied read, then one on the new address');
    assert.strictEqual(process.env[key], 'arn:new');
    assert.deepStrictEqual([configReads, recovered], [1, 1]);
    assert.strictEqual(await read(), 'the-new-code');
    assert.strictEqual(aws.reads.length, 2, 'the value is reused inside its five minutes');
  } finally {
    if (before === undefined) delete process.env[key];
    else process.env[key] = before;
  }
});

test('secret: a denied read that a fresh address does not explain is thrown, and the config is not read on every request', async () => {
  const env: Record<string, string | undefined> = { K: 'arn:only' };
  let clock = 0;
  let configReads = 0;
  const denied = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
  const refresh = addressRefresher({
    key: 'K',
    env,
    now: () => clock,
    fetchConfig: async () => {
      configReads++;
      return { K: 'arn:only' };
    },
  });
  const read = freshSecretReader({
    read: async () => {
      throw denied;
    },
    refresh,
    ttlMs: 1000,
    now: () => clock,
  });
  await assert.rejects(read, (e) => e === denied);
  await assert.rejects(read, (e) => e === denied);
  assert.strictEqual(configReads, 1, 'a second failure inside ten seconds reads no config');
  clock = 10_000;
  await assert.rejects(read, (e) => e === denied);
  assert.strictEqual(configReads, 2);

  // Any other fault never touches the config, and neither does a config read that fails.
  const other = new Error('throttled');
  const calls: string[] = [];
  await assert.rejects(
    freshSecretReader({
      read: async () => {
        throw other;
      },
      refresh: async () => {
        calls.push('refresh');
        return true;
      },
      ttlMs: 1000,
    }),
    (e) => e === other,
  );
  assert.deepStrictEqual(calls, []);
  const failing = addressRefresher({
    key: 'K',
    env,
    fetchConfig: async () => {
      throw new Error('no such key');
    },
  });
  assert.strictEqual(await failing(), false);
  assert.strictEqual(env.K, 'arn:only');
});

test('secret: a missing value is never cached, a new address is tried for it, and a value expires after its time', async () => {
  const env: Record<string, string | undefined> = { K: 'arn:gone' };
  const values: Record<string, string | null> = { 'arn:gone': null, 'arn:new': 'one' };
  let clock = 0;
  let reads = 0;
  const read = freshSecretReader({
    read: async () => {
      reads++;
      return values[env.K ?? ''] ?? null;
    },
    refresh: addressRefresher({ key: 'K', env, now: () => clock, fetchConfig: async () => ({ K: 'arn:new' }) }),
    ttlMs: 1000,
    now: () => clock,
  });
  assert.strictEqual(await read(), 'one');
  assert.strictEqual(reads, 2, 'the old address had no value, the new one did');
  values['arn:new'] = 'two';
  clock = 999;
  assert.strictEqual(await read(), 'one');
  clock = 1000;
  assert.strictEqual(await read(), 'two');
  values['arn:new'] = null;
  clock = 2000;
  assert.strictEqual(await read(), null);
  values['arn:new'] = 'three';
  assert.strictEqual(await read(), 'three', 'the missing value was not kept');
});

test('secret: the backend reads the invite code through the fresh reader only, and the Block still resolves its address on each read', () => {
  const backend = readFileSync('cdk-blocks/index.ts', 'utf8');
  assert.strictEqual(backend.match(/inviteCode\.get\(\)/g)?.length, 1, 'one direct read, inside the fresh reader');
  assert.match(backend, /read: \(\) => inviteCode\.get\(\),\s*refresh: addressRefresher\(\{ key: secretArnKey\(inviteCode\.fullId\) \}\)/);
  assert.match(backend, /const expected = await readInviteCode\(\);/);
  // The fix rests on two facts about @aws-cdk-blocks/bb-secret. If an upgrade changes either, look at fresh-secret.ts again.
  const block = readFileSync('node_modules/@aws-cdk-blocks/bb-secret/dist/index.aws.js', 'utf8');
  assert.match(block, /async get\(options\) \{\s*const secretArn = this\.resolveSecretArn\(\);/);
  assert.match(block, /this\.externalArn \?\? process\.env\[secretArnConfigKey\(this\.fullId\)\]/);
  const shared = readFileSync('node_modules/@aws-cdk-blocks/bb-secret/dist/internal-shared.js', 'utf8');
  assert.match(shared, /return `BLOCKS_SECRET_ARN_\$\{fullId\.toUpperCase\(\)\.replace\(\/\[\^A-Z0-9\]\/g, '_'\)\}`;/);
});

// ─── What the function logs ──────────────────────────────────────────────────

function fakeConsole() {
  const lines: { level: 'error' | 'warn'; args: unknown[] }[] = [];
  const out: ConsoleLike = {
    error: (...args) => lines.push({ level: 'error', args }),
    warn: (...args) => lines.push({ level: 'warn', args }),
  };
  return { lines, out };
}

test('logs: a refused request is one warn line with no stack trace, and a fault stays an error', () => {
  const { lines, out } = fakeConsole();
  const undo = logRefusalsAsWarnings(out);
  const refusals = [
    Object.assign(new ApiError('Saving a build needs the invite link.', 403, { name: 'InviteRequiredException' }), { reason: 'invite' }),
    new ApiError("That request isn't valid for Baseplate.", 400, { name: 'InvalidInputException' }),
    new ApiError('No build has that id.', 404, { name: 'BuildNotFoundException' }),
    new ApiError('Conversation not found.', 404, { name: 'ConversationNotFoundException' }),
    new ApiError('All saves for today are used.', 429, { name: 'SaveBudgetException' }),
  ];
  for (const refusal of refusals) {
    assert.ok(isRefusal(refusal));
    out.error(API_ERROR_PREFIX, refusal);
  }
  assert.deepStrictEqual(
    lines.map((l) => [l.level, ...l.args]),
    [
      ['warn', 'Request refused: 403 InviteRequiredException (invite)'],
      ['warn', 'Request refused: 400 InvalidInputException'],
      ['warn', 'Request refused: 404 BuildNotFoundException'],
      ['warn', 'Request refused: 404 ConversationNotFoundException'],
      ['warn', 'Request refused: 429 SaveBudgetException'],
    ],
    'each is one string: no error object, so no stack trace',
  );
  // The same refusal written with a request id between the label and the error.
  lines.length = 0;
  out.error(API_ERROR_PREFIX, '[request 1f2e]', refusals[0]);
  out.error(API_ERROR_PREFIX, 'not a request id', refusals[0]);
  assert.deepStrictEqual(
    lines.map((l) => l.level),
    ['warn', 'error'],
  );

  // Faults: a plain error, an SDK error, a 5xx ApiError, and anything logged outside an API method.
  lines.length = 0;
  const faults = [
    new Error('boom'),
    Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    new ApiError('Baseplate is busy right now.', 503, { name: 'BusyException' }),
  ];
  for (const fault of faults) out.error(API_ERROR_PREFIX, fault);
  out.error('RawRoute Error:', refusals[0]);
  out.error('something else');
  assert.deepStrictEqual(
    lines.map((l) => l.level),
    ['error', 'error', 'error', 'error', 'error'],
  );
  assert.deepStrictEqual(lines[0].args, [API_ERROR_PREFIX, faults[0]], 'passed on unchanged');

  undo();
  out.error(API_ERROR_PREFIX, refusals[0]);
  assert.strictEqual(lines.at(-1)?.level, 'error', 'undone');
});

test('logs: a scheduled run before the config is readable is skipped with one warn line; an API request in that window still fails', async () => {
  const { lines, out } = fakeConsole();
  // The error the CDK Blocks handler throws in that window, by name and by message.
  const notReady = Object.assign(
    new Error('[Blocks] Config not readable yet (transient post-deploy S3 window); will retry on next request'),
    {
      name: 'TransientConfigError',
    },
  );
  let fail: Error | null = notReady;
  const handler = skipScheduledRunsUntilConfigIsReady(async (event: object) => {
    if (fail) throw fail;
    return { ok: event };
  }, out);
  const scheduled = { source: 'blocks.cronjob', jobName: 'baseplate-gallery-snapshot', scheduledTime: '2026-11-19T23:38:00Z' };
  assert.strictEqual(await handler(scheduled, {}), undefined);
  assert.deepStrictEqual(
    lines.map((l) => l.level),
    ['warn'],
  );
  await assert.rejects(() => handler({ httpMethod: 'POST', path: '/cdk-blocks/api' }, {}), { name: 'TransientConfigError' });
  // Any other failure of a scheduled run is still a failure.
  fail = new Error('boom');
  await assert.rejects(() => handler(scheduled, {}), /boom/);
  // Once the config is readable the run goes through.
  fail = null;
  assert.deepStrictEqual(await handler(scheduled, {}), { ok: scheduled });
  assert.strictEqual(lines.length, 1);
});

test('logs: the handler installs both guards, the backend throws its refusals as one class, and the Blocks handler still logs the way the guards expect', () => {
  const entry = readFileSync('cdk-blocks/index.handler.ts', 'utf8');
  assert.match(entry, /^logRefusalsAsWarnings\(\);$/m);
  assert.match(entry, /= skipScheduledRunsUntilConfigIsReady\(createLambdaHandler\(/);
  const backend = readFileSync('cdk-blocks/index.ts', 'utf8');
  // Only the 503 for a contended budget is a bare ApiError; it's a fault to look at, and it stays an error.
  assert.deepStrictEqual(backend.match(/new ApiError\([^)]*\)/g), [
    "new ApiError('Baseplate is busy right now. Try again in a moment.', 503, { name: 'BusyException' })",
  ]);
  assert.match(backend, /class Refusal extends ApiError/);
  // What the guards match in @aws-cdk-blocks/core. If an upgrade changes any of these lines, look at handler-guards.ts again.
  const core = readFileSync('node_modules/@aws-cdk-blocks/core/dist/lambda-handler.js', 'utf8');
  assert.ok(core.includes(`rpcErrorLabel: '${API_ERROR_PREFIX}',`));
  // The dispatcher writes the label and the error, with the request id between them when the request carries one.
  const dispatch = readFileSync('node_modules/@aws-cdk-blocks/core/dist/dispatch.js', 'utf8');
  assert.ok(dispatch.includes('console.error(label, error);'));
  assert.match(dispatch, /console\.error\(label, `\[request \$\{request\.requestId\}\]`, error\);/);
  assert.ok(core.includes("this.name = 'TransientConfigError';"));
  assert.ok(readFileSync('node_modules/@aws-cdk-blocks/bb-cron-job/dist/index.cdk.js', 'utf8').includes("source: 'blocks.cronjob'"));
});

// ─── What the stack sets ─────────────────────────────────────────────────────

test('stack: the invite secret has no fixed name, and the stack says where to find it', () => {
  const backend = readFileSync('cdk-blocks/index.ts', 'utf8');
  assert.match(backend, /new Secret\(scope, 'invite-code', \{ generate: true, cacheTtlSeconds: 0 \}\)/);
  const stack = readFileSync('cdk-blocks/index.cdk.ts', 'utf8');
  assert.match(stack, /new cdk\.CfnOutput\(blocksStack, 'InviteCodeSecretArn'/);
  // The Realtime Block has a secret of its own in the stack, so the output must not take the first secret it finds.
  assert.match(stack, /c instanceof secretsmanager\.Secret && c\.node\.path\.includes\('\/invite-code\/'\)/);
});

test('stack: the API throttle comes from shared.ts, and every alarm of ours has an action', () => {
  const stack = readFileSync('cdk-blocks/index.cdk.ts', 'utf8');
  assert.match(stack, /throttling: \{ rateLimit: API_RATE_LIMIT, burstLimit: API_BURST_LIMIT \}/);
  assert.match(stack, /for \(const alarm of alarms\) alarm\.addAlarmAction\(new SnsAction\(topic\)\)/);
  assert.strictEqual(stack.match(/new cloudwatch\.Alarm\(/g)?.length, 2, 'both alarms are in the list that gets the action');
  assert.match(stack, /const alarms = \[\s*new cloudwatch\.Alarm\(blocksStack, 'AgentCallsAtDailyCap'/);
  assert.match(stack, /alarms\.push\(\s*new cloudwatch\.Alarm\(blocksStack, 'ApiRequestsHigh'/);
});

// ─── The agent's model ───────────────────────────────────────────────────────

test('model: the agent runs Claude Haiku 5.5 through an inference profile, sends no sampling setting, and leaves room for thinking', () => {
  // Amazon Bedrock serves this model on demand only through an inference profile: the global one, or a geography's.
  assert.match(AGENT_MODEL_ID, /^(global|us|ca|eu|au|jp)\.anthropic\.claude-haiku-5-5$/);
  const backend = readFileSync('cdk-blocks/index.ts', 'utf8');
  assert.match(
    backend,
    /deployed: \{ provider: 'bedrock', modelId: AGENT_MODEL_ID, inferenceConfig: \{ maxTokens: AGENT_MAX_TOKENS \} \},/,
  );
  // Claude Haiku 5.5 answers a request that sets temperature or topP with a validation error, so the whole agent would fail.
  assert.doesNotMatch(backend, /\b(temperature|topP)\s*:/);
  // The model thinks before it answers, and thinking counts toward the cap. One call used up to about 360 tokens in tests.
  assert.ok(AGENT_MAX_TOKENS >= 800, `AGENT_MAX_TOKENS is ${AGENT_MAX_TOKENS}`);
  // No preset names the model for us: a preset can move to another model in an upgrade of @aws-cdk-blocks/bb-agent.
  assert.doesNotMatch(backend, /BedrockModels/);
  // The README and the deploy page state the same id, and the cost page states the same cap.
  assert.ok(readFileSync('README.md', 'utf8').includes(`\`${AGENT_MODEL_ID}\``));
  assert.ok(readFileSync('docs/deploy.md', 'utf8').includes(`\`${AGENT_MODEL_ID}\``));
  assert.ok(readFileSync('docs/costs.md', 'utf8').includes(`at most ${AGENT_MAX_TOKENS.toLocaleString('en-US')} output tokens`));
});

// ─── The README and the pages under docs/ ────────────────────────────────────

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces to hyphens. */
const anchorOf = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, '')
    .replace(/ /g, '-');

/** Every relative link and image in a Markdown file that points nowhere, as `file: target`. */
function brokenLinks(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const targets = [...text.matchAll(/\]\(([^)\s]+)\)/g), ...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  const broken: string[] = [];
  for (const target of targets) {
    if (/^(https?:|mailto:)/.test(target)) continue;
    const [path, anchor] = target.split('#');
    const resolved = path === '' ? file : join(dirname(file), path);
    if (!existsSync(resolved)) broken.push(`${file}: ${target}`);
    else if (anchor !== undefined && resolved.endsWith('.md')) {
      const anchors = [...readFileSync(resolved, 'utf8').matchAll(/^#+ (.+)$/gm)].map((m) => anchorOf(m[1]));
      if (!anchors.includes(anchor)) broken.push(`${file}: ${target}`);
    }
  }
  return broken;
}

test('docs: every relative link and image in the README and the docs pages points at a file and a heading that exist', () => {
  const pages = [
    'README.md',
    'AGENTS.md',
    ...readdirSync('docs')
      .filter((name) => name.endsWith('.md'))
      .map((name) => join('docs', name)),
  ];
  assert.ok(pages.length >= 7, 'the README, AGENTS.md and five pages under docs/');
  assert.deepStrictEqual(pages.flatMap(brokenLinks), []);
});

test('docs: the README keeps the sections a sample needs, shows every picture with alt text, and stays a short page', () => {
  const readme = readFileSync('README.md', 'utf8');
  for (const heading of [
    '## Run it on your machine',
    '## Deploy it to your own account',
    '## Limits',
    '## Security',
    '## Contributing',
    '## License',
  ]) {
    assert.ok(readme.includes(`\n${heading}\n`), `missing section: ${heading}`);
  }
  assert.ok(readme.includes('This is sample code, for non-production usage.'));
  assert.ok(readme.includes('See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.'));
  assert.ok(readme.includes('This library is licensed under the MIT-0 License.'));
  for (const image of readme.matchAll(/!\[([^\]]*)\]\(|<img [^>]*>/g)) {
    const alt = image[1] ?? /alt="([^"]*)"/.exec(image[0])?.[1] ?? '';
    assert.ok(alt.length >= 20, `an image has no real alt text: ${image[0].slice(0, 60)}`);
  }
  // The README is the product page. Long reference belongs under docs/.
  assert.ok(readme.split('\n').length <= 180, 'README.md has grown past 180 lines: move detail to docs/');
});

// ─── The custom Block's package ──────────────────────────────────────────────

test('package: the custom Block is a file dependency, so an install can never fetch that name from a registry', () => {
  const root = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.strictEqual(root.dependencies['@your-team/bb-house-bucket'], 'file:packages/bb-house-bucket');
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  assert.deepStrictEqual(lock.packages['node_modules/@your-team/bb-house-bucket'], { resolved: 'packages/bb-house-bucket', link: true });
  assert.strictEqual(JSON.parse(readFileSync('packages/bb-house-bucket/package.json', 'utf8')).private, true);
});

// ─── The page: what it says and what it frees ────────────────────────────────

const joined = (path: string) => readFileSync(path, 'utf8').replace(/\s+/g, ' ');

test('page: it says that agent questions are kept, and no longer promises an audit entry for every write', () => {
  assert.match(
    joined('src/App.tsx'),
    /A question you ask the agent is kept, with its answer, in the tables of the AWS account that runs this app\./,
  );
  assert.doesNotMatch(joined('src/RunsOn.tsx'), /Every write leaves an audit entry/);
});

test('scene: the shadow textures and link materials are freed on unmount, and the canvas has a name', () => {
  const stage = joined('src/scene/Stage.tsx');
  assert.strictEqual(
    stage.match(/useEffect\(\(\) => \(\) => blob\.dispose\(\), \[blob\]\);/g)?.length,
    2,
    'the plate and the tray each free theirs',
  );
  assert.strictEqual(stage.match(/useMemo\(makeBlob, \[\]\)/g)?.length, 2);
  assert.match(joined('src/scene/Wiring.tsx'), /for \(const material of Object\.values\(materials\)\) material\.dispose\(\);/);
  assert.match(stage, /<Canvas role="img" aria-label="[^"]+"/);
});

// ─── Licenses ────────────────────────────────────────────────────────────────

test('licenses: MIT-0 at the root and in every package, with no NOTICE file, and the third-party file ships with the build', () => {
  const license = readFileSync('LICENSE', 'utf8');
  assert.match(license, /^MIT No Attribution\n\nCopyright Amazon\.com, Inc\. or its affiliates\. All Rights Reserved\.\n/);
  // MIT-0 is MIT without the condition that copies carry the notice.
  assert.doesNotMatch(license, /The above copyright notice and this permission notice shall be included/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
  // The MIT-0 template has no NOTICE file, and the license asks for none.
  assert.strictEqual(existsSync('NOTICE'), false);
  assert.strictEqual(readFileSync('packages/bb-house-bucket/LICENSE', 'utf8'), license);
  for (const path of ['package.json', 'cdk-blocks/package.json', 'packages/bb-house-bucket/package.json'])
    assert.strictEqual(JSON.parse(readFileSync(path, 'utf8')).license, 'MIT-0', path);
  // Every source file's header names the same license.
  for (const path of [
    'cdk-blocks/index.ts',
    'src/App.tsx',
    'src/data.ts',
    'src/styles.css',
    'scripts/setup.mjs',
    'scripts/scan.sh',
    'packages/bb-house-bucket/src/runtime.ts',
  ])
    assert.match(readFileSync(path, 'utf8').slice(0, 400), /SPDX-License-Identifier: MIT-0\b/, path);
  const notices = readFileSync('THIRD-PARTY-LICENSES', 'utf8');
  for (const font of ['@fontsource/fredoka@', '@fontsource/jetbrains-mono@']) assert.ok(notices.includes(` - ${font}`), font);
  assert.ok(notices.includes('SIL OPEN FONT LICENSE Version 1.1'));
  assert.doesNotMatch(
    notices,
    / - (@your-team\/bb-house-bucket|cdk-blocks|baseplate|sample-3d-builder-for-aws-cdk-blocks)@/,
    "this repository's own packages aren't third-party",
  );
  // Every required production dependency is in the file at its locked version. Optional platform
  // binaries and optional peers aren't: the generator lists what an install on one platform needs.
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { dev?: boolean; link?: boolean; optional?: boolean; peer?: boolean; version?: string }>;
  };
  const listed = new Set([...notices.matchAll(/^ - (\S+)$/gm)].map((m) => m[1]));
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/') || entry.dev || entry.link || entry.optional || entry.peer || path.includes('/@your-team/'))
      continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    assert.ok(listed.has(`${name}@${entry.version}`), `${name}@${entry.version} is missing from THIRD-PARTY-LICENSES`);
  }
  assert.match(readFileSync('vite.config.ts', 'utf8'), /fileName: 'THIRD-PARTY-LICENSES\.txt'/);
  // The page links to it, and the link is a full-size tap target.
  assert.match(joined('src/App.tsx'), /<a className="foot-link" href="\/THIRD-PARTY-LICENSES\.txt"/);
  assert.match(joined('src/styles.css'), /\.foot-link \{[^}]*min-width: 44px;[^}]*min-height: 44px;/);
});

// ─── The flat theme ──────────────────────────────────────────────────────────

test('theme: ?theme=flat picks the flat theme, and nothing else does', () => {
  assert.deepStrictEqual([...THEMES], ['flat']);
  assert.strictEqual(themeOf('?theme=flat'), 'flat');
  assert.strictEqual(themeOf('?b=abcdefghij&theme=flat&names=exact'), 'flat');
  for (const search of ['', '?theme=', '?theme=FLAT', '?theme=dark', '?themes=flat', '?icons=flat'])
    assert.strictEqual(themeOf(search), null, search);
});

test('theme: six distinct brick colors, and every text pair the theme uses has a contrast of 4.5 to 1 or more', () => {
  const hex = /^#[0-9A-F]{6}$/;
  for (const color of [
    FLAT.dark,
    FLAT.light,
    FLAT.accent,
    FLAT.gray,
    FLAT.textOnDark,
    FLAT.textOnLight,
    FLAT.softOnDark,
    FLAT.softOnLight,
    FLAT.raised,
    FLAT.linkOnDark,
    ...FLAT.faces,
  ])
    assert.match(color, hex);
  assert.strictEqual(new Set(FLAT.faces).size, 6);
  // WCAG relative luminance and contrast ratio.
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(color.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  // Text on the dark page and on its raised surfaces, and dark text on the light surfaces and on each brick color.
  // This is the palette's own arithmetic. It doesn't open a browser, so it can't see which color lands on which surface.
  for (const surface of [FLAT.dark, FLAT.raised])
    for (const onDark of [FLAT.textOnDark, FLAT.softOnDark, FLAT.accent, FLAT.linkOnDark])
      assert.ok(contrast(onDark, surface) >= 4.5, `${onDark} on ${surface}: ${contrast(onDark, surface).toFixed(1)}`);
  // The stage is dark under the theme, a label over it carries its own dark fill, and each surface
  // that keeps a light fill turns the text variables dark.
  const themeSource = joined('src/theme-flat.ts');
  assert.match(themeSource, /--stage-top: \$\{P\.dark\}; --stage-edge: \$\{P\.dark\};/);
  assert.match(
    themeSource,
    /:root\[data-theme\] \.hud-label b, :root\[data-theme\] \.hud-label span \{ padding: 0 4px; background: \$\{P\.dark\}; color: \$\{P\.textOnDark\}; \}/,
  );
  assert.match(themeSource, /\$\{LIGHT\} \{ --ink: \$\{P\.textOnLight\}; --ink-soft: \$\{P\.softOnLight\};/);
  for (const surface of ['.yours', '.team-label']) assert.ok(themeSource.includes(`"${surface}"`), surface);
  for (const surface of [FLAT.light, '#EEF1F4', '#FFF3D2'])
    assert.ok(contrast(FLAT.softOnLight, surface) >= 4.5, `${FLAT.softOnLight} on ${surface}`);
  for (const surface of [FLAT.light, ...FLAT.faces])
    assert.ok(
      contrast(FLAT.textOnLight, surface) >= 4.5,
      `${FLAT.textOnLight} on ${surface}: ${contrast(FLAT.textOnLight, surface).toFixed(1)}`,
    );
});

// ─── A page that left ────────────────────────────────────────────────────────
// These tests sit at the end of the file on purpose: the threat model cites earlier tests by line.

test('logs: a WebSocket message from a page that already left is one warn line, and the connection is dropped the way a disconnect drops it', async () => {
  // Imported here, not at the top, so no earlier line of this file moves.
  const { treatClosedConnectionsAsExpected } = await import('../cdk-blocks/handler-guards.js');
  const { lines, out } = fakeConsole();
  // What API Gateway answers to a post on a closed connection, as the SDK throws it.
  const gone = Object.assign(new Error('UnknownError'), { name: 'GoneException', $metadata: { httpStatusCode: 410 } });
  const seen: string[] = [];
  let fail: Error | null = gone;
  const handler = treatClosedConnectionsAsExpected(async (event: { requestContext?: { eventType?: string; connectionId?: string } }) => {
    seen.push(`${event.requestContext?.eventType}:${event.requestContext?.connectionId}`);
    if (event.requestContext?.eventType === 'MESSAGE' && fail) throw fail;
    return { statusCode: 200, from: 'the Block' };
  }, out);
  const message = {
    requestContext: { eventType: 'MESSAGE', connectionId: 'abc=', domainName: 'example.execute-api', stage: 'rt' },
    body: '{}',
  };

  assert.deepStrictEqual(await handler(message, {}), { statusCode: 200 });
  assert.deepStrictEqual(seen, ['MESSAGE:abc=', 'DISCONNECT:abc='], 'the Block is handed a disconnect for the same connection');
  assert.deepStrictEqual(
    lines.map((l) => [l.level, ...l.args]),
    [['warn', 'WebSocket connection closed before a reply could be sent. Its records are dropped.']],
  );

  // A 410 named only by its status counts too, and a cleanup that fails doesn't turn it into a fault.
  const cleanupFails = treatClosedConnectionsAsExpected(async (event: { requestContext: { eventType: string } }) => {
    throw event.requestContext.eventType === 'DISCONNECT'
      ? new Error('table throttled')
      : Object.assign(new Error('gone'), { statusCode: 410 });
  }, out);
  assert.deepStrictEqual(await cleanupFails(message, {}), { statusCode: 200 });

  // Any other failure of a WebSocket event is still a failure, and so is a 410 outside one.
  fail = new Error('boom');
  await assert.rejects(() => handler(message, {}), /boom/);
  const notWebSocket = treatClosedConnectionsAsExpected(async () => {
    throw gone;
  }, out);
  await assert.rejects(() => notWebSocket({ httpMethod: 'POST', path: '/cdk-blocks/api' }, {}), { name: 'GoneException' });
  await assert.rejects(() => notWebSocket({ source: 'blocks.cronjob' }, {}), { name: 'GoneException' });
  // A page that's still there goes straight through.
  fail = null;
  assert.deepStrictEqual(await handler(message, {}), { statusCode: 200, from: 'the Block' });
  assert.strictEqual(lines.filter((l) => l.level === 'error').length, 0);
});

test('logs: the handler installs the closed-connection guard, and the Realtime Block still answers a subscribe the way the guard expects', () => {
  assert.match(
    readFileSync('cdk-blocks/index.handler.ts', 'utf8'),
    /export const handler = treatClosedConnectionsAsExpected\(whenConfigIsReady\);/,
  );
  // What the guard rests on in @aws-cdk-blocks/bb-realtime. If an upgrade changes these, look at handler-guards.ts again:
  // the Block may have started to catch the 410 itself.
  const block = readFileSync('node_modules/@aws-cdk-blocks/bb-realtime/dist/index.aws.js', 'utf8');
  // A subscribe is answered with a post that nothing catches.
  assert.match(
    block,
    /await table\.put\(\{ connectionId, channel: msg\.channel \}, \{[^;]*\}\);\s*await getApigw\(callbackUrl\)\.send\(new PostToConnectionCommand\(\{\s*ConnectionId: connectionId,\s*Data: JSON\.stringify\(\{ type: 'subscribe_success', channel: msg\.channel \}\),/,
  );
  // A disconnect event drops the connection's records.
  assert.match(block, /if \(eventType === 'DISCONNECT'\) \{\s*await deleteConnectionRecords\(connectionId\);/);
  // The CDK Blocks handler tells a WebSocket event by these three event types.
  assert.ok(
    readFileSync('node_modules/@aws-cdk-blocks/core/dist/lambda-handler.js', 'utf8').includes(
      "['CONNECT', 'DISCONNECT', 'MESSAGE'].includes(event.requestContext.eventType)",
    ),
  );
});

// ─── The notices file ────────────────────────────────────────────────────────
// At the end of the file for the same reason as the tests above: the threat model cites earlier tests by line.

test('licenses: every production package the lockfile installs is in the third-party file, peers and bundled copies included', async () => {
  // @ts-expect-error a plain .mjs script with no types
  const { problemsIn, productionPackages } = await import('../scripts/third-party-licenses.mjs');
  const packages = productionPackages() as { id: string; dir: string; installed: boolean }[];
  const notices = readFileSync('THIRD-PARTY-LICENSES', 'utf8');
  assert.deepStrictEqual(problemsIn(notices, packages), { missing: [], extra: [] });
  // The two kinds a walk from package.json's dependencies doesn't reach are in the list being checked.
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { peer?: boolean; inBundle?: boolean }>;
  };
  const reached = (flag: 'peer' | 'inBundle') => packages.filter((p) => p.installed && lock.packages[p.dir][flag]).map((p) => p.id);
  assert.ok(
    reached('peer').length > 0 && reached('inBundle').length > 0,
    'the lockfile has peer-installed and bundled production packages',
  );
  for (const id of [...reached('peer'), ...reached('inBundle')]) assert.ok(notices.includes(` - ${id}\n`), `${id} is listed`);
  // The check fails on a file with one entry taken out, and on one with an entry nothing installs.
  const one = reached('peer')[0];
  assert.deepStrictEqual(problemsIn(notices.replace(` - ${one}\n`, ''), packages), { missing: [one], extra: [] });
  assert.deepStrictEqual(problemsIn(`${notices} - left-pad@9.9.9\n`, packages), { missing: [], extra: ['left-pad@9.9.9'] });
});
