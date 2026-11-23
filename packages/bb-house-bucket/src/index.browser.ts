// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Browser stub: HouseBucket runs on the server only. This entry re-exports the
// public types and error constants so client code type-checks and can match
// errors by name. The methods live on the server entries and are absent here.
export class HouseBucket {
	constructor(..._args: unknown[]) {}
}
export { HouseBucketErrors } from './errors.js';
export type {
	AuditEntry,
	DataClassification,
	HouseBucketOptions,
	HouseFile,
	HousePutOptions,
	HouseRules,
} from './types.js';
