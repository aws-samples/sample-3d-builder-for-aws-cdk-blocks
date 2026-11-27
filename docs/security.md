# Security notes

These notes describe this sample's own code and the choices it makes. The threat model is [threat-model.tc.json](threat-model.tc.json), a [Threat Composer](https://github.com/awslabs/threat-composer) file; import it into Threat Composer to read it. To report a security issue, see [CONTRIBUTING](../CONTRIBUTING.md#security-issue-notifications).

## Before you deploy

This sample is for learning. Before you deploy it:

- Don't put production, personal or sensitive data in it. Questions typed to the agent are stored with their answers, with no expiry.
- The invite link is one shared code, not a sign-in. Give it only to people you know, and change the code when the link has gone further than you wanted. [The invite code](deploy.md#the-invite-code) has the command.
- What the link unlocks is capped for everyone together: the agent stops at 200 questions a day and saves stop at 500 a day. The reads need no link, and nothing caps what they can cost. [What it costs](costs.md) has the estimates for both.
- Tear the stack down when you're done. [Tear it down](teardown.md) says what goes and what stays.

This page, the threat model and any scan results for this repository describe this sample's own code and the choices it makes. They aren't a security statement about AWS CDK Blocks, which is a separate AWS project with its own documentation and security process:

- [Security in AWS CDK Blocks](https://docs.aws.amazon.com/cdk/blocks/devguide/security.html), in the Developer Guide.
- The [CDK Blocks repository](https://github.com/aws/cdk-blocks) and its [security policy](https://github.com/aws/cdk-blocks/security/policy).
- [AWS vulnerability reporting](https://aws.amazon.com/security/vulnerability-reporting/).

Report a problem in this sample the way [CONTRIBUTING](../CONTRIBUTING.md#security-issue-notifications) says. Report a problem in a CDK Block upstream, through that repository's security policy.

## What to know about the deployed app

- The API has no authorizer. Every method is a public endpoint, by design: reads are open, and `saveBuild` and the four agent methods check the invite code in the handler before they touch a budget.
- The invite code is one shared code for everyone you give the link to. It isn't a sign-in. Anyone who has it can use up the day's 200 agent questions and 500 saves for everyone, and can fill the recent-builds strip. The "10 questions a page" limit keys on an id the browser makes up, so it slows a person down and doesn't stop a script. Change the code (see [The invite code](deploy.md#the-invite-code)) when the link has gone further than you wanted.
- The API throttle is shared by all callers: 25 requests a second, with bursts of up to 50. One script at the limit makes real visitors see errors. API Gateway answers 429 only past the burst, so 60 requests sent at once can all succeed.
- The here-now count can be inflated by anyone, because checking in is open. New pages share a budget of 120 joins a minute and the count stops at 200.
- The page and the gallery are open to anyone with the URL, including through the API Gateway address directly.
- Questions put to the agent are stored with their answers in the Agent Block's DynamoDB tables, with no expiry. The page says so. Saved builds hold piece ids only, and they don't expire either.
- A saved build, a gallery event and the agent's pick never carry visitor text. The agent's tool input is checked against the seven piece ids, and its reply is shown as text.
- The app's shared role is the one the app function and the AgentCore runtime both run as. `@aws-cdk-blocks/bb-agent` 1.0.0 adds statements to it that let it invoke any Bedrock AgentCore runtime in the account and Region, and call any Amazon Bedrock foundation model and inference profile. No request input reaches those calls, but the role is wider than this app needs. The template has 13 IAM roles in all. The other 12 belong to the deploy-time helper functions (10), the state machine that waits for table indexes (1) and the schedule (1).
- `npm run nag` reports cdk-nag findings. Almost all of them are on resources that the CDK Blocks constructs create, as this sample configures them at the pinned versions: wildcard IAM statements, no WAF, no API access logging, no Content-Security-Policy header. This sample doesn't change them. That describes this sample's stack and isn't a verdict on CDK Blocks; [Security in AWS CDK Blocks](https://docs.aws.amazon.com/cdk/blocks/devguide/security.html) is the upstream page, and it covers the shared role.
- The page is served on CloudFront's own domain name with CloudFront's default certificate. That certificate's security policy is fixed at TLSv1, so the distribution accepts TLS 1.0 and later. Raising the minimum needs a custom domain and certificate. The deploy prints a warning that says so.
- A refused request is one WARN line in the app function's log group, for example `Request refused: 403 InviteRequiredException (invite)`. That covers a wrong or missing invite code, invalid input, an unknown build or conversation, and a spent budget. An ERROR line there means a fault. During a first deploy the scheduled job can fire before the app's config file is readable; each such run is skipped with one WARN line. A page that closes while the function is answering it over the WebSocket is one WARN line too: `@aws-cdk-blocks/bb-realtime` 1.0.0 lets that error out of its handler, and this app's handler turns it into the warning.
- The custom Block stores a file and then records its audit entry. If the second step fails, the file is stored with no entry.
- CDK Blocks collects anonymous usage data from its command line tools (`npm run dev`, `sandbox`, `deploy` and others). It prints a notice once for each user on a machine: the first time it sends data, when it creates `~/.cdk-blocks/telemetry/installation-id`. If that file is already there from another CDK Blocks project, you see no notice. It follows the AWS CDK CLI's telemetry setting and has no switch of its own. To turn both off, run `npx cdk cli-telemetry --disable` or set `CDK_DISABLE_CLI_TELEMETRY=1`. The first command that sends data writes a project id into your `.cdk-blocks/config.json`.
