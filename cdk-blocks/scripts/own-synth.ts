// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * npm run own-synth
 *
 * Synthesizes Baseplate itself (`npx cdk synth`, no AWS credentials needed),
 * counts the resources in its own CloudFormation template by type, lists the
 * Blocks constructed in cdk-blocks/index.ts, and writes cdk-blocks/own-synth.json.
 * `getApp()` returns that file, and the "what this page runs on" panel shows it.
 *
 * Run it after any change under cdk-blocks/ and commit the result. The output
 * has no timestamp, so a re-run with no change writes the same bytes.
 *
 * It isn't part of `npm run build`: the Hosting construct runs `npm run build`
 * during synth, so hooking it in there would make synth call itself.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/**
 * The Blocks constructed in a source file: `new Kind(scope, 'id'`, grouped by kind in first-seen
 * order. `parent` is the first argument's name: `scope` in the app's backend, `this` inside a
 * custom Block's CDK entry, where the Block constructs the Blocks it's built from.
 */
export function constructedBlocks(source: string, parent: 'scope' | 'this' = 'scope'): { kind: string; ids: string[] }[] {
  const found: { kind: string; ids: string[] }[] = [];
  // `parent` is one of two literals, so the pattern holds no outside input.
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  for (const m of source.matchAll(new RegExp(`\\bnew\\s+([A-Z][A-Za-z]+)\\s*(?:<[^>]*>)?\\(\\s*${parent}\\s*,\\s*'([^']+)'`, 'g'))) {
    const [, kind, id] = m;
    if (kind === 'ApiNamespace') continue; // the API surface, not a Block
    const entry = found.find((f) => f.kind === kind);
    if (entry) entry.ids.push(id);
    else found.push({ kind, ids: [id] });
  }
  return found;
}

/**
 * The custom Blocks among them: a kind whose import in the backend source comes from a package in
 * this app's workspace (listed under "workspaces" in package.json), not from AWS. For each, the
 * Blocks it constructs inside itself, read from its package's src/index.cdk.ts.
 */
export function customBlocks(
  source: string,
  blocks: { kind: string; ids: string[] }[],
  workspaces: { name: string; dir: string }[],
  readFile: (path: string) => string,
): { kind: string; package: string; ids: string[]; inside: { kind: string; ids: string[] }[] }[] {
  const out = [];
  for (const m of source.matchAll(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';/gm)) {
    const ws = workspaces.find((w) => w.name === m[2]);
    if (!ws) continue;
    const names = m[1].split(',').map((n) => n.trim());
    for (const b of blocks)
      if (names.includes(b.kind))
        out.push({ kind: b.kind, package: ws.name, ids: b.ids, inside: constructedBlocks(readFile(`${ws.dir}/src/index.cdk.ts`), 'this') });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = mkdtempSync(join(tmpdir(), 'baseplate-own-synth-'));
  try {
    execFileSync('npx', ['cdk', 'synth', '--quiet', '-o', out], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
    });
    const templates = readdirSync(out).filter((f) => f.endsWith('.template.json'));
    if (templates.length !== 1) throw new Error(`expected one stack template, found ${templates.length}: ${templates.join(', ')}`);
    const template = JSON.parse(readFileSync(join(out, templates[0]), 'utf8')) as {
      Resources: Record<string, { Type: string }>;
    };
    const byType: Record<string, number> = {};
    for (const r of Object.values(template.Resources)) byType[r.Type] = (byType[r.Type] ?? 0) + 1;
    const sorted = Object.fromEntries(Object.entries(byType).sort(([a], [b]) => a.localeCompare(b)));

    const source = read('cdk-blocks/index.ts');
    const blocks = constructedBlocks(source);
    const workspaces = (JSON.parse(read('package.json')).workspaces as string[])
      .filter((dir) => dir !== 'cdk-blocks')
      .map((dir) => ({ name: JSON.parse(read(`${dir}/package.json`)).name as string, dir }));
    const hostingConstruct = /\bnew\s+Hosting\s*\(/.test(read('cdk-blocks/index.cdk.ts'));
    const version = (name: string) => JSON.parse(read(`node_modules/${name}/package.json`)).version as string;

    const result = {
      // How N is counted: Block kinds. Three KVStore stores are one Block kind used three times.
      blockKinds: blocks.length,
      blocks,
      customBlocks: customBlocks(source, blocks, workspaces, read),
      hostingConstruct,
      resourceCount: Object.keys(template.Resources).length,
      resourcesByType: sorted,
      packages: {
        'aws-cdk-blocks': version('aws-cdk-blocks'),
        'aws-cdk-lib': version('aws-cdk-lib'),
      },
    };
    writeFileSync(join(root, 'cdk-blocks', 'own-synth.json'), `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `own-synth: ${result.blockKinds} Block kinds (${result.customBlocks.length} custom)${hostingConstruct ? ' and the Hosting construct' : ''}, ${result.resourceCount} resources, written to cdk-blocks/own-synth.json`,
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}
