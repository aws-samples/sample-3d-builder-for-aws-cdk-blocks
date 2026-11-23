// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Reading a secret whose address can change under a running copy of the function.
 *
 * CDK Blocks writes each Block's address (here the secret's ARN) to a config file in S3. A copy of
 * the function reads that file once, when it starts, into process.env, and never again. The Secret
 * Block looks its ARN up in process.env on every read. So when a deploy replaces the secret, a
 * copy that started before the new config file was written keeps the old ARN for as long as it
 * lives. The role no longer allows the old secret, and every read fails with AccessDeniedException.
 *
 * The reader here handles that: when a read is denied, or finds no secret, it reads the config
 * file again, takes the secret's new address from it, and reads once more. It also holds the value
 * for a few minutes itself (the Secret Block's own cache is off), so a missing value is never kept.
 *
 * Plain functions over what they're given, so the tests run them with no AWS account.
 */

type Env = Record<string, string | undefined>;

/** The key the Secret Block reads its ARN from. The same rule as `@aws-cdk-blocks/bb-secret`; a test compares them. */
export const secretArnKey = (fullId: string) => `BLOCKS_SECRET_ARN_${fullId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

/** The deployed config file, read from S3 now. Null when this isn't a deployed function (local runs have no config file). */
async function fetchDeployedConfig(env: Env = process.env): Promise<Record<string, unknown> | null> {
  const bucket = env.BLOCKS_CONFIG_BUCKET;
  const key = env.BLOCKS_CONFIG_KEY;
  if (!bucket || !key) return null;
  // The same client, loaded the same way, that @aws-cdk-blocks/core uses to read this file when a copy starts.
  // cdk-blocks/package.json names it at the version @aws-cdk-blocks/core already brings, for the typecheck and
  // the local tests. The function's bundle leaves @aws-sdk/* out, so on AWS the Lambda runtime's copy runs.
  const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ region: env.AWS_REGION, requestHandler: { requestTimeout: 5000 }, maxAttempts: 3 });
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const parsed: unknown = JSON.parse((await response.Body?.transformToString('utf-8')) ?? 'null');
  return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
}

export interface AddressRefreshOptions {
  /** The config key to refresh, for example `secretArnKey(secret.fullId)`. */
  key: string;
  env?: Env;
  fetchConfig?: () => Promise<Record<string, unknown> | null>;
  /** At most one config read in this many milliseconds, so a broken copy doesn't read S3 on every request. */
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * Returns a function that re-reads the config file and puts the key's current value in `env`.
 * It resolves true only when the value changed. A failed config read counts as no change.
 */
export function addressRefresher(options: AddressRefreshOptions): () => Promise<boolean> {
  const { key, env = process.env, fetchConfig = () => fetchDeployedConfig(env), minIntervalMs = 10_000, now = Date.now } = options;
  let lastAt = Number.NEGATIVE_INFINITY;
  return async () => {
    if (now() - lastAt < minIntervalMs) return false;
    lastAt = now();
    let config: Record<string, unknown> | null;
    try {
      config = await fetchConfig();
    } catch {
      return false;
    }
    const fresh = config?.[key];
    if (typeof fresh !== 'string' || fresh === '' || fresh === env[key]) return false;
    env[key] = fresh;
    return true;
  };
}

/** What Secrets Manager answers when the address is a secret this role can't read, or one that's gone. */
const isStaleAddressError = (e: unknown) => {
  const name = (e as { name?: string } | null)?.name;
  return name === 'AccessDeniedException' || name === 'ResourceNotFoundException';
};

export interface FreshSecretOptions {
  /** One uncached read of the secret. Null means it has no value. */
  read: () => Promise<string | null>;
  /** Re-read the secret's address. True when it changed. */
  refresh: () => Promise<boolean>;
  /** How long a value is reused. */
  ttlMs: number;
  now?: () => number;
  /** Called when a read failed on an old address and the retry on the new one worked. */
  onRecovered?: () => void;
}

/**
 * Returns a cached reader for one secret. A read that's denied or finds nothing refreshes the
 * address and, when the address changed, reads once more. A fault that a fresh address doesn't
 * explain is thrown as it came. Only a real value is cached.
 */
export function freshSecretReader(options: FreshSecretOptions): () => Promise<string | null> {
  const { read, refresh, ttlMs, now = Date.now, onRecovered } = options;
  let cached: { value: string; at: number } | null = null;
  return async () => {
    if (cached && now() - cached.at < ttlMs) return cached.value;
    let value: string | null;
    let recovered = false;
    try {
      value = await read();
    } catch (e) {
      if (!isStaleAddressError(e) || !(await refresh())) throw e;
      value = await read();
      recovered = true;
    }
    if (value === null && !recovered && (await refresh())) {
      value = await read();
      recovered = value !== null;
    }
    if (recovered) onRecovered?.();
    cached = value === null ? null : { value, at: now() };
    return value;
  };
}
