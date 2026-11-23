// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Guards around the deployed function's handler, so an ERROR line in its log group means a
 * fault. index.handler.ts installs them. None imports a Block, so they load before the config.
 *
 * 1. A refused request is one WARN line. The CDK Blocks handler writes every error an API method
 *    throws with console.error and a stack trace. A refusal (an ApiError with a 4xx status: a
 *    wrong or missing invite code, invalid input, an unknown build or conversation, a spent
 *    budget) is expected, so it's written as one line at warn. Everything else stays an error.
 * 2. A scheduled run that fires before the app's config file is readable is skipped with one WARN
 *    line. That happens for a minute or two during a first deploy. The next run tries again.
 */

/** The first argument the CDK Blocks handler passes to console.error for an error from an API method. A test checks it. */
export const API_ERROR_PREFIX = 'Lambda Error:';

type LogFn = (...args: unknown[]) => void;
export interface ConsoleLike {
  error: LogFn;
  warn: LogFn;
}

/** An ApiError with a 4xx status, matched by shape the way the CDK Blocks handler matches it. */
export function isRefusal(e: unknown): e is Error & { status: number; reason?: string } {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** Replace `out.error` so a refusal from an API method is one warn line with no stack trace. Returns a function that undoes it. */
export function logRefusalsAsWarnings(out: ConsoleLike = console): () => void {
  const original = out.error;
  out.error = (...args: unknown[]) => {
    // The handler writes the label and the error, with a `[request <id>]` string between them when the request carries an id.
    const [first, second] = args;
    const e = args.at(-1);
    const fromApiMethod = args.length === 2 || (args.length === 3 && typeof second === 'string' && second.startsWith('[request '));
    if (first === API_ERROR_PREFIX && fromApiMethod && isRefusal(e)) {
      const reason = typeof e.reason === 'string' ? ` (${e.reason})` : '';
      out.warn(`Request refused: ${e.status} ${e.name}${reason}`);
      return;
    }
    original.apply(out, args);
  };
  return () => {
    out.error = original;
  };
}

const isConfigNotReady = (e: unknown) => {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'TransientConfigError' || /Config not readable yet/.test(err?.message ?? '');
};

/** True for the event the CronJob Block's schedule sends. */
const isScheduledRun = (event: unknown) => (event as { source?: unknown } | null)?.source === 'blocks.cronjob';

/**
 * Wrap the handler so a scheduled run that finds the config unreadable returns quietly. A request
 * from the API in that window still fails: a caller should see that, and the next request retries.
 */
export function skipScheduledRunsUntilConfigIsReady<E, C, R>(
  handler: (event: E, context: C) => Promise<R>,
  out: ConsoleLike = console,
): (event: E, context: C) => Promise<R | undefined> {
  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (e) {
      if (isScheduledRun(event) && isConfigNotReady(e)) {
        out.warn('Scheduled run skipped: the config is not readable yet. The next run tries again.');
        return undefined;
      }
      throw e;
    }
  };
}

interface WebSocketEvent {
  requestContext: { eventType: 'CONNECT' | 'DISCONNECT' | 'MESSAGE'; connectionId: string };
}

/** True for an event from the WebSocket API, the way the CDK Blocks handler tells one apart. */
const isWebSocketEvent = (event: unknown): event is WebSocketEvent => {
  const context = (event as { requestContext?: { eventType?: unknown; connectionId?: unknown } } | null)?.requestContext;
  return typeof context?.connectionId === 'string' && ['CONNECT', 'DISCONNECT', 'MESSAGE'].includes(context.eventType as string);
};

/** What API Gateway answers to a post on a WebSocket connection that has closed: 410 Gone. */
const isGone = (e: unknown) => {
  const err = e as { name?: string; statusCode?: number; $metadata?: { httpStatusCode?: number } } | null;
  return err?.name === 'GoneException' || err?.statusCode === 410 || err?.$metadata?.httpStatusCode === 410;
};

/**
 * Wrap the handler so a WebSocket message from a page that has already left isn't a fault.
 *
 * A page subscribes to a channel and the Realtime Block answers on the same connection. When the
 * page closes in between, API Gateway answers that post with 410 Gone, and `@aws-cdk-blocks/bb-realtime`
 * 0.5.0 lets the error out of the handler, where Lambda logs it as an ERROR. (The Block's publish
 * path already treats a 410 as a page that left.) Here the 410 is one WARN line, and the connection's
 * records are dropped the way the Block drops them on a disconnect: by handing it that event.
 */
export function treatClosedConnectionsAsExpected<E, C, R>(
  handler: (event: E, context: C) => Promise<R>,
  out: ConsoleLike = console,
): (event: E, context: C) => Promise<R | { statusCode: number }> {
  return async (event, context) => {
    try {
      return await handler(event, context);
    } catch (e) {
      if (!isWebSocketEvent(event) || !isGone(e)) throw e;
      out.warn('WebSocket connection closed before a reply could be sent. Its records are dropped.');
      if (event.requestContext.eventType !== 'DISCONNECT') {
        const disconnect = { ...event, requestContext: { ...event.requestContext, eventType: 'DISCONNECT' } };
        // Best effort: the records also expire by themselves, and a publish to a closed connection removes them.
        await handler(disconnect as E, context).catch(() => undefined);
      }
      return { statusCode: 200 };
    }
  };
}
