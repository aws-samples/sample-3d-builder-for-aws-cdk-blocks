// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { type CodeLine, tokenize } from "./code";
import type { Mark } from "./connections";
import {
  changeLine,
  markText,
  type OutsideRecord,
  partName,
  platformCode,
  propertyWord,
  type StandardsEntry,
  standardsText,
  statementText,
} from "./custom";
import { colorOf, data, headline, plural } from "./data";
import { SERVICE_WORD, typeLabel, useNaming } from "./naming";
import type { Block } from "./types";

/** Code lines with six token colors. Short strings stay whole, so an import never breaks inside a package name. */
export function CodeLines({ lines, open = null, fresh }: { lines: CodeLine[]; open?: string | null; fresh?: Set<string> }) {
  return (
    <pre>
      {lines.map((l) => {
        const idx = l.blockId ? data.blocks.findIndex((b) => b.id === l.blockId) : -1;
        return (
          <span
            key={l.key}
            className={`line${l.blockId ? " has-bar" : ""}${l.blockId && l.blockId === open ? " is-open" : ""}${l.blockId && fresh?.has(l.blockId) ? " is-new" : ""}`}
            style={idx >= 0 ? ({ "--brick": colorOf(idx) } as React.CSSProperties) : undefined}
          >
            {l.text === ""
              ? null
              : tokenize(l.text).map((t, i) => (
                  <span key={i} className={`t-${t.kind}${t.kind === "str" && t.text.length <= 34 ? " t-keep" : ""}`}>
                    {t.text}
                  </span>
                ))}
            {"\n"}
          </span>
        );
      })}
    </pre>
  );
}

/**
 * The resources one block creates, as plain DOM text. Exact mode shows the service, the resource and
 * its CloudFormation type, as the synth has them. Generic mode shows the generic label from
 * naming.json and no type string, since the type names the service.
 */
export function ResourceList({ block, className, withMore = true }: { block: Block; className?: string; withMore?: boolean }) {
  const mode = useNaming();
  return (
    <ul className={`res-list ${className ?? ""}`} aria-label={`${mode === "exact" ? "AWS resources" : "Resources"} ${block.label} creates`}>
      {headline(block).map((r, i) => (
        <li key={`${r.type}:${i}`} data-type={r.type}>
          <span className="res-main">
            {mode === "exact" ? (
              <>
                <b>{r.service}</b> {r.name}
              </>
            ) : (
              <b>{typeLabel(r.type, mode)}</b>
            )}
            {r.count > 1 && <span className="res-count">×{r.count}</span>}
          </span>
          {mode === "exact" && <code>{r.type}</code>}
          {r.note && (mode === "exact" || !SERVICE_WORD.test(r.note)) && <span className="res-note">{r.note}</span>}
        </li>
      ))}
      {withMore && block.supportingCount > 0 && <li className="res-more">plus {plural(block.supportingCount, "supporting resource")}</li>}
    </ul>
  );
}

