// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { useEffect, useState } from "react";
import { ALL_ON, CUSTOM_PIECE, PIECE_IDS, STANDARDS_KEYS, standardsOfKey } from "../cdk-blocks/shared";
import { NamesSwitch } from "./Connections";
import { buildSections, codeOf } from "./code";
import { carrierMarksById, connectionCount, countLine, edgesOn, meaningOf, pairLine } from "./connections";
import { sharedData, standardLabel, standardsEntry } from "./custom";
import { loadCustom } from "./custom-loader";
import { blockText, colorOf, plural, resourceTotal, stackTotal } from "./data";
import raw from "./data/page/connections.json";
import { CodeLines, CustomList, OutsideList, PlatformCode, ResourceList, SupportingList } from "./Mapping";
import { type NamingMode, useNaming } from "./naming";
import type { BlocksData } from "./types";

const ALL_KEYS = Object.keys((raw as unknown as { combos: Record<string, unknown> }).combos).sort(
  (a, b) => a.split("+").length - b.split("+").length || a.localeCompare(b),
);

/** No WebGPU and no WebGL: the same mapping and the same connections, as text. */
export function StaticFallback({ data, reason, onNames }: { data: BlocksData; reason: string; onNames: (mode: NamingMode) => void }) {
  const mode = useNaming();
  const [showAll, setShowAll] = useState(false);
  // The custom piece's standards data, for the piece alone. It's a small file loaded after the page.
  const [customLoad, setCustomLoad] = useState<"loading" | "ready" | string>("loading");
  useEffect(() => {
    let live = true;
    loadCustom(CUSTOM_PIECE).then(
      () => live && setCustomLoad("ready"),
      (e: unknown) => live && setCustomLoad(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, []);
  const customEntry = customLoad === "ready" ? standardsEntry(CUSTOM_PIECE, ALL_ON) : null;
  const label = (id: string) => data.blocks.find((b) => b.id === id)?.label ?? id;
  const all = [...PIECE_IDS];
  const lines = data.blocks.reduce((n, b) => n + b.code.length, 0);
  return (
    <section className="static" data-static-fallback>
      <p className="static-note">{reason} Here's the same mapping as text.</p>
      <NamesSwitch onChange={onNames} />
      {data.blocks.map((b, i) => {
        const text = blockText(b, mode);
        const edges = edgesOn([b.id]);
        return (
          <article key={b.id} className="static-block" style={{ borderColor: colorOf(i) }}>
            <h2>
              <span className="stud" style={{ background: colorOf(i) }} />
              {b.label}
            </h2>
            <p className="static-tag">{text.tagline}</p>
            <p className="pkg">
              <span>
                {b.package} {b.version}
              </span>{" "}
              <span>in {b.codeFile}</span>
            </p>
            <div className="static-code">
              <CodeLines lines={buildSections([b])[0].lines} />
            </div>
            <p className="static-sum">
              On its own, {plural(b.code.length, "line")} {b.code.length === 1 ? "creates" : "create"}{" "}
              {plural(resourceTotal(b), mode === "exact" ? "AWS resource" : "resource")}:
            </p>
            {b.custom && (
              <p className="static-tag" data-static-custom>
                Your standards as custom Blocks. This is a custom Block: the {b.builtOn} Block that AWS provides, with a platform team's
                standards on top. Below, each of its resources is marked base (the plain {b.builtOn} has it, the same), changed or added.
              </p>
            )}
            {b.custom && customEntry ? (
              <>
                <CustomList entry={customEntry} links={carrierMarksById(b.id, [b.id], mode, ALL_ON)} linkNumber={() => 0} />
                <OutsideList entry={customEntry} />
              </>
            ) : (
              <>
                <ResourceList block={b} />
                {b.supporting.length > 0 && <SupportingList block={b} />}
              </>
            )}
            {b.custom && customLoad !== "ready" && customLoad !== "loading" && (
              <p className="block-note">The custom Block's marks didn't load: {customLoad}</p>
            )}
            {text.note && <p className="block-note">{text.note}</p>}
            {b.custom && customLoad === "ready" && (
              <>
                <p className="static-sum">
                  Its four standards can each be on or off. Every one of the 16 states was synthesized. On its own:
                </p>
                <table className="static-standards" data-static-standards>
                  <thead>
                    <tr>
                      <th scope="col">Standards on</th>
                      <th scope="col">Resources</th>
                      <th scope="col">Connections</th>
                      <th scope="col">Lines</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STANDARDS_KEYS.map((key) => {
                      const e = standardsEntry(CUSTOM_PIECE, key);
                      const on = standardsOfKey(key) ?? [];
                      return (
                        <tr key={key} data-standards-key={key}>
                          <th scope="row">{on.length === 0 ? "None" : on.map(standardLabel).join(", ")}</th>
                          <td>{e?.resourcesAdded}</td>
                          <td>{e?.K}</td>
                          <td>{codeOf(b, key).length}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <p className="static-sum">What the platform team writes once, with all four on:</p>
                <div className="static-code">
                  <PlatformCode standards={ALL_ON} />
                </div>
                <p className="static-sum">{sharedData()?.runtimeRules.heading}:</p>
                <ul className="static-links" data-static-rules>
                  {sharedData()?.runtimeRules.rules.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </>
            )}
            <p className="static-sum" data-static-k={b.id}>
              On its own it has {plural(connectionCount([b.id]), "connection")}:
            </p>
            <ul className="static-links" data-static-links={b.id}>
              {edges.map((e) => (
                <li key={e.id} data-edge={e.id}>
                  {meaningOf(e.id, mode)}
                </li>
              ))}
            </ul>
          </article>
        );
      })}
      <article className="static-block">
        <h2>Every piece together: five Blocks, the Hosting construct and one custom Block</h2>
        <p className="static-sum" data-static-count-line>
          {countLine(all, stackTotal(all), lines, mode).text}.
        </p>
        <p className="static-tag">
          No piece links straight to another piece. Each one plugs into the app, and some share parts that are created once.
        </p>
        <ul className="static-links" data-static-links="all">
          {edgesOn(all).map((e) => (
            <li key={e.id} data-edge={e.id}>
              {meaningOf(e.id, mode)}
            </li>
          ))}
        </ul>
        <ul className="static-links" data-static-pairs>
          {all.flatMap((a, i) => all.slice(i + 1).map((b) => <li key={`${a}+${b}`}>{pairLine(a, b, all, mode)}</li>))}
        </ul>
      </article>
      <details className="static-block static-every" data-static-every onToggle={(e) => setShowAll(e.currentTarget.open)}>
        <summary>Every arrangement's connections ({ALL_KEYS.length} arrangements)</summary>
        <p className="static-tag">
          An arrangement with the custom Block is listed with all four of its standards on. In the 3D builder each of those has 16 standards
          states.
        </p>
        {showAll &&
          ALL_KEYS.map((key) => {
            const ids = key.split("+");
            return (
              <div key={key} data-arrangement={key}>
                <h3>
                  {ids.map(label).join(" + ")}: {plural(connectionCount(ids), "connection")}
                </h3>
                <ul className="static-links">
                  {edgesOn(ids).map((e) => (
                    <li key={e.id} data-edge={e.id}>
                      {meaningOf(e.id, mode)}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </details>
    </section>
  );
}
