// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Choices a deployer makes without editing code, read from the environment by index.cdk.ts.
 * `npm run deploy`, `npm run sandbox` and `npm run destroy` all see the same variables.
 */
export interface DeployOptions {
  /** Tags put on every taggable resource. BASEPLATE_TAGS="key=value,key=value"; default project=baseplate. */
  tags: [string, string][];
  /** BASEPLATE_RETAIN_DATA=1 keeps tables and log buckets when the stack is destroyed. Default: they're removed. */
  retainData: boolean;
  /** BASEPLATE_API_WAF=1 puts AWS WAF with a per-address rate limit in front of the API. Default: off (WAF bills monthly). */
  apiWaf: boolean;
  /** BASEPLATE_ALARM_EMAIL=you@example.com subscribes that address to the alarm topic. Default: no subscription. */
  alarmEmail: string | null;
}

const isOn = (value: string | undefined) => ['1', 'true', 'yes'].includes((value ?? '').trim().toLowerCase());

/** "key=value,key=value" as pairs. A malformed entry throws, so a typo never deploys untagged. */
function parseTags(text: string): [string, string][] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const at = entry.indexOf('=');
      if (at < 1 || at === entry.length - 1) throw new Error(`BASEPLATE_TAGS: "${entry}" isn't key=value`);
      return [entry.slice(0, at).trim(), entry.slice(at + 1).trim()];
    });
}

export function readDeployOptions(env: Record<string, string | undefined>): DeployOptions {
  const email = (env.BASEPLATE_ALARM_EMAIL ?? '').trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`BASEPLATE_ALARM_EMAIL: "${email}" isn't an email address`);
  return {
    tags: parseTags(env.BASEPLATE_TAGS ?? 'project=baseplate'),
    retainData: isOn(env.BASEPLATE_RETAIN_DATA),
    apiWaf: isOn(env.BASEPLATE_API_WAF),
    alarmEmail: email || null,
  };
}
