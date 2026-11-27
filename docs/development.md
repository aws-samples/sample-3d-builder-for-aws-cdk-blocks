# Working on the code

[AGENTS.md](../AGENTS.md) is the guide for coding agents working in this repository or a fork. It has the same commands, plus the conventions and a list of things that break quietly.

## Where things are

- `cdk-blocks/index.ts` is the whole backend. `cdk-blocks/shared.ts` has the limits and schemas that the backend, the page and the tests share.
- `cdk-blocks/index.cdk.ts` is the CDK app: tags, removal policy, the API throttle, hosting and the alarms.
- `cdk-blocks/budget.ts`, `presence.ts` and `gallery-pick.ts` hold the budget counters, the here-now count and the gallery's picks as plain functions.
- `src/` is the page. `src/scene/` is the 3D scene. `src/data/` is the synth data the page shows. `src/icons/` is the icon atlas, with [its own README](../src/icons/README.md). `src/theme-flat.ts` is the flat theme.
- `packages/bb-house-bucket/` is the custom Block, a workspace package. It isn't published to npm, and the app depends on it by path.
- `cdk-blocks/fresh-secret.ts` reads the invite code so that a running copy of the function follows a replaced secret. `cdk-blocks/handler-guards.ts` sets what the deployed function logs at which level.
- `test/` has the tests. `scripts/` has the first-run setup, the page-data splitter and the scan script.
- `assets/` has the README's demo animation, its screenshots and the architecture diagram. `assets/architecture.drawio` is the diagram's source; it opens in [draw.io](https://www.drawio.com/).
- `docs/` has these pages and `threat-model.tc.json`, the threat model, as a [Threat Composer](https://github.com/awslabs/threat-composer) file. Import it into Threat Composer to read it.

## Tests and checks

```bash
npm run check        # typecheck, Biome, knip, and the tests that need no server
npm run build        # always `npm run build`, never a bare `vite build`
npm run test:e2e     # API tests against the local dev server; starts one if none is running
npm run test:caps    # the daily budgets; needs the dev server stopped and starts its own
npm run test:contrast  # text contrast in a real browser, both looks, two sizes; starts a dev server if none is running
npm run own-synth    # after a change under cdk-blocks/: rewrites cdk-blocks/own-synth.json
npm run data:split   # after a change to src/data/custom.json or connections.json: rewrites src/data/page/
npm run scan         # semgrep, betterleaks, osv-scanner, trivy, npm audit, the license allowlist and the notices file
npm run nag          # cdk-nag over this app's own synth; a report, not a gate
```

`npm run scan` needs four scanners on your PATH. Their versions are pinned in `mise.toml`, and `mise install` gets them. `.github/workflows/ci.yml` runs `check`, the build, the API tests, the capability tests, the contrast test and `scan`.

Rules that are off and findings that are accepted each carry a reason where they're set: `biome.jsonc`, `knip.jsonc`, `osv-scanner.toml`, `.trivyignore.yaml`. The last two hold no accepted advisory today. The license check leaves out `parse-cache-control`, which declares "BSD" with no variant; its license file is the 3-clause text. `lefthook.yml` holds optional git hooks; nothing installs them for you.

No test in this repository calls a model. One test opens a browser: `npm run test:contrast` reads the computed color of every visible piece of text and of the background behind it, in the default look and in `?theme=flat`, at 384 px and 1440 px wide, and fails below the WCAG 2.2 AA ratios. It needs Playwright's Chromium, which `npx playwright install chromium` downloads once. It can't see the pixels of the 3D scene. `test/backend.test.ts` checks the contrast arithmetic of the flat theme's palette without a browser.

## What `npm ci` reports

`npm ci` ends with an audit summary. On November 27, 2026 it read "found 0 vulnerabilities". The summary changes as advisories are published, so a later install can read differently.

Don't run `npm audit fix --force`: it moves pinned packages to versions this app wasn't checked with. `npm run scan` is this repository's check, and it fails on an advisory rated high or worse. An advisory the app can't fix yet goes in `osv-scanner.toml` or `.trivyignore.yaml`, with the reason and a date to look again; neither file holds one today.

## The data

Every number the builder shows is looked up, never computed on the page. The numbers were read on November 27, 2026 from synths of `aws-cdk-blocks` 1.0.1, and every count and connection came out equal to the 1.0.0 run of November 21, 2026. `src/data/` holds the results of synthesizing all 127 arrangements of the seven pieces, and all 16 states of the custom Block's four standards in the 64 arrangements that include it. `cdk-blocks/` has byte copies for the backend, and a test compares them. The `template` fields in those files name the synth-run files each number was read from. Those templates aren't in this repository, so the data can be checked against itself here but not regenerated.

## The icons and third-party software

The tiles carry AWS Architecture Icons. [`src/icons/README.md`](../src/icons/README.md) says where they come from and how to run the page without them. The screenshots and the diagram in `assets/` show the same icons.

The page uses the Fredoka and JetBrains Mono fonts from the `@fontsource` npm packages, under the SIL Open Font License 1.1. `THIRD-PARTY-LICENSES` lists the licenses of the production dependencies, and the build ships a copy with the page.
