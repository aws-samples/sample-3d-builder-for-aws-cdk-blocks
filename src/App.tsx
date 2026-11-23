// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { api } from "cdk-blocks";
import { Component, lazy, type ReactNode, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_ON,
  type Build,
  CUSTOM_PIECE,
  type Featured,
  type GalleryEvent,
  type PieceId,
  type StandardId,
  sortPieces,
  standardsKeyOf,
  standardsOfKey,
} from "../cdk-blocks/shared";
import { AgentBox, type AgentView } from "./AgentBox";
import { dropInviteCode, errorText, isPieceId, keepInviteCode, sessionId, sharedBuildId, shareUrl, takeInviteCode } from "./backend";
import { ConnectionsPanel, focusText, LinkBar, NamesSwitch } from "./Connections";
import { buildSections, codeOf, customNoteFor, downloadText } from "./code";
import { carrierMarks, carrierMarksById, comboOf, countLine, type Focus, litEdges, pairTotal } from "./connections";
import { hasCustom, isLoaded, markText, partName, standardLabel, standardsEntry, toggled } from "./custom";
import { loadCustom } from "./custom-loader";
import { blockText, CUSTOM_LAYER_COLOR, colorOf, data, plural, resourceTotal, setBrickColors, stackTotal } from "./data";
import { Gallery } from "./Gallery";
import { probeGpu, type RendererInfo } from "./gpu";
import { HAS_ICONS, ICON_PAGE, ICON_RELEASE, leadColor } from "./icons";
import { MakeItYours } from "./MakeItYours";
import { CarrierList, CodeLines, CustomList, OutsideList, PlatformCode, ResourceList, SupportingList } from "./Mapping";
import { initialMode, NamingContext, type NamingMode, rememberMode, withNames } from "./naming";
import { RunsOn } from "./RunsOn";
import { StaticFallback } from "./StaticFallback";
import type { CustomTile } from "./scene/Stage";
import { useCoarsePointer, useReducedMotion } from "./useReducedMotion";
import { loadVariants, type Variants } from "./variants";

// The 3D scene (three, fiber, drei: about 1.3 MB) loads as its own chunk, so the shell paints first.
const Stage = lazy(() => import("./scene/Stage").then((m) => ({ default: m.Stage })));

/** What getApp() returns: where the backend runs and what this app's own synth holds. */
export type AppInfo = Awaited<ReturnType<typeof api.getApp>>;

class Boundary extends Component<{ fallback: (message: string) => ReactNode; children: ReactNode }, { error: string | null }> {
  override state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  override render() {
    return this.state.error !== null ? this.props.fallback(this.state.error) : this.props.children;
  }
}

const BACKEND_LABEL = { webgpu: "WebGPU", webgl2: "WebGL 2", none: "text only" } as const;
type Invite = "none" | "checking" | "ok";
type Here = { here: number; building: number };

const labelOf = (id: string) => data.blocks.find((b) => b.id === id)?.label ?? id;
const listOf = (ids: readonly string[]) => ids.map(labelOf).join(", ");

