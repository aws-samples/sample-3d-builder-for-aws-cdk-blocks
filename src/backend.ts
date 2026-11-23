// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { PIECE_IDS, type PieceId } from "../cdk-blocks/shared";

const SESSION_KEY = "baseplate:session";
const CODE_KEY = "baseplate:code";

/**
 * A random id for this tab, used to count it as one open page and to own its agent conversation.
 * It lives in sessionStorage, so a reload stays one page and it goes when the tab closes.
 */
export function sessionId(): string {
  const saved = sessionStorage.getItem(SESSION_KEY);
  if (saved) return saved;
  const id = crypto.randomUUID();
  sessionStorage.setItem(SESSION_KEY, id);
  return id;
}

/**
 * The invite link carries the code in the URL fragment (#code=...), which the browser never sends
 * to a server. Read it once, drop it from the address bar, and keep it for this tab. It's never rendered.
 */
export function takeInviteCode(): string | null {
  const fromLink = new URLSearchParams(window.location.hash.slice(1)).get("code");
  if (fromLink) {
    sessionStorage.setItem(CODE_KEY, fromLink);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    return fromLink;
  }
  return sessionStorage.getItem(CODE_KEY);
}

export const keepInviteCode = (code: string) => sessionStorage.setItem(CODE_KEY, code);
export const dropInviteCode = () => sessionStorage.removeItem(CODE_KEY);

/** A share link names a saved build in the query string: ?b=<id>. It never carries the invite code. */
export function sharedBuildId(): string | null {
  const id = new URLSearchParams(window.location.search).get("b");
  return id && /^[a-z2-7]{10}$/.test(id) ? id : null;
}

export function shareUrl(id: string): string {
  return `${window.location.origin}${window.location.pathname}?b=${id}`;
}

export const isPieceId = (id: string): id is PieceId => (PIECE_IDS as readonly string[]).includes(id);

/** An error from the API client carries the server's message; anything else becomes its string. */
export function errorText(e: unknown): string {
  if (
    e &&
    typeof e === "object" &&
    "message" in e &&
    typeof (e as { message: unknown }).message === "string" &&
    (e as { message: string }).message
  ) {
    return (e as { message: string }).message;
  }
  return String(e);
}
