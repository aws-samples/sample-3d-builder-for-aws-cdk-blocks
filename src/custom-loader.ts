// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { type ArrangementFile, isLoaded, register, registerShared, type SharedFile } from "./custom";

// The custom piece's data, loaded when it's needed: one small file per arrangement (its 16 standards
// states) and one shared file. Vite turns each into its own chunk, so the first screen doesn't carry
// them. Kept apart from src/custom.ts because import.meta.glob only exists in the Vite build.
const loaders = import.meta.glob<{ default: unknown }>("./data/page/custom/*.json");
const pending = new Map<string, Promise<void>>();

function load(name: string, keep: (file: unknown) => void): Promise<void> {
  let job = pending.get(name);
  if (!job) {
    const loader = loaders[`./data/page/custom/${name}.json`];
    job = loader ? loader().then((m) => keep(m.default)) : Promise.reject(new Error(`No standards data for ${name}`));
    // A failed load can be tried again.
    job.catch(() => pending.delete(name));
    pending.set(name, job);
  }
  return job;
}

/** Load one arrangement's standards data (and the shared file). Resolves when both are in memory. */
export async function loadCustom(arrangement: string): Promise<void> {
  if (isLoaded(arrangement)) return;
  await Promise.all([load("shared", (f) => registerShared(f as SharedFile)), load(arrangement, (f) => register(f as ArrangementFile))]);
}
