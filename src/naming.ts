// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createContext, useContext } from "react";
import { isNamingMode, NAMING_MODES, type NamingMode } from "../cdk-blocks/shared";
import raw from "./data/naming.json";

// Two ways to name what the pieces build. "Generic" never names an AWS service: it uses the category
// words in naming.json. "Exact" shows what the synth shows. Counts, structure and links are the same
// in both; only names change. Every label comes from naming.json, a byte copy of the analysis output.
export { NAMING_MODES, type NamingMode };

interface TypeName {
  exact: string;
  generic: string;
}
const table = raw as unknown as {
  default: NamingMode;
  types: Record<string, TypeName>;
  nodes: Record<string, TypeName>;
  edgeSentences: Record<string, TypeName>;
};

export const DEFAULT_MODE: NamingMode = table.default;
const STORE_KEY = "baseplate:names";
const PARAM = "names";

/** The mode a page starts in: the link's ?names= parameter, else what this browser chose last, else Generic. */
export function initialMode(search = window.location.search): NamingMode {
  const fromLink = new URLSearchParams(search).get(PARAM);
  if (isNamingMode(fromLink)) return fromLink;
  try {
    const saved = window.localStorage.getItem(STORE_KEY);
    if (isNamingMode(saved)) return saved;
  } catch {
    // Storage can be blocked. The default still applies.
  }
  return DEFAULT_MODE;
}

/** Remember the mode in this browser, and keep a ?names= parameter in the address bar in step if the link has one. */
export function rememberMode(mode: NamingMode): void {
  try {
    window.localStorage.setItem(STORE_KEY, mode);
  } catch {
    // Not remembered; the switch still works for this visit.
  }
  const url = new URL(window.location.href);
  if (url.searchParams.has(PARAM)) {
    url.searchParams.set(PARAM, mode);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}

/** A link carries the mode only as ?names=generic or ?names=exact. */
export function withNames(url: string, mode: NamingMode): string {
  const u = new URL(url);
  u.searchParams.set(PARAM, mode);
  return u.toString();
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const noArticle = (s: string) => s.replace(/^(a|an|the) /, "");

/** The name of a resource type. Null when naming.json has no row for it. */
export function typeName(type: string, mode: NamingMode): string | null {
  const row = table.types[type];
  return row ? row[mode] : null;
}
/** A resource type's name as a label: no leading article, first letter capital. */
export function typeLabel(type: string, mode: NamingMode): string {
  const name = typeName(type, mode);
  return name ? upperFirst(noArticle(name)) : type;
}

/** A node's name in a sentence ("the app's shared role"). Pieces keep their Block names in both modes. */
export function nodeName(id: string, mode: NamingMode): string {
  return table.nodes[id]?.[mode] ?? id;
}
/**
 * A node's short label for the plate: the name with "the app's" or "the" taken off the front and
 * anything in brackets left out. The full name is in the Connections list.
 */
export function nodeLabel(id: string, mode: NamingMode): string {
  return upperFirst(
    nodeName(id, mode)
      .replace(/^the app's /, "")
      .replace(/^the /, "")
      .replace(/ \(.*\)$/, ""),
  );
}

/** The plain-words sentence for one connection. */
export function sentenceOf(edgeId: string, mode: NamingMode): string {
  return table.edgeSentences[edgeId]?.[mode] ?? edgeId;
}

// A word that names an AWS service. Generic naming mode shows no text that matches it: a resource's
// note from the synth mapping is left out when it names one.
export const SERVICE_WORD =
  /\b(DynamoDB|Aurora|RDS|Cognito|Bedrock|AgentCore|S3|CloudFront|CloudWatch|CloudFormation|Lambda|IAM|KMS|SNS|SQS|API Gateway|Secrets Manager|Step Functions|EventBridge|Systems Manager|SSM|VPC|EC2|X-Ray|Resource Groups)\b/;

export const NamingContext = createContext<NamingMode>(DEFAULT_MODE);
export const useNaming = () => useContext(NamingContext);
