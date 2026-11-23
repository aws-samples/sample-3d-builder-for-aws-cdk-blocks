// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The local entry (the `default` and `types` export): what runs under
 * `npm run dev` and in tests, with no AWS account.
 *
 * HouseBucket packages a platform's standards for file intake on top of
 * `FileBucket`. The app calls `put()`; the standards come with it.
 *
 * **When to use:** an app team needs to accept files and the platform wants
 * every such bucket encrypted with its own key, logged, tagged, on a retention
 * rule, and guarded by a size limit and a content-type allowlist.
 *
 * **When NOT to use:** you need presigned browser uploads. They skip the
 * server-side checks, so HouseBucket doesn't offer them.
 *
 * The class is the same one the deployed entry exports (see `runtime.ts`).
 * The run-time rules are enforced here too. The template-only settings (key,
 * retention, access logging, tags) have no local effect.
 */
import { assertNotMockInDeployedEnv } from '@aws-cdk-blocks/core/bb-utils';

// Fail closed if this local entry loads in a deployed environment.
assertNotMockInDeployedEnv('@your-team/bb-house-bucket');

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
