// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/** The four entry points expose one public surface. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as mock from './index.mock.js';
import * as aws from './index.aws.js';
import * as cdk from './index.cdk.js';
import * as browser from './index.browser.js';

test('error constants are the same across mock / aws / cdk / browser', () => {
	assert.deepEqual(mock.HouseBucketErrors, aws.HouseBucketErrors);
	assert.deepEqual(mock.HouseBucketErrors, cdk.HouseBucketErrors);
	assert.deepEqual(mock.HouseBucketErrors, browser.HouseBucketErrors);
});

test('the local and deployed entries export the same class', () => {
	assert.strictEqual(mock.HouseBucket, aws.HouseBucket);
});

test('the cdk entry reads the same rules and stubs every runtime method', () => {
	assert.strictEqual(cdk.HOUSE_RULES, mock.HOUSE_RULES);
	const runtime = Object.getOwnPropertyNames(mock.HouseBucket.prototype).filter((m) => !['constructor', 'record'].includes(m));
	for (const method of runtime) {
		assert.ok(method in cdk.HouseBucket.prototype, `index.cdk.ts is missing "${method}"`);
	}
});