/** A block's supporting resources by type. A type that carries a link is marked with the link's number, in text. */
export function SupportingList({
  block,
  id,
  marks,
  linkNumber,
}: {
  block: Block;
  id?: string;
  marks?: Map<string, Mark[]>;
  linkNumber?: (edgeId: string) => number;
}) {
  const mode = useNaming();
  return (
    <ul className="sup-list" id={id} aria-label={`Supporting resources for ${block.label}`}>
      {block.supporting.map((s) => {
        const carried = marks?.get(s.type) ?? [];
        return (
          <li key={s.type} data-type={s.type}>
            {mode === "exact" ? <code>{s.type}</code> : <span className="sup-name">{typeLabel(s.type, mode)}</span>}
            {carried.length > 0 && linkNumber && (
              <span className="sup-link" data-edges={carried.map((m) => m.edgeId).join(" ")}>
                carries {carried.length === 1 ? "link" : "links"} {carried.map((m) => linkNumber(m.edgeId)).join(", ")}
              </span>
            )}
            <span>×{s.count}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * For an open piece: which of its resources carry each lit link, in words. The 3D tiles carry the
 * same marks as a line under each tile's name.
 */
export function CarrierList({ marks, linkNumber }: { marks: Map<string, Mark[]>; linkNumber: (edgeId: string) => number }) {
  const mode = useNaming();
  if (marks.size === 0) return null;
  return (
    <div className="carry" data-testid="carriers">
      <h3>What carries the links</h3>
      <ul>
        {[...marks.entries()].map(([type, rows]) => (
          <li key={type} data-type={type}>
            <b>{typeLabel(type, mode)}</b>
            {rows.some((m) => m.shared) && <span className="carry-shared"> (shared)</span>}
            <span className="carry-links">
              {rows.length === 1 ? "link" : "links"} {rows.map((m) => linkNumber(m.edgeId)).join(", ")}
            </span>
            <ul>
              {rows.map((m) => (
                <li key={m.edgeId} data-edge={m.edgeId}>
                  {linkNumber(m.edgeId)}. {m.sentence}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── The custom piece ────────────────────────────────────────────────────────

const MARK_WORD = { base: "base", changed: "changed", added: "added" } as const;

/**
 * The custom piece's own resources, each with its mark in text: base (the plain FileBucket has it,
 * unchanged), changed (with each property before and after) or added (and by which standard). The
 * same marks sit under the 3D tiles. Every value is the synthesized template's.
 */
export function CustomList({
  entry,
  links,
  linkNumber,
}: {
  entry: StandardsEntry;
  links: Map<string, Mark[]>;
  linkNumber: (edgeId: string) => number;
}) {
  const mode = useNaming();
  const typeOfId = (id: string) => entry.resources.find((r) => r.logicalId === id)?.type;
  return (
    <ul
      className="cust-list"
      data-testid="custom-resources"
      data-standards-key={entry.standards}
      aria-label="What the custom Block creates, and what it changed or added"
    >
      {entry.resources.map((r) => {
        const mark = markText(r);
        const carried = links.get(r.logicalId) ?? [];
        return (
          <li key={r.logicalId} data-resource={r.logicalId} data-type={r.type} data-mark={r.mark}>
            <span className="cust-main">
              <b>{partName(r)}</b> <span className="cust-type">{mode === "exact" ? <code>{r.type}</code> : typeLabel(r.type, mode)}</span>
            </span>
            <span className="cust-marks">
              <span className={`mark is-${mark.kind}`} data-testid="mark">
                {MARK_WORD[mark.kind]}
              </span>
              <span className="cust-why">
                {r.mark === "base" && "The plain FileBucket has this, the same."}
                {r.mark === "added" &&
                  (r.standards === "always" ? "Always there: it holds the audit entries." : `Added by: ${standardsText(r.standards)}.`)}
                {r.mark === "changed" && "The plain FileBucket has this. The standards changed it:"}
              </span>
              {carried.length > 0 && (
                <span className="sup-link" data-edges={carried.map((m) => m.edgeId).join(" ")}>
                  carries {carried.length === 1 ? "link" : "links"} {carried.map((m) => linkNumber(m.edgeId)).join(", ")}
                </span>
              )}
            </span>
            {(r.changes ?? []).map((c) => {
              const line = changeLine(c, mode, typeOfId);
              return (
                <div
                  key={c.property}
                  className="cust-change"
                  data-property={c.property}
                  data-standards={c.standards === "always" ? "always" : c.standards.join("+")}
                >
                  <p className="cust-change-head">
                    <b>{line.word}</b>
                    {mode === "exact" && <code>{c.property.replace(/^Properties\./, "")}</code>}
                    <span className="cust-by">{standardsText(c.standards)}</span>
                  </p>
                  <ul className="cust-rows">
                    {line.rows.map((row) => (
                      <li key={row.path}>
                        <code>{row.path}</code>
                        <span className="cust-before">{row.before}</span>
                        <span aria-hidden="true">→</span>
                        <span className="sr-only">becomes</span>
                        <span className="cust-after">{row.after}</span>
                      </li>
                    ))}
                    {line.hidden > 0 && (
                      <li className="cust-hidden">
                        {line.hidden} more {line.hidden === 1 ? "value names" : "values name"} a service. Switch Names to Exact to see{" "}
                        {line.hidden === 1 ? "it" : "them"}.
                      </li>
                    )}
                  </ul>
                </div>
              );
            })}
            {(r.propertyStandards ?? []).map((p) => (
              <p key={p.property} className="cust-also" data-property={p.property} data-standards={p.standards.join("+")}>
                Its {propertyWord(p.property).toLowerCase()} {p.standards.length > 1 ? "need" : "come from"} {standardsText(p.standards)}
                {p.standards.length > 1 ? ", both on" : ""}.
              </p>
            ))}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * What the custom piece adds or changes outside its own construct: statements on the app's shared
 * role, and in some arrangements a second policy the role spills into. A platform developer reading
 * only the Block's code wouldn't see these; the synth shows them.
 */
export function OutsideList({ entry }: { entry: StandardsEntry }) {
  const mode = useNaming();
  if (entry.outside.length === 0) return null;
  const name = (o: OutsideRecord) => (mode === "exact" ? <code>{o.type}</code> : typeLabel(o.type, mode));
  return (
    <div className="outside" data-testid="custom-outside">
      <h3>Outside this Block</h3>
      <p className="outside-note">
        A custom Block can change the app around it. These are in the same synthesized template, outside the Block's own construct.
      </p>
      <ul>
        {entry.outside.map((o) => (
          <li key={o.logicalId} data-outside={o.logicalId} data-kind={o.kind}>
            <span className="cust-marks">
              <span className={`mark is-${o.kind}`}>{o.kind}</span>
              <b>{o.logicalId.startsWith("BlocksRole") ? "The app's shared role: " : ""}</b>
              {name(o)}
              {o.kind === "added" && o.standards && (
                <span className="cust-by">{o.standards === "always" ? "always there with this piece" : standardsText(o.standards)}</span>
              )}
            </span>
            {o.kind === "added" && (
              <p className="outside-line">
                The shared role's permissions no longer fit in one policy with this piece on, so a second policy is added to hold the rest.
              </p>
            )}
            {(o.statementsAdded ?? []).map((s, i) => (
              <p
                key={`a${i}`}
                className="outside-line"
                data-standards={s.standards === "always" ? "always" : (s.standards ?? []).join("+")}
              >
                Adds a statement: {statementText(s, mode, entry.types)}. <span className="cust-by">{standardsText(s.standards)}</span>
              </p>
            ))}
            {(o.statementsRemoved ?? []).map((s, i) => (
              <p key={`r${i}`} className="outside-line">
                Moves a statement out, into the second policy: {statementText(s, mode, entry.types)}.
              </p>
            ))}
            {(o.changes ?? []).map((c) => (
              <p key={c.property} className="outside-line" data-standards={c.standards === "always" ? "always" : c.standards.join("+")}>
                {propertyWord(c.property)}: now also waits for the second policy.{" "}
                <span className="cust-by">{standardsText(c.standards)}</span>
              </p>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the platform team writes once: the custom Block's constructor for the standards key on screen,
 * cut from the generated file that was typechecked and synthesized. A line a standard added or
 * changed carries that standard's name.
 */
export function PlatformCode({ standards }: { standards: string }) {
  const code = platformCode(standards);
  if (!code) return null;
  return (
    <div className="file" data-testid="platform-code" data-standards-key={standards}>
      <p className="file-name">{code.file}</p>
      <pre>
        {code.lines.map((text, i) => {
          const by = code.addedBy[i];
          return (
            <span key={`${i}:${text}`} className={`line${by ? " is-standard" : ""}`} data-standard={by?.standard} data-kind={by?.kind}>
              {text === ""
                ? null
                : tokenize(text).map((t, j) => (
                    <span key={j} className={`t-${t.kind}${t.kind === "str" && t.text.length <= 34 ? " t-keep" : ""}`}>
                      {t.text}
                    </span>
                  ))}
              {by && text !== "" && (
                <i className="line-mark">
                  <span className="sr-only">{by.kind === "added" ? " added by " : " changed by "}</span>
                  {by.standard}
                </i>
              )}
              {"\n"}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
