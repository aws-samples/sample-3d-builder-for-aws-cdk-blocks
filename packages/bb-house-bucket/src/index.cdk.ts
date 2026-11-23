// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The `cdk` export: runs during `cdk synth`. This is where the template-level
 * house rules live. It constructs the same three children as the runtime, with
 * the same ids, so each child's construct provisions what its runtime expects.
 */
import { Tags } from 'aws-cdk-lib';
import { Scope, synthGuard } from '@aws-cdk-blocks/core/cdk';
import type { ScopeParent } from '@aws-cdk-blocks/core';
import { FileBucket } from '@aws-cdk-blocks/bb-file-bucket';
import { KVStore } from '@aws-cdk-blocks/bb-kv-store';
import { Logger } from '@aws-cdk-blocks/bb-logger';
import { HOUSE_RULES, resolveRequiredTags } from './rules.js';
import type { AuditEntry, HouseBucketOptions, HouseRules } from './types.js';
import { BB_NAME } from './version.js';

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

export class HouseBucket extends Scope {
	readonly tags: Readonly<Record<string, string>>;

	constructor(scope: ScopeParent, id: string, options: HouseBucketOptions) {
		super(id, { parent: scope, bbName: BB_NAME });

		// House rule: no synth without the required tags.
		this.tags = Object.freeze(resolveRequiredTags(this.fullId, options));

		new FileBucket(this, 'files', {
			// House rule: a dedicated customer-managed key, with rotation.
			encryption: HOUSE_RULES.encryption,
			// House rule: server access logs to a dedicated log bucket.
			accessLogging: HOUSE_RULES.accessLogging,
			// House rule: retention. Files expire, and so do superseded versions.
			lifecycleRules: [{ expirationDays: HOUSE_RULES.retentionDays }],
			noncurrentVersionExpirationDays: HOUSE_RULES.noncurrentVersionDays,
			removalPolicy: options.removalPolicy,
		});
		new KVStore<AuditEntry>(this, 'audit', {
			// 'destroy' removes the table with the stack. 'retain' keeps it and leaves
			// deletion protection off. Omitted, the table follows the stack's posture.
			...(options.removalPolicy ? { protection: options.removalPolicy === 'destroy' ? 'disposable' : 'retained' } : {}),
		});
		new Logger(this, 'audit-log', { defaultContext: { ...this.tags } });

		// House rule: every resource under this Block carries the required tags.
		for (const [key, value] of Object.entries(this.tags)) Tags.of(this).add(key, value);
	}

	get rules(): HouseRules {
		return HOUSE_RULES;
	}

	// Runtime methods aren't available during CDK synth. Each one is stubbed so
	// a top-level call fails with a clear message.
	put(..._args: unknown[]): never {
		return synthGuard('HouseBucket', 'put');
	}
	get(..._args: unknown[]): never {
		return synthGuard('HouseBucket', 'get');
	}
	listAudit(..._args: unknown[]): never {
		return synthGuard('HouseBucket', 'listAudit');
	}
}
