// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import atlasUrl from "./atlas.png";
import { ATLAS_SIZE } from "./map";

/** The atlas image and its size. Only the page loads this file; map.ts has the lookups with no image. */
export const ATLAS = { url: atlasUrl, ...ATLAS_SIZE };
