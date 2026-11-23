// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { type NamingMode, useNaming } from "../naming";
import { ATLAS } from "./atlas";
import { iconFor } from "./map";

/**
 * An official AWS icon as a DOM sprite cut from the same atlas the 3D tiles use: the whole cell,
 * uniformly scaled. Returns null for a type with no icon; the caller shows text only.
 */
export function IconSprite({ type, size = 28, mode: fixed }: { type: string; size?: number; mode?: NamingMode }) {
  // Inside the 3D scene there is no naming context (labels there render in their own React root), so the scene passes the mode in.
  const fromContext = useNaming();
  const mode = fixed ?? fromContext;
  const icon = iconFor(type, mode);
  if (!icon) return null;
  const k = size / ATLAS.cell;
  return (
    <span
      className={`icon-sprite is-${icon.kind}`}
      aria-hidden="true"
      data-icon={icon.key}
      style={{
        width: size,
        height: size,
        backgroundImage: `url(${ATLAS.url})`,
        backgroundSize: `${ATLAS.width * k}px ${ATLAS.height * k}px`,
        backgroundPosition: `${-icon.px[0] * k}px ${-icon.px[1] * k}px`,
      }}
    />
  );
}
