// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { Build, Featured } from "../cdk-blocks/shared";
import { PIECE_IDS } from "../cdk-blocks/shared";
import { data } from "./data";

interface Props {
  builds: Build[] | null;
  featured: Featured | null;
  /** The build of the hour, which holds for its hour even when newer saves pushed it off the list. */
  featuredBuild: Build | null;
  fresh: Set<string>;
  colors: (index: number) => string;
  onOpen: (build: Build) => void;
}

const labelOf = (id: string) => data.blocks.find((b) => b.id === id)?.label ?? id;

/** The newest saved builds, live. A build has no name and no visitor text: it shows as its Blocks. */
export function Gallery({ builds: recent, featured, featuredBuild, fresh, colors, onOpen }: Props) {
  // A featured build that's no longer among the newest still shows, first.
  const pinned = featuredBuild && featured?.id === featuredBuild.id && recent && !recent.some((b) => b.id === featuredBuild.id);
  const builds = pinned && recent ? [featuredBuild, ...recent] : recent;
  return (
    <section className="gallery" aria-label="Recent builds">
      <h2 className="gallery-title">Recent builds</h2>
      {builds === null ? (
        <p className="gallery-empty">Loading the gallery</p>
      ) : builds.length === 0 ? (
        <p className="gallery-empty" data-testid="gallery-empty">
          No saved builds yet. Save yours and it lands here in every open page.
        </p>
      ) : (
        <ul className="gallery-strip" data-testid="gallery">
          {builds.map((b) => {
            const names = b.blocks.map(labelOf).join(", ");
            const isFeatured = featured?.id === b.id;
            return (
              <li key={b.id}>
                <button
                  type="button"
                  className={`gallery-item${fresh.has(b.id) ? " is-fresh" : ""}${isFeatured ? " is-featured" : ""}`}
                  data-testid="gallery-item"
                  data-build-id={b.id}
                  data-blocks={b.blocks.join("+")}
                  data-source={b.source}
                  data-featured={isFeatured ? "true" : undefined}
                  aria-label={`Open a saved build: ${names}${b.source === "agent" ? ", picked by the Agent Block" : ""}${isFeatured ? ", build of the hour" : ""}`}
                  onClick={() => onOpen(b)}
                >
                  <span className="mini" aria-hidden="true">
                    {PIECE_IDS.map((id, i) => (
                      <i
                        key={id}
                        className={b.blocks.includes(id) ? "is-on" : ""}
                        style={{ "--brick": colors(i) } as React.CSSProperties}
                      />
                    ))}
                  </span>
                  <span className="gallery-meta">
                    {b.blocks.length} {b.blocks.length === 1 ? "piece" : "pieces"}
                    {b.source === "agent" ? " · agent" : ""}
                  </span>
                  {isFeatured && <span className="gallery-flag">build of the hour</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