export function App() {
  const blocks = data.blocks;
  const reduced = useReducedMotion();
  const coarse = useCoarsePointer();
  const [on, setOn] = useState<string[]>(() => blocks.slice(0, 1).map((b) => b.id));
  const [open, setOpen] = useState<string | null>(null);
  // The custom Block's standards key. It only means something while the custom piece is on the plate,
  // and it can only leave all-on once that arrangement's standards data is loaded.
  const [standards, setStandards] = useState<string>(ALL_ON);
  const [customTick, setCustomTick] = useState(0);
  const [customError, setCustomError] = useState<string | null>(null);
  // What the visitor tapped on the plate or in the Connections list: a node or one link. Opening a piece focuses it.
  const [focus, setFocus] = useState<Focus>(null);
  const [mode, setMode] = useState<NamingMode>(() => initialMode());
  const [showConnections, setShowConnections] = useState(() => window.matchMedia("(min-width: 620px)").matches);
  const [showSupporting, setShowSupporting] = useState(false);
  const [probe, setProbe] = useState<RendererInfo | null>(null);
  const [renderer, setRenderer] = useState<RendererInfo | null>(null);
  const fresh = useRef<Set<string>>(new Set());
  // The backend adds to the builder and never gates it: if these calls fail, everything in the builder still works.
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);
  const [invite, setInvite] = useState<Invite>("none");
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [agent, setAgent] = useState<AgentView>({ status: "idle" });
  const [builds, setBuilds] = useState<Build[] | null>(null);
  const [featured, setFeatured] = useState<Featured | null>(null);
  const [featuredBuild, setFeaturedBuild] = useState<Build | null>(null);
  const [freshBuilds, setFreshBuilds] = useState<Set<string>>(new Set());
  const [here, setHere] = useState<Here | null>(null);
  const [joinEpoch, setJoinEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; key: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [variants, setVariants] = useState<Variants | null>(null);
  const session = useMemo(sessionId, []);
  const lastPick = useRef<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);

  /** Tell everyone: a short visible notice, and the same words in the aria-live region. */
  const say = useCallback((message: string, show = true) => {
    setStatus(message);
    if (!show) return;
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5000);
  }, []);

  /**
   * Put an arrangement on the plate: exactly these pieces, in the fixed order. A saved build with the
   * custom Block brings its standards; without them (an agent pick, a build saved earlier) the custom
   * Block starts with all four on. Standards other than all-on wait for that arrangement's data, so
   * the plate never shows one key's pieces with another key's numbers.
   */
  const arrange = useCallback(
    (ids: readonly string[], saved?: readonly string[]) => {
      const next = sortPieces(ids.filter(isPieceId));
      const key = saved && hasCustom(next) ? standardsKeyOf(saved) : ALL_ON;
      const apply = () => {
        setOn((prev) => {
          fresh.current = new Set(next.filter((id) => !prev.includes(id)));
          return next;
        });
        setStandards(key);
        setOpen(null);
        setFocus(null);
        setShowSupporting(false);
      };
      if (key === ALL_ON) apply();
      else loadCustom(next.join("+")).then(apply, (e: unknown) => say(`That build's standards didn't load: ${errorText(e)}`));
    },
    [say],
  );

  // The custom piece's data loads when the piece is on the plate: this arrangement's file, the piece
  // alone (for "on its own"), and the arrangements one piece away, so the next tap doesn't wait.
  const onKey = on.join("+");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `on` and `onKey` change together, and `on` is a new array on every render.
  useEffect(() => {
    if (!hasCustom(on)) return;
    let live = true;
    setCustomError(null);
    const bump = () => live && setCustomTick((n) => n + 1);
    loadCustom(onKey).then(bump, (e: unknown) => live && setCustomError(errorText(e)));
    loadCustom(CUSTOM_PIECE).then(bump, () => {});
    for (const b of data.blocks) {
      if (b.id === CUSTOM_PIECE) continue;
      const near = sortPieces((on.includes(b.id) ? on.filter((x) => x !== b.id) : [...on, b.id]).filter(isPieceId));
      void loadCustom(near.join("+")).catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [onKey]);

  const chooseNames = useCallback((next: NamingMode) => {
    setMode(next);
    rememberMode(next);
    setStatus(
      next === "generic" ? "Names are generic now. No AWS service is named." : "Names are exact now, as the synthesized template has them.",
    );
  }, []);

  // Look variants (src/variants.ts): the flat theme, when the address asks for it.
  useEffect(() => {
    let live = true;
    void loadVariants().then((v) => {
      if (!live || !v) return;
      if (v.bricks) setBrickColors(v.bricks);
      setVariants(v);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    api
      .getApp()
      .then((info) => live && setAppInfo(info))
      .catch((e: unknown) => live && setApiError(errorText(e)));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    probeGpu().then((p) => {
      if (!live) return;
      setProbe(p);
      if (p.backend === "none") {
        setRenderer(p);
        window.__renderer = p;
      }
    });
    return () => {
      live = false;
    };
  }, []);

  // Arrival: the invite code, if the link carried one (#code=...). It's checked with the server and never rendered.
  useEffect(() => {
    const found = takeInviteCode();
    if (!found) return;
    let live = true;
    setInvite("checking");
    api
      .checkInvite({ code: found })
      .then(({ ok }) => {
        if (!live) return;
        if (ok) {
          setCode(found);
          setInvite("ok");
        } else {
          dropInviteCode();
          setInvite("none");
          say("That invite link didn't match. You can still build and look around.");
        }
      })
      .catch(() => live && setInvite("none"));
    return () => {
      live = false;
    };
  }, [say]);

  // Arrival by share link (?b=<id>): load that build onto the plate.
  useEffect(() => {
    const id = sharedBuildId();
    if (!id) return;
    let live = true;
    api
      .getBuild({ id })
      .then((build) => {
        if (!live) return;
        arrange(build.blocks, build.standards);
        say(`Opened a shared build: ${listOf(build.blocks)}.`);
      })
      .catch((e: unknown) => live && say(`That share link didn't open: ${errorText(e)}`));
    return () => {
      live = false;
    };
  }, [arrange, say]);

  const reachable = appInfo !== null;
  const customOn = hasCustom(on);
  /** The standards key for lookups: only an arrangement with the custom piece has one. */
  const std = customOn ? standards : undefined;

  const loadGallery = useCallback(async () => {
    const g = await api.listGallery();
    setBuilds(g.builds);
    setFeatured(g.featured);
    setFeaturedBuild(g.featuredBuild);
  }, []);

  // The gallery, live. Subscribe first, wait until the server confirms, then load: the channel doesn't
  // buffer, so this order can't miss a build. Reload after a reconnect for the same reason. Created and
  // released inside the effect so StrictMode's extra mount doesn't leak a subscription.
  // biome-ignore lint/correctness/useExhaustiveDependencies: appInfo only supplies a limit here, and `reachable` is what starts the subscription. joinEpoch isn't read: bumping it joins again from scratch.
  useEffect(() => {
    if (!reachable) return;
    let cancelled = false;
    let sub: { unsubscribe: () => void; established: Promise<void> } | undefined;
    let retry: number | undefined;

    const onMessage = (event: GalleryEvent) => {
      if (event.type === "build") {
        const limit = appInfo?.limits.recentBuilds ?? 24;
        setBuilds((prev) => [event.build, ...(prev ?? []).filter((b) => b.id !== event.build.id)].slice(0, limit));
        setFreshBuilds((prev) => new Set(prev).add(event.build.id));
        window.setTimeout(() => {
          setFreshBuilds((prev) => {
            const next = new Set(prev);
            next.delete(event.build.id);
            return next;
          });
        }, 2400);
        setStatus(`A new build landed in the gallery: ${listOf(event.build.blocks)}.`);
      } else if (event.type === "presence") {
        setHere({ here: event.here, building: event.building });
      } else if (event.type === "featured") {
        setFeatured({ id: event.id, pickedAt: event.pickedAt });
        // The new pick may not be among the builds this page holds: load it with the list.
        loadGallery().catch(() => {});
      }
    };

    (async () => {
      try {
        const channel = await api.joinGallery();
        if (cancelled) return;
        sub = channel.subscribe({
          onMessage,
          onDisconnect: (reason) => {
            if (cancelled || reason === "client") return;
            // The stored tokens expired or retries ran out: join again from scratch.
            if (reason === "error") retry = window.setTimeout(() => setJoinEpoch((n) => n + 1), 3000);
          },
          onReconnect: () => {
            if (!cancelled) loadGallery().catch(() => {});
          },
        });
        await sub.established;
        if (cancelled) return;
        await loadGallery();
      } catch {
        if (cancelled) return;
        retry = window.setTimeout(() => setJoinEpoch((n) => n + 1), 3000);
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(retry);
      sub?.unsubscribe();
    };
  }, [reachable, loadGallery, joinEpoch]);

  // Here now: check in on arrival and every heartbeatSeconds while the page is visible, and again right
  // away when it becomes visible. A hidden or closed page stops checking in and drops out on its own.
  const heartbeatSeconds = appInfo?.limits.heartbeatSeconds;
  useEffect(() => {
    if (!heartbeatSeconds) return;
    let cancelled = false;
    const beat = () => {
      if (document.visibilityState !== "visible") return;
      api
        .heartbeat(code ? { session, code } : { session })
        .then((r) => {
          if (!cancelled) setHere({ here: r.here, building: r.building });
        })
        .catch(() => {});
    };
    beat();
    const timer = window.setInterval(beat, heartbeatSeconds * 1000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", beat);
    };
  }, [heartbeatSeconds, code, session]);

  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);

  const press = (id: string) => {
    setShowSupporting(false);
    if (!on.includes(id)) {
      fresh.current = new Set([id]);
      const next = sortPieces([...on, id].filter(isPieceId));
      // A custom Block placed by hand starts with all four standards on.
      const nextStd = id === CUSTOM_PIECE ? ALL_ON : std;
      const added = (comboOf(next, nextStd)?.K ?? 0) - (comboOf(on, std)?.K ?? 0);
      setOn(next);
      if (id === CUSTOM_PIECE) setStandards(ALL_ON);
      setFocus(null);
      say(`${labelOf(id)} snapped on. ${added} ${added === 1 ? "connection" : "connections"} added.`, false);
    } else {
      setOpen(open === id ? null : id);
      setFocus(open === id ? null : { kind: "node", id });
      if (open === id) say(`${labelOf(id)} closed.`, false);
      else {
        const lit = litEdges({ kind: "node", id }, on, std);
        const text = focusText({ kind: "node", id }, lit, on, mode);
        say(
          `${labelOf(id)} opened. Its ${mode === "exact" ? "AWS resources" : "resources"} are listed in the detail card. ${text ? `${text.title}. ${text.sentences.join(" ")} ${text.pairs.join(" ")}` : ""}`.trim(),
          false,
        );
      }
    }
  };
  /** A tap on a core socket, a shared part or a link, on the plate or in the Connections list. A second tap lets go. */
  const tapNode = (id: string) => {
    const same = focus?.kind === "node" && focus.id === id;
    const next: Focus = same ? null : { kind: "node", id };
    setOpen(null);
    setShowSupporting(false);
    setFocus(next);
    const text = focusText(next, litEdges(next, on, std), on, mode);
    say(text ? `${text.title}. ${text.sentences.join(" ")}` : "Nothing is lit now.", false);
  };
  const tapEdge = (id: string) => {
    const same = focus?.kind === "edge" && focus.id === id;
    const next: Focus = same ? null : { kind: "edge", id };
    setOpen(null);
    setShowSupporting(false);
    setFocus(next);
    const text = focusText(next, litEdges(next, on, std), on, mode);
    say(text ? `Connection lit. ${text.sentences.join(" ")}` : "Nothing is lit now.", false);
  };
  // On a phone the tray sits below the stage, so a brick opened from the tray can fly its icon
  // tiles out above the screen. Bring the stage back into view when that happens. With reduced
  // motion there are no tiles (the resources are a plain list), so nothing moves.
  useEffect(() => {
    if (!open || reduced) return;
    const scene = document.querySelector(".scene");
    if (!scene) return;
    const r = scene.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) scene.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [open, reduced]);
  // The agent box and the gallery sit below the stage on a phone. When either one changes what's on
  // the plate, bring the bricks back into view.
  const showStage = useCallback(() => {
    const scene = document.querySelector(".scene");
    if (!scene) return;
    const r = scene.getBoundingClientRect();
    if (r.top < -r.height * 0.3 || r.bottom > window.innerHeight + r.height * 0.3)
      scene.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }, []);
  const remove = (id: string) => {
    const next = on.filter((x) => x !== id);
    const gone = (comboOf(on, std)?.K ?? 0) - (comboOf(next, id === CUSTOM_PIECE ? undefined : std)?.K ?? 0);
    setOn(next);
    if (id === CUSTOM_PIECE) setStandards(ALL_ON);
    setOpen(null);
    setFocus(null);
    setShowSupporting(false);
    say(`${labelOf(id)} removed. ${gone} ${gone === 1 ? "connection" : "connections"} removed.`, false);
  };

  const onAgentView = useCallback(
    (view: AgentView) => {
      setAgent(view);
      if (view.status === "done" && view.pick && view.pick.blocks.length > 0) {
        arrange(view.pick.blocks);
        showStage();
        lastPick.current = view.pick.blocks.join("+");
        setStatus(
          `The Agent Block snapped on ${listOf(view.pick.blocks)}: ${view.pick.added} resources and ${view.pick.connections} connections.`,
        );
      } else if (view.status === "done") {
        setStatus("The Agent Block answered and picked no Blocks.");
      } else if (view.status === "failed") {
        setStatus(`The Agent Block failed: ${view.error}`);
      }
    },
    [arrange, showStage],
  );

  const unlock = async (e: React.FormEvent) => {
    e.preventDefault();
    const candidate = typed.trim();
    if (!candidate || invite === "checking") return;
    setInvite("checking");
    try {
      const { ok } = await api.checkInvite({ code: candidate });
      if (ok) {
        keepInviteCode(candidate);
        setCode(candidate);
        setInvite("ok");
        setTyped("");
        say("Unlocked. You can ask the Agent Block and save builds.");
      } else {
        setInvite("none");
        say("That code didn't match.");
      }
    } catch (err) {
      setInvite("none");
      say(`Couldn't check that code: ${errorText(err)}`);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `blocks` is the module's own list, named so the memo reads whole.
  const snapped = useMemo(() => on.map((id) => blocks.find((b) => b.id === id)!).filter(Boolean), [on, blocks]);
  // Every number and link below is a lookup for (arrangement, standards key). All-on reads the
  // arrangement's own entry; any other key reads that key's entry from the loaded file, and is null
  // (shown as loading) until the file is in. Nothing here falls back to another key's data.
  const customReady = customOn && isLoaded(onKey);
  const entry = customOn ? standardsEntry(onKey, standards) : null;
  // customTick counts loads of the custom piece's data; the lookups below read that data, so they're redone when it arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: customTick isn't read. It counts loads of the custom piece's data, which this lookup reads.
  const sections = useMemo(() => buildSections(snapped, std), [snapped, std, customTick]);
  const lineCount = snapped.reduce((n, b) => n + codeOf(b, std).length, 0);
  const total = customOn && standards !== ALL_ON ? pairTotal(on, standards) : stackTotal(on);
  const combo = comboOf(on, std);
  // A focus only counts while what it points at is on the plate.
  // biome-ignore lint/correctness/useExhaustiveDependencies: customTick isn't read. It counts loads of the custom piece's data, which this lookup reads.
  const lit = useMemo(() => litEdges(focus, on, std), [focus, on, std, customTick]);
  const liveFocus = focus && lit.length > 0 ? focus : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: customTick isn't read. It counts loads of the custom piece's data, which this lookup reads.
  const marks = useMemo(() => (open ? carrierMarks(open, on, mode, std) : new Map()), [open, on, mode, std, customTick]);
  const linkNumber = (edgeId: string) => lit.indexOf(edgeId) + 1;
  const count = countLine(on, total, lineCount, mode, std);
  // The open custom piece: its own resources for this standards key, each with its mark and its links.
  // biome-ignore lint/correctness/useExhaustiveDependencies: customTick isn't read. It counts loads of the custom piece's data, which this lookup reads.
  const customLinks = useMemo(
    () => (open === CUSTOM_PIECE ? carrierMarksById(CUSTOM_PIECE, on, mode, std) : new Map()),
    [open, on, mode, std, customTick],
  );
  // Tiles are for the piece's headline resources. Its two access policies are in the list, with their marks, like any supporting resource.
  // biome-ignore lint/correctness/useExhaustiveDependencies: customTick isn't read. It counts loads of the custom piece's data, which this lookup reads.
  const customTiles: CustomTile[] | null = useMemo(() => {
    const e = open === CUSTOM_PIECE && std ? standardsEntry(onKey, std) : null;
    return e
      ? e.resources
          .filter((r) => !r.type.endsWith("Policy"))
          .map((r) => ({ id: r.logicalId, type: r.type, part: partName(r), mark: markText(r), links: customLinks.get(r.logicalId) ?? [] }))
      : null;
  }, [open, onKey, std, customLinks, customTick]);
  const alone = standardsEntry(CUSTOM_PIECE, standards);

  /** A switch flip: move to that standards key, if its synth data is here, and say what changed. */
  const flip = (id: StandardId) => {
    const next = toggled(standards, id);
    if (!standardsEntry(onKey, next)) return;
    setStandards(next);
    setSaved(null);
    const lines = snapped.reduce((n, b) => n + codeOf(b, next).length, 0);
    const nowOn = (standardsOfKey(next) ?? []).includes(id);
    say(`${standardLabel(id)} ${nowOn ? "on" : "off"}. ${countLine(on, pairTotal(on, next), lines, mode, next).text}.`, false);
  };
  const partsSum = snapped.reduce((n, b) => n + resourceTotal(b), 0);
  const openBlock = blocks.find((b) => b.id === open) ?? null;
  const openIndex = openBlock ? blocks.indexOf(openBlock) : -1;
  const arrangementKey = on.join("+");

  const save = async () => {
    if (!code || saving || on.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      const source = lastPick.current === arrangementKey ? "agent" : "hand";
      const { id, listed } = await api.saveBuild({
        code,
        blocks: on as PieceId[],
        source,
        ...(customOn ? { standards: standardsOfKey(standards) ?? [] } : {}),
      });
      setSaved({ id, key: arrangementKey });
      setCopied(false);
      say(
        listed
          ? "Saved. The share link is ready, and the build is in the gallery."
          : "Saved. The share link is ready. The gallery was busy, so this build isn't listed there.",
      );
    } catch (e) {
      setSaved(null);
      setSaveError(errorText(e));
      setStatus(`Saving failed: ${errorText(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!saved) return;
    try {
      await navigator.clipboard.writeText(withNames(shareUrl(saved.id), mode));
      setCopied(true);
      say("Share link copied.", false);
    } catch {
      say("Couldn't copy. Select the link and copy it by hand.");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([downloadText(sections, customNoteFor(blocks))], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "index.ts";
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    say("Downloaded index.ts, built in this browser from the code panel.", false);
  };

  const variantLabels = variants?.labels.map((label) => (
    <p key={label} className="variant-label" data-testid="variant-label" role="note">
      {label}
    </p>
  ));

  // The title is a compact bar: the name, and how many pages are here now. The bricks come next.
  const header = (
    <header className="top">
      {variantLabels}
      <h1>
        Snap <span className="brand">AWS CDK Blocks</span> together
      </h1>
      {here && (
        <span
          className="tag tag-here"
          data-testid="here-now"
          data-here={here.here}
          data-building={here.building}
          title={`Pages open and on screen in the last ${appInfo?.limits.hereWindowSeconds ?? 45} seconds. Pages, not people.`}
        >
          <i className="dot" aria-hidden="true" />
          {here.here} here now
        </span>
      )}
    </header>
  );
  // What this is, in two sentences, and where it runs. It sits under the builder, not over it.
  const intro = (lede: ReactNode) => (
    <section className="intro" aria-label="What this page is">
      <p className="pitch">AWS capabilities as code you import. Best practices built in.</p>
      <p className="lede">{lede}</p>
      {appInfo && (
        <p className="pills">
          <span className={`tag tag-runtime is-${appInfo.runtime}`} data-testid="runtime">
            {appInfo.runtime === "local" ? "Running on this machine, no AWS account" : "Running on AWS, the same code"}
          </span>
        </p>
      )}
    </section>
  );
  const footer = (
    <footer className="foot">
      <details className="about">
        <summary>About the numbers</summary>
        <p>{data.caseNote}</p>
        {data.baselineResources !== undefined && (
          <p>
            An app with no Blocks already synthesizes {plural(data.baselineResources, "resource")}. The sockets in the plate stand for
            those: the shared role, the shared function, the config file and the API that every app starts with. The totals here count what
            the Blocks, the Hosting construct and the custom Block add on top. They share some resources, so a stack total can be smaller
            than its parts added up.
          </p>
        )}
        <p>
          A connection is one link the deployed app uses while it runs, read from the synthesized template: a permission, a config entry, an
          integration. Links that only order the deploy, deploy-time helpers and links inside the app core aren't counted. The count is
          looked up per arrangement, like the resource total.
        </p>
        <p>
          Every resource is CDK that you can audit and change. Platform developers can package their own standards as custom Blocks. The
          custom Block here, HouseBucket, is real code: every one of its 16 standards states was synthesized in every arrangement, and its
          marks (base, changed, added) compare it with a plain FileBucket synthesized the same way. It's a package in the app's workspace
          and isn't published.
        </p>
        <p>"Here now" counts pages open and on screen, not people. A saved build holds its Blocks and nothing about who saved it.</p>
        <p data-testid="questions-kept">
          A question you ask the agent is kept, with its answer, in the tables of the AWS account that runs this app. Don't put anything
          private in one.
        </p>
        {HAS_ICONS && (
          <p data-testid="icon-credit">
            The icons on the tiles are the official AWS Architecture Icons, release {ICON_RELEASE}, from {ICON_PAGE.replace("https://", "")}
            . Each one is drawn whole and unchanged.
          </p>
        )}
      </details>
      <p>
        Built with AWS CDK Blocks · {data.umbrella.name} {data.umbrella.version} · mapping read {data.readAt}
        {HAS_ICONS && ` · AWS Architecture Icons ${ICON_RELEASE}`}
      </p>
      {import.meta.env.PROD && (
        <p>
          <a className="foot-link" href="/THIRD-PARTY-LICENSES.txt" data-testid="third-party">
            Third-party licenses
          </a>
        </p>
      )}
      <p className="renderer" data-backend={appInfo?.runtime ?? (apiError ? "unreachable" : "loading")}>
        {appInfo
          ? `Backend: ${appInfo.runtime === "aws" ? "AWS" : "this machine"}`
          : apiError
            ? "Backend: not reachable. The builder works without it."
            : "Backend: checking"}
      </p>
      <p className="renderer" data-renderer>
        {renderer
          ? `Renderer: ${BACKEND_LABEL[renderer.backend]}${renderer.backend === "none" ? "" : ` · ${renderer.renderer}`}`
          : "Renderer: starting"}
      </p>
    </footer>
  );

  if (probe?.backend === "none") {
    return (
      <main className="app is-static">
        {header}
        {intro("What five Blocks, the Hosting construct and one custom Block build in AWS, and the TypeScript that asks for them.")}
        <NamingContext.Provider value={mode}>
          <StaticFallback data={data} reason="This browser has no WebGPU or WebGL, so the 3D builder can't run." onNames={chooseNames} />
        </NamingContext.Provider>
        {footer}
      </main>
    );
  }

  const localAgent = appInfo?.agent === "local-no-model";
  const savedHere = saved && saved.key === arrangementKey ? saved : null;

  // A share link carries the naming mode only as ?names=, so it opens the way it was saved.
  const shareLink = savedHere ? withNames(shareUrl(savedHere.id), mode) : "";

  return (
    <NamingContext.Provider value={mode}>
      <main
        className={`app${reduced ? " is-reduced" : ""}`}
        data-open={open ?? ""}
        data-on={on.join(" ")}
        data-invite={invite}
        data-names={mode}
      >
        {header}

        <Boundary
          fallback={(message) => (
            <div className="scene scene-failed">
              <StaticFallback data={data} reason={`The 3D scene failed to start (${message}).`} onNames={chooseNames} />
            </div>
          )}
        >
          {probe ? (
            <Suspense fallback={<div className="scene" data-scene-loading />}>
              <Stage
                blocks={blocks}
                on={on}
                open={open}
                reduced={reduced}
                coarse={coarse}
                preferWebGL={probe.backend === "webgl2"}
                probe={probe}
                palette={variants?.palette}
                ownLids={Boolean(variants?.bricks)}
                Relief={variants?.Relief}
                names={mode}
                edges={combo?.edgeIds ?? []}
                parts={combo?.nodes ?? []}
                lit={lit}
                focusNode={liveFocus?.kind === "node" ? liveFocus.id : null}
                marks={marks}
                linkNumber={linkNumber}
                customTiles={customTiles}
                onFocusNode={(id) => (isPieceId(id) ? press(id) : tapNode(id))}
                onFocusEdge={tapEdge}
                overlay={<NamesSwitch onChange={chooseNames} />}
                caption={
                  <p className="total" data-total data-count-line={on.length === 0 ? "" : count.text}>
                    {on.length === 0 ? (
                      <span className="total-main">Tap a brick to snap it on.</span>
                    ) : (
                      <span className="total-main">
                        {total !== null && (
                          <span className="total-part">
                            <b data-total-resources>{total}</b> {mode === "exact" ? "AWS " : ""}
                            {total === 1 ? "resource" : "resources"},
                          </span>
                        )}{" "}
                        <span className="total-part">
                          <b data-total-connections>{count.connections}</b> {count.connections === 1 ? "connection" : "connections"}
                        </span>{" "}
                        <span className="total-part">
                          from <b data-total-lines>{lineCount}</b> {lineCount === 1 ? "line" : "lines"} of TypeScript
                        </span>
                      </span>
                    )}
                  </p>
                }
                onPress={press}
                onRenderer={(info) => {
                  window.__renderer = info;
                  setRenderer(info);
                }}
              />
            </Suspense>
          ) : (
            <div className="scene" />
          )}
        </Boundary>

        <LinkBar focus={liveFocus} lit={lit} on={on} />

        <nav className="tray" aria-label="Five CDK Blocks, the Hosting construct and one custom Block you can snap on">
          {blocks.map((b, i) => {
            const isOn = on.includes(b.id);
            const isOpen = open === b.id;
            const chip = (
              <button
                key={b.id}
                type="button"
                className={`chip${isOn ? " is-on" : ""}${isOpen ? " is-open" : ""}${b.custom ? " is-custom" : ""}`}
                style={
                  {
                    "--brick": colorOf(i),
                    "--lid": variants?.bricks ? colorOf(i) : (leadColor(b) ?? colorOf(i)),
                    "--layer": CUSTOM_LAYER_COLOR,
                  } as React.CSSProperties
                }
                aria-pressed={isOn}
                aria-expanded={isOn ? isOpen : undefined}
                aria-controls={isOn ? "detail" : undefined}
                data-block={b.id}
                onClick={() => press(b.id)}
                // Start loading the custom piece's data when it's about to be placed.
                onPointerEnter={
                  b.custom ? () => void loadCustom(sortPieces([...on, b.id].filter(isPieceId)).join("+")).catch(() => {}) : undefined
                }
                onFocus={
                  b.custom ? () => void loadCustom(sortPieces([...on, b.id].filter(isPieceId)).join("+")).catch(() => {}) : undefined
                }
              >
                <span className="stud" aria-hidden="true" />
                <span className="chip-text">
                  <span className="chip-label">{b.label}</span>
                  <span className="chip-state">{isOpen ? "tap to close" : isOn ? "tap to open" : "tap to snap on"}</span>
                </span>
              </button>
            );
            // The custom Block sits apart from the six, under a heading that says whose it is.
            return b.custom ? (
              <div key={b.id} className="tray-custom" role="group" aria-labelledby="tray-custom-title">
                <p className="tray-custom-title" id="tray-custom-title">
                  Your custom Block
                  <span>built on {b.builtOn}</span>
                </p>
                {chip}
              </div>
            ) : (
              chip
            );
          })}
        </nav>

        <aside className="side">
          <section className="detail" id="detail">
            {openBlock ? (
              <div className="detail-card" style={{ "--brick": colorOf(openIndex) } as React.CSSProperties}>
                <div className="detail-head">
                  <h2>{openBlock.label}</h2>
                  <p className="pkg">
                    {openBlock.package} {openBlock.version}
                  </p>
                </div>
                <p className="tagline">{blockText(openBlock, mode).tagline}</p>
                {openBlock.custom && (
                  <p className="built-on" data-testid="built-on">
                    A custom Block: the <b>{openBlock.builtOn}</b> Block that AWS provides, with a platform team's standards on top.
                  </p>
                )}
                <p className="sum">
                  On its own: <b>{plural(codeOf(openBlock, std).length, "line")}</b> <span aria-hidden="true">→</span>
                  <span className="sr-only">creates</span>{" "}
                  <b>
                    {plural(
                      openBlock.custom && standards !== ALL_ON ? (alone?.resourcesAdded ?? 0) : resourceTotal(openBlock),
                      mode === "exact" ? "AWS resource" : "resource",
                    )}
                  </b>
                </p>
                {openBlock.custom && entry ? (
                  <>
                    <CustomList entry={entry} links={customLinks} linkNumber={linkNumber} />
                    <OutsideList entry={entry} />
                  </>
                ) : (
                  <>
                    <ResourceList block={openBlock} className={reduced ? "" : "sr-only"} withMore={!reduced} />
                    <CarrierList marks={marks} linkNumber={linkNumber} />
                  </>
                )}
                {!(openBlock.custom && standards !== ALL_ON) && blockText(openBlock, mode).note && (
                  <p className="block-note">{blockText(openBlock, mode).note}</p>
                )}
                <div className="detail-actions">
                  {openBlock.supportingCount > 0 && !(openBlock.custom && entry) && (
                    <button
                      type="button"
                      className="pill"
                      aria-expanded={showSupporting}
                      aria-controls="supporting"
                      onClick={() => setShowSupporting(!showSupporting)}
                    >
                      plus {plural(openBlock.supportingCount, "supporting resource")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="pill pill-quiet"
                    aria-label={`Remove ${openBlock.label}`}
                    onClick={() => remove(openBlock.id)}
                  >
                    Remove
                  </button>
                </div>
                {showSupporting && <SupportingList block={openBlock} id="supporting" marks={marks} linkNumber={linkNumber} />}
              </div>
            ) : null}
          </section>

          {customOn && <MakeItYours standards={standards} ready={customReady} error={customError} onFlip={flip} />}

          <section className="ask" aria-label="Ask the Agent Block">
            {!reachable ? (
              <p className="ask-off" data-testid="backend-off">
                {apiError
                  ? "The backend isn't reachable, so asking, saving and the gallery are off. The builder below works without it."
                  : "Checking the backend"}
              </p>
            ) : code ? (
              <>
                <AgentBox code={code} session={session} names={mode} onView={onAgentView} />
                {localAgent && (
                  <p className="ask-note" data-testid="agent-local-label">
                    Local implementation, no model. On this machine the Agent Block runs its real tool and always snaps the same fixed set.
                  </p>
                )}
              </>
            ) : (
              <form className="ask-locked" onSubmit={unlock} data-testid="invite-locked">
                <p>
                  <b>Describe your app</b> and the Agent Block snaps Blocks on. Asking and saving need the invite link.
                </p>
                <div className="ask-row">
                  <input
                    type="password"
                    autoComplete="off"
                    aria-label="Invite code"
                    placeholder="Invite code"
                    data-testid="invite-field"
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                  />
                  <button type="submit" className="btn" data-testid="invite-submit" disabled={invite === "checking" || !typed.trim()}>
                    Unlock
                  </button>
                </div>
              </form>
            )}
          </section>

          {agent.status !== "idle" && (
            <div className={`caption is-${agent.status}`} data-testid="agent-caption" data-status={agent.status}>
              {agent.status === "failed" ? (
                <p className="caption-error" role="alert" data-testid="agent-error">
                  <b>The Agent Block failed.</b> {agent.error}
                </p>
              ) : (
                <>
                  <p className="caption-text" data-testid="agent-answer">
                    <span className="caption-who">{localAgent ? "Agent Block, local implementation, no model" : "Agent Block"}</span>
                    {agent.text || (agent.status === "working" ? "Working" : "The Agent Block gave no text.")}
                    {agent.status === "working" && <span className="cursor" aria-hidden="true" />}
                  </p>
                  {agent.status === "done" &&
                    (agent.pick && agent.pick.blocks.length > 0 ? (
                      <p
                        className="caption-pick"
                        data-testid="agent-pick"
                        data-blocks={agent.pick.blocks.join(" ")}
                        data-added={agent.pick.added}
                        data-connections={agent.pick.connections}
                        data-conversation={agent.conversationId}
                      >
                        Snapped on: <b>{listOf(agent.pick.blocks)}</b>. {agent.pick.added}{" "}
                        {mode === "exact" ? "AWS resources" : "resources"} and {agent.pick.connections} connections, from the synth mapping.
                      </p>
                    ) : (
                      <p className="caption-pick" data-testid="agent-no-pick" data-conversation={agent.conversationId}>
                        No Blocks were picked, so the baseplate didn't change. This page has five Blocks, the Hosting construct and one
                        custom Block; the AWS CDK Blocks library has more Blocks than it shows.
                      </p>
                    ))}
                </>
              )}
            </div>
          )}

          {intro(
            <>
              <span className="lede-part">Five Blocks and the Hosting construct, and one custom Block.</span>{" "}
              <span className="lede-part">Tap one to snap it on. Tap again to open it.</span>
            </>,
          )}

          {reachable && (
            <section className="share" aria-label="Save and share this build">
              <div className="share-row">
                <button
                  type="button"
                  className="btn btn-save"
                  data-testid="save"
                  disabled={!code || saving || on.length === 0}
                  onClick={save}
                >
                  {saving ? "Saving" : savedHere ? "Saved" : "Save this build"}
                </button>
                {!code && <span className="share-hint">Saving needs the invite link.</span>}
                {code && !savedHere && (
                  <span className="share-hint">Saves the Blocks on the plate and gives you a link. No name, nothing about you.</span>
                )}
              </div>
              {savedHere && (
                <div className="share-row share-link">
                  <label className="sr-only" htmlFor="share-link">
                    Share link
                  </label>
                  <input
                    id="share-link"
                    type="text"
                    readOnly
                    value={shareLink}
                    data-testid="share-link"
                    data-build-id={savedHere.id}
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <button type="button" className="btn" data-testid="share-copy" onClick={copyLink}>
                    {copied ? "Copied" : "Copy link"}
                  </button>
                </div>
              )}
              {saveError && (
                <p className="share-error" role="alert" data-testid="save-error">
                  <b>Saving failed.</b> {saveError}
                </p>
              )}
            </section>
          )}

          {reachable && (
            <Gallery
              builds={builds}
              featured={featured}
              featuredBuild={featuredBuild}
              fresh={freshBuilds}
              colors={colorOf}
              onOpen={(b) => {
                arrange(b.blocks, b.standards);
                showStage();
                say(`Opened a saved build: ${listOf(b.blocks)}.`);
              }}
            />
          )}
          {total !== null && partsSum > total && <p className="total-note">Shared pieces are counted once.</p>}
          <ConnectionsPanel
            on={on}
            std={std}
            focus={liveFocus}
            lit={lit}
            open={showConnections}
            onToggle={setShowConnections}
            onNode={tapNode}
            onEdge={tapEdge}
          />

          <section className="code" aria-label="The TypeScript for this arrangement">
            <div className="code-head">
              <h2>The code</h2>
              <span>{plural(lineCount, "line")} + imports</span>
            </div>
            {sections.length === 0 && <p className="code-empty">{"// snap a brick on to see its code"}</p>}
            {customOn && (
              <h3 className="code-side" data-testid="code-side-app">
                What an app team writes
              </h3>
            )}
            {sections.map((s) => (
              <div className="file" key={s.file} data-testid="app-code">
                <p className="file-name">{s.file}</p>
                <CodeLines lines={s.lines} open={open} fresh={fresh.current} />
              </div>
            ))}
            {customOn && customReady && (
              <>
                <h3 className="code-side" data-testid="code-side-platform">
                  What the platform team writes once
                  <span>The custom Block's constructor. Lines a standard added or changed carry its name.</span>
                </h3>
                <PlatformCode standards={standards} />
              </>
            )}
            <div className="code-foot">
              <button type="button" className="btn btn-dark" data-testid="download" disabled={sections.length === 0} onClick={download}>
                Download index.ts
              </button>
            </div>
          </section>

          {appInfo && <RunsOn own={appInfo.own} />}

          {footer}
        </aside>

        <div className="toast-zone">
          {notice && (
            <p className="toast" data-testid="notice">
              {notice}
            </p>
          )}
        </div>
        <p className="sr-only" role="status" aria-live="polite" data-testid="live-status">
          {status}
        </p>
      </main>
    </NamingContext.Provider>
  );
}
