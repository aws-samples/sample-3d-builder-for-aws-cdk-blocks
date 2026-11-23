// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Typed error constants for HouseBucket. Match them in catch blocks with
 * `isBlocksError(e, HouseBucketErrors.FileTooLarge)` from `@aws-cdk-blocks/core`.
 * Errors cross the wire by `name`, so the same guard works on the server and
 * in the browser.
 */
export const HouseBucketErrors = {
	/** The upload is larger than the house size limit. */
	FileTooLarge: 'HouseFileTooLargeException',
	/** The declared content type isn't on the house allowlist. */
	ContentTypeNotAllowed: 'HouseContentTypeNotAllowedException',
	/** The bytes don't match the declared content type. */
	ContentMismatch: 'HouseContentMismatchException',
	/** The upload is empty, or its path or uploader label is malformed. */
	InvalidUpload: 'HouseInvalidUploadException',
	/** A required tag (owner, data classification, cost center) is missing or malformed. */
	MissingRequiredTag: 'HouseMissingRequiredTagException',
} as const;
