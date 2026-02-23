#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CodeAgentRuntimeStack } from '../lib/code-agent-runtime-stack';

const app = new cdk.App();

const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot';
const environment = process.env.ENVIRONMENT || 'dev';
const awsRegion = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-2';
const awsAccount = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const anthropicModel = process.env.ANTHROPIC_MODEL || 'us.anthropic.claude-sonnet-4-6';

new CodeAgentRuntimeStack(app, 'CodeAgentRuntimeStack', {
  projectName,
  environment,
  anthropicModel,
  env: {
    account: awsAccount,
    region: awsRegion,
  },
  description: 'Code Agent A2A Runtime on AWS Bedrock AgentCore',
});

app.synth();
