// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { createLambdaHandler } from 'aws-cdk-blocks/lambda-handler';
import { logRefusalsAsWarnings, skipScheduledRunsUntilConfigIsReady, treatClosedConnectionsAsExpected } from './handler-guards.js';

// Refused requests log at warn, a scheduled run waits quietly for the config, and a page that left isn't a fault. See handler-guards.ts.
logRefusalsAsWarnings();

const whenConfigIsReady = skipScheduledRunsUntilConfigIsReady(createLambdaHandler(() => import('./index.js')));
export const handler = treatClosedConnectionsAsExpected(whenConfigIsReady);
