// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { Scope, isBlocksError } from '@aws-cdk-blocks/core';
import { HOUSE_RULES, HouseBucket, HouseBucketErrors } from './index.mock.js';
import type { HouseBucketOptions } from './index.mock.js';

// A real, typed parent Scope, as an app would have.
const parent = new Scope('test-app');
const tags: HouseBucketOptions = { owner: 'intake-team', dataClassification: 'internal', costCenter: 'cc-4410' };
let n = 0;
const make = () => new HouseBucket(parent, `intake-${n++}`, tags);
const by = { uploadedBy: 'tester' };

// A 1x1 PNG.
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64',
);

// The children persist under .cdk-blocks/local/data/ in the working directory.
beforeEach(() => {
	rmSync('.cdk-blocks/local/data/', { recursive: true, force: true });
});

test('an allowed file is stored and audited with its checksum', async () => {
	const bucket = make();
	const body = Buffer.from('a,b\n1,2\n');
	const entry = await bucket.put('inbox/data.csv', body, { contentType: 'text/csv', ...by });
	assert.strictEqual(entry.outcome, 'stored');
	assert.strictEqual(entry.size, body.length);
	assert.strictEqual(entry.sha256, createHash('sha256').update(body).digest('hex'));
	assert.strictEqual(entry.uploadedBy, 'tester');

	const file = await bucket.get('inbox/data.csv');
	assert.ok(file);
	assert.deepStrictEqual(file.body, body);
	assert.strictEqual(file.contentType, 'text/csv');
	assert.strictEqual(file.metadata.sha256, entry.sha256);

	assert.deepStrictEqual(await bucket.listAudit(), [entry]);
});

test('a real PNG is allowed', async () => {
	const entry = await make().put('inbox/dot.png', PNG, { contentType: 'image/png', ...by });
	assert.strictEqual(entry.outcome, 'stored');
});

test('a file over the size limit is refused, audited, and not stored', async () => {
	const bucket = make();
	const body = Buffer.alloc(HOUSE_RULES.maxBytes + 1, 0x61);
	await assert.rejects(
		bucket.put('inbox/big.txt', body, { contentType: 'text/plain', ...by }),
		(e: unknown) => isBlocksError(e, HouseBucketErrors.FileTooLarge) && /house limit is 2 MB/.test((e as Error).message),
	);
	assert.strictEqual(await bucket.get('inbox/big.txt'), null);
	const [entry] = await bucket.listAudit();
	assert.strictEqual(entry.outcome, 'refused');
	assert.strictEqual(entry.rule, HouseBucketErrors.FileTooLarge);
	assert.strictEqual(entry.size, body.length);
});

test('a file exactly at the size limit is allowed', async () => {
	const body = Buffer.alloc(HOUSE_RULES.maxBytes, 0x61);
	const entry = await make().put('inbox/edge.txt', body, { contentType: 'text/plain', ...by });
	assert.strictEqual(entry.outcome, 'stored');
});

test('a content type off the allowlist is refused, audited, and not stored', async () => {
	const bucket = make();
	await assert.rejects(
		bucket.put('inbox/tool.zip', Buffer.from('PK\u0003\u0004'), { contentType: 'application/zip', ...by }),
		(e: unknown) => isBlocksError(e, HouseBucketErrors.ContentTypeNotAllowed),
	);
	assert.strictEqual(await bucket.get('inbox/tool.zip'), null);
	const [entry] = await bucket.listAudit();
	assert.strictEqual(entry.rule, HouseBucketErrors.ContentTypeNotAllowed);
});

test('bytes that do not match the declared type are refused', async () => {
	const bucket = make();
	await assert.rejects(
		bucket.put('inbox/fake.png', Buffer.from('this is not a png, it is just some text'), { contentType: 'image/png', ...by }),
		(e: unknown) => isBlocksError(e, HouseBucketErrors.ContentMismatch),
	);
	await assert.rejects(
		bucket.put('inbox/binary.csv', Buffer.from([0xff, 0xfe, 0xfd, 0x00]), { contentType: 'text/csv', ...by }),
		(e: unknown) => isBlocksError(e, HouseBucketErrors.ContentMismatch),
	);
	await assert.rejects(
		bucket.put('inbox/broken.json', Buffer.from('{"a":'), { contentType: 'application/json', ...by }),
		(e: unknown) => isBlocksError(e, HouseBucketErrors.ContentMismatch),
	);
	assert.strictEqual((await bucket.listAudit()).length, 3);
});

test('an empty file, a bad path and a missing uploader are refused', async () => {
	const bucket = make();
	const invalid = (e: unknown) => isBlocksError(e, HouseBucketErrors.InvalidUpload);
	await assert.rejects(bucket.put('inbox/empty.txt', Buffer.alloc(0), { contentType: 'text/plain', ...by }), invalid);
	await assert.rejects(bucket.put('../escape.txt', Buffer.from('x'), { contentType: 'text/plain', ...by }), invalid);
	await assert.rejects(bucket.put('inbox//double.txt', Buffer.from('x'), { contentType: 'text/plain', ...by }), invalid);
	await assert.rejects(bucket.put('inbox/a.txt', Buffer.from('x'), { contentType: 'text/plain', uploadedBy: ' ' }), invalid);
});

test('the audit trail is newest first and honors the limit', async () => {
	const bucket = make();
	for (const name of ['one', 'two', 'three']) {
		await bucket.put(`inbox/${name}.txt`, Buffer.from(name), { contentType: 'text/plain', ...by });
		await new Promise((r) => setTimeout(r, 5));
	}
	const all = await bucket.listAudit();
	assert.deepStrictEqual(all.map((e) => e.path), ['inbox/three.txt', 'inbox/two.txt', 'inbox/one.txt']);
	assert.strictEqual((await bucket.listAudit({ limit: 2 })).length, 2);
});

test('the Block refuses to construct without its required tags', () => {
	const missing = (e: unknown) => isBlocksError(e, HouseBucketErrors.MissingRequiredTag);
	const { owner: _owner, ...noOwner } = tags;
	assert.throws(() => new HouseBucket(parent, `intake-${n++}`, noOwner as HouseBucketOptions), missing);
	assert.throws(() => new HouseBucket(parent, `intake-${n++}`, { ...tags, costCenter: '4410' }), missing);
	assert.throws(
		() => new HouseBucket(parent, `intake-${n++}`, { ...tags, dataClassification: 'secret' as 'internal' }),
		(e: unknown) => missing(e) && /dataClassification/.test((e as Error).message),
	);
	assert.throws(() => new HouseBucket(parent, `intake-${n++}`, undefined as unknown as HouseBucketOptions), missing);
});

test('the rules are exposed as data', () => {
	const { rules, tags: applied } = make();
	assert.strictEqual(rules.maxBytes, 2 * 1024 * 1024);
	assert.ok(rules.allowedContentTypes.includes('text/csv'));
	assert.deepStrictEqual(applied, { owner: 'intake-team', 'data-classification': 'internal', 'cost-center': 'cc-4410' });
});
