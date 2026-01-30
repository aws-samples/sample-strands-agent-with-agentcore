#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ChatbotStack } from '../lib/chatbot-stack';
import { CognitoAuthStack } from '../lib/cognito-auth-stack';
import { SsoMonitoringStack } from '../lib/sso-monitoring-stack';
import { LambdaEdgeUsEast1Stack } from '../lib/lambda-edge-us-east-1-stack';
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
let cognitoProps: any = {};
let cognitoStack: CognitoAuthStack | undefined;

// Check if SSO should be enabled (via environment variable) - needed for Cognito stack
const enableSso = process.env.ENABLE_SSO === 'true';
const ssoLoginUrl = process.env.SSO_LOGIN_URL;

// CloudFront URL for callback URLs (hardcoded for now, could be made configurable)
const cloudFrontUrl = 'https://d1ystqalgm445b.cloudfront.net';

if (enableCognito) {
  // Path to SAML metadata file
  const samlMetadataPath = enableSso ? join(__dirname, '..', 'saml-metadata.xml') : undefined;
  
  cognitoStack = new CognitoAuthStack(app, 'CognitoAuthStack', { 
    env,
    enableSso: enableSso,
    samlMetadataPath: samlMetadataPath,
    cloudFrontUrl: cloudFrontUrl,
    environment: 'dev',
  });

  cognitoProps = {
    enableCognito: true,
    userPoolId: cdk.Fn.importValue('CognitoAuthStack-UserPoolId'),
    userPoolClientId: cdk.Fn.importValue('CognitoAuthStack-UserPoolClientId'),
    userPoolDomain: cdk.Fn.importValue('CognitoAuthStack-UserPoolDomain'),
  };
}

// Lambda@Edge stack (deployed to us-east-1)
let lambdaEdgeStack: LambdaEdgeUsEast1Stack | undefined;

if (enableSso) {
  console.log(`🔐 SSO Authentication: ENABLED`);
  
  if (!enableCognito) {
    console.error('❌ SSO requires Cognito to be enabled. Set ENABLE_COGNITO=true');
    process.exit(1);
  }
  
  if (!ssoLoginUrl) {
    console.error('❌ SSO_LOGIN_URL environment variable required when ENABLE_SSO=true');
    console.error('   Example: https://your-domain.auth.us-west-2.amazoncognito.com/login');
    process.exit(1);
  }
  
  // Deploy Lambda@Edge stack to us-east-1 (required for CloudFront)
  console.log(`   Deploying Lambda@Edge functions to us-east-1...`);
  lambdaEdgeStack = new LambdaEdgeUsEast1Stack(app, 'LambdaEdgeStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT,
      region: 'us-east-1', // Lambda@Edge MUST be in us-east-1
    },
    environment: 'dev',
    projectName: 'strands-agent-chatbot',
    crossRegionReferences: true,
  });
  
  // Add SSO configuration to Cognito props
  cognitoProps = {
    ...cognitoProps,
    enableSso: true,
    ssoLoginUrl: ssoLoginUrl,
    ssoTokenCookieName: process.env.SSO_TOKEN_COOKIE_NAME || 'id_token',
    // Pass Lambda@Edge function versions for CloudFront association
    viewerRequestFunctionVersion: lambdaEdgeStack.viewerRequestVersion,
    originRequestFunctionVersion: lambdaEdgeStack.originRequestVersion,
  };
  
  console.log(`   Login URL: ${ssoLoginUrl}`);
  console.log(`   Token Cookie: ${cognitoProps.ssoTokenCookieName}`);
} else {
  console.log(`🔐 SSO Authentication: DISABLED`);
}

// Deploy main Chatbot stack
const chatbotStack = new ChatbotStack(app, 'ChatbotStack', {
  env,
  ...cognitoProps,
  projectName: 'strands-agent-chatbot',
  environment: 'dev',
  // Enable cross-region references for Lambda@Edge (us-east-1) -> CloudFront (eu-west-1)
  crossRegionReferences: enableSso,
});

// Add explicit dependency if Cognito is enabled
if (enableCognito && cognitoStack) {
  chatbotStack.addDependency(cognitoStack);
}

// Add explicit dependency on Lambda@Edge stack if SSO is enabled
if (enableSso && lambdaEdgeStack) {
  chatbotStack.addDependency(lambdaEdgeStack);
}

// Check if SSO monitoring should be enabled (via environment variable)
const enableSsoMonitoring = process.env.ENABLE_SSO_MONITORING === 'true';

if (enableSsoMonitoring) {
  console.log(`📊 SSO Monitoring: ENABLED`);
  
  // Deploy SSO Monitoring stack
  const ssoMonitoringStack = new SsoMonitoringStack(app, 'SsoMonitoringStack', {
    env,
    environment: 'dev',
    alarmNotificationEmail: process.env.SSO_ALARM_EMAIL,
    lambdaEdgeRoleArn: process.env.LAMBDA_EDGE_ROLE_ARN,
    cognitoUserPoolId: cognitoStack?.userPool.userPoolId,
    enableCloudTrail: process.env.ENABLE_CLOUDTRAIL !== 'false',
  });

  // Add dependency on Cognito stack if enabled
  if (cognitoStack) {
    ssoMonitoringStack.addDependency(cognitoStack);
  }
}
