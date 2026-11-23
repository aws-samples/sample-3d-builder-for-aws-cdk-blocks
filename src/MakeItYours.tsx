// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { STANDARD_IDS, type StandardId, standardsOfKey } from "../cdk-blocks/shared";
import { sharedData } from "./custom";

interface Props {
  /** The standards key on screen. */
  standards: string;
  /** False while the arrangement's standards data loads; the switches wait for it. */
  ready: boolean;
  /** The text of a failed load, shown as it is. */
  error: string | null;
  onFlip: (id: StandardId) => void;
}

/**
 * "Make it yours": the custom Block's four standards as switches. Each switch is a DOM button, and a
 * flip swaps the page to that standards key's own synth data: the resources and their marks, the
 * links, the count line and both sides of the TypeScript. Below them, the rules the Block checks in
 * code, which aren't switches.
 */
export function MakeItYours({ standards, ready, error, onFlip }: Props) {
  const shared = sharedData();
  const on = standardsOfKey(standards) ?? [];
  const label = (id: StandardId) => shared?.standards.find((s) => s.id === id)?.label ?? id;
  return (
    <section className="yours" aria-labelledby="yours-title" data-testid="make-it-yours" data-standards-key={standards} data-ready={ready}>
      <p className="yours-kicker">Make it yours</p>
      <h2 id="yours-title">Your standards as custom Blocks</h2>
      <p className="yours-lede">
        Platform developers package their own standards as custom Blocks, so app teams start from the same approved pattern. HouseBucket is
        one: the FileBucket Block that AWS provides, with a platform team's four standards on top. Switch one off to see what it was adding.
      </p>
      <div className="yours-switches" role="group" aria-label="The custom Block's standards">
        {STANDARD_IDS.map((id) => {
          const isOn = on.includes(id);
          return (
            <button
              key={id}
              type="button"
              role="switch"
              aria-checked={isOn}
              className={`switch${isOn ? " is-on" : ""}`}
              data-standard={id}
              data-on={isOn}
              disabled={!ready}
              onClick={() => onFlip(id)}
            >
              <span className="switch-track" aria-hidden="true">
                <span className="switch-knob" />
              </span>
              <span className="switch-text">
                <span className="switch-label">{label(id)}</span>
                <span className="switch-state">{isOn ? "on" : "off"}</span>
              </span>
            </button>
          );
        })}
      </div>
      {!ready && !error && <p className="yours-wait">Loading this arrangement's standards data. The switches work once it's in.</p>}
      {error && (
        <p className="yours-wait" role="alert">
          The standards data didn't load, so the switches are off: {error}
        </p>
      )}
      {shared && (
        <>
          <h3>{shared.runtimeRules.heading}</h3>
          <ul className="yours-rules" data-testid="runtime-rules">
            {shared.runtimeRules.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          <p className="yours-note">
            These four aren't switches. The Block checks them on every upload, with its local implementation and on AWS.
          </p>
          {on.includes("tags") && (
            <details className="yours-missing" data-testid="missing-tag">
              <summary>What happens when an app team forgets a tag</summary>
              <p>The synth stops with exit code {shared.missingTag.exitCode}. This is the real output:</p>
              <pre>{shared.missingTag.error}</pre>
            </details>
          )}
        </>
      )}
      <p className="yours-note">
        This custom Block is a package in the app's workspace. Sharing it with app teams through npm is the step a platform developer would
        take next.
      </p>
    </section>
  );
}
