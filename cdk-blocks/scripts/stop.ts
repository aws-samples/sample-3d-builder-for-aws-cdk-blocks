// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { runStopCli } from 'aws-cdk-blocks/scripts';

// Stop the local dev server this app started (`npm run dev`). SIGTERMs the
// recorded `tsx watch` supervisor by PID — never a name match like `pkill -f
// tsx`, which would also kill your own shell. Pass `--port <n>` for a non-
// default port.
await runStopCli();
