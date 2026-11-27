# Tear it down

```bash
npm run destroy
```

Run it from the same clone you deployed from. It reads the stack id in `.cdk-blocks/config.json`, synthesizes the app with the page build that the deploy left in `dist/`, and then deletes the stack. It took 5 minutes 16 seconds on November 21, 2026, on a stack that had been used.

On a stack that has been used, expect the first attempt to fail and the command to finish anyway. Amazon S3 delivers the gallery bucket's access logs some minutes after the requests they record. A log file can land in the access-log bucket after CloudFormation emptied it and before CloudFormation deletes it, and then the delete fails with `DELETE_FAILED` and "The bucket you tried to delete is not empty". `npm run destroy` handles this itself: it empties the stack's buckets, waits 60 seconds and deletes again. It prints warnings that the other buckets no longer exist, then `Production stack destroyed on retry!`, and exits 0. This happened on both teardowns of a used stack on November 21, 2026. If you delete the stack yourself and hit the same error, empty that one bucket and delete the stack again.

If the clone or its `.cdk-blocks/config.json` is gone, delete the stack yourself. It's named `<stack id>-prod`, which starts with `baseplate-` unless you changed the id. Use the CloudFormation console, or `aws cloudformation delete-stack --stack-name <stack id>-prod`.

The `BASEPLATE_*` variables don't change what destroy removes. CloudFormation deletes each resource by the policy the last deploy gave it. Destroy still synthesizes the app, so a malformed value stops it before it deletes anything.

It doesn't ask first. By default it deletes every resource in the stack that holds data: the seven DynamoDB tables, the seven S3 buckets and their contents, the two KMS keys, the two secrets and the three log groups the template declares. AWS KMS keeps a deleted key in a 30-day waiting period before the key is gone; the template doesn't set another length.

Five of the template's 155 resources carry a `Retain` policy: five of the Hosting construct's `Custom::CDKBucketDeployment` resources (`HostingAssetDeploymentHtml`, `HostingAssetDeploymentImmutable`, `HostingAssetDeploymentMutable`, `HostingAssetDeploymentNoCache` and `HostingFontTypeDeploymentwoff2`). Each one is a record that a deploy copied part of the built page into the site bucket. They hold no data. On destroy, CloudFormation drops them from the stack without running their delete step, and the files they copied go with the site bucket.

If you deployed with `BASEPLATE_RETAIN_DATA=1`, the tables, the buckets, the gallery's key and the two secrets stay, the tables have deletion protection, and a later deploy with the same stack id fails on their names until you delete them yourself.

Three things are outside the stack and stay:

- CloudWatch log groups that Lambda creates by itself. Eight of the template's 11 functions, all deploy-time helpers, have no log group in the template, so Lambda makes one for each the first time it runs. Their names start with `/aws/lambda/<stack id>-prod`. A deploy and destroy on November 21, 2026 left seven, because one helper never ran.
- The log group that Amazon Bedrock AgentCore creates for the agent's runtime. Its name starts with `/aws/bedrock-agentcore/runtimes/` followed by the stack name without its hyphens. It has no expiry.
- The `CDKToolkit` stack from `cdk bootstrap`, and the files each deploy uploaded to its bucket.

To list the log groups that are left, search for the six hex digits of your stack id:

```bash
aws logs describe-log-groups --query "logGroups[?contains(logGroupName, '3fa9c1')].logGroupName" --output text
```

To delete them, after you've read the list and it holds only this stack's log groups:

```bash
for group in $(aws logs describe-log-groups --query "logGroups[?contains(logGroupName, '3fa9c1')].logGroupName" --output text); do
  aws logs delete-log-group --log-group-name "$group"
done
```

After that, nothing with the stack's name is left except the two KMS keys in their waiting period. `aws kms describe-key --key-id <key id> --query KeyMetadata.KeyState` reads `PendingDeletion` for each, and a key in that state isn't billed.
