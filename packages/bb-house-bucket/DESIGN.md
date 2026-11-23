# HouseBucket: design

## Shape

`@aws-cdk-blocks/create-block` generates a primitive Block: four entry files, one per execution context, each with its own implementation. HouseBucket wraps Blocks that already have those four entries, so it needs less:

- `src/rules.ts` holds the rule values and the pure checks (tags, size, type, content).
- `src/runtime.ts` holds the one runtime class. `index.mock.ts` (local) and `index.aws.ts` (deployed) both re-export it. The children (`FileBucket`, `KVStore`, `Logger`) resolve to their own local implementation or deployed runtime through the package export conditions, so one class is correct in both contexts and the two entries can't drift.
- `src/index.cdk.ts` constructs the same three children with the same ids and passes the template-level rules as their options. It applies the required tags with `Tags.of(this)` and stubs each runtime method with `synthGuard`.
- `src/index.browser.ts` exports the error names and types only.

## Infrastructure (CDK)

Under the Block's scope: the `FileBucket` (bucket, bucket policy, KMS key, access-log bucket and its policy), the `KVStore` table for the audit trail (TTL on), and whatever the `Logger` registers. HouseBucket itself creates no resource.

## Local vs deployed

| Behavior | Local | Deployed |
| --- | --- | --- |
| Size limit, allowlist, content match, audit entry, required-tag check | enforced | enforced, same code |
| Customer-managed key, access logging, lifecycle rules | no effect | in the template |
| Tags | checked, not applied | checked and applied |
| Audit entry expiry | TTL honored on read | TTL honored on read; the table removes expired items later |

## Limits

- `listAudit()` scans the audit table and sorts in memory. That's fine while retention and the app's write cap keep the table small. A larger trail would want a `DistributedTable` with a sort key.
- The audit entry is written after the file. If the entry write fails, the file is stored and `put()` throws; the caller can retry.
