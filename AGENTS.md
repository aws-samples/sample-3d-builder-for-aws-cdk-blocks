# Agent guide

This repository is a sample: a 3D builder for AWS CDK Blocks that is itself a small CDK Blocks app. The app's on-screen name is Baseplate. A visitor snaps seven pieces onto a plate and sees the AWS resources each one creates. Read `README.md` first for what it does, how to deploy it, what it costs and how to take it down. This file is the short list a coding agent needs before it changes anything, whether you're working here or in a fork.

The CDK Blocks packages are `aws-cdk-blocks`, which re-exports every Block, and the ones under the npm scope `@aws-cdk-blocks`. The source is at https://github.com/aws/cdk-blocks. Keep package names, import paths and commands exactly as they are.

## Layout

| Path | What's there |
|---|---|
| `cdk-blocks/index.ts` | The whole backend. Blocks are built at module scope; their data methods only run inside an API method or a job handler |
| `cdk-blocks/shared.ts` | The seven piece ids, the custom Block's four standard ids, every limit and the Zod schemas. The backend, the page and the tests import it, so it has no Node-only imports |
| `cdk-blocks/budget.ts`, `presence.ts`, `gallery-pick.ts` | The budget counters, the here-now count and the gallery's picks, as plain functions over a small store interface |
| `cdk-blocks/fresh-secret.ts` | Reads the invite code so a running copy of the function follows a secret that a deploy replaced |
| `cdk-blocks/index.handler.ts`, `handler-guards.ts` | The deployed function's entry, and its three guards: a refused request logs at warn, a scheduled run waits quietly for the config, and a WebSocket message from a page that already left is a warning, not a fault |
| `cdk-blocks/index.cdk.ts`, `deploy-options.ts` | The CDK app (tags, removal policy, API throttle, hosting, alarms, the invite secret's output) and the `BASEPLATE_*` variables it reads |
| `cdk-blocks/own-synth.json` | This app's own Blocks and resource count, written by `npm run own-synth` |
| `cdk-blocks/*.json` (the rest) | Byte copies of the synth data in `src/data/`, for the backend |
| `cdk-blocks/scripts/` | Thin wrappers around the CDK Blocks scripts: dev server, sandbox, deploy, destroy |
| `packages/bb-house-bucket/` | The custom Block, `HouseBucket`, a private workspace package named `@your-team/bb-house-bucket` |
| `src/App.tsx` | The page shell and its state. `src/AgentBox.tsx`, `src/Gallery.tsx`, `src/RunsOn.tsx` are its parts |
| `src/scene/` | The 3D scene: bricks, plate, tiles and links |
| `src/data/` | The synth data the page shows. `src/data/page/` is generated from it by `npm run data:split` |
| `src/icons/` | The icon atlas, its map and the lookups. Read `src/icons/README.md` before touching it |
| `src/variants.ts`, `src/theme-flat.ts` | Look variants. `?theme=flat` is the only one |
| `test/` | `e2e.test.ts` and `caps.test.ts` need the local dev server; `connections.test.ts`, `custom.test.ts` and `backend.test.ts` don't |
| `scripts/` | `setup.mjs` (first-run stack id), `split-page-data.mjs`, `scan.sh` |
| `docs/threat-model.tc.json` | The threat model, a Threat Composer file (github.com/awslabs/threat-composer). Update it when a change crosses a trust boundary |

The AWS CDK Blocks Developer Guide is at https://docs.aws.amazon.com/cdk/blocks/devguide/what-is-blocks.html. Block documentation is also installed with the packages: `node_modules/aws-cdk-blocks/docs/<block>/README.md`. Read a Block's README before you use it.

## Commands

```bash
npm ci               # installs the locked versions, writes .cdk-blocks/config.json if it's missing, builds the custom Block
npm run dev          # API and page on http://localhost:4340, Vite on 4440; DEV_PORT moves both
npm run dev:stop -- --port 4340
npm run check        # typecheck, Biome, knip and the tests that need no server. Run it before every commit
npm run build        # the production page
npm run test:e2e     # API tests; reuses a running dev server or starts one
npm run test:caps    # the daily budgets; needs the dev server stopped
npm run test:contrast  # text contrast in headless Chromium, both looks, two sizes; run `npx playwright install chromium` once
npm run own-synth    # after any change under cdk-blocks/
npm run data:split   # after a change to src/data/custom.json or src/data/connections.json
npm run scan         # semgrep, betterleaks, osv-scanner, trivy, npm audit, the license allowlist and the notices file; versions in mise.toml
npm run nag          # cdk-nag over the app's own synth; a report, not a gate
npm run format       # apply Biome's formatting and safe fixes
```

The one browser test is `test/contrast.test.ts` (`npm run test:contrast`): it measures text contrast in both looks at two sizes and waits on the scene's `__firstFrame` hook. The scene exposes a few `window` hooks for browser tests (`__renderer`, `__firstFrame`, `__plate`, `__links`, `__tiles`); keep them. The flat theme (`?theme=flat`) turns the text variables dark inside each surface that keeps a light fill: when you add such a surface, add it to `LIGHT` in `src/theme-flat.ts` and run the contrast test.

Locally every Block runs its local implementation with no AWS account, and keeps its data under `.cdk-blocks/local/data/`. The agent runs on the `canned` provider there: the real tools, no model.

## The stack id

`scripts/setup.mjs` writes `.cdk-blocks/config.json` with a random stack id (`baseplate-` plus six hex digits) when the file is missing. It runs from `npm ci` or `npm install` and before `dev`, `sandbox`, `deploy`, `typegen`, `own-synth` and `nag`. CDK Blocks names the stack and its S3 buckets after that id, and bucket names are shared by every AWS account. The file is in `.gitignore`. `.cdk-blocks/config.example.json` shows its shape.

## Deploy and destroy

```bash
npm run deploy       # needs AWS credentials, a bootstrapped account and Bedrock model access (see README)
npm run destroy      # removes the stack. It doesn't ask first. The README's "Tear it down" section lists what stays
```

Four variables change a deploy. `cdk-blocks/deploy-options.ts` reads them and `test/backend.test.ts` covers them.

| Variable | Effect |
|---|---|
| `BASEPLATE_TAGS` | Resource tags as `key=value,key=value`. Default `project=baseplate`. A value of your own replaces the default |
| `BASEPLATE_RETAIN_DATA=1` | Keep tables, buckets and the secret on destroy. Default: every table, bucket, key and secret is removed |
| `BASEPLATE_ALARM_EMAIL` | Subscribe an address to the alarm topic |
| `BASEPLATE_API_WAF=1` | AWS WAF on the API with a limit per client address |

## How the pieces fit

- The page talks to the backend through one generated client. `cdk-blocks/client.js` is written by `npm run build` (for AWS) and by the dev server (for local use), and it isn't in git.
- Every API method is in the `ApiNamespace` at the bottom of `cdk-blocks/index.ts`. Reads are open. `saveBuild` and the agent methods call `requireInvite` first, then take a budget slot.
- To use another Block in the backend, construct it at module scope in `cdk-blocks/index.ts` (`new KVStore(scope, 'my-store')`), use it inside an API method or the job handler, then run `npm run own-synth` and commit `cdk-blocks/own-synth.json`. A test compares that file with the source.
- The builder's seven bricks are data, not code. `PIECE_IDS` in `cdk-blocks/shared.ts` lists them, and `src/data/` holds a synthesized result for every arrangement of them. Adding a brick means synthesizing every arrangement that includes it and adding those results to the data files. The templates the data came from aren't in this repository, so you'd build that step yourself.
- The custom Block is a normal workspace package. Its three entry points (`index.aws.ts`, `index.mock.ts`, `index.cdk.ts`) are the deployed, local and CDK sides of the same class. `npm run test:block` builds it and runs its tests.

## Conventions

- TypeScript, strict. Biome formats and lints; `src/` uses double quotes and everything else single quotes, because several tests match source text. Run the tests after any formatting change.
- Fix a Biome finding or suppress it in place with `// biome-ignore <rule>: <reason>`. Don't turn a rule off in `biome.jsonc` without a reason next to it. `packages/bb-house-bucket/` is linted but never formatted.
- Every source file starts with the two-line header: the Amazon copyright line and `SPDX-License-Identifier: MIT-0`.
- Dependencies are pinned to exact versions.
- A behavior change comes with a test that fails without it.
- Commit messages say what the code does now.
- Copy: the product is "AWS CDK Blocks" on first mention and "CDK Blocks" after; one of them is "a Block". Say "the Hosting construct", "the Agent Block", "local implementation". Make no speed claims. Use American English and contractions.

## Things that break quietly

1. Build with `npm run build`, never a bare `npx vite build`. The `prebuild` step regenerates `cdk-blocks/client.js` for AWS; a bare Vite build after a dev run ships the local Realtime middleware.
2. Don't run `npm run build` or `npm run own-synth` while the dev server is up. Both rewrite `client.js` under it.
3. After editing `src/three-compat.ts`, stop the dev server and delete `node_modules/.vite`.
4. The `Agent` must stay declared before `new Realtime(...)` in `cdk-blocks/index.ts`. A test checks it.
5. Every secret-bearing API argument is an object field named `code`. The local dev server logs arguments and redacts by field name.
6. API refusals arrive as HTTP 200 with a JSON-RPC error body: `{"error":{"code":403,"message":"...","data":{"name":"InviteRequiredException"}}}`. On the wire `error.code` is the status and `error.data.name` is the name. The generated client throws an error that carries them as `status` and `name`; the tests assert on those.
7. Anything with a one-way `destroy()` (the agent chat, a Realtime subscription) is created inside a React effect and released in that effect's cleanup. StrictMode is on.
8. Don't use drei's `RoundedBox`. It needs `ExtrudeGeometry`, which the production build strips from `three`. Use `src/scene/RoundBox.tsx`.
9. No Block in `cdk-blocks/index.ts` sets `removalPolicy` or `deletionProtection`. The stack's defaults in `index.cdk.ts` decide for all of them, and a test fails if one comes back.
10. The here-now count never scans a table. `presence.ts` takes a store with `get` and `put` only; keep it that way.
11. The dev server treats a listener on its ports as an old copy of itself and stops it. Pick free ports.
12. Throw an expected refusal as `Refusal` in `cdk-blocks/index.ts`, with a 4xx status and a short reason. The deployed function logs it as one WARN line (`handler-guards.ts`). A bare `ApiError` with a 5xx status, or any other error, logs at ERROR with its stack, which is right for a fault.
13. Read the invite code through `readInviteCode()`, never `inviteCode.get()`. A deploy that replaces the secret leaves running copies of the function with the old secret's address; `fresh-secret.ts` re-reads it when a read is denied.
14. The agent's model is `AGENT_MODEL_ID` in `cdk-blocks/shared.ts`: Claude Haiku 5.5 through an Amazon Bedrock inference profile. Don't add `temperature` or `topP` to its `inferenceConfig`; the model refuses the request and every agent turn fails. The model thinks before it answers and the thinking counts toward `AGENT_MAX_TOKENS`, so a low cap ends a call before its tool call. No local test calls the model, so check a model change on a deployed stack.
15. The stage throttle is 25 requests a second with a burst of 50 (`cdk-blocks/shared.ts`). API Gateway answers 429 only past the burst, so a test that expects a 429 has to send more than 50 requests at once.

## Don't

- Don't commit `.cdk-blocks/config.json` or any stack id, account id, deployed URL or invite code.
- Don't print the local invite code. It's in `.cdk-blocks/local/data/settings.json`.
- Don't deploy from CI. The workflow in `.github/workflows/ci.yml` checks, builds, tests and scans, and should stay that way.
- Don't add a link to a running copy of the app to the README or the page. Readers deploy their own.
- Don't publish `packages/bb-house-bucket` to npm.
- Don't recolor, crop, flip, rotate or reshape an icon, and don't draw one of your own.
- Don't edit `src/data/page/` or the icon atlas by hand.
