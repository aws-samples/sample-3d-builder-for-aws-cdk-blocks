// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// First-run setup: gives this clone its own stack id.
//
// CDK Blocks names the CloudFormation stack, and through it the S3 buckets and DynamoDB tables,
// after `stackId` in .cdk-blocks/config.json, and stops when the file is missing. S3 bucket names are
// shared by every AWS account, so two clones must not use the same id. The file isn't in git.
// This script writes one with a random suffix when there's none, and never changes an id that's set.
//
// It runs from `npm install` (the `prepare` script) and before dev, sandbox, deploy, typegen and
// the synth scripts. Run it yourself with `npm run setup`.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLACEHOLDER = 'baseplate-REPLACE-ME';

/** Make sure `<root>/.cdk-blocks/config.json` holds a stack id. Returns the id and whether this call wrote it. */
export function ensureBlocksConfig(root) {
  const path = join(root, '.cdk-blocks', 'config.json');
  let config = {};
  if (existsSync(path)) {
    try {
      config = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error(`${path} isn't valid JSON. Fix it or delete it, then run npm run setup again.`);
    }
  }
  if (typeof config.stackId === 'string' && config.stackId.length > 0 && config.stackId !== PLACEHOLDER) {
    return { created: false, stackId: config.stackId };
  }
  const stackId = `baseplate-${randomBytes(3).toString('hex')}`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify({ ...config, stackId }, null, 2)}\n`);
  return { created: true, stackId };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const { created, stackId } = ensureBlocksConfig(root);
  if (created) console.log(`setup: wrote .cdk-blocks/config.json with stack id ${stackId}. Your production stack will be ${stackId}-prod.`);
}
