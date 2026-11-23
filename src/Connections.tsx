// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { edgesOn, type Focus, isPiece, LEAD_TYPE, meaningOf, nodePhrase, pairLines, plugNodes } from "./connections";
import { IconSprite } from "./icons";
import { NAMING_MODES, type NamingMode, nodeLabel, nodeName, useNaming } from "./naming";

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const links = (n: number) => `${n} connection${n === 1 ? "" : "s"}`;

/** Generic or Exact names. Two buttons, each a full tap target. The choice is remembered in this browser. */
export function NamesSwitch({ onChange }: { onChange: (mode: NamingMode) => void }) {
  const mode = useNaming();
  return (
    <div className="names-switch" role="group" aria-label="How services are named" data-testid="naming-switch" data-names={mode}>
      <span className="names-switch-label" aria-hidden="true">
        Names
      </span>
      {NAMING_MODES.map((m) => (
        <button
          key={m}
          type="button"
          className={`names-btn${m === mode ? " is-on" : ""}`}
          aria-pressed={m === mode}
          data-names={m}
          onClick={() => onChange(m)}
        >
          {m === "generic" ? "Generic" : "Exact"}
        </button>
      ))}
    </div>
  );
}

/** What a focus is called, and what it lights, as text. Shared by the label under the scene and the aria-live line. */
export function focusText(
  focus: Focus,
  lit: readonly string[],
  on: readonly string[],
  mode: NamingMode,
): { title: string; sentences: string[]; pairs: string[] } | null {
  if (!focus) return null;
  const sentences = lit.map((id) => meaningOf(id, mode));
  if (focus.kind === "edge") return { title: "One connection", sentences, pairs: [] };
  const title = `${upperFirst(nodePhrase(focus.id, mode))}: ${links(lit.length)}`;
  return { title, sentences, pairs: isPiece(focus.id) ? pairLines(focus.id, on, mode) : [] };
}

/**
 * The HTML label for what's lit on the plate: each lit link's meaning in plain words, and for a piece,
 * how it relates to every other piece on the plate. Never a texture.
 */
export function LinkBar({ focus, lit, on }: { focus: Focus; lit: readonly string[]; on: readonly string[] }) {
  const mode = useNaming();
  const text = focusText(focus, lit, on, mode);
  const core = ["core:role", "core:handler", "core:config", "core:api"].map((id) => nodeName(id, mode));
  return (
    <section
      className={`linkbar${text ? " is-lit" : ""}`}
      aria-label="What's connected"
      data-testid="link-label"
      data-focus={focus ? `${focus.kind}:${focus.id}` : ""}
      data-lit={lit.join(" ")}
      tabIndex={text ? 0 : undefined}
    >
      {text ? (
        <>
          <p className="linkbar-title">{text.title}</p>
          <ol className={`linkbar-list${text.sentences.length === 1 ? " is-one" : ""}`}>
            {text.sentences.map((s, i) => (
              <li key={lit[i]} data-edge={lit[i]}>
                {s}
              </li>
            ))}
          </ol>
          {text.pairs.map((p) => (
            <p key={p} className="linkbar-pair" data-testid="pair-line">
              {p}
            </p>
          ))}
        </>
      ) : on.length === 0 ? (
        <p className="linkbar-hint">
          Tap a brick and it snaps onto the baseplate. The plate's sockets are what every app starts with: {core.slice(0, -1).join(", ")}{" "}
          and {core.at(-1)}. Pieces plug into them.
        </p>
      ) : (
        <p className="linkbar-hint">
          Each lit line is one connection from the synthesized template. Tap a piece, a socket or a line to read what it means.
        </p>
      )}
    </section>
  );
}

interface PanelProps {
  on: readonly string[];
  /** The custom Block's standards key, when the custom piece is on the plate. */
  std?: string;
  focus: Focus;
  lit: readonly string[];
  open: boolean;
  onToggle: (open: boolean) => void;
  onNode: (id: string) => void;
  onEdge: (id: string) => void;
}

/**
 * The Connections list: the same K connections the plate draws, as buttons. Each button lights its
 * link the way a tap on the plate does, so keyboard, screen reader and no-GPU visitors get the
 * whole picture. The sockets and shared parts have buttons here too.
 */
export function ConnectionsPanel({ on, std, focus, lit, open, onToggle, onNode, onEdge }: PanelProps) {
  const mode = useNaming();
  const edges = edgesOn(on, std);
  const nodes = plugNodes(on, std);
  return (
    <details className="connections" data-testid="connections" open={open} onToggle={(e) => onToggle(e.currentTarget.open)}>
      <summary>
        <span className="connections-title">Connections</span>
        <span className="connections-count" data-testid="connections-count" data-k={edges.length}>
          {edges.length}
        </span>
      </summary>
      <p className="connections-note">
        Every resource is CDK that you can audit and change. Each connection here is in the synthesized template. No piece links straight to
        another piece: they connect through the app.
      </p>
      <div className="connections-nodes" role="group" aria-label="What the pieces plug into">
        {nodes.map((n) => (
          <button
            key={n.id}
            type="button"
            className={`node-btn is-${n.kind}`}
            data-node={n.id}
            aria-pressed={focus?.kind === "node" && focus.id === n.id}
            aria-label={`${upperFirst(nodeName(n.id, mode))}, ${n.kind === "core" ? "part of every app" : "shared by pieces"}, ${links(n.links)}`}
            onClick={() => onNode(n.id)}
          >
            <IconSprite type={LEAD_TYPE[n.id]} size={24} />
            <span className="node-btn-text">
              <b>{nodeLabel(n.id, mode)}</b>
              <span>
                {n.kind === "core" ? "every app has it" : "shared"} · {n.links}
              </span>
            </span>
          </button>
        ))}
      </div>
      {edges.length === 0 ? (
        <p className="connections-empty">Snap a piece on to see what it connects to.</p>
      ) : (
        <ul className="connections-list" data-testid="connections-list">
          {edges.map((e) => (
            <li key={e.id}>
              <button type="button" className="link-btn" data-edge={e.id} aria-pressed={lit.includes(e.id)} onClick={() => onEdge(e.id)}>
                {meaningOf(e.id, mode)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
