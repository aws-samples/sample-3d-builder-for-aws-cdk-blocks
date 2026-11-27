# What it costs

These are estimates, made on November 19, 2026 and recounted against the template on November 21, 2026. Nobody has measured them on a bill. They come from counting the resources in this app's synthesized template and multiplying by the public list prices for US East (N. Virginia) on that date, listed under the tables. Prices change and differ by Region, so check https://aws.amazon.com/pricing/ before you rely on them. The AWS Free Tier can cover some of this.

While nobody uses it, the stack still bills for:

| What | Count in the template | Estimate a month |
|---|---|---|
| Customer managed KMS keys (the gallery bucket's, the alarm topic's). Both rotate yearly, and each of a key's first two rotations adds $1.00 a month | 2 | $2.00, up to $6.00 after two years |
| CloudWatch dashboard (an account's first three are free) | 1 | $3.00 |
| CloudWatch alarms (an account's first ten are free) | 3 | $0.30 |
| Secrets Manager secrets (the invite code, and the one the Realtime Block signs its channel tokens with) | 2 | $0.80 |
| The scheduled job: 43,200 runs a month of a 2,048 MB function, assumed at half a second each. A test deploy on November 19, 2026 measured a median of 16 ms | 1 | under $1 |
| DynamoDB reads by that job, S3 storage, logs, the schedule itself | | under $1 |
| Also on, and small at this size: point-in-time recovery on the seven tables, log groups kept for 365 days, and CloudFront access logs in an S3 bucket | | not estimated |
| Total | | about $6 to $10 |

Under use:

- An open page checks in every 15 seconds. That's 240 API requests an hour for each open page, which we estimate at well under one cent an hour.
- The agent is capped at 200 questions a day across everyone, with at most 4 model calls of at most 1,000 output tokens for each question. At the cap, with every call using its whole output allowance, that's 800,000 output tokens a day, and about 2 million input tokens a day at the 2,400 input tokens a call that test calls used. At Claude Haiku 5.5's prices we estimate that at about $0.60 a day if the cap is reached every day. A typical question in those tests took three calls, about 6,500 input tokens and about 600 output tokens, which is about a tenth of a cent. Each question also uses a few seconds of Amazon Bedrock AgentCore runtime time, which isn't in that estimate.
- Saves are capped at 500 a day and are a few DynamoDB writes each.

What a stranger with the URL can cost you: the reads are open, so anyone can call them in a loop. The API throttle caps all callers together at 25 requests a second, with bursts of up to 50. Held for a whole day that's about 2.2 million requests, which we estimate at $10 to $15 a day in API Gateway, Lambda and DynamoDB charges until you notice. The `ApiRequestsHigh` alarm fires when the API takes more than 2,500 requests in five minutes. It only reaches you if you set `BASEPLATE_ALARM_EMAIL` or subscribe to the alarm topic yourself. `BASEPLATE_API_WAF=1` adds a limit for each client address. Neither one caps spend. If you need a cap, add an AWS Budgets action or take the stack down.

Unit prices used, US East (N. Virginia), November 19, 2026: KMS key $1.00 a month, dashboard $3.00 a month, standard alarm $0.10 a month, secret $0.40 a month, Lambda $0.0000166667 per GB-second and $0.20 per million requests, API Gateway REST $3.50 per million requests, DynamoDB on-demand $0.125 per million read request units and $0.625 per million write request units. Claude Haiku 5.5 through the global inference profile, read on November 20, 2026: $0.10 per million input tokens and $0.50 per million output tokens for prompts of up to 100,000 tokens.
