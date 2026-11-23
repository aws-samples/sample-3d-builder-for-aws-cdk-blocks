// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// A second look for the page: flat fills, no gradients, square corners and a dark background, with
// system fonts. Open the page with ?theme=flat to see it. The icons on the tiles don't change.
import type { Variants } from "./variants";

/** The theme's colors. The bricks take `faces`, in order. */
export const FLAT = {
  dark: "#000000",
  light: "#F5F3EF",
  accent: "#FF6200",
  faces: ["#F3C300", "#FF4D8B", "#B052FF", "#0578FF", "#6EE750", "#FF6200"],
  gray: "#7E7A72",
  textOnDark: "#FFFFFF",
  textOnLight: "#000000",
  /** Secondary text on the dark page and on its raised dark surfaces. */
  softOnDark: "#A8A49C",
  /** Secondary text on a light surface. */
  softOnLight: "#55524C",
  /** A raised surface on the dark page: an open code line, a list. */
  raised: "#1A1917",
  linkOnDark: "#68ADFF",
};

const P = FLAT;

const SYSTEM = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const SYSTEM_MONO = 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace';

// Contrast against #000000: #FFFFFF 21:1, #A8A49C 8.4:1, #FF6200 7.0:1, #F3C300 12.6:1, #68ADFF 8.9:1,
// #6EE750 13.4:1. Black text on each face color is 5.1:1 or better. Every text pair here is 4.5:1 or more.
//
// The page has surfaces that keep a light fill under this theme: the custom Block's panel and the
// label on its plate, the cards for shared resources, the marks on changed code lines. The LIGHT
// rule below turns the text variables dark inside each one, so nothing light is drawn on them.
const LIGHT = [".yours", ".team-label", ".connections-count", ".node-btn", ".carry", ".link-btn", ".line-mark"]
  .map((surface) => `:root[data-theme] ${surface}`)
  .join(", ");
