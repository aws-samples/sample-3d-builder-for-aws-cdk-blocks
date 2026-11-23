// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * A browser test of text contrast for the 3D builder, in both looks (the default one and
 * ?theme=flat) and at two sizes (384 px wide and 1440 px wide).
 *
 * Run:  npm run test:contrast
 *   It needs Playwright's Chromium once: npx playwright install chromium
 *   DEV_PORT=<port> moves the dev server it uses, as for the API tests.
 *   CONTRAST_SCREENS=<folder> keeps a screenshot of each look and size.
 *
 * It opens the page in headless Chromium on the local dev server (it reuses a running one or
 * starts one), puts bricks on the plate, toggles one, unlocks the page with the local invite
 * code, opens the page once more with WebGPU and WebGL taken away so it shows its text-only
 * fallback, and after each step reads the computed color of every piece of visible text and of
 * the background behind it. WCAG 2.2 AA asks for 4.5 to 1, or 3 to 1 for large text (24 px, or
 * 18.66 px bold) and for the marks of controls. The test fails below that.
 *
 * What it can't see: the pixels of the 3D scene. Text drawn over the scene is measured against
 * its own background when it has one, and against the stage's CSS background otherwise.
 * A disabled control is left out, as WCAG leaves it out.
 */
import assert from 'node:assert';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Browser, chromium, type Page } from 'playwright';

const app = resolve('.');
const serverPort = Number(process.env.DEV_PORT ?? 4340);
const readinessUrl = `http://localhost:${serverPort}/.cdk-blocks-sandbox/config.json`;

/** The local invite code, from the Secret Block's local store. Never printed. */
function localInviteCode(): string {
  const code = JSON.parse(readFileSync(join(app, '.cdk-blocks/local/data/settings.json'), 'utf-8'))['baseplate-invite-code'];
  assert.ok(typeof code === 'string' && code.length > 0, 'expected a local invite code in .cdk-blocks/local/data/settings.json');
  return code;
}
async function serverIsUp(): Promise<boolean> {
  try {
    return (await fetch(readinessUrl)).ok;
  } catch {
    return false;
  }
}
async function waitForServer(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (await serverIsUp()) return;
    await sleep(1000);
  }
  throw new Error(`Server not ready at ${readinessUrl}`);
}

const isWin = process.platform === 'win32';
const site = `http://localhost:${serverPort}`;
/** Set CONTRAST_SCREENS to a folder to keep a screenshot of each look and size. */
const screens = process.env.CONTRAST_SCREENS;

const THEMES = [
  { name: 'default', query: '' },
  { name: 'flat', query: '?theme=flat' },
] as const;
const SIZES = [
  { name: '384', context: { viewport: { width: 384, height: 832 }, deviceScaleFactor: 2.8125, isMobile: true, hasTouch: true } },
  { name: 'desktop', context: { viewport: { width: 1440, height: 900 } } },
] as const;

interface Finding {
  what: string;
  text: string;
  color: string;
  background: string;
  ratio: number;
  needs: number;
}

/**
 * Runs in the page. Returns every text and glyph pair with its contrast ratio.
 * `glyphs` are selectors of control marks that carry meaning without text; they need 3 to 1.
 */
