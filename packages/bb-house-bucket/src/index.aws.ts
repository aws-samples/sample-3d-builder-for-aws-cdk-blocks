// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The deployed entry (the `aws-runtime` export). It's the same class as the
 * local entry: HouseBucket makes no AWS SDK call of its own. Under the
 * `aws-runtime` condition its child `FileBucket`, `KVStore` and `Logger`
 * resolve to their deployed runtimes, and those make the calls.
 */
export { HouseBucket } from './runtime.js';
export { HOUSE_RULES } from './rules.js';
export { HouseBucketErrors } from './errors.js';
export type {
	AuditEntry,
	DataClassification,
	HouseBucketOptions,
	HouseFile,
	HousePutOptions,
	HouseRules,
} from './types.js';
