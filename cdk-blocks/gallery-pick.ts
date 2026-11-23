// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The gallery's two small decisions, as plain functions the tests can run: which build is the
 * build of the hour, and how the newest-first list takes a new id.
 */
import { createHash } from 'node:crypto';
import type { Featured } from './shared.js';

/** The featured build for an hour: a pick that depends only on the hour and the ids, so repeated deliveries agree. */
export function pickFeatured(ids: readonly string[], hour: string): string {
  const sorted = [...ids].sort();
  return sorted[createHash('sha256').update(hour).digest().readUInt32BE(0) % sorted.length];
}

/**
 * The featured build after a scheduled run, or null when the stored pick stands.
 *
 * A pick holds for its whole UTC hour, even when newer saves have pushed it off the recent list:
 * a saved build is never deleted, so the pick can always be shown. A run that arrives late, stamped
 * with an hour before the stored pick's, changes nothing, so a delayed delivery can't undo a newer pick.
 */
export function nextFeatured(current: Featured | null, recentIds: readonly string[], scheduledTime: string): Featured | null {
  const hour = scheduledTime.slice(0, 13);
  if (current && current.pickedAt.slice(0, 13) >= hour) return null;
  if (recentIds.length === 0) return null;
  return { id: pickFeatured(recentIds, hour), pickedAt: scheduledTime };
}

/** `id` at the front of a newest-first list of at most `max`, without repeating it. */
export function withNewest(current: readonly string[], id: string, max: number): string[] {
  return [id, ...current.filter((x) => x !== id)].slice(0, max);
}
