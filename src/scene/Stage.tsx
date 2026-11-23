// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { OrbitControls } from "@react-three/drei";
import { addAfterEffect, Canvas, useFrame, useThree } from "@react-three/fiber";
import { easing } from "maath";
import { type ComponentType, type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import * as THREE from "three/webgpu";
import type { NamingMode, PieceId } from "../../cdk-blocks/shared";
import type { Mark } from "../connections";
import { BRICK, CUSTOM_LAYER_COLOR, CUSTOM_PLATE_COLOR, colorOf, headline, TEAM_LABEL } from "../data";
import { type RendererInfo, webglRendererString } from "../gpu";
import { leadColor } from "../icons";
import { type HudLayout, hudLayout } from "../layout";
import { typeLabel } from "../naming";
import { centerOf, freeStuds, LABEL_ANCHOR, LINK_PATH, offerSlots, PIECE_SLOT, PLATE, PLATE_CENTER_X, type Rect } from "../plate";
import type { Block } from "../types";
import type { ReliefProps, Variants } from "../variants";
import { Brick, LIFT } from "./Brick";
import { FOV, fitShot, plateBox, type Shot, stageShot, VIEW } from "./camera";
import { Pieces } from "./Pieces";
import { RoundBox } from "./RoundBox";
import { atlasTexture } from "./shapes";
import { CoreSockets, Links, NodeChips, SharedParts } from "./Wiring";

/** A soft contact shadow under the baseplate, drawn once into a small canvas. */
function makeBlob(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 30, 128, 128, 128);
  grad.addColorStop(0, "rgba(40,32,20,0.42)");
  grad.addColorStop(0.6, "rgba(40,32,20,0.26)");
  grad.addColorStop(0.85, "rgba(40,32,20,0.05)");
  grad.addColorStop(1, "rgba(40,32,20,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

function Plate({ color = "#2c3957", studColor = "#35456b" }: { color?: string; studColor?: string }) {
  const studs = useRef<THREE.InstancedMesh>(null);
  const blob = useMemo(makeBlob, []);
  // The plate and the tray swap every time the plate empties or gets its first brick. Free the shadow texture each time.
  useEffect(() => () => blob.dispose(), [blob]);
  // Studs only where the plate is bare: none under a slot, a socket, a shared part or a link's channel.
  const spots = useMemo(() => freeStuds(), []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    spots.forEach(([x, z], n) => {
      m.setPosition(x, 0.08, z);
      studs.current?.setMatrixAt(n, m);
    });
    if (studs.current) studs.current.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <group>
      <RoundBox
        args={[PLATE.w, PLATE.h, PLATE.d]}
        radius={0.16}
        smoothness={4}
        position={[PLATE_CENTER_X, -PLATE.h / 2, 0]}
        receiveShadow
        castShadow
      >
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.02} />
      </RoundBox>
      <instancedMesh ref={studs} args={[undefined, undefined, spots.length]} receiveShadow>
        <cylinderGeometry args={[0.25, 0.25, 0.16, 28]} />
        <meshStandardMaterial color={studColor} roughness={0.45} metalness={0.02} />
      </instancedMesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[PLATE_CENTER_X + 0.25, -PLATE.h - 0.02, 0.35]}>
        <planeGeometry args={[PLATE.w * 1.26, PLATE.d * 1.42]} />
        <meshBasicMaterial map={blob} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * What the bricks stand on while nothing is snapped on: a plate just big enough for the seven of
 * them side by side. The real baseplate, with its sockets, takes its place when the first brick lands.
 */
function OfferTray({ slots, color = "#2c3957" }: { slots: Rect[]; color?: string }) {
  const blob = useMemo(makeBlob, []);
  useEffect(() => () => blob.dispose(), [blob]);
  const x0 = Math.min(...slots.map((r) => r.x0)) - 0.6;
  const x1 = Math.max(...slots.map((r) => r.x1)) + 0.6;
  const z0 = Math.min(...slots.map((r) => r.z0)) - 0.6;
  const z1 = Math.max(...slots.map((r) => r.z1)) + 0.6;
  return (
    <group position={[(x0 + x1) / 2, 0, (z0 + z1) / 2]}>
      <RoundBox args={[x1 - x0, PLATE.h, z1 - z0]} radius={0.16} smoothness={4} position={[0, -PLATE.h / 2, 0]} receiveShadow castShadow>
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.02} />
      </RoundBox>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.2, -PLATE.h - 0.02, 0.3]}>
        <planeGeometry args={[(x1 - x0) * 1.26, (z1 - z0) * 1.42]} />
        <meshBasicMaterial map={blob} transparent depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Lights() {
  const { gl, scene } = useThree();
  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl as unknown as THREE.WebGPURenderer);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    return () => {
      scene.environment = null;
      env.dispose();
      pmrem.dispose();
    };
  }, [gl, scene]);
  return (
    <>
      <hemisphereLight args={["#fff6e6", "#b9a98f", 0.7]} />
      <directionalLight
        position={[-7, 14, 8]}
        intensity={2.1}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
        shadow-camera-near={1}
        shadow-camera-far={50}
        shadow-bias={-0.0006}
        shadow-radius={5}
      />
    </>
  );
}

