// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Shared budgets on a counter store: a conditional write per slot, so two requests can't both
 * take the last one. The store is the `counters` KVStore; the interface is the two calls used
 * here, so the tests can run the same code on a store in memory.
 */
export interface CounterStore {
  get(key: string): Promise<number | null>;
  put(key: string, value: number, options?: { ifNotExists?: boolean; ifValueEquals?: number; ttlSeconds?: number }): Promise<void>;
}

const ATTEMPTS = 8;
const isConflict = (e: unknown) => (e as { name?: string }).name === 'ConditionalCheckFailedException';

/**
 * Add `delta` to a counter. `allow` sees the current value (0 when the key is new) and can refuse.
 * Returns "done", "refused" (allow said no) or "busy" (other writers won every attempt).
 */
export async function bump(
  store: CounterStore,
  key: string,
  delta: number,
  ttlSeconds: number,
  allow: (current: number) => boolean = () => true,
): Promise<'done' | 'refused' | 'busy'> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const current = await store.get(key);
    if (!allow(current ?? 0)) return 'refused';
    try {
      if (current === null) await store.put(key, delta, { ifNotExists: true, ttlSeconds });
      else await store.put(key, current + delta, { ifValueEquals: current, ttlSeconds });
      return 'done';
    } catch (e) {
      // Another request moved the counter first: read it again and retry.
      if (!isConflict(e)) throw e;
    }
  }
  return 'busy';
}

/** "taken": the caller holds a slot. "full": the budget is used up. "busy": too much contention to tell; nothing was taken. */
export type Slot = 'taken' | 'full' | 'busy';

/** Take one slot from a budget of `limit`. */
export async function takeSlot(store: CounterStore, key: string, limit: number, ttlSeconds: number): Promise<Slot> {
  const result = await bump(store, key, 1, ttlSeconds, (used) => used < limit);
  return result === 'done' ? 'taken' : result === 'refused' ? 'full' : 'busy';
}

/** Is the budget used up? A read only, for refusing early without writing a key. */
export async function isFull(store: CounterStore, key: string, limit: number): Promise<boolean> {
  return ((await store.get(key)) ?? 0) >= limit;
}

/** Give a taken slot back, when the work it paid for never started. Best effort: a lost race leaves the slot spent. */
export async function giveBack(store: CounterStore, key: string, ttlSeconds: number): Promise<void> {
  await bump(store, key, -1, ttlSeconds, (used) => used > 0);
}
