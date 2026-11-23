// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The daily budgets, proven against the real code path.
 *
 * Run:  npm run dev:stop -- --port 4340     (the dev server must be stopped first)
 *       DEV_PORT=4340 npm run test:caps
 *
 * Reaching the daily caps through the API alone would take 500 saves (at 60 a
 * minute, nine minutes) and 200 agent questions. So this file writes "one below
 * the cap" into the local counters store while no server is running, starts the
 * dev server itself, and then goes through the API: the last slot is accepted
 * and the next request is refused. The per-page cap of 10 questions is spent
 * for real, one question at a time, before the daily cap is reached.
 *
 * When it's done it stops the server and removes every budget key it touched,
 * so today's local budgets are back to zero. The counters file format
 * ({ version: 2, items: [{ _bkv_pk: "<key>", _bkv_value: <number>, _bkv_ttl: <epoch seconds> }] })
 * belongs to the KVStore Block's local implementation in @aws-cdk-blocks/bb-kv-store 1.0.0.
 */

import assert from 'node:assert';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { __resetConnectionsForTest } from '@aws-cdk-blocks/bb-realtime/mock-middleware';
import { isServerRunning } from 'aws-cdk-blocks/utils';
import { ASKS_PER_DAY, ASKS_PER_SESSION_PER_DAY, CONVERSATIONS_PER_DAY, SAVES_PER_DAY } from '../cdk-blocks/shared.js';
import { type Api, ask, localInviteCode, refusedWith, serverPort, waitForServer } from './helpers.js';

const STORE_DIR = '.cdk-blocks/local/data/baseplate-counters';
const STORE = `${STORE_DIR}/store.json`;
const today = new Date().toISOString().slice(0, 10);
const ttl = Math.floor(Date.now() / 1000) + 2 * 24 * 3600;

interface Item {
  _bkv_pk: string;
  _bkv_value: number;
  _bkv_ttl?: number;
}
interface Stored {
  version: 2;
  items: Item[];
}
const readStore = (): Stored => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : { version: 2, items: [] });
/** The store without its budget keys, plus the ones given. */
const withBudgets = (store: Stored, budgets: Record<string, number> = {}): Stored => ({
  ...store,
  items: [
    ...store.items.filter((item) => !isBudgetKey(item._bkv_pk)),
    ...Object.entries(budgets).map(([key, value]) => ({ _bkv_pk: key, _bkv_value: value, _bkv_ttl: ttl })),
  ],
});
const isBudgetKey = (key: string) => ['ask:', 'save-day:', 'save:', 'convos:'].some((prefix) => key.startsWith(prefix));
/** A counter's value in the local store file, or null when the key isn't there. */
const stored = (key: string): number | null => {
  const item = readStore().items.find((entry) => entry._bkv_pk === key);
  return item === undefined ? null : item._bkv_value;
};
/** New conversations the last test may start before the day's budget for them runs out. */
const CONVERSATIONS_LEFT = 12;

let server: ChildProcess | null = null;
let api: Api;

async function stopServer() {
  if (!server?.pid) return;
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {}
  for (let i = 0; i < 20; i++) {
    if (!(await isServerRunning(serverPort).catch(() => true))) break;
    await sleep(500);
  }
  server = null;
}

test.before(async () => {
  assert.ok(
    !(await isServerRunning(serverPort)),
    `a dev server is running on ${serverPort}; stop it first (npm run dev:stop -- --port ${serverPort})`,
  );
  // Just below each daily cap: the saves one short, the agent questions short by what the first agent test uses
  // (ASKS_PER_SESSION_PER_DAY on one page, one on another) plus one. A midnight (UTC) rollover during the run would make these keys stale; rerun then.
  const store = withBudgets(readStore(), {
    [`save-day:${today}`]: SAVES_PER_DAY - 1,
    [`ask:${today}`]: ASKS_PER_DAY - ASKS_PER_SESSION_PER_DAY - 2,
    // The earlier tests start seven conversations; the last test uses up the rest.
    [`convos:${today}`]: CONVERSATIONS_PER_DAY - CONVERSATIONS_LEFT,
  });
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE, JSON.stringify(store, null, 2));

  server = spawn('npm', ['run', 'dev:server'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'ignore', 'ignore'],
    detached: true,
    env: { ...process.env, NODE_OPTIONS: '', DEV_PORT: String(serverPort) },
  });
  server.unref();
  await sleep(2000);
  const mod = await import('cdk-blocks');
  api = mod.api;
  await waitForServer();
});

test.after(async () => {
  __resetConnectionsForTest();
  await stopServer();
  // Hand today's local budgets back.
  writeFileSync(STORE, JSON.stringify(withBudgets(readStore()), null, 2));
});