/** A tinted footprint on the plate where a block that isn't snapped on yet will go. Tapping it snaps the block on. */
function Footprint({ color, slot, onPress }: { color: string; slot: [number, number]; onPress: () => void }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a three.js object, not a DOM element. The same action is on a button in the tray.
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[slot[0], 0.02, slot[1]]}
      onClick={(e) => {
        e.stopPropagation();
        if (e.delta > 6) return;
        onPress();
      }}
    >
      <planeGeometry args={[BRICK.w, BRICK.d]} />
      <meshBasicMaterial color={color} transparent opacity={0.62} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

interface RigProps {
  elevation: number;
  shot: Shot;
  /** How far out a pinch or the wheel can go: far enough to see the whole plate. */
  farthest: number;
  reduced: boolean;
  coarse: boolean;
  resetKey: number;
}

function Rig({ elevation, shot, farthest, reduced, coarse, resetKey }: RigProps) {
  const { camera, gl, invalidate } = useThree();
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const moving = useRef(false);
  const first = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey isn't read. A new value means "fly back to the shot".
  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    if (first.current || reduced) {
      first.current = false;
      camera.position.copy(shot.position);
      c.target.copy(shot.target);
      c.update();
      moving.current = false;
      invalidate();
    } else {
      moving.current = true;
    }
    window.__toy = { camera, controls: c };
  }, [shot, reduced, resetKey, camera, invalidate]);

  useEffect(() => {
    // Phones: a sideways swipe orbits, a vertical swipe scrolls the page, a pinch zooms.
    gl.domElement.style.touchAction = coarse ? "pan-y" : "none";
  });

  useFrame((_, dt) => {
    const c = controls.current;
    if (!c || !moving.current) return;
    const a = easing.damp3(camera.position, shot.position, 0.22, dt);
    const b = easing.damp3(c.target, shot.target, 0.22, dt);
    if (!a && !b) moving.current = false;
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping={!reduced}
      dampingFactor={0.12}
      rotateSpeed={0.7}
      // Fixed limits, so a re-fit glides instead of being clamped: in as close as one brick filling the stage, out to the whole plate.
      minDistance={6}
      maxDistance={farthest}
      minPolarAngle={coarse ? Math.PI / 2 - elevation : 0.35}
      maxPolarAngle={coarse ? Math.PI / 2 - elevation : 1.45}
      onStart={() => (moving.current = false)}
    />
  );
}

function FirstFrame() {
  const gl = useThree((s) => s.gl) as unknown as { getMaxAnisotropy?: () => number };
  // Start loading the icon atlas with the scene, so the tiles have their icons when the first brick opens.
  useEffect(() => void atlasTexture(gl.getMaxAnisotropy?.() ?? 1), [gl]);
  useEffect(() => {
    const stop = addAfterEffect(() => {
      if (window.__firstFrame === undefined) window.__firstFrame = performance.now();
      stop();
    });
    return stop;
  }, []);
  return null;
}