const CSS = `
:root[data-theme] {
  --paper: ${P.dark};
  --paper-2: ${P.dark};
  --ink: ${P.textOnDark};
  --ink-soft: ${P.softOnDark};
  --stage-top: ${P.dark};
  --stage-edge: ${P.dark};
  --code-bg: ${P.dark};
  --code-line: ${P.textOnDark};
  --focus: ${P.linkOnDark};
  --go: ${P.accent};
  --display: ${SYSTEM};
  --mono: ${SYSTEM_MONO};
  color-scheme: dark;
}
:root[data-theme] body { background-image: none; }
${LIGHT} { --ink: ${P.textOnLight}; --ink-soft: ${P.softOnLight}; --paper: ${P.light}; --paper-2: ${P.light}; color: ${P.textOnLight}; }
:root[data-theme] * { border-radius: 0 !important; box-shadow: none !important; }
:root[data-theme] .brand { background: none; color: ${P.accent}; padding: 0; }
:root[data-theme] .tag, :root[data-theme] .tag-runtime.is-aws { background: ${P.dark}; }
:root[data-theme] .dot { background: #6EE750; border-radius: 0 !important; }
:root[data-theme] .btn, :root[data-theme] .pill { background: ${P.dark}; color: ${P.textOnDark}; }
:root[data-theme] .btn-go, :root[data-theme] .btn-save { background: ${P.accent}; color: ${P.textOnLight}; border-color: ${P.accent}; }
:root[data-theme] .btn:disabled { background: ${P.dark}; color: ${P.gray}; border-color: ${P.gray}; }
:root[data-theme] .btn-dark { background: ${P.light}; color: ${P.textOnLight}; border-color: ${P.light}; }
:root[data-theme] .pill[aria-expanded="true"] { background: ${P.light}; color: ${P.textOnLight}; }
:root[data-theme] .ask-row input, :root[data-theme] .share-link input { background: ${P.light}; color: ${P.textOnLight}; border-color: ${P.light}; }
:root[data-theme] .ask-row input::placeholder { color: ${P.softOnLight}; }
:root[data-theme] .chip { background: ${P.dark}; }
:root[data-theme] .chip.is-on, :root[data-theme] .chip.is-on .chip-state { background: var(--brick); color: ${P.textOnLight}; }
:root[data-theme] .chip .stud { background: var(--brick); border-color: ${P.textOnDark}; }
:root[data-theme] .chip.is-on .stud { background: ${P.dark}; border-color: ${P.dark}; }
:root[data-theme] .caption.is-failed, :root[data-theme] .share-error { background: ${P.dark}; border-color: #FF4D8B; }
:root[data-theme] .reset-view span { background: ${P.dark}; }
:root[data-theme] .brick-tag { background: ${P.light}; color: ${P.textOnLight}; border-color: ${P.light}; }
:root[data-theme] .brick-tag.is-open { background: ${P.accent}; color: ${P.textOnLight}; border-color: ${P.accent}; }
/* The stage is dark like the page. A label over it carries its own dark fill, so it reads over a brick or the plate too. */
:root[data-theme] .scene { background: ${P.dark}; }
:root[data-theme] .hud-label b, :root[data-theme] .hud-label span { padding: 0 4px; background: ${P.dark}; color: ${P.textOnDark}; }
:root[data-theme] .hud-label span { color: ${P.softOnDark}; }
:root[data-theme] .hud-count, :root[data-theme] .res-count, :root[data-theme] .gallery-flag, :root[data-theme] .toast { background: ${P.light}; color: ${P.textOnLight}; }
:root[data-theme] .detail-card { box-shadow: none !important; border-left: 10px solid var(--brick); }
:root[data-theme] .sup-list { background: ${P.raised}; }
:root[data-theme] .file-name, :root[data-theme] .code-head span, :root[data-theme] .code-empty { color: ${P.softOnDark}; }
:root[data-theme] .file-name::before { background: ${P.accent}; }
:root[data-theme] .t-kw { color: ${P.accent}; }
:root[data-theme] .t-str { color: #6EE750; }
:root[data-theme] .t-type { color: #F3C300; }
:root[data-theme] .t-num { color: ${P.linkOnDark}; }
:root[data-theme] .t-com { color: ${P.softOnDark}; }
:root[data-theme] .t-punct { color: ${P.textOnDark}; }
:root[data-theme] .line.is-open { background: ${P.raised}; }
:root[data-theme] .mini i { border-color: ${P.textOnDark}; opacity: 0.35; }
:root[data-theme] .mini i.is-on { opacity: 1; border-color: var(--brick); }
:root[data-theme] .gallery-item.is-fresh { animation: none; }
:root[data-theme] .res-list li, :root[data-theme] .runs-on-blocks li { border-bottom-color: #3a3833; }
:root[data-theme] .icon-sprite.is-resource { background-color: ${P.light}; outline: 2px solid ${P.light}; }
/* Square tiles on a grid, stepped: the tray's tiles touch, and every other one sits one step lower. */
:root[data-theme] .tray { gap: 0; }
:root[data-theme] .chip { border-width: 2px; margin: 0 -1px -1px 0; }
@media (min-width: 900px) {
  :root[data-theme] .tray { padding-bottom: 26px; }
  :root[data-theme] .chip:nth-child(even) { transform: translateY(12px); }
}
`;

/** Switch the page to the flat theme. Returns the colors the 3D scene and the bricks need. */
export function applyTheme(): { palette: NonNullable<Variants["palette"]>; bricks: string[] } {
  if (!document.getElementById("theme-flat")) {
    const style = document.createElement("style");
    style.id = "theme-flat";
    style.textContent = CSS;
    document.head.append(style);
  }
  document.documentElement.dataset.theme = "flat";
  return { palette: { plate: P.gray, studs: P.gray }, bricks: P.faces };
}
