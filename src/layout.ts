// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

interface HudItem {
  cx: number;
  cy: number;
}

export interface HudLayout {
  items: HudItem[];
  piece: number;
  cellW: number;
  labelTop: number;
  bottom: number;
}

/** Screen-space slots (CSS px inside the scene box) for the fanned-out resource pieces. */
export function hudLayout(w: number, h: number, n: number, markLines = 0): HudLayout {
  const phone = w < 620;
  // Four tiles on a phone sit two and two, so each has room for its name and its marks.
  const cols = Math.max(1, Math.min(n, phone ? (n === 4 ? 2 : 3) : 6));
  const rows = Math.ceil(n / cols);
  // The tiles are the picture while a brick is open, so they are large: 64 px on a phone, up to 112 px on a desktop stage.
  const piece = phone ? 64 : Math.min(112, Math.max(72, h * 0.15));
  // Room under each tile for its name, plus one line per link mark (the lines sit outside the icon's box).
  const labelH = (phone ? 36 : 48) + markLines * (phone ? 13 : 16);
  const cellW = Math.min(phone ? (cols <= 2 ? 160 : 124) : 176, (w - 12) / cols);
  const cellH = piece + labelH + (phone ? 6 : 12);
  // The tiles start under the count caption that sits on the stage's top edge.
  const top = phone ? 46 : 58;
  const items: HudItem[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const inRow = row === rows - 1 ? n - row * cols : cols;
    const col = i - row * cols;
    items.push({
      cx: w / 2 + (col - (inRow - 1) / 2) * cellW,
      cy: top + row * cellH + piece / 2,
    });
  }
  return { items, piece, cellW, labelTop: piece / 2 + 2, bottom: top + rows * cellH };
}
