// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { OwnSynth } from "../cdk-blocks/shared";
import { IconSprite } from "./icons";
import { typeLabel, useNaming } from "./naming";

// What each Block does in this app. The list itself (kinds and ids) comes from the app's own synth.
const JOB: Record<string, string> = {
  Agent: "Reads your description and picks pieces through a tool limited to the builder's seven ids.",
  Realtime: "Pushes new builds and the here-now count to every open page.",
  KVStore: "Holds saved builds, the budgets and check-ins, and the agent's last pick.",
  CronJob: "Once a minute, picks the build of the hour and writes the gallery snapshot if it changed.",
  HouseBucket:
    "Holds the gallery snapshot file, under this app's standards: its own key, retention, access logging and required tags. Each write it stores or refuses is recorded in an audit table.",
  Secret: "Holds the invite code that unlocks saving and asking.",
  Logger: "Logs each save, question and refusal.",
  Metrics: "Counts builds saved, agent questions and refusals.",
  Dashboard: "Charts those counts and the app's health on AWS.",
};

/** "What this page runs on": this app's own Blocks and resource count, from its own cdk synth. */
export function RunsOn({ own }: { own: OwnSynth }) {
  const types = Object.entries(own.resourcesByType).sort(([, a], [, b]) => b - a);
  const mode = useNaming();
  const stores = own.blocks.find((b) => b.kind === "KVStore")?.ids ?? [];
  const custom = own.customBlocks ?? [];
  const provided = own.blockKinds - custom.length;
  const customOf = (kind: string) => custom.find((c) => c.kind === kind);
  const counted = `${provided} Blocks that AWS provides${custom.length === 1 ? ", one custom Block" : custom.length > 1 ? `, ${custom.length} custom Blocks` : ""}${own.hostingConstruct ? " and the Hosting construct" : ""}`;
  return (
    <details className="runs-on" data-testid="runs-on">
      <summary>
        <span className="runs-on-title">What this page runs on</span>
        <span
          className="runs-on-count"
          data-testid="runs-on-count"
          data-blocks={own.blockKinds}
          data-custom={custom.length}
          data-resources={own.resourceCount}
        >
          {counted}, {own.resourceCount} resources, synthesized from this app
        </span>
      </summary>
      <p className="runs-on-note">
        These are this page's own numbers, not the builder's. They come from running <code>cdk synth</code> on this app and counting the
        resources in its own template. Every resource is CDK that you can audit and change.
      </p>
      <ul className="runs-on-blocks" data-testid="runs-on-blocks">
        {own.blocks.map((b) => (
          <li key={b.kind} data-kind={b.kind} data-custom={customOf(b.kind) ? "true" : undefined}>
            <b>
              {b.kind}
              {b.ids.length > 1 && <span className="runs-on-x"> ×{b.ids.length}</span>}
              {customOf(b.kind) && <span className="runs-on-custom">custom Block</span>}
            </b>
            <span>
              {JOB[b.kind] ?? "Used by this app."}
              {customOf(b.kind) && (
                <span className="runs-on-inside" data-testid="runs-on-inside">
                  {" "}
                  Built from{" "}
                  {customOf(b.kind)!
                    .inside.map((i) => i.kind)
                    .join(", ")
                    .replace(/, ([^,]+)$/, " and $1")}
                  , the Blocks that AWS provides. It's a package in this app's workspace ({customOf(b.kind)!.package}), not a published one.
                </span>
              )}
            </span>
          </li>
        ))}
        {own.hostingConstruct && (
          <li data-kind="Hosting">
            <b>The Hosting construct</b>
            <span>Serves this page. It's a construct, not a Block, so it's counted apart.</span>
          </li>
        )}
      </ul>
      <p className="runs-on-note" data-testid="runs-on-how">
        How we count: {own.blockKinds} is the number of Block kinds this app constructs
        {custom.length > 0
          ? `, ${provided} that AWS provides and ${custom.length === 1 ? "one custom Block" : `${custom.length} custom Blocks`}`
          : ""}
        .{stores.length > 1 && ` KVStore is one Block used for ${stores.length} stores (${stores.join(", ")}).`}
        {custom.length > 0 && " The Blocks inside the custom Block aren't counted again."} The {own.resourceCount} resources are everything
        in the template, including what the Blocks set up that we didn't write.
      </p>
      {custom.length > 0 && (
        <p className="runs-on-note" data-testid="runs-on-custom-note">
          This app is a sample, so by default every table, bucket, key and secret it creates is removed with its stack, this page's own
          custom Block's included. The custom Block in the builder keeps the production preset, which retains its buckets, key and table. So
          its resources and these aren't the same list.
        </p>
      )}
      <ul className="runs-on-types" data-testid="runs-on-types">
        {types.map(([type, count]) => (
          <li key={type} data-type={type}>
            <IconSprite type={type} size={24} />
            {/* Exact names show the CloudFormation type. Generic names show the generic label from naming.json, since a type string names its service. */}
            {mode === "exact" ? <code>{type}</code> : <span className="runs-on-name">{typeLabel(type, mode)}</span>}
            <span>×{count}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