interface StageProps {
  blocks: Block[];
  on: string[];
  open: string | null;
  reduced: boolean;
  coarse: boolean;
  preferWebGL: boolean;
  onPress: (id: string) => void;
  onRenderer: (info: RendererInfo) => void;
  probe: RendererInfo;
  /** From a look variant (src/variants.ts): plate and stud colors. Usually not set. */
  palette?: Variants["palette"];
  /** True when a look variant replaced the brick colors: the lids then follow the bricks. */
  ownLids?: boolean;
  /** From a look variant: draws a tile's face in place of the atlas texture. Usually not set. */
  Relief?: ComponentType<ReliefProps> | null;
  /** Generic or Exact names, for the tile labels, the node chips and which icon a tile carries. */
  names: NamingMode;
  /** Edge ids of the arrangement on the plate, and the shared parts it has, from connections.json. */
  edges: readonly string[];
  parts: readonly string[];
  /** Edge ids lit by what the visitor tapped, and the node that's tapped, if it's a node. */
  lit: readonly string[];
  focusNode: string | null;
  /** For the open piece: resource type to the links it carries, and each lit link's number in the list under the scene. */
  marks: Map<string, Mark[]>;
  linkNumber: (edgeId: string) => number;
  onFocusNode: (id: string) => void;
  onFocusEdge: (id: string) => void;
  /** HTML drawn over the scene's bottom left corner: the naming switch. */
  overlay?: ReactNode;
  /** HTML drawn over the scene's top left corner: the count line, as a small caption. */
  caption?: ReactNode;
  /**
   * The custom piece's tiles for the standards key on screen: one per headline resource of the piece,
   * each with its mark (base, changed or added) and the links it carries, from the synth data. Null
   * while that data loads; the open custom piece then shows its all-on headline with no marks.
   */
  customTiles?: CustomTile[] | null;
}

export interface CustomTile {
  /** The resource's logical id in the template. */
  id: string;
  type: string;
  /** Which part of the Block it is, in a few words. */
  part: string;
  mark: { kind: "base" | "changed" | "added"; text: string };
  links: Mark[];
}

