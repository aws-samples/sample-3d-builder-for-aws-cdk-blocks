// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Writes THIRD-PARTY-LICENSES, or checks the one on disk.
//
//   node scripts/third-party-licenses.mjs           write the file (needs the network once, for npx)
//   node scripts/third-party-licenses.mjs --check   exit 1 if the file on disk misses a package or lists one the lockfile doesn't have
//
// The list is every package the lockfile installs for production: everything in package-lock.json
// that isn't a development dependency, one of this repository's own workspace packages, or a
// platform binary that the machine writing the file didn't install. That includes two kinds a walk from
// package.json's "dependencies" doesn't reach:
// - peer dependencies that npm installs by itself (the Agent Block's SDK brings five that way), and
// - copies bundled inside another package (aws-cdk-lib carries its own).
//
// generate-license-file writes the texts for what it finds. This script then adds a block, in the
// same layout, for every production package it left out, with the text of that package's own
// license file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = 'THIRD-PARTY-LICENSES';
const GENERATOR = 'generate-license-file@4.2.5';
const RULE = '\n-----------\n';
const FIRST_BLOCK = 'The following npm package';
const FOOTER = 'This file was generated with the generate-license-file npm package!';

/**
 * Every production package in the lockfile, as { id: "name@version", dir, installed }: everything under
 * node_modules that isn't a development dependency or a link to one of this repository's own packages.
 * `installed` is false for a platform binary that this machine didn't install.
 */
export function productionPackages(root = ROOT, isInstalled = (path) => existsSync(join(root, path))) {
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
  const out = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('node_modules/') || entry.dev || entry.link) continue;
    const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({ id: `${name}@${entry.version}`, dir: path, installed: isInstalled(path) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** The "name@version" entries a notices file lists. */
export const listedIn = (text) => new Set([...text.matchAll(/^ - (\S+)$/gm)].map((m) => m[1]));

/**
 * What's wrong with a notices file: installed production packages it doesn't list, and entries the
 * lockfile doesn't have. A listed platform binary that another machine installs isn't a problem.
 */
export function problemsIn(text, packages = productionPackages()) {
  const listed = listedIn(text);
  const known = new Set(packages.map((p) => p.id));
  return {
    missing: [...new Set(packages.filter((p) => p.installed).map((p) => p.id))].filter((id) => !listed.has(id)),
    extra: [...listed].filter((id) => !known.has(id)),
  };
}

/** A package's own license text: its license file, or the license id in its package.json when it ships none. */
function licenseTextOf(root, dir) {
  const names = readdirSync(join(root, dir)).filter((n) => /^(licen[sc]e|copying)/i.test(n));
  if (names.length > 0) return readFileSync(join(root, dir, names.sort()[0]), 'utf8').trim();
  const { license } = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));
  if (typeof license !== 'string' || license.length === 0) throw new Error(`${dir} has no license file and no license field`);
  return license;
}

const blockFor = (ids, text) =>
  ids.length === 1
    ? `The following npm package may be included in this product:\n\n - ${ids[0]}\n\nThis package contains the following license:\n\n${text}\n`
    : `The following npm packages may be included in this product:\n\n${ids.map((id) => ` - ${id}`).join('\n')}\n\nThese packages each contain the following license:\n\n${text}\n`;

function generate() {
  const packages = productionPackages().filter((p) => p.installed);
  const wanted = new Set(packages.map((p) => p.id));
  const scratch = mkdtempSync(join(tmpdir(), 'third-party-'));
  let generated;
  try {
    execFileSync('npx', ['--yes', GENERATOR, '--input', 'package.json', '--output', join(scratch, 'out.txt'), '--overwrite'], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    generated = readFileSync(join(scratch, 'out.txt'), 'utf8');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const body = generated.slice(generated.indexOf(FIRST_BLOCK), generated.lastIndexOf(FOOTER));
  // Keep the generator's blocks, minus any entry that isn't a production package here (this repository's own packages).
  const blocks = [];
  for (const block of body.split(RULE)) {
    const ids = [...listedIn(block)];
    if (ids.length === 0) continue;
    const kept = ids.filter((id) => wanted.has(id));
    if (kept.length === 0) continue;
    blocks.push(
      kept.length === ids.length
        ? `${block.trim()}\n`
        : blockFor(kept, block.slice(block.indexOf('license:\n\n') + 'license:\n\n'.length).trim()),
    );
  }
  // Add what the generator left out, grouped by license text.
  const have = listedIn(blocks.join(RULE));
  const byText = new Map();
  for (const p of packages.filter((pkg) => !have.has(pkg.id))) {
    const text = licenseTextOf(ROOT, p.dir);
    byText.set(text, [...(byText.get(text) ?? []), p.id]);
  }
  for (const [text, ids] of byText) blocks.push(blockFor(ids, text));
  const current = readFileSync(join(ROOT, FILE), 'utf8');
  const header = current.slice(0, current.indexOf(FIRST_BLOCK));
  const out = `${header}${blocks.join(RULE)}${RULE}\n${FOOTER}\nhttps://www.npmjs.com/package/generate-license-file\n`;
  const problems = problemsIn(out, packages);
  if (problems.missing.length > 0 || problems.extra.length > 0) throw new Error(`the generated file is wrong: ${JSON.stringify(problems)}`);
  writeFileSync(join(ROOT, FILE), out);
  console.log(`${FILE}: ${wanted.size} packages, ${[...byText.values()].flat().length} of them added from the lockfile`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const { missing, extra } = problemsIn(readFileSync(join(ROOT, FILE), 'utf8'));
    for (const id of missing) console.error(`${FILE}: ${id} is installed for production and isn't listed`);
    for (const id of extra) console.error(`${FILE}: ${id} is listed and isn't in the lockfile`);
    if (missing.length > 0 || extra.length > 0) {
      console.error(`Run node scripts/third-party-licenses.mjs to write the file again.`);
      process.exit(1);
    }
    console.log(`${FILE}: every production package the lockfile installs is listed`);
  } else generate();
}
