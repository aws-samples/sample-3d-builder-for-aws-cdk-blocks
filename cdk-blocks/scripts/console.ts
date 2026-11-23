// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openConsole } from 'aws-cdk-blocks/scripts';

const __dirname = dirname(fileURLToPath(import.meta.url));

openConsole({
  outputsFile: join(__dirname, '..', '..', '.cdk-blocks-sandbox', 'outputs.json'),
});
