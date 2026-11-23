// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { chmodSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDevServer } from 'aws-cdk-blocks/scripts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The dev server listens on DEV_PORT (default 4340) and runs Vite on DEV_PORT + 100.
// Set DEV_PORT to move it, e.g. `DEV_PORT=4350 npm run dev`; the e2e test
// reads the same variable. Don't start on a port another program holds: the dev
// server treats a listener on its ports as a stale copy of itself and stops it.
const port = Number(process.env.DEV_PORT ?? 4340);
const frontendPort = port + 100;

startDevServer({
  port,
  backendPath: join(__dirname, '..', 'index.ts'),
  frontendCommand: `npx vite --port ${frontendPort} --strictPort`,
  frontendPort,
}).then(lockLocalSecrets);

// Locally the Secret Block keeps its values as plaintext under .cdk-blocks/local/data/
// (gitignored). That includes the generated invite code, so keep those files
// readable by this user only.
function lockLocalSecrets() {
  const dataDir = join(__dirname, '..', '..', '.cdk-blocks/local/data/');
  for (const [path, mode] of [
    [dataDir, 0o700],
    [join(dataDir, 'settings.json'), 0o600],
    [join(dataDir, 'secret-versions.json'), 0o600],
  ] as const) {
    if (existsSync(path)) chmodSync(path, mode);
  }
}
