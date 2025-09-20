#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatbotStack } from '../lib/chatbot-stack';
import { CognitoAuthStack } from '../lib/cognito-auth-stack';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load config.json
const configPath = join(__dirname, '..', 'config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

const app = new cdk.App();

// Get deployment region from environment variable or use default
const deploymentRegion = process.env.AWS_REGION || config.defaultRegion;

// Check if Cognito should be enabled (via environment variable)
const enableCognito = process.env.ENABLE_COGNITO === 'true';

// Validate region is supported
if (!config.supportedRegions.includes(deploymentRegion)) {
  console.error(`❌ Unsupported region: ${deploymentRegion}`);
  console.error(`✅ Supported regions: ${config.supportedRegions.join(', ')}`);
  process.exit(1);
}

console.log(`🚀 Deploying to region: ${deploymentRegion}`);
console.log(`🔐 Cognito authentication: ${enableCognito ? 'ENABLED' : 'DISABLED'}`);

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: deploymentRegion,
};

// Deploy Cognito stack first if enabled
let cognitoProps = {};
let cognitoStack: CognitoAuthStack | undefined;

if (enableCognito) {
  cognitoStack = new CognitoAuthStack(app, 'CognitoAuthStack', { env });

  cognitoProps = {
    enableCognito: true,
    userPoolId: cdk.Fn.importValue('CognitoAuthStack-UserPoolId'),
    userPoolClientId: cdk.Fn.importValue('CognitoAuthStack-UserPoolClientId'),
    userPoolDomain: cdk.Fn.importValue('CognitoAuthStack-UserPoolDomain'),
  };
}

// Deploy main Chatbot stack
const chatbotStack = new ChatbotStack(app, 'ChatbotStack', {
  env,
  ...cognitoProps,
});

// Add explicit dependency if Cognito is enabled
if (enableCognito && cognitoStack) {
  chatbotStack.addDependency(cognitoStack);
}