test(`cap: the ${SAVES_PER_DAY}th save of the day is accepted and the next is refused`, async () => {
  const code = localInviteCode();
  const last = await api.saveBuild({ code, blocks: ['kvstore'], source: 'hand' });
  assert.match(last.id, /^[a-z2-7]{10}$/);
  await assert.rejects(
    () => api.saveBuild({ code, blocks: ['kvstore'], source: 'hand' }),
    (err: unknown) => {
      refusedWith(429, 'SaveBudgetException')(err);
      assert.match((err as Error).message, new RegExp(`All ${SAVES_PER_DAY} saves for today`));
      return true;
    },
  );
  // The refused save didn't reach the gallery.
  assert.strictEqual((await api.listGallery()).builds[0].id, last.id);
  // And it didn't use a slot of the per-minute budget: only the accepted save did.
  const minuteSlots = readStore()
    .items.map((item) => item._bkv_pk)
    .filter((key) => /^save:\d+$/.test(key))
    .reduce((n, key) => n + (stored(key) ?? 0), 0);
  assert.strictEqual(minuteSlots, 1);
});

test(`cap: one page gets ${ASKS_PER_SESSION_PER_DAY} agent questions a day, and another page is unaffected`, async () => {
  const code = localInviteCode();
  const session = randomUUID();
  const conversationId = await api.agentCreateConversationId({ code, session });
  for (let i = 0; i < ASKS_PER_SESSION_PER_DAY; i++) {
    const accepted = await api.agentStream({ code, session, message: 'hello', conversationId });
    assert.strictEqual(accepted.channelId, conversationId, `question ${i + 1} should be accepted`);
    await sleep(150); // let the canned turn finish before the next one
  }
  await assert.rejects(
    () => api.agentStream({ code, session, message: 'hello', conversationId }),
    (err: unknown) => {
      refusedWith(429, 'AskBudgetException')(err);
      assert.match((err as Error).message, new RegExp(`used its ${ASKS_PER_SESSION_PER_DAY} agent questions`));
      return true;
    },
  );
  // A new conversation on the same page doesn't get around it.
  const second = await api.agentCreateConversationId({ code, session });
  await assert.rejects(
    () => api.agentStream({ code, session, message: 'hello', conversationId: second }),
    refusedWith(429, 'AskBudgetException'),
  );
  // Another page still gets an answer.
  const other = await ask(api, { code, session: randomUUID() }, 'a chat app where people sign in');
  assert.strictEqual(other.failure, undefined);
  assert.deepStrictEqual(other.toolCalls, ['snapPieces']);
});

test(`cap: the ${ASKS_PER_DAY}th agent question of the day is accepted and the next is refused, for any page`, async () => {
  const code = localInviteCode();
  const first = await ask(api, { code, session: randomUUID() }, 'a chat app where people sign in');
  assert.strictEqual(first.failure, undefined);
  assert.deepStrictEqual(first.toolCalls, ['snapPieces']);

  // A different page, with its own untouched per-page budget.
  const session = randomUUID();
  const conversationId = await api.agentCreateConversationId({ code, session });
  await assert.rejects(
    () => api.agentStream({ code, session, message: 'a chat app', conversationId }),
    (err: unknown) => {
      refusedWith(429, 'AskBudgetException')(err);
      assert.match((err as Error).message, new RegExp(`All ${ASKS_PER_DAY} agent questions for today`));
      return true;
    },
  );
  // The refused question ran no tool: there's no proposal for that conversation.
  assert.strictEqual(await api.getProposal({ conversationId }), null);
  // Once the day is spent a refusal writes nothing, so rotating page ids can't grow the table.
  assert.strictEqual(stored(`ask:${session}:${today}`), null);
  assert.strictEqual(stored(`ask:${today}`), ASKS_PER_DAY);

  // Through the chat client, the refusal surfaces as the turn's failure text, not as an answer.
  const refused = await ask(api, { code, session: randomUUID() }, 'a chat app');
  assert.match(refused.failure ?? '', new RegExp(`All ${ASKS_PER_DAY} agent questions for today`));
  assert.strictEqual(refused.answer, '');
});

test(`cap: new agent conversations stop at ${CONVERSATIONS_PER_DAY} a day`, async () => {
  const code = localInviteCode();
  let accepted = 0;
  let refusal: unknown;
  for (let i = 0; i < CONVERSATIONS_LEFT + 1 && !refusal; i++) {
    try {
      await api.agentCreateConversationId({ code, session: randomUUID() });
      accepted++;
    } catch (err) {
      refusal = err;
    }
  }
  assert.ok(accepted >= 1, 'some conversations were still available');
  assert.ok(refusal, `expected a refusal within ${CONVERSATIONS_LEFT + 1} new conversations`);
  refusedWith(429, 'AskBudgetException')(refusal);
  assert.match((refusal as Error).message, /started all the conversations it can today/);
  assert.strictEqual(stored(`convos:${today}`), CONVERSATIONS_PER_DAY);
  // Without the invite code the budget isn't touched.
  await assert.rejects(
    () => api.agentCreateConversationId({ code: 'not-the-code', session: randomUUID() }),
    refusedWith(403, 'InviteRequiredException'),
  );
});
