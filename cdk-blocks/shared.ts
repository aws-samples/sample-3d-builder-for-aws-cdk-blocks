// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

/**
 * Shared by the backend (cdk-blocks/index.ts), the frontend (src/) and the
 * tests: the seven piece ids, the four standards of the custom Block, every limit, and the Zod schemas for API input,
 * stored values and gallery events. No Node-only imports here, so the browser
 * bundle can use it.
 */
import { z } from 'zod';

// ─── The pieces in the builder ───────────────────────────────────────────────
// Fixed order: it's the order of blocks.json and of the "+"-joined keys in
// combos.json. Five Blocks, the Hosting construct and one custom Block.
export const PIECE_IDS = ['kvstore', 'database', 'auth', 'agent', 'realtime', 'hosting', 'housebucket'] as const;
export type PieceId = (typeof PIECE_IDS)[number];
export const pieceIdSchema = z.enum(PIECE_IDS);

/** Dedupe and put ids in the fixed order, so one arrangement has one spelling. */
export function sortPieces(ids: readonly PieceId[]): PieceId[] {
  return PIECE_IDS.filter((id) => ids.includes(id));
}

// ─── Naming mode ─────────────────────────────────────────────────────────────
// "generic" never names an AWS service; "exact" shows what the synth shows.
// The page sends its mode with each agent question.
export const NAMING_MODES = ['generic', 'exact'] as const;
export type NamingMode = (typeof NAMING_MODES)[number];
export const namingModeSchema = z.enum(NAMING_MODES);
export const isNamingMode = (v: unknown): v is NamingMode => v === 'generic' || v === 'exact';

/** The combos.json key for an arrangement. */
export const comboKey = (ids: readonly PieceId[]) => sortPieces(ids).join('+');

// ─── The custom Block's standards ────────────────────────────────────────────
// The custom piece is HouseBucket, a custom Block built on FileBucket. A platform
// team's four standards can each be on or off in the builder. A standards key is
// the on ids joined with "+" in this order, or "none": 16 keys, each one a real
// synth. A test ties these ids to custom.json.
export const CUSTOM_PIECE = 'housebucket' satisfies PieceId;
export const STANDARD_IDS = ['key', 'retention', 'logging', 'tags'] as const;
export type StandardId = (typeof STANDARD_IDS)[number];
const standardIdSchema = z.enum(STANDARD_IDS);
export const ALL_ON = STANDARD_IDS.join('+');

/** The standards key for a set of ids: fixed order, no repeats, "none" when empty. */
export function standardsKeyOf(ids: readonly string[]): string {
  const on = STANDARD_IDS.filter((id) => ids.includes(id));
  return on.length === 0 ? 'none' : on.join('+');
}
/** The ids a standards key holds. Null when it isn't one of the 16 keys. */
export function standardsOfKey(key: string): StandardId[] | null {
  if (key === 'none') return [];
  const ids = key.split('+');
  return standardsKeyOf(ids) === key && ids.length === new Set(ids).size ? (ids as StandardId[]) : null;
}
/** All 16 keys, "none" first, in the order custom.json lists them. */
export const STANDARDS_KEYS: string[] = Array.from({ length: 1 << STANDARD_IDS.length }, (_, bits) =>
  standardsKeyOf(STANDARD_IDS.filter((_id, i) => bits & (1 << i))),
);

/** The standards a saved build stores: a subset of the four ids, no repeats. */
const standardsSchema = z
  .array(standardIdSchema)
  .max(STANDARD_IDS.length)
  .refine((ids) => new Set(ids).size === ids.length, { message: 'A standard is listed twice.' });

// ─── Limits ──────────────────────────────────────────────────────────────────
export const SAVES_PER_MINUTE = 60;
export const SAVES_PER_DAY = 500;
export const ASKS_PER_SESSION_PER_DAY = 10;
export const ASKS_PER_DAY = 200;
/** New agent conversations a day, across everyone. Each one is a row in the Agent Block's table. */
export const CONVERSATIONS_PER_DAY = 1000;
export const JOINS_PER_MINUTE = 120;
export const MAX_HERE = 200;
export const HEARTBEAT_SECONDS = 15;
export const HERE_WINDOW_SECONDS = 45;
export const RECENT_BUILDS = 24;
export const MAX_QUESTION_LENGTH = 300;
export const MAX_WHY_LENGTH = 200;
export const PROPOSAL_TTL_SECONDS = 3600;
/**
 * The agent's model on Amazon Bedrock: Claude Haiku 5.5, through its global inference profile.
 * Bedrock serves this model on demand only through an inference profile, never by its bare model id.
 */
export const AGENT_MODEL_ID = 'global.anthropic.claude-haiku-5-5';
/**
 * Output tokens for one model call. Claude Haiku 5.5 thinks before it answers and the thinking
 * counts toward this cap, so the cap leaves room for both: on this agent's prompts a call used up
 * to about 360 tokens. A cap that's too low ends a call before its tool call.
 */
export const AGENT_MAX_TOKENS = 1000;
export const AGENT_MAX_LLM_CALLS = 4;
export const AGENT_MAX_TOOL_ITERATIONS = 4;

// The API's request limits. API Gateway applies the throttle to all callers together.
export const API_RATE_LIMIT = 25;
export const API_BURST_LIMIT = 50;
/** The request-volume alarm: about a third of what the throttle lets through. */
export const API_REQUESTS_ALARM = { requests: 2500, minutes: 5 };
/** With the opt-in WAF: requests one client address may make in five minutes. An open page makes about 20. */
export const WAF_REQUESTS_PER_ADDRESS = 300;

