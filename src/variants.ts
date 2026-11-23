// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Look variants: other ways to draw the same page, picked with a query parameter. There's one,
// the flat theme (?theme=flat, src/theme-flat.ts). The page asks this module once, on load, and
// draws its usual look when the answer is null.
import type { ComponentType } from "react";

export interface ReliefProps {
  type: string;
  z: number;
  size: number;
}

export interface Variants {
  /** Notes shown above the title, one per variant that wants to say it's on. */
  labels: string[];
  /** Colors for the plate and its studs in the 3D scene. */
  palette?: { plate: string; studs: string } | null;
  /** Colors for the bricks, in place of the builder's own. */
  bricks?: string[] | null;
  /** Draws an icon tile's face in place of the atlas texture. No variant in this repository sets it. */
  Relief?: ComponentType<ReliefProps> | null;
}

export const THEMES = ["flat"] as const;
export type Theme = (typeof THEMES)[number];

/** The theme a query string asks for, or null: `?theme=flat`. Anything else is ignored. */
export function themeOf(search: string): Theme | null {
  const asked = new URLSearchParams(search).get("theme");
  return THEMES.find((theme) => theme === asked) ?? null;
}

export async function loadVariants(): Promise<Variants | null> {
  if (themeOf(window.location.search) !== "flat") return null;
  const { applyTheme } = await import("./theme-flat");
  return { labels: [], ...applyTheme() };
}
