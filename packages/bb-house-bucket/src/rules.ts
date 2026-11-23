// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * The house rules themselves: one place, no AWS and no Block imports beyond
 * the error helper, so the local implementation, the deployed runtime and the
 * CDK construct all read the same values and run the same checks.
 */
import { createHash } from 'node:crypto';
import { blocksError } from '@aws-cdk-blocks/core';
import { HouseBucketErrors } from './errors.js';
import type { DataClassification, HouseBucketOptions, HousePutOptions, HouseRules } from './types.js';

export const HOUSE_RULES: HouseRules = Object.freeze({
	maxBytes: 2 * 1024 * 1024,
	allowedContentTypes: Object.freeze(['text/csv', 'image/png', 'application/json', 'text/plain']),
	retentionDays: 30,
	noncurrentVersionDays: 7,
	requiredTags: Object.freeze(['owner', 'data-classification', 'cost-center']),
	encryption: 'customer-managed',
	accessLogging: true,
});

const CLASSIFICATIONS: readonly DataClassification[] = ['public', 'internal', 'confidential'];
const OWNER_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
const COST_CENTER_PATTERN = /^cc-[0-9]{4}$/;
const PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Check the required tags and return them as tag key and value pairs.
 * Throws `HouseBucketErrors.MissingRequiredTag` when one is missing or malformed.
 */
export function resolveRequiredTags(blockId: string, options: HouseBucketOptions | undefined): Record<string, string> {
	const problems: string[] = [];
	const owner = options?.owner;
	const dataClassification = options?.dataClassification;
	const costCenter = options?.costCenter;
	if (typeof owner !== 'string' || !OWNER_PATTERN.test(owner)) {
		problems.push('owner (a team name: lowercase letters, digits and dashes, 2 to 40 characters)');
	}
	if (typeof dataClassification !== 'string' || !CLASSIFICATIONS.includes(dataClassification)) {
		problems.push(`dataClassification (one of ${CLASSIFICATIONS.join(', ')})`);
	}
	if (typeof costCenter !== 'string' || !COST_CENTER_PATTERN.test(costCenter)) {
		problems.push('costCenter (like cc-4410)');
	}
	if (problems.length > 0) {
		throw blocksError(
			HouseBucketErrors.MissingRequiredTag,
			`HouseBucket "${blockId}" needs its required tags. Missing or malformed: ${problems.join('; ')}.`,
		);
	}
	return {
		owner: owner as string,
		'data-classification': dataClassification as string,
		'cost-center': costCenter as string,
	};
}

/** SHA-256 of the bytes, hex. */
export function sha256Hex(body: Buffer): string {
	return createHash('sha256').update(body).digest('hex');
}

function megabytes(bytes: number): string {
	return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 2)} MB`;
}

/**
 * Checks that are about the request and not the file: a usable path and
 * uploader label. A failure here isn't audited, because there's nothing
 * trustworthy to write down.
 */
export function checkRequest(path: string, options: HousePutOptions): void {
	if (typeof path !== 'string' || path.length > 200 || !PATH_PATTERN.test(path)) {
		throw blocksError(
			HouseBucketErrors.InvalidUpload,
			'The path must be 1 to 200 characters of letters, digits, dots, dashes and underscores, with / between segments.',
		);
	}
	const uploadedBy = options?.uploadedBy;
	if (typeof uploadedBy !== 'string' || uploadedBy.trim().length === 0 || uploadedBy.length > 60) {
		throw blocksError(HouseBucketErrors.InvalidUpload, 'uploadedBy must be 1 to 60 characters.');
	}
	if (typeof options?.contentType !== 'string' || options.contentType.length > 100) {
		throw blocksError(HouseBucketErrors.InvalidUpload, 'contentType must be a string of at most 100 characters.');
	}
}

/**
 * The run-time house rules for one upload. Returns the rule that refuses it,
 * or `null` when the upload is allowed.
 */
export function checkUpload(body: Buffer, contentType: string): { rule: string; reason: string } | null {
	if (body.length === 0) {
		return { rule: HouseBucketErrors.InvalidUpload, reason: 'The file is empty.' };
	}
	if (body.length > HOUSE_RULES.maxBytes) {
		return {
			rule: HouseBucketErrors.FileTooLarge,
			reason: `The file is ${megabytes(body.length)}. The house limit is ${megabytes(HOUSE_RULES.maxBytes)}.`,
		};
	}
	if (!HOUSE_RULES.allowedContentTypes.includes(contentType)) {
		return {
			rule: HouseBucketErrors.ContentTypeNotAllowed,
			reason: `The type "${contentType || 'unknown'}" isn't allowed. Allowed types: ${HOUSE_RULES.allowedContentTypes.join(', ')}.`,
		};
	}
	if (contentType === 'image/png') {
		if (body.length < 24 || !body.subarray(0, 8).equals(PNG_SIGNATURE)) {
			return { rule: HouseBucketErrors.ContentMismatch, reason: 'The file says image/png but its bytes are not a PNG.' };
		}
	} else {
		// The other allowed types are all text. Refuse bytes that aren't valid UTF-8.
		try {
			new TextDecoder('utf-8', { fatal: true }).decode(body);
		} catch {
			return { rule: HouseBucketErrors.ContentMismatch, reason: `The file says ${contentType} but its bytes are not UTF-8 text.` };
		}
		if (contentType === 'application/json') {
			try {
				JSON.parse(body.toString('utf-8'));
			} catch {
				return { rule: HouseBucketErrors.ContentMismatch, reason: 'The file says application/json but it does not parse as JSON.' };
			}
		}
	}
	return null;
}
