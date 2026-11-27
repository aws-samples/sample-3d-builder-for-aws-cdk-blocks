// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BlocksPresets, BlocksStack, Hosting, HostingPresets } from 'aws-cdk-blocks/cdk';
import { getStackName } from 'aws-cdk-blocks/scripts';
import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { readDeployOptions } from './deploy-options.js';
import {
  API_BURST_LIMIT,
  API_RATE_LIMIT,
  API_REQUESTS_ALARM,
  ASKS_PER_DAY,
  METRICS_NAMESPACE,
  WAF_REQUESTS_PER_ADDRESS,
} from './shared.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = new cdk.App();

// The deployer's choices, from the environment (see deploy-options.ts and docs/deploy.md).
const options = readDeployOptions(process.env);

// Tag every taggable resource in every stack of this app.
for (const [key, value] of options.tags) cdk.Tags.of(app).add(key, value);

const sandboxMode = app.node.tryGetContext('sandboxMode') === 'true';
// `npm run sandbox:preview` also sets previewMode: a sandbox with hosting in preview shape.
const previewMode = app.node.tryGetContext('previewMode') === 'true';
const projectRoot = app.node.tryGetContext('projectRoot') || process.cwd();

// The production preset with two changes for a sample.
// - `npm run destroy` removes everything that holds data: tables, buckets and their contents,
//   keys and the secret. The preset would retain them and turn on deletion protection, which
//   leaves named tables behind and makes the next deploy fail. BASEPLATE_RETAIN_DATA=1 puts the
//   preset's behavior back. Five of the Hosting construct's deployment custom resources keep
//   their own Retain policy either way and hold no data.
// - A lower API throttle: reads are public on this small demo, so cap how fast anyone holding the
//   URL can call it. Every caller shares this one limit. Every API method is the same route
//   (POST /cdk-blocks/api), so API Gateway can't give one method a limit of its own.
const deployedDefaults = {
  ...BlocksPresets.production,
  ...(options.retainData ? {} : { removalPolicy: cdk.RemovalPolicy.DESTROY, deletionProtection: false }),
  throttling: { rateLimit: API_RATE_LIMIT, burstLimit: API_BURST_LIMIT },
};

const stackName = getStackName({ sandbox: sandboxMode, projectRoot });
export const blocksStack = await BlocksStack.create(app, stackName, {
  backendHandlerPath: join(__dirname, 'index.handler.ts'),
  backendCDKPath: join(__dirname, 'index.ts'),
  defaults: sandboxMode ? BlocksPresets.sandbox : deployedDefaults,
  // Opt-in (BASEPLATE_API_WAF=1): AWS WAF on the API with a limit per client address, which the
  // shared throttle above can't give. It's off by default because a web ACL bills every month.
  ...(options.apiWaf && !sandboxMode ? { apiWaf: { enabled: true, rateLimit: WAF_REQUESTS_PER_ADDRESS } } : {}),
});

// Add static site hosting when deploying, and to a preview sandbox in preview
// shape (served by API Gateway, no CloudFront). A plain sandbox is backend-only.
const hosting =
  !sandboxMode || previewMode
    ? new Hosting(blocksStack, 'Hosting', {
        ...(previewMode ? HostingPresets.preview : HostingPresets.production),
        root: join(__dirname, '..'),
        buildCommand: 'npm run build',
        buildOutputDir: 'dist',
        api: blocksStack,
        // The Hosting construct makes an SNS topic for its own alarms. BASEPLATE_ALARM_EMAIL
        // subscribes an address to it, and the two alarms below notify the same topic.
        ...(options.alarmEmail ? { monitoring: { subscriptions: [new EmailSubscription(options.alarmEmail)] } } : {}),
      })
    : undefined;

// The invite code's secret gets its name from the stack, so two deployments in one account don't
// collide. This output is how you find it: see "The invite code" in docs/deploy.md.
// The stack holds a second secret, the one the Realtime Block signs its channel tokens with, so
// the invite code's is picked by where it sits: under the Secret Block with the id `invite-code`.
const inviteSecret = blocksStack.node
  .findAll()
  .find((c): c is secretsmanager.Secret => c instanceof secretsmanager.Secret && c.node.path.includes('/invite-code/'));
if (!inviteSecret) throw new Error('the invite code has no Secrets Manager secret in this stack');
new cdk.CfnOutput(blocksStack, 'InviteCodeSecretArn', {
  description: 'Secrets Manager secret that holds the invite code',
  value: inviteSecret.secretArn,
});

// Two alarms, both sent to the Hosting construct's alarm topic.
// - The agent's daily question budget is used up. The budget itself is enforced in
//   cdk-blocks/index.ts before the model is called; this makes a spent budget visible.
// - The API is taking more requests than a small demo should. Reads are public, so this is the
//   early sign of someone running a script against the URL.
if (!sandboxMode) {
  const alarms = [
    new cloudwatch.Alarm(blocksStack, 'AgentCallsAtDailyCap', {
      alarmDescription: `Baseplate: agent questions reached the daily cap of ${ASKS_PER_DAY}`,
      metric: new cloudwatch.Metric({
        namespace: METRICS_NAMESPACE,
        metricName: 'AgentCalls',
        statistic: 'Sum',
        period: cdk.Duration.days(1),
      }),
      threshold: ASKS_PER_DAY,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }),
  ];
  const api = blocksStack.node.findAll().find((c): c is apigateway.RestApi => c instanceof apigateway.RestApi);
  if (api) {
    alarms.push(
      new cloudwatch.Alarm(blocksStack, 'ApiRequestsHigh', {
        alarmDescription: `Baseplate: more than ${API_REQUESTS_ALARM.requests} API requests in ${API_REQUESTS_ALARM.minutes} minutes`,
        metric: api.metricCount({ statistic: 'Sum', period: cdk.Duration.minutes(API_REQUESTS_ALARM.minutes) }),
        threshold: API_REQUESTS_ALARM.requests,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
  }
  // The first topic is the one in this stack's region.
  const topic = hosting?.monitoring?.alarmTopics[0];
  if (topic) for (const alarm of alarms) alarm.addAlarmAction(new SnsAction(topic));
}
