// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

export interface Resource {
  type: string;
  service: string;
  name: string;
  count: number;
  note?: string | null;
}

interface Supporting {
  type: string;
  count: number;
}

export interface Block {
  id: string;
  label: string;
  package: string;
  version: string;
  tagline: string;
  codeFile: string;
  importName: string;
  importFrom: string;
  code: string[];
  resources: Resource[];
  supporting: Supporting[];
  supportingCount: number;
  extraImports?: string[];
  note?: string | null;
  /** True for a custom Block: one a platform team wrote, not one that AWS provides. */
  custom?: boolean;
  /** The Block that AWS provides which a custom Block is built on. */
  builtOn?: string;
  /** The standards key the entry's counts and code were synthesized with (all on). */
  standardsKey?: string;
}

export interface BlocksData {
  readAt: string;
  repoCommit: string;
  umbrella: { name: string; version: string };
  caseNote: string;
  /** Resources in an app with no blocks. */
  baselineResources?: number;
  /** Arrangement key (block ids joined with "+", in `blocks` order) to the resources that arrangement adds, from real synths. */
  comboAdded?: Record<string, number>;
  blocks: Block[];
}
