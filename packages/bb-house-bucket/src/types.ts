// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Shared types for HouseBucket. Imported by the mock, aws, cdk, and browser
 * entry points. Types only: this file has zero runtime dependencies.
 */

/** The data classifications the platform accepts on a bucket. */
export type DataClassification = 'public' | 'internal' | 'confidential';

/**
 * Options for constructing a {@link HouseBucket}.
 *
 * The three tag options are required. The Block refuses to construct without
 * them, in every context: on your machine, at `cdk synth`, and deployed.
 */
export interface HouseBucketOptions {
	/** Team that owns the data, for the `owner` tag. Lowercase letters, digits and dashes. */
	owner: string;
	/** For the `data-classification` tag. */
	dataClassification: DataClassification;
	/** For the `cost-center` tag, like `cc-4410`. */
	costCenter: string;
	/**
	 * What `cdk destroy` does with the bucket, its key, its log bucket and the
	 * audit table. Omit it to follow the stack's posture (production retains).
	 * Not a house rule: it's the app team's call per environment.
	 */
	removalPolicy?: 'destroy' | 'retain';
}

/** What the caller says about an upload. */
export interface HousePutOptions {
	/** The declared MIME type. Must be on the allowlist and match the bytes. */
	contentType: string;
	/** Who is uploading, for the audit entry. A label the app supplies. */
	uploadedBy: string;
}

/** One line of the audit trail. Written for every upload, stored or refused. */
export interface AuditEntry {
	/** Unique id of this entry. */
	id: string;
	/** ISO 8601 time the Block handled the upload. */
	at: string;
	uploadedBy: string;
	path: string;
	/** Size in bytes. */
	size: number;
	contentType: string;
	/** SHA-256 of the bytes, hex. */
	sha256: string;
	outcome: 'stored' | 'refused';
	/** For a refusal: the {@link HouseBucketErrors} name of the rule that refused it. */
	rule?: string;
	/** For a refusal: the message the caller got. */
	reason?: string;
}

/** A stored file, as returned by `get()`. */
export interface HouseFile {
	body: Buffer;
	contentType: string;
	size: number;
	metadata: Record<string, string>;
}

/** The house rules, as data. Returned by `HouseBucket.rules`. */
export interface HouseRules {
	/** Largest upload `put()` accepts, in bytes. */
	maxBytes: number;
	/** Content types `put()` accepts. */
	allowedContentTypes: readonly string[];
	/** Days until a stored file and its audit entry expire. */
	retentionDays: number;
	/** Days until a superseded version of a file expires. */
	noncurrentVersionDays: number;
	/** Tag keys every resource under the Block carries. */
	requiredTags: readonly string[];
	/** Encryption at rest for the bucket. */
	encryption: 'customer-managed';
	/** Server access logging for the bucket. */
	accessLogging: true;
}