function measure(glyphs: string[]): Finding[] {
  type Rgba = [number, number, number, number];
  const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!probe) throw new Error('no 2d canvas');
  /** Any CSS color as sRGB bytes and alpha, read back from a canvas so every notation works. */
  const parse = (color: string): Rgba => {
    probe.clearRect(0, 0, 1, 1);
    probe.fillStyle = '#000';
    probe.fillStyle = color;
    probe.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = probe.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: Rgba, under: Rgba): Rgba => {
    const a = top[3] + under[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const mix = (i: 0 | 1 | 2) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
  };
  const luminance = ([r, g, b]: Rgba) => {
    const lin = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  };
  const ratio = (a: Rgba, b: Rgba) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const show = ([r, g, b]: Rgba) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  const gradientColors = (image: string) => image.match(/(?:rgba?|hsla?|color)\([^()]*\)|#[0-9a-f]{3,8}\b/gi) ?? [];

  /**
   * The backgrounds an element's content can sit on. Walks up until a layer is opaque. A gradient
   * gives one candidate for each of its colors, so the worst one counts.
   */
  const backgroundsOf = (el: Element): Rgba[] => {
    const layers: Rgba[][] = [];
    let opaque = false;
    for (let node: Element | null = el; node && !opaque; node = node.parentElement) {
      const style = getComputedStyle(node);
      let color = parse(style.backgroundColor);
      // A pill drawn by a pseudo-element behind the element's text counts as its background.
      for (const pseudo of ['::before', '::after']) {
        const drawn = getComputedStyle(node, pseudo);
        if (drawn.content !== 'none' && drawn.position === 'absolute' && Number(drawn.zIndex) < 0)
          color = over(parse(drawn.backgroundColor), color);
      }
      const stops = style.backgroundImage.includes('gradient(') ? gradientColors(style.backgroundImage).map(parse) : [];
      const options = stops.length > 0 ? stops.map((stop) => over(stop, color)) : [color];
      if (options.some((o) => o[3] > 0)) layers.push(options);
      opaque = options.every((o) => o[3] === 1);
    }
    // Under everything is the browser's canvas: white, or black when the page asks for a dark scheme.
    const scheme = getComputedStyle(document.documentElement).colorScheme;
    let candidates: Rgba[] = [scheme.includes('dark') && !scheme.includes('light') ? [0, 0, 0, 1] : [255, 255, 255, 1]];
    for (const options of layers.reverse()) candidates = options.flatMap((o) => candidates.map((under) => over(o, under)));
    return candidates;
  };

  const opacityOf = (el: Element) => {
    let opacity = 1;
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  };
  const visible = (el: Element) => {
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return false;
    const style = getComputedStyle(el);
    if (style.visibility !== 'visible' || style.display === 'none') return false;
    if (el.closest('.sr-only')) return false;
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node instanceof HTMLDetailsElement && !node.open && !el.closest('summary')) return false;
    }
    return opacityOf(el) > 0.01;
  };
  const disabled = (el: Element) => el.closest(':disabled, [aria-disabled="true"]') !== null;
  const name = (el: Element) => {
    const parts: string[] = [];
    for (let node: Element | null = el; node && parts.length < 4 && node !== document.body; node = node.parentElement) {
      const cls = typeof node.className === 'string' && node.className.trim() ? `.${node.className.trim().split(/\s+/).join('.')}` : '';
      parts.unshift(`${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${cls}`);
    }
    return parts.join(' > ');
  };

  const findings: Finding[] = [];
  const record = (el: Element, what: string, text: string, color: Rgba, needs: number) => {
    const opacity = opacityOf(el);
    let worst: { ratio: number; background: Rgba; drawn: Rgba } | null = null;
    for (const background of backgroundsOf(el)) {
      const drawn = over([color[0], color[1], color[2], color[3] * opacity], background);
      const r = ratio(drawn, background);
      if (!worst || r < worst.ratio) worst = { ratio: r, background, drawn };
    }
    if (!worst) return;
    findings.push({
      what,
      text,
      color: show(worst.drawn),
      background: show(worst.background),
      ratio: Math.round(worst.ratio * 100) / 100,
      needs,
    });
  };

  // Text: every element that holds a text node of its own.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set<Element>();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    if (!el || seen.has(el) || !node.textContent?.trim()) continue;
    seen.add(el);
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || !visible(el) || disabled(el)) continue;
    const style = getComputedStyle(el);
    const size = Number.parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    record(el, name(el), node.textContent.trim().slice(0, 40), parse(style.color), large ? 3 : 4.5);
  }
  // Typed text and placeholders in fields.
  for (const input of document.querySelectorAll('input:not([type="checkbox"]):not([type="radio"])')) {
    if (!(input instanceof HTMLInputElement) || !visible(input) || disabled(input)) continue;
    record(input, `${name(input)} (value)`, input.value.slice(0, 40) || '(empty)', parse(getComputedStyle(input).color), 4.5);
    if (input.placeholder) {
      record(input, `${name(input)} (placeholder)`, input.placeholder, parse(getComputedStyle(input, '::placeholder').color), 4.5);
    }
  }
  // Glyphs: the mark's own fill against what's behind it.
  for (const selector of glyphs) {
    for (const el of document.querySelectorAll(selector)) {
      if (!visible(el) || disabled(el) || !el.parentElement) continue;
      // A mark with an outline is seen by its outline; one without, by its fill.
      const style = getComputedStyle(el);
      const outlined = Number.parseFloat(style.borderTopWidth) >= 1 && parse(style.borderTopColor)[3] > 0;
      const fill = parse(outlined ? style.borderTopColor : style.backgroundColor);
      if (fill[3] === 0) continue;
      const opacity = opacityOf(el);
      let worst: { ratio: number; background: Rgba; drawn: Rgba } | null = null;
      for (const background of backgroundsOf(el.parentElement)) {
        const drawn = over([fill[0], fill[1], fill[2], fill[3] * opacity], background);
        const r = ratio(drawn, background);
        if (!worst || r < worst.ratio) worst = { ratio: r, background, drawn };
      }
      if (worst) {
        findings.push({
          what: `${name(el)} (glyph)`,
          text: selector,
          color: show(worst.drawn),
          background: show(worst.background),
          ratio: Math.round(worst.ratio * 100) / 100,
          needs: 3,
        });
      }
    }
  }
  return findings;
}

/** Control marks with no text: the dot beside the here-now count, and a switch's track and knob. */
const GLYPHS = ['.dot', '.switch-knob', '.switch-track'];

/** Runs in the page before its own code. Takes WebGPU and WebGL away, so the page shows its text-only fallback. */
const NO_3D = `
  Object.defineProperty(navigator, 'gpu', { value: undefined });
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    return String(type).startsWith('webgl') ? null : getContext.call(this, type, ...rest);
  };
`;

let server: ChildProcess | null = null;
let browser: Browser;

