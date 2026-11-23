// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The here-now count, kept with keyed reads and writes only. No scan: a check-in costs the same
 * however many keys the table holds.
 *
 * Time is cut into buckets of one heartbeat. A page counts as here while its last check-in is in
 * the current bucket or one of the two before it, so the window is three buckets.
 *
 * Per page: one marker, `here:<session>`, holding the bucket of its last check-in and whether it
 * holds the invite code. Per bucket: two tallies, one for all pages and one for those building.
 * A tally packs three numbers:
 *   n   pages whose first check-in of the bucket landed here
 *   r1  of those, pages that were also seen one bucket earlier
 *   r2  of those, pages last seen two buckets earlier
 * The distinct pages over buckets b, b-1 and b-2 are then
 *   n[b] + (n[b-1] - r1[b]) + (n[b-2] - r1[b-1] - r2[b])
 * which is exact, because each page adds itself to a bucket once and says where it came from.
 */
import { bump, type CounterStore } from './budget.js';

const WATCHING = 1;
const BUILDING = 2;
const BUCKETS = 3;
const PACK = 1000; // each packed number stays far below this: the cap on pages is in the hundreds

export interface PresenceLimits {
  /** Seconds in a bucket: the page's heartbeat interval. */
  bucketSeconds: number;
  /** Seconds a page stays counted after its last check-in. Must be three buckets. */
  windowSeconds: number;
  /** Pages counted at most. A new page past this isn't recorded. */
  maxHere: number;
}

export interface Tally {
  n: number;
  r1: number;
  r2: number;
}
const unpack = (v: number | null): Tally => ({
  n: (v ?? 0) % PACK,
  r1: Math.floor((v ?? 0) / PACK) % PACK,
  r2: Math.floor((v ?? 0) / PACK ** 2),
});

/** Distinct pages over three buckets, newest first. */
export function distinct([now, one, two]: readonly [Tally, Tally, Tally]): number {
  return Math.max(0, now.n + (one.n - now.r1) + (two.n - one.r1 - now.r2));
}

export interface CheckIn {
  here: number;
  building: number;
  /** False when the page is new and the count is at its cap: it wasn't recorded. */
  counted: boolean;
}

/**
 * Record a page's check-in and return the counts. A page already counted in this bucket costs
 * reads only. A new page needs room under `maxHere` and a slot from `takeJoinSlot`, which the
 * caller backs with a per-minute budget and may throw from.
 */
export async function checkIn(
  store: CounterStore,
  session: string,
  building: boolean,
  nowMs: number,
  limits: PresenceLimits,
  takeJoinSlot: () => Promise<void>,
): Promise<CheckIn> {
  if (limits.windowSeconds !== BUCKETS * limits.bucketSeconds) throw new Error('the here-now window must be three heartbeats');
  const bucket = Math.floor(nowMs / (limits.bucketSeconds * 1000));
  const markerKey = `here:${session}`;
  const tallyKey = (kind: 'h' | 'b', b: number) => `tally:${kind}:${b}`;
  const read = (kind: 'h' | 'b') =>
    Promise.all([0, 1, 2].map(async (back) => unpack(await store.get(tallyKey(kind, bucket - back))))) as Promise<[Tally, Tally, Tally]>;
  const [marker, all, builders] = await Promise.all([store.get(markerKey), read('h'), read('b')]);

  // A marker older than the window is a page that left and came back: it joins like a new one.
  const last = marker === null ? null : Math.floor(marker / 4);
  const known = last !== null && last >= bucket - 2 && last <= bucket;
  const wasBuilding = known && marker !== null && marker % 4 === BUILDING;
  const result = (counted: boolean): CheckIn => ({ here: distinct(all), building: distinct(builders), counted });
  const tallyTtl = (BUCKETS + 1) * limits.bucketSeconds;
  const mark = (mode: number) => store.put(markerKey, bucket * 4 + mode, { ttlSeconds: limits.windowSeconds });

  if (known && last === bucket) {
    // Already counted in this bucket. The one change that matters is a page that just got the code.
    if (building && !wasBuilding && (await bump(store, tallyKey('b', bucket), 1, tallyTtl)) === 'done') {
      builders[0].n += 1;
      await mark(BUILDING);
    }
    return result(true);
  }

  if (!known) {
    if (distinct(all) >= limits.maxHere) return result(false);
    await takeJoinSlot();
  }
  const from = !known ? 0 : last === bucket - 1 ? PACK : PACK ** 2;
  if ((await bump(store, tallyKey('h', bucket), 1 + from, tallyTtl)) !== 'done') return result(known);
  all[0].n += 1;
  if (from === PACK) all[0].r1 += 1;
  if (from === PACK ** 2) all[0].r2 += 1;
  // A page that was building last time leaves that bucket's building count, whatever it is now.
  const builderDelta = (building ? 1 : 0) + (wasBuilding ? from : 0);
  if (builderDelta > 0 && (await bump(store, tallyKey('b', bucket), builderDelta, tallyTtl)) === 'done') {
    if (building) builders[0].n += 1;
    if (wasBuilding && from === PACK) builders[0].r1 += 1;
    if (wasBuilding && from === PACK ** 2) builders[0].r2 += 1;
  }
  await mark(building ? BUILDING : WATCHING);
  return result(true);
}
