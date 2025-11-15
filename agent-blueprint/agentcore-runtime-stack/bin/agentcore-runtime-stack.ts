#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { AgentRuntimeStack } from '../lib/agent-runtime-stack'

const app = new cdk.App()

const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const environment = process.env.ENVIRONMENT || 'dev'
const awsRegion = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-2'
const awsAccount = process.env.AWS_ACCOUNT || process.env.CDK_DEFAULT_ACCOUNT

new AgentRuntimeStack(app, 'AgentRuntimeStack', {
  projectName,
  environment,
  env: {
    account: awsAccount,
    region: awsRegion,
  },
  description: `AgentCore Runtime Stack for ${projectName} (${environment})`,
  tags: {
    Project: projectName,
    Environment: environment,
    ManagedBy: 'CDK',
  },
})

app.synth()
