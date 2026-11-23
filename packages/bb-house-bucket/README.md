# HouseBucket

A custom Block that wraps `FileBucket` with a platform's standards for file intake. The app calls `put()`; the standards come with it.

**Keywords:** file upload, intake, standards, encryption, retention, access logging, tags, audit

A **composed** Block: it owns no AWS SDK code. It constructs a `FileBucket`, a `KVStore` and a `Logger` as children of its own scope and adds the house rules on top.

## The house rules

| Rule | Value | Where it's enforced |
| --- | --- | --- |
| Encryption | a dedicated customer-managed key, rotation on | template (`cdk synth`) |
| Access logging | on, to a dedicated log bucket | template |
| Retention | files expire after 30 days, superseded versions after 7 | template |
| Required tags | `owner`, `data-classification`, `cost-center` on every resource under the Block | constructor, in every context; applied in the template |
| Size limit | 2 MB per file | `put()`, on your machine and deployed |
| Content types | `text/csv`, `image/png`, `application/json`, `text/plain`, and the bytes must match | `put()`, on your machine and deployed |
| Audit | one entry per upload, stored or refused: who, path, size, type, SHA-256, time | `put()`, on your machine and deployed |

The template-only rules (key, logging, retention, tags) have no local effect. The run-time rules run the same code in both places.

## API

### `new HouseBucket(scope, id, options)`

| Option | Type | Notes |
| --- | --- | --- |
| `owner` | `string` | Required. Team name for the `owner` tag. |
| `dataClassification` | `'public' \| 'internal' \| 'confidential'` | Required. |
| `costCenter` | `string` | Required. Like `cc-4410`. |
| `removalPolicy` | `'destroy' \| 'retain'` | Optional. Omit to follow the stack's posture. |

A missing or malformed required tag throws `HouseBucketErrors.MissingRequiredTag` from the constructor.

### Methods

- `put(path, body, { contentType, uploadedBy }): Promise<AuditEntry>` stores the file if the rules allow it. Throws `HouseBucketErrors.FileTooLarge`, `ContentTypeNotAllowed`, `ContentMismatch` or `InvalidUpload`.
- `get(path): Promise<HouseFile | null>` reads a stored file.
- `listAudit({ limit? }): Promise<AuditEntry[]>` returns the audit trail, newest first.
- `rules` is the rule set as data, and `tags` is the tag set the Block applies.

There's no presigned upload. It would skip the server-side checks.

## Example

```ts
import { ApiNamespace, Scope } from 'aws-cdk-blocks';
import { HouseBucket } from '@your-team/bb-house-bucket';

const scope = new Scope('my-app');
const intake = new HouseBucket(scope, 'intake', {
	owner: 'intake-team',
	dataClassification: 'internal',
	costCenter: 'cc-4410',
});

export const api = new ApiNamespace(scope, 'api', () => ({
	async upload(name: string, text: string) {
		return intake.put(`inbox/${name}`, Buffer.from(text), { contentType: 'text/plain', uploadedBy: 'someone' });
	},
}));
```

## Build and test

```sh
npm run build -w @your-team/bb-house-bucket
npm test -w @your-team/bb-house-bucket
```

The package exports point at `dist/`, so it has to be built before an app can import it. The app's root `package.json` does that in `prepare`.

## Status

This package lives in the app's workspace and isn't published. It's packaged the way a Block is (`@aws-cdk-blocks/create-block` generated the skeleton), so publishing it to a registry is the step a platform developer would take next.
