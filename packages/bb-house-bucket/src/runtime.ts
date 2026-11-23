// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The one runtime implementation of HouseBucket, used by both the local entry
 * (`index.mock.ts`) and the deployed entry (`index.aws.ts`).
 *
 * HouseBucket owns no storage of its own. It composes three Blocks that AWS
 * provides, as children of its own scope: a `FileBucket` for the files, a
 * `KVStore` for the audit trail and a `Logger` for the audit line. Each of
 * those resolves to its own local implementation or its own deployed runtime
 * through the package export conditions, so the code in this file is the same
 * in both places and the two entries can't drift apart.
 */
import { randomUUID } from 'node:crypto';
import { Scope, blocksError } from '@aws-cdk-blocks/core';
import type { ScopeParent } from '@aws-cdk-blocks/core';
import { FileBucket } from '@aws-cdk-blocks/bb-file-bucket';
import { KVStore } from '@aws-cdk-blocks/bb-kv-store';
import { Logger } from '@aws-cdk-blocks/bb-logger';
import { HouseBucketErrors } from './errors.js';
import { HOUSE_RULES, checkRequest, checkUpload, resolveRequiredTags, sha256Hex } from './rules.js';
import type { AuditEntry, HouseBucketOptions, HouseFile, HousePutOptions, HouseRules } from './types.js';
import { BB_NAME, BB_VERSION } from './version.js';

/** Most audit entries `listAudit()` returns in one call. */
const MAX_AUDIT_PAGE = 100;

export class HouseBucket extends Scope {
	/** The tags this Block puts on its resources when deployed. */
	readonly tags: Readonly<Record<string, string>>;
	private readonly files: FileBucket;
	private readonly audit: KVStore<AuditEntry>;
	private readonly log: Logger;

	constructor(scope: ScopeParent, id: string, options: HouseBucketOptions) {
		super(id, { parent: scope, bbName: BB_NAME, bbVersion: BB_VERSION });
		// Fails here, on your machine, the same way it fails at synth.
		this.tags = Object.freeze(resolveRequiredTags(this.fullId, options));
		// The infrastructure options (key, retention, access logging) are set in
		// index.cdk.ts. The children ignore them at run time, so they aren't repeated.
		this.files = new FileBucket(this, 'files');
		this.audit = new KVStore<AuditEntry>(this, 'audit');
		this.log = new Logger(this, 'audit-log', { defaultContext: { ...this.tags } });
	}

	/** The house rules, as data, for a UI or a README to show. */
	get rules(): HouseRules {
		return HOUSE_RULES;
	}

	/**
	 * Store a file, if the house rules allow it. Every call that reaches the
	 * rules writes one audit entry, stored or refused.
	 *
	 * @returns The audit entry for the stored file.
	 * @throws `HouseBucketErrors.FileTooLarge`, `ContentTypeNotAllowed`,
	 *   `ContentMismatch` or `InvalidUpload` when a rule refuses the upload.
	 */
	async put(path: string, body: Buffer, options: HousePutOptions): Promise<AuditEntry> {
		if (!Buffer.isBuffer(body)) {
			throw blocksError(HouseBucketErrors.InvalidUpload, 'The body must be a Buffer.');
		}
		checkRequest(path, options);
		const entry: AuditEntry = {
			id: randomUUID(),
			at: new Date().toISOString(),
			uploadedBy: options.uploadedBy.trim(),
			path,
			size: body.length,
			contentType: options.contentType,
			sha256: sha256Hex(body),
			outcome: 'stored',
		};
		const refusal = checkUpload(body, options.contentType);
		if (refusal) {
			const refused: AuditEntry = { ...entry, outcome: 'refused', rule: refusal.rule, reason: refusal.reason };
			await this.record(refused);
			this.log.warn('upload refused', { ...refused });
			throw blocksError(refusal.rule, refusal.reason);
		}
		await this.files.put(path, body, {
			contentType: options.contentType,
			metadata: { sha256: entry.sha256, 'uploaded-by': encodeURIComponent(entry.uploadedBy), 'audit-id': entry.id },
		});
		await this.record(entry);
		this.log.info('upload stored', { ...entry });
		return entry;
	}

	/** Read a stored file. Returns `null` when there's no file at the path. */
	async get(path: string): Promise<HouseFile | null> {
		const file = await this.files.get(path);
		if (!file) return null;
		return { body: file.body, contentType: file.contentType, size: file.size, metadata: file.metadata };
	}

	/**
	 * The audit trail, newest first. Entries expire with the files, after
	 * `rules.retentionDays`.
	 */
	async listAudit(options?: { limit?: number }): Promise<AuditEntry[]> {
		const limit = Math.min(Math.max(1, Math.floor(options?.limit ?? 20)), MAX_AUDIT_PAGE);
		const entries: AuditEntry[] = [];
		for await (const { value } of this.audit.scan()) entries.push(value);
		entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
		return entries.slice(0, limit);
	}

	private async record(entry: AuditEntry): Promise<void> {
		await this.audit.put(`${entry.at}#${entry.id}`, entry, { ttlSeconds: HOUSE_RULES.retentionDays * 24 * 60 * 60 });
	}
}
