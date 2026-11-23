// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Shared by test/e2e.test.ts and test/caps.test.ts.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { type ChatMessage, createChat, realtimeTransport } from '@aws-cdk-blocks/bb-agent/client';
import type { api as ApiType } from 'cdk-blocks';

export type Api = typeof ApiType;

// The dev server's port: DEV_PORT, or 4340, the same default `npm run dev` uses.
export const serverPort = Number(process.env.DEV_PORT ?? 4340);
export const readinessUrl = `http://localhost:${serverPort}/.cdk-blocks-sandbox/config.json`;

/** The local invite code: the Secret Block's local store, gitignored and mode 600. Never printed. */
export function localInviteCode(): string {
  const settings = JSON.parse(readFileSync('.cdk-blocks/local/data/settings.json', 'utf-8'));
  // The Secret Block keys its local value by the Block's full id: the scope's name, then the id given in index.ts.
  const code = settings['baseplate-invite-code'];
  assert.ok(typeof code === 'string' && code.length > 0, 'expected a local invite code in .cdk-blocks/local/data/settings.json');
  return code;
}

/** Refusals arrive as HTTP 200 with a JSON-RPC error body, so assert on the error itself. */
export function refusedWith(status: number, name: string) {
  return (err: unknown) => {
    const e = err as { status?: number; name?: string; message?: string };
    assert.strictEqual(e.status, status, `expected status ${status}, got ${e.status} (${e.message})`);
    assert.strictEqual(e.name, name);
    return true;
  };
}

export async function waitForServer(): Promise<void> {
  for (let i = 0; i < 40; i++) {
    try {
      const response = await fetch(readinessUrl);
      if (response.ok) return;
    } catch {
      // The server is not listening yet.
    }
    await sleep(1000);
  }
  throw new Error(`Server not ready at ${readinessUrl}`);
}

export interface Turn {
  conversationId: string;
  answer: string;
  toolCalls: string[];
  failure?: string;
}

/**
 * Ask the agent one question over the streaming client, the way the page does,
 * and wait for the turn to finish. A refusal from agentStream comes back as `failure`.
 */
export async function ask(
  api: Api,
  creds: { code: string; session: string },
  question: string,
  names?: 'generic' | 'exact',
): Promise<Turn> {
  const toolCalls: string[] = [];
  let messages: ChatMessage[] = [];
  let failure: string | undefined;
  let conversationId = '';
  const settled = Promise.withResolvers<void>();
  let started = false;

  const chat = createChat({
    transport: realtimeTransport({
      subscribe: async (channelId, handlerOrOptions) => {
        const channel = await api.agentGetChannel({ ...creds, channelId });
        // Same value on both arms: the branch only picks a subscribe overload.
        return typeof handlerOrOptions === 'function' ? channel.subscribe(handlerOrOptions) : channel.subscribe(handlerOrOptions);
      },
      sendMessage: async (channelId, message) => {
        await api.agentStream({ ...creds, message, conversationId: channelId, ...(names ? { names } : {}) });
      },
      resume: async () => {
        throw new Error('This agent has no approval steps.');
      },
    }),
    api: {
      createConversation: async () => {
        conversationId = await api.agentCreateConversationId(creds);
        return { conversationId };
      },
      getConversation: async (id) => ({ messages: await api.agentGetConversation({ ...creds, channelId: id }) }),
    },
    onMessagesChange: (next) => {
      messages = next;
    },
    onChunk: (chunk) => {
      if (chunk.type === 'tool-call' && chunk.toolName) toolCalls.push(chunk.toolName);
    },
    onError: (error) => {
      failure = error || 'the agent turn failed';
    },
    onLoadingChange: (loading) => {
      if (loading) started = true;
      else if (started) settled.resolve();
    },
  });

  const timeout = new AbortController();
  try {
    await chat.sendMessage(question);
    await Promise.race([
      settled.promise,
      sleep(30_000, undefined, { signal: timeout.signal }).then(() => {
        throw new Error('the agent turn did not finish in 30 s');
      }),
    ]);
  } catch (e) {
    failure ??= e instanceof Error ? e.message : String(e);
  } finally {
    timeout.abort();
    chat.destroy();
  }
  const answer = messages.findLast((m) => m.role === 'assistant')?.content ?? '';
  return { conversationId, answer, toolCalls, failure };
}
