#!/usr/bin/env node
/**
 * CDK App Entry Point for AgentCore Gateway Stack
 * Deploys Gateway + Lambda + Targets in correct order
 */
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { GatewayIamStack } from '../lib/iam-stack'
import { GatewayStack } from '../lib/gateway-stack'
import { LambdaStack } from '../lib/lambda-stack'
import { GatewayTargetStack } from '../lib/gateway-target-stack'

const app = new cdk.App()

// ============================================================
// Environment Configuration
// ============================================================

const projectName = process.env.PROJECT_NAME || 'strands-agent-chatbot'
const environment = process.env.ENVIRONMENT || 'dev'
const awsRegion = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-west-2'
const awsAccount = process.env.CDK_DEFAULT_ACCOUNT

const env = {
  account: awsAccount,
  region: awsRegion,
}

console.log(`🚀 Deploying AgentCore Gateway Stack`)
console.log(`   Project: ${projectName}`)
console.log(`   Environment: ${environment}`)
console.log(`   Region: ${awsRegion}`)
console.log(`   Account: ${awsAccount || 'default'}`)

// ============================================================
// Stack Deployment Order
// ============================================================

// Step 1: IAM Roles and Secrets
const iamStack = new GatewayIamStack(app, `${projectName}-GatewayIamStack`, {
  stackName: `${projectName}-gateway-iam`,
  description: 'IAM roles and secrets for AgentCore Gateway',
  projectName,
  env,
  tags: {
    Project: projectName,
    Environment: environment,
    Component: 'Gateway-IAM',
    ManagedBy: 'CDK',
  },
})

// Step 2: Gateway (depends on IAM)
const gatewayStack = new GatewayStack(app, `${projectName}-GatewayStack`, {
  stackName: `${projectName}-gateway`,
  description: 'AgentCore Gateway with MCP protocol and AWS_IAM authorization',
  projectName,
  environment,
  gatewayRole: iamStack.gatewayRole,
  env,
  tags: {
    Project: projectName,
    Environment: environment,
    Component: 'Gateway',
    ManagedBy: 'CDK',
  },
})
gatewayStack.addDependency(iamStack)

// Step 3: Lambda Functions (depends on Gateway for permissions)
const lambdaStack = new LambdaStack(app, `${projectName}-GatewayLambdaStack`, {
  stackName: `${projectName}-gateway-lambdas`,
  description: 'Lambda functions for AgentCore Gateway MCP tools',
  projectName,
  lambdaRole: iamStack.lambdaRole,
  gatewayArn: gatewayStack.gatewayArn,
  tavilyApiKeySecret: iamStack.tavilyApiKeySecret,
  googleCredentialsSecret: iamStack.googleCredentialsSecret,
  googleMapsCredentialsSecret: iamStack.googleMapsCredentialsSecret,
  env,
  tags: {
    Project: projectName,
    Environment: environment,
    Component: 'Gateway-Lambda',
    ManagedBy: 'CDK',
  },
})
lambdaStack.addDependency(gatewayStack)

// Step 4: Gateway Targets (connects Lambda to Gateway)
const targetStack = new GatewayTargetStack(app, `${projectName}-GatewayTargetStack`, {
  stackName: `${projectName}-gateway-targets`,
  description: 'Gateway Targets connecting Lambda functions to AgentCore Gateway',
  gateway: gatewayStack.gateway,
  functions: lambdaStack.functions,
  env,
  tags: {
    Project: projectName,
    Environment: environment,
    Component: 'Gateway-Targets',
    ManagedBy: 'CDK',
  },
})
targetStack.addDependency(lambdaStack)

// ============================================================
// App-level Tags
// ============================================================

cdk.Tags.of(app).add('Project', projectName)
cdk.Tags.of(app).add('Environment', environment)
cdk.Tags.of(app).add('ManagedBy', 'CDK')

app.synth()