export function Stage({
  blocks,
  on,
  open,
  reduced,
  coarse,
  preferWebGL,
  onPress,
  onRenderer,
  probe,
  palette,
  ownLids,
  Relief,
  names,
  edges,
  parts,
  lit,
  focusNode,
  marks,
  linkNumber,
  onFocusNode,
  onFocusEdge,
  overlay,
  caption,
  customTiles,
}: StageProps) {
  // Body colors stay the builder's own. The lid and the footprint take the AWS category color of the Block's lead service.
  const bodyColor = colorOf;
  const lidColor = (i: number) => (ownLids ? colorOf(i) : (leadColor(blocks[i]) ?? colorOf(i)));
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [resetKey, setResetKey] = useState(0);
  // The fanned-out pieces linger for a moment after a fold so they can fly back in.
  const [hudId, setHudId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (reduced) return setHudId(null);
    if (open) return setHudId(open);
    const t = setTimeout(() => setHudId(null), 320);
    return () => clearTimeout(t);
  }, [open, reduced]);

  const fanned = !reduced && open !== null;
  const phone = size.w < 620;
  const hudBlock = blocks.find((b) => b.id === hudId) ?? null;
  // The custom piece's tiles come from its standards data, one per resource, so two buckets with
  // different marks are two tiles. Every other piece's tiles are its headline types from blocks.json.
  const tiles = hudBlock?.custom && customTiles ? customTiles : null;
  const resources = useMemo(
    () => (tiles ? tiles.map((t) => ({ type: t.type, service: "", name: "", count: 1 })) : hudBlock ? headline(hudBlock) : []),
    [tiles, hudBlock],
  );
  const marked = tiles ? tiles.some((t) => t.links.length > 0) : resources.some((r) => marks.has(r.type));
  // Room under each tile: a custom tile has its part name, its type and its mark (a boxed line, so it counts for two), then the link line.
  const markLines = (tiles ? 2 : 0) + (marked ? 1 : 0);
  const layout: HudLayout = useMemo(
    () => hudLayout(size.w || 1, size.h || 1, resources.length, markLines),
    [size, resources.length, markLines],
  );

  // For browser checks: the master layout the scene draws from.
  useEffect(() => {
    window.__plate = { slots: PIECE_SLOT, anchors: LABEL_ANCHOR, paths: LINK_PATH };
  }, []);

  // Nothing snapped on: the seven bricks stand side by side, large, and a tap snaps one on.
  const offering = on.length === 0;
  const offer = useMemo(() => offerSlots(phone ? 2 : 4), [phone]);
  const rectOf = (id: string): Rect => (offering ? offer : PIECE_SLOT)[id as PieceId];
  const placeOf = (id: string): [number, number] => centerOf(rectOf(id));
  // For the tools: where each brick stands right now.
  useEffect(() => {
    window.__brickRects = offering ? offer : PIECE_SLOT;
  }, [offering, offer]);

  const view = phone ? VIEW.phone : VIEW.desktop;
  const onKey = on.join("+");
  const edgeKey = edges.join("|");
  const partKey = parts.join("|");
  const litKey = lit.join("|");
  // The camera frames the bricks, not the plate (stageShot in camera.ts).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the keys stand for the lists. A new array with the same ids isn't a new shot.
  const shot = useMemo(
    // With reduced motion an open brick's resources are a plain list and the camera stays where it is, so its lit links don't re-frame.
    () =>
      stageShot({
        w: size.w || 384,
        h: size.h || 500,
        on,
        parts,
        edges,
        lit: reduced && open ? [] : lit,
        fanned: fanned ? open : null,
        hudBottom: layout.bottom,
      }),
    [size, fanned, layout.bottom, onKey, edgeKey, partKey, litKey, open, reduced],
  );
  // Pinch or wheel out as far as the whole plate.
  const farthest = useMemo(
    () => fitShot(size.w || 384, size.h || 500, { top: 0, bottom: size.h || 500 }, plateBox(1.3), view).distance * 1.15,
    [size, view],
  );

  const origin = useMemo(() => {
    const [x, z] = hudBlock ? centerOf(PIECE_SLOT[hudBlock.id as PieceId]) : [0, 0];
    return new THREE.Vector3(x, LIFT + BRICK.body, z);
  }, [hudBlock]);

  return (
    <div
      className={`scene${offering ? " is-offering" : ""}`}
      ref={box}
      data-testid="stage"
      data-offering={offering ? "" : undefined}
      data-crowded={on.length > 3 ? "" : undefined}
    >
      {size.w > 0 && (
        <Canvas
          role="img"
          aria-label="The baseplate and its bricks in 3D. Every action here is also a button in the list of pieces below."
          shadows
          dpr={[1, 2]}
          frameloop={reduced ? "demand" : "always"}
          camera={{ fov: FOV, near: 0.5, far: 400, position: [-8, 12, 20] }}
          gl={async (props) => {
            const renderer = new THREE.WebGPURenderer({
              canvas: props.canvas as HTMLCanvasElement,
              antialias: true,
              alpha: true,
              forceWebGL: preferWebGL,
            });
            await renderer.init();
            renderer.setClearColor(0x000000, 0);
            const isGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;
            let name = probe.renderer;
            if (!isGPU) {
              const gl = (renderer.backend as unknown as { gl?: WebGL2RenderingContext }).gl;
              if (gl) name = webglRendererString(gl);
            }
            onRenderer({ backend: isGPU ? "webgpu" : "webgl2", renderer: name });
            return renderer as never;
          }}
          onCreated={({ gl }) => {
            // No tone mapping. This renderer applies tone mapping to the whole frame in its output pass,
            // where a material's `toneMapped={false}` has no say: with NeutralToneMapping the
            // CloudFront icon's #8C4FFF reached the screen as #8041F1. With it off, an icon drawn by a
            // basic material comes out at its exact hex.
            gl.toneMapping = THREE.NoToneMapping;
          }}
        >
          <FirstFrame />
          <Lights />
          {offering ? (
            <OfferTray slots={Object.values(offer)} color={palette?.plate} />
          ) : (
            <>
              <Plate color={palette?.plate} studColor={palette?.studs} />
              <CoreSockets onFocus={onFocusNode} />
              <SharedParts present={parts} onFocus={onFocusNode} />
            </>
          )}
          {/* The chips stay mounted and step out while the bricks are on offer: unmounting an HTML label mid-render makes React log an error. */}
          <NodeChips parts={parts} names={names} focus={focusNode} quiet={fanned || offering} />
          <Links present={edges} lit={lit} reduced={reduced} onFocus={onFocusEdge} />
          {blocks.map((b, i) => (
            <Brick
              key={b.id}
              label={b.label}
              color={bodyColor(i)}
              lidColor={lidColor(i)}
              slot={placeOf(b.id)}
              on={offering || on.includes(b.id)}
              open={open === b.id}
              reduced={reduced}
              showTag={!fanned || open === b.id}
              onPress={() => onPress(b.id)}
              custom={b.custom ? { layerColor: CUSTOM_LAYER_COLOR, plateColor: CUSTOM_PLATE_COLOR, label: TEAM_LABEL } : null}
            />
          ))}
          {!offering &&
            blocks.map((b, i) =>
              on.includes(b.id) ? null : (
                <Footprint key={b.id} color={lidColor(i)} slot={centerOf(PIECE_SLOT[b.id as PieceId])} onPress={() => onPress(b.id)} />
              ),
            )}
          {hudBlock && (
            <Pieces
              key={hudBlock.id}
              resources={resources}
              origin={origin}
              layout={layout}
              show={open === hudBlock.id}
              Relief={Relief}
              names={names}
            />
          )}
          <Rig elevation={view.elevation} shot={shot} farthest={farthest} reduced={reduced} coarse={coarse} resetKey={resetKey} />
        </Canvas>
      )}
      {hudBlock && (
        <div className={`hud${open === hudBlock.id ? " is-shown" : ""}`} aria-hidden="true">
          {resources.map((r, i) => {
            const slot = layout.items[i];
            const tile = tiles?.[i];
            if (tile)
              return (
                <div
                  key={tile.id}
                  className="hud-item"
                  data-tile={tile.id}
                  data-mark={tile.mark.kind}
                  style={{ left: slot.cx, top: slot.cy, width: layout.cellW - 6, "--d": `${620 + i * 90}ms` } as React.CSSProperties}
                >
                  <span className="hud-label" style={{ top: layout.labelTop }}>
                    <b>{tile.part}</b>
                    <span>{typeLabel(tile.type, names)}</span>
                    {/* The mark: base, changed or added, and what caused it. A line under the name, outside the icon's box. */}
                    <span className={`hud-mark is-${tile.mark.kind}`}>{tile.mark.text}</span>
                    {tile.links.length > 0 && (
                      <span className="hud-link" data-edges={tile.links.map((m) => m.edgeId).join(" ")}>
                        {tile.links.length === 1 ? "link" : "links"} {tile.links.map((m) => linkNumber(m.edgeId)).join(" ")}
                      </span>
                    )}
                  </span>
                </div>
              );
            return (
              <div
                key={`${r.type}:${i}`}
                className="hud-item"
                style={{ left: slot.cx, top: slot.cy, width: layout.cellW - 6, "--d": `${620 + i * 90}ms` } as React.CSSProperties}
              >
                {r.count > 1 && (
                  <span className="hud-count" style={{ left: `calc(50% + ${layout.piece * 0.3}px)`, top: -layout.piece / 2 }}>
                    ×{r.count}
                  </span>
                )}
                <span className="hud-label" style={{ top: layout.labelTop }}>
                  {names === "exact" ? (
                    <>
                      <b>{r.service}</b>
                      <span>{r.name}</span>
                    </>
                  ) : (
                    <b>{typeLabel(r.type, names)}</b>
                  )}
                  {/* The mark that this resource carries links. It's a line under the name, outside the icon's box. */}
                  {marks.has(r.type) && (
                    <span
                      className="hud-link"
                      data-edges={marks
                        .get(r.type)!
                        .map((m) => m.edgeId)
                        .join(" ")}
                    >
                      {marks.get(r.type)!.length === 1 ? "link" : "links"}{" "}
                      {marks
                        .get(r.type)!
                        .map((m) => linkNumber(m.edgeId))
                        .join(" ")}
                    </span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {caption && <div className="scene-caption">{caption}</div>}
      {overlay && <div className="scene-overlay">{overlay}</div>}
      <button type="button" className="reset-view" aria-label="Recenter the view on the bricks" onClick={() => setResetKey((k) => k + 1)}>
        <span>Recenter</span>
      </button>
    </div>
  );
}
