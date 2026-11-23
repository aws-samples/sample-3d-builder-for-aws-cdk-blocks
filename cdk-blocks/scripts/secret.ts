// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { runSecretCli } from 'aws-cdk-blocks/scripts';

// `npm run secret -- set STRIPE_KEY sk_live_...`
// `npm run secret -- list`
// `npm run secret -- remove STRIPE_KEY`
runSecretCli(process.argv.slice(2)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
