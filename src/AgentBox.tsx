// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { type ChatMessage, createChat, realtimeTransport } from "@aws-cdk-blocks/bb-agent/client";
import { api } from "cdk-blocks";
import { useEffect, useRef, useState } from "react";
import { MAX_QUESTION_LENGTH, type NamingMode, type PieceId, readAgain } from "../cdk-blocks/shared";
import { errorText } from "./backend";

interface AgentPick {
  blocks: PieceId[];
  why: string;
  added: number;
  /** Runtime connections in the picked arrangement, from the server's copy of connections.json. */
  connections: number;
}

/** What the page shows for the agent's last turn. A failure is shown as a failure, with its error text. */
export type AgentView =
  | { status: "idle" }
  | { status: "working"; text: string }
  | { status: "done"; text: string; pick: AgentPick | null; conversationId: string }
  | { status: "failed"; error: string };

/**
 * The Agent Block (`@aws-cdk-blocks/bb-agent` 1.0.0) wraps a tool's result in <untrusted-data> delimiters
 * only when the tool sets `untrustedOutput`, and none of this app's tools do. If one ever does, the
 * local implementation echoes the tool result as is, so drop the delimiters for display.
 */
function displayText(text: string): string {
  return (
    text
      .replace(/<\/?untrusted-data[^>]*>/g, "")
      // A model can write a few words before it calls its tool. The chat client joins that text to the
      // answer with nothing between them ("...your chat app:I picked..."), so put the space back.
      .replace(/([.:!?])(?=[A-Z])/g, "$1 ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

const TURN_TIMEOUT_MS = 40_000;
const EXAMPLE = "a chat app where people sign in and get live updates";

interface Props {
  code: string;
  session: string;
  /** The page's naming mode. It goes to the server with every question, so the agent names things the way the page does. */
  names: NamingMode;
  onView: (view: AgentView) => void;
}

/** "Describe your app": one question to the Agent Block, which answers by snapping Blocks on through its tool. */
export function AgentBox({ code, session, names, onView }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const view = useRef(onView);
  view.current = onView;
  // Read at send time through a ref, so switching names doesn't tear down the chat.
  const mode = useRef(names);
  mode.current = names;

  // One chat controller per mount, created inside the effect: destroy() is permanent, and React
  // StrictMode runs every effect cleanup once on mount in development, so a controller built during
  // render would be dead before its first turn.
  const live = useRef<{
    chat: ReturnType<typeof createChat>;
    conversationId: () => string;
    messages: () => ChatMessage[];
    error: { current: string | null };
    turn: { current: { started: boolean; done: () => void } | null };
    from: { current: number };
  } | null>(null);

  useEffect(() => {
    const creds = { code, session };
    let conversationId = "";
    let messages: ChatMessage[] = [];
    const error = { current: null as string | null };
    const turn = { current: null as { started: boolean; done: () => void } | null };
    const from = { current: 0 };
    const chat = createChat({
      transport: realtimeTransport({
        subscribe: async (channelId, handlerOrOptions) => {
          const channel = await api.agentGetChannel({ ...creds, channelId });
          // Same value on both arms: the branch only picks a subscribe overload.
          return typeof handlerOrOptions === "function" ? channel.subscribe(handlerOrOptions) : channel.subscribe(handlerOrOptions);
        },
        sendMessage: async (channelId, message) => {
          await api.agentStream({ ...creds, message, conversationId: channelId, names: mode.current });
        },
        resume: async () => {
          throw new Error("This agent has no approval steps.");
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
        messages = [...next];
        if (!turn.current) return;
        const answer = messages.slice(from.current).findLast((m) => m.role === "assistant");
        view.current({ status: "working", text: displayText(answer?.content ?? "") });
      },
      onError: (message) => {
        error.current = message || "The agent turn failed with no error text.";
      },
      onLoadingChange: (loading) => {
        if (!turn.current) return;
        if (loading) turn.current.started = true;
        else if (turn.current.started) turn.current.done();
      },
    });
    live.current = { chat, conversationId: () => conversationId, messages: () => messages, error, turn, from };
    return () => {
      chat.destroy();
      live.current = null;
    };
  }, [code, session]);

  async function ask(question: string) {
    const text = question.trim();
    const l = live.current;
    if (!text || busy || !l) return;
    setBusy(true);
    setInput("");
    l.error.current = null;
    l.from.current = l.messages().length;
    view.current({ status: "working", text: "" });
    let timer: number | undefined;
    try {
      const settled = new Promise<void>((resolve) => {
        l.turn.current = { started: false, done: resolve };
      });
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(
          () => reject(new Error(`The agent turn didn't finish in ${TURN_TIMEOUT_MS / 1000} seconds.`)),
          TURN_TIMEOUT_MS,
        );
      });
      await l.chat.sendMessage(text);
      if (!l.error.current) await Promise.race([settled, timeout]);
      if (l.error.current) throw new Error(l.error.current);
      const conversationId = l.conversationId();
      const answer = l
        .messages()
        .slice(l.from.current)
        .findLast((m) => m.role === "assistant");
      // The pick comes from the server's validated record of the tool call, never from the agent's prose.
      // That record was written moments ago, and a read this soon can miss it: look once more before showing "no pick".
      const proposal = await readAgain(
        () => api.getProposal({ conversationId }),
        (p) => p === null,
      );
      view.current({
        status: "done",
        text: displayText(answer?.content ?? ""),
        pick: proposal ? { blocks: proposal.blocks, why: proposal.why, added: proposal.added, connections: proposal.connections } : null,
        conversationId,
      });
    } catch (e) {
      // A failed turn shows its failure. Nothing stored or canned is shown in its place.
      view.current({ status: "failed", error: l.error.current ?? errorText(e) });
    } finally {
      window.clearTimeout(timer);
      l.turn.current = null;
      setBusy(false);
    }
  }

  return (
    <form
      className="ask-form"
      onSubmit={(e) => {
        e.preventDefault();
        void ask(input);
      }}
    >
      <label className="ask-label" htmlFor="ask-input">
        <b>Describe your app</b> and the Agent Block snaps Blocks on.
      </label>
      <div className="ask-row">
        <input
          id="ask-input"
          type="text"
          name="question"
          maxLength={MAX_QUESTION_LENGTH}
          placeholder={EXAMPLE}
          autoComplete="off"
          enterKeyHint="send"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          data-testid="agent-input"
        />
        <button type="submit" className="btn btn-go" disabled={busy || !input.trim()} data-testid="agent-send">
          {busy ? "Asking" : "Ask"}
        </button>
      </div>
    </form>
  );
}
