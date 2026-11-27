# Deploy to your own account

This page has the detail behind the deploy steps in the [README](../README.md#deploy-it-to-your-own-account): what you need first, what the deploy prints, the options, deploying again and the invite code. [Costs](costs.md) has the estimates, [Tear it down](teardown.md) says what a destroy removes and what stays, and [Security notes](security.md) lists what to know before you share the page.

## Before you start

- Node.js 22 or later, with npm.
- An AWS account, credentials for it in your shell, and a Region where Amazon Bedrock AgentCore is available.
- CDK bootstrapped in that account and Region. `npm run deploy` checks this and prints the `npx cdk bootstrap` command when it's missing.
- Access to the agent's model in Amazon Bedrock. The agent uses Anthropic Claude Haiku 5.5 through its global inference profile, `global.anthropic.claude-haiku-5-5`, set as `AGENT_MODEL_ID` in `cdk-blocks/shared.ts`. Amazon Bedrock serves this model on demand only through an inference profile, and a global profile can send a request to any commercial Region; for requests that stay in the United States, use `us.anthropic.claude-haiku-5-5`. The notes in `@aws-cdk-blocks/bb-agent` 1.0.0 say to submit Anthropic's one-time use case details form and to activate the model's one-time AWS Marketplace subscription before first use in an account. The agent's own role can't activate it, so make the first call as a user or role that has the `aws-marketplace:Subscribe`, `aws-marketplace:Unsubscribe` and `aws-marketplace:ViewSubscriptions` permissions. Until that's done the agent answers with an error and the rest of the app works.

## Deploy

From your clone:

```bash
npm ci
npm run deploy
```

`npm ci` runs `scripts/setup.mjs`, which writes `.cdk-blocks/config.json` with a stack id of your own, such as `baseplate-3fa9c1`. CDK Blocks names the stack `<stack id>-prod` and derives S3 bucket names from it, and bucket names are shared by every AWS account, so each clone needs its own id. The file isn't in git. Edit it before the first deploy if you want another name.

The deploy goes to the Region the AWS CDK resolves: `region` in `cdk.json` if you add one, then `AWS_REGION` or `AWS_DEFAULT_REGION`, then the region of your AWS profile. It prints the Region on the line that starts `Deployment target`. Outside US East (N. Virginia) the CloudFront 5xx alarm is created but never fires, because CloudFront publishes its metrics only in that Region.

A first deploy took 11 minutes 32 seconds in US East (N. Virginia) on November 19, 2026, and 11 minutes 23 seconds on AWS CDK Blocks 1.0.0 on November 21, 2026, so plan for about 12 minutes. A later deploy of changed code took under 5 minutes.

The deploy prints three warnings from the Hosting construct. All three are expected:

- The alarm topic has no subscriber. That's true until you set `BASEPLATE_ALARM_EMAIL` or subscribe to the topic yourself.
- The CloudFront 5xx alarm never fires outside US East (N. Virginia), as described above.
- `minimumProtocolVersion` is ignored, because the site uses CloudFront's default certificate. [Security notes](security.md) says what that means.

The deploy prints the page's URL and writes the stack's outputs to `.cdk-blocks-sandbox/outputs.production.json`.

`npm run sandbox` deploys a second, disposable stack for development and runs the page locally against it. `npm run sandbox:destroy` removes it.

### Options

Set these in the shell for `npm run deploy`. They're read in `cdk-blocks/deploy-options.ts`.

| Variable | Default | What it does |
|---|---|---|
| `BASEPLATE_TAGS` | `project=baseplate` | Tags for every taggable resource, as `key=value,key=value`. Your value replaces the default; it doesn't add to it |
| `BASEPLATE_RETAIN_DATA` | off | `1` keeps the tables, the gallery, agent and log buckets, the gallery's key and the two secrets when the stack is destroyed, and turns on DynamoDB deletion protection |
| `BASEPLATE_ALARM_EMAIL` | none | Subscribes this address to the alarm topic. Amazon SNS sends a confirmation email first |
| `BASEPLATE_API_WAF` | off | `1` puts AWS WAF in front of the API with a limit of 300 requests per client address in five minutes. WAF bills monthly. It covers the API, not the CloudFront distribution |

Use the same values each time you deploy. A deploy without `BASEPLATE_RETAIN_DATA` after one with it switches the stack back to removing its data on destroy.

## Deploying again

Run `npm run deploy` again from the same clone to update the stack. Each running copy of the function reads the addresses of its tables, buckets and secret once, when it starts, from a config file that CDK Blocks writes during the deploy. A copy that starts in the middle of a deploy can read the old file and keep the old addresses for as long as it lives.

That matters when a deploy replaces a resource. The one resource this app has seen replaced is the invite secret, when a deploy changed its name. The backend handles that case itself: when Secrets Manager denies a read of the invite code, the function reads the config file again, takes the secret's new address and reads once more. It logs `invite secret address refreshed` at WARN when that happens. It doesn't cover a replaced table or bucket. If requests fail with access errors after a deploy that replaced one, start fresh copies of the function by changing its configuration, for example its description, with `aws lambda update-function-configuration`.

## The invite code

The code is a generated Secrets Manager secret. The stack output `InviteCodeSecretArn` names it. To read it:

```bash
STACK="$(node -p "require('./.cdk-blocks/config.json').stackId")-prod"
ARN="$(aws cloudformation describe-stacks --stack-name "$STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='InviteCodeSecretArn'].OutputValue" --output text)"
aws secretsmanager get-secret-value --secret-id "$ARN" --query SecretString --output text
```

The invite link is the page's URL with the code in the fragment: `https://<your site>/#code=<the code>`. The page reads the fragment once, removes it from the address bar, keeps the code for that tab and never shows it. A share link (`?b=<id>`) carries no code.

To change the code:

```bash
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string "<a new long random value>"
```

The backend caches the secret for up to five minutes, so the old code can still work for that long.
