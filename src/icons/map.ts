// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import type { NamingMode } from "../../cdk-blocks/shared";
import type { Block } from "../types";
import raw from "./atlas-map.json";

// The icon map and lookups, with no image import, so the tests and the backend can load this file.
// Every icon is an official AWS Architecture Icon, drawn whole and unchanged into its atlas cell by
// a build step that isn't in this repository. This folder is the only place the icons live: see
// its README.md for where they come from and how to run the page without them.
export interface IconEntry {
  /** "service" and "group" icons are a filled square with a white glyph; "resource" icons are a colored glyph on clear. */
  kind: "service" | "resource" | "group" | "category";
  /** The icon's own fill color, read from its SVG: the AWS category color. */
  color: string;
  /** Top-left pixel of the cell in the atlas image. */
  px: [number, number];
  /** [u0, v0, u1, v1] for a three.js texture with flipY = true. */
  uv: [number, number, number, number];
  label: string;
  /** True when the package has no icon for the type and its service's icon stands in. */
  fallback?: boolean;
  /** Generic naming mode: the key of the official AWS category icon that stands in, where this icon is a service's own mark. */
  generic?: string;
}

const map = raw as unknown as {
  release: string;
  page: string;
  atlas: { width: number; height: number; cell: number };
  types: Record<string, IconEntry>;
};

export const ICON_RELEASE = map.release;
/** False when the atlas map holds no icons: every tile then shows as text and the bricks keep their own colors. */
export const HAS_ICONS = Object.keys(map.types).length > 0;
export const ICON_PAGE = map.page;
/** The atlas image's size and cell size. The image itself is imported in icons.ts, which only the page loads. */
export const ATLAS_SIZE = map.atlas;

// A type with no icon of its own uses its service's icon when the map names one for that service.
// Anything else shows as text with no icon. We never draw an icon of our own.
const SERVICE_ICON: Record<string, string> = {
  ApiGateway: "AWS::ApiGatewayV2::Api",
  ApiGatewayV2: "AWS::ApiGatewayV2::Api",
  CloudFront: "AWS::CloudFront::Distribution",
  CloudWatch: "AWS::CloudWatch::Dashboard",
  CloudFormation: "AWS::CloudFormation::CustomResource",
  Cognito: "AWS::Cognito::UserPool",
  IAM: "service:IAM",
  Lambda: "service:Lambda",
  KMS: "AWS::KMS::Key",
  SecretsManager: "AWS::SecretsManager::Secret",
  StepFunctions: "AWS::StepFunctions::StateMachine",
  BedrockAgentCore: "AWS::BedrockAgentCore::Runtime",
  AppSync: "service:AppSync",
};

/**
 * The icon for a CloudFormation type: its own, or its service's, or null (text only). In Generic
 * naming mode an icon that is a service's own mark gives way to the official AWS category icon for
 * that service's category (the atlas map names which), so the picture doesn't name the service.
 * Either way the icon is an official one, drawn whole and unchanged.
 */
export function iconFor(
  type: string,
  mode: NamingMode = "exact",
): (IconEntry & { via: "type" | "service" | "category"; key: string }) | null {
  const own = map.types[type];
  const [vendor, service] = type.split("::");
  const serviceKey = vendor === "AWS" ? SERVICE_ICON[service ?? ""] : undefined;
  const key = own ? type : serviceKey;
  const found = key ? map.types[key] : undefined;
  if (!found || !key) return null;
  if (mode === "generic" && found.generic && map.types[found.generic])
    return { ...map.types[found.generic], via: "category", key: found.generic };
  return { ...found, via: own ? "type" : "service", key };
}

/** The AWS category color of a Block's lead service: its first headline resource's icon color. */
export function leadColor(block: Block): string | null {
  const first = block.resources[0];
  return first ? (iconFor(first.type)?.color ?? null) : null;
}