/** CloudWatch namespace for the app's own metrics (index.cdk.ts alarms on it). */
export const METRICS_NAMESPACE = 'Baseplate';
export const GALLERY_SNAPSHOT_PATH = 'gallery/latest.json';

/**
 * The AWS Architecture Icons release the icon tiles come from, read from the
 * atlas map (through src/icons/map.ts, the one module that reads it), so the page and
 * the backend can't disagree about which release is on the tiles.
 */
export { ICON_RELEASE } from '../src/icons/map';

/**
 * Read again, once, when the first read came back empty. DynamoDB reads here are eventually
 * consistent, so a read right after the write it depends on can miss it.
 */
export async function readAgain<T>(read: () => Promise<T>, missing: (value: T) => boolean, waitMs = 300): Promise<T> {
  const first = await read();
  if (!missing(first)) return first;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  return read();
}

// ─── Stored values ───────────────────────────────────────────────────────────
export const BUILD_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC 4648 base32, lowercase
export const BUILD_ID_LENGTH = 10;
export const buildIdSchema = z.string().regex(/^[a-z2-7]{10}$/);

const buildSourceSchema = z.enum(['hand', 'agent']);

/** Standards belong to the custom piece: a build without it can't carry them. */
const standardsNeedThePiece = (v: { blocks: readonly string[]; standards?: readonly string[] }) =>
  v.standards === undefined || v.blocks.includes(CUSTOM_PIECE);
const standardsMessage = { message: 'Standards can be saved only with the custom Block.' };

/**
 * A saved arrangement. No visitor text: a build shows as its Blocks. A build with the custom Block
 * also holds which of its standards are on. A build saved before the custom Block existed has no
 * `standards` field and still parses; with the piece on and no field, every standard is on.
 */
export const buildSchema = z
  .object({
    id: buildIdSchema,
    blocks: z.array(pieceIdSchema).min(1).max(PIECE_IDS.length),
    source: buildSourceSchema,
    createdAt: z.string(),
    standards: standardsSchema.optional(),
  })
  .refine(standardsNeedThePiece, standardsMessage);
export type Build = z.infer<typeof buildSchema>;

export const recentSchema = z.array(buildIdSchema).max(RECENT_BUILDS);
export const featuredSchema = z.object({ id: buildIdSchema, pickedAt: z.string() });
export type Featured = z.infer<typeof featuredSchema>;

/** The agent's validated pick for one conversation. */
export const proposalSchema = z.object({
  blocks: z.array(pieceIdSchema).max(PIECE_IDS.length),
  why: z.string().max(MAX_WHY_LENGTH),
  at: z.string(),
});

/** What the CronJob writes to the FileBucket at GALLERY_SNAPSHOT_PATH. */
export const gallerySnapshotSchema = z.object({
  version: z.literal(1),
  writtenAt: z.string(),
  hash: z.string(),
  featured: featuredSchema.nullable(),
  builds: z.array(buildSchema),
});
export type GallerySnapshot = z.infer<typeof gallerySnapshotSchema>;

// ─── Gallery channel events (server to browser only) ─────────────────────────
export const galleryEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('build'), build: buildSchema }),
  z.object({ type: z.literal('presence'), here: z.number().int(), building: z.number().int() }),
  z.object({ type: z.literal('featured'), id: buildIdSchema, pickedAt: z.string() }),
]);
export type GalleryEvent = z.infer<typeof galleryEventSchema>;

// ─── API input ───────────────────────────────────────────────────────────────
// Every secret-bearing argument is an object field named `code`: the local dev
// server logs RPC arguments and redacts by field name.
const code = z.string().min(1).max(200);
const session = z.uuid();
const conversationId = z.uuid();

export const codeInputSchema = z.object({ code });
export const heartbeatInputSchema = z.object({ session, code: code.optional() });
export const getBuildInputSchema = z.object({ id: buildIdSchema });
export const saveBuildInputSchema = z
  .object({
    code,
    blocks: z.array(pieceIdSchema).min(1).max(PIECE_IDS.length),
    source: buildSourceSchema,
    standards: standardsSchema.optional(),
  })
  .refine(standardsNeedThePiece, standardsMessage);
export const createConversationInputSchema = z.object({ code, session });
export const agentChannelInputSchema = z.object({ code, session, channelId: conversationId });
export const agentStreamInputSchema = z.object({
  code,
  session,
  message: z.string().trim().min(1).max(MAX_QUESTION_LENGTH),
  conversationId,
  /** The page's naming mode. Left out, it's "generic". */
  names: namingModeSchema.optional(),
});
export const getProposalInputSchema = z.object({ conversationId });

// ─── The app's own synth (cdk-blocks/own-synth.json) ─────────────────────────
/** Written by `npm run own-synth` from this app's own `cdk synth`. */
export interface OwnSynth {
  /** Block kinds constructed in cdk-blocks/index.ts. Three KVStore stores count as one kind. */
  blockKinds: number;
  blocks: { kind: string; ids: string[] }[];
  /**
   * The Block kinds above that come from a package in this app's workspace, not from AWS, with the
   * Blocks each one constructs inside itself (read from the package's CDK entry).
   */
  customBlocks: { kind: string; package: string; ids: string[]; inside: { kind: string; ids: string[] }[] }[];
  /** Hosting is a construct, not a Block, so it's counted apart. */
  hostingConstruct: boolean;
  resourceCount: number;
  resourcesByType: Record<string, number>;
  packages: Record<string, string>;
}
