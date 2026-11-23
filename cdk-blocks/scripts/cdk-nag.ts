// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

// Synthesizes this app with cdk-nag's AwsSolutions rules added as a validation plugin.
// Run it through `npm run nag`. It needs no AWS credentials and deploys nothing.
// The findings are printed and written to the validation report in the output folder.
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { blocksStack } from '../index.cdk.js';

const app = App.of(blocksStack);
if (!app) throw new Error('the Blocks stack has no CDK app above it');
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