test.before(async () => {
  if (!(await serverIsUp())) {
    server = spawn('npm', ['run', 'dev:server'], {
      cwd: app,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: !isWin,
      shell: isWin,
      env: { ...process.env, NODE_OPTIONS: '', DEV_PORT: String(serverPort) },
    });
    server.unref();
    await sleep(2000);
  }
  await waitForServer();
  // The flags let headless Chromium use a GPU when the machine has one. Without one the page draws its fallback, and the test still reads the page around it.
  browser = await chromium.launch({
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--ignore-gpu-blocklist'],
  });
  if (screens) mkdirSync(screens, { recursive: true });
});

test.after(async () => {
  await browser?.close();
  if (server?.pid) {
    try {
      if (isWin) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
      else process.kill(-server.pid, 'SIGTERM');
    } catch {}
  }
});

/** Wait for the first 3D frame, or for the fallback the page shows when it can't draw one. */
async function settled(page: Page) {
  const drawn = (timeout: number) =>
    page.waitForFunction(
      () => (window as { __firstFrame?: number }).__firstFrame !== undefined || document.querySelector('.scene-failed') !== null,
      undefined,
      { timeout },
    );
  try {
    await drawn(45_000);
  } catch {
    // The first load of a dev server that just started can stall while Vite compiles the page and
    // reloads it. One reload gets a compiled page; a second stall is a failure.
    await page.reload();
    await drawn(90_000);
  }
  await page.waitForTimeout(1500);
}

async function below(page: Page, step: string): Promise<string[]> {
  // Let fades and the pieces' landing finish, so no text is caught half transparent.
  await page.waitForTimeout(2500);
  const findings = await page.evaluate(measure, GLYPHS);
  assert.ok(findings.length > 20, `${step}: expected the page's text, found ${findings.length} pairs`);
  return findings
    .filter((f) => f.ratio < f.needs)
    .map((f) => `${step}: ${f.what} "${f.text}" is ${f.color} on ${f.background}, ${f.ratio.toFixed(2)} to 1, needs ${f.needs}`);
}

for (const theme of THEMES) {
  for (const size of SIZES) {
    test(`contrast: ${theme.name} look at ${size.name}: every text and background pair meets WCAG AA`, async () => {
      const context = await browser.newContext(size.context);
      // tsx compiles this file with esbuild, which wraps each named function in a helper called __name. The page needs one too.
      await context.addInitScript('globalThis.__name = (fn) => fn;');
      try {
        const failures: string[] = [];
        const page = await context.newPage();
        await page.goto(`${site}/${theme.query}`);
        await settled(page);
        assert.strictEqual(
          await page.evaluate(() => document.documentElement.dataset.theme ?? null),
          theme.name === 'flat' ? 'flat' : null,
        );
        failures.push(...(await below(page, 'empty plate, locked')));

        // Two bricks on the plate, one of them the custom Block: its panel and the label on its plate show.
        await page.locator('nav.tray [data-block="kvstore"]').click();
        await page.locator('nav.tray [data-block="housebucket"]').click();
        await page.locator('[data-testid="make-it-yours"]').waitFor();
        failures.push(...(await below(page, 'two bricks, locked')));
        if (screens) await page.screenshot({ path: join(screens, `${theme.name}-${size.name}-1.png`), fullPage: size.name === '384' });

        // Tap the first brick's tile again, which opens or closes it: the other of the two states, with a
        // resource's label over the stage and the brick's card, or with the bricks' own labels.
        await page.locator('nav.tray [data-block="kvstore"]').click();
        failures.push(...(await below(page, 'two bricks, first one toggled')));
        if (screens) await page.screenshot({ path: join(screens, `${theme.name}-${size.name}-2.png`), fullPage: size.name === '384' });

        // Unlocked: the agent box and Save show. The code goes in through the invite link and is never printed.
        const unlocked = await context.newPage();
        await unlocked.goto(`${site}/${theme.query}#code=${encodeURIComponent(localInviteCode())}`);
        await settled(unlocked);
        await unlocked.locator('[data-testid="invite-locked"]').waitFor({ state: 'detached', timeout: 15_000 });
        await unlocked.locator('nav.tray [data-block="housebucket"]').click();
        failures.push(...(await below(unlocked, 'unlocked')));

        // No 3D: the page as text. It's what a browser with no WebGPU and no WebGL gets, and its lists are the ones
        // the page falls back to when the scene fails, which software rendering on a CI machine can make it do.
        const plain = await context.newPage();
        await plain.addInitScript(NO_3D);
        await plain.goto(`${site}/${theme.query}`);
        await plain.locator('[data-static-standards]').waitFor();
        await plain.locator('[data-static-every] summary').click();
        await plain.locator('[data-arrangement]').first().waitFor();
        failures.push(...(await below(plain, 'text only')));
        if (screens) await plain.screenshot({ path: join(screens, `${theme.name}-${size.name}-3.png`), fullPage: true });

        assert.deepStrictEqual(failures, []);
      } finally {
        await context.close();
      }
    });
  }
}
