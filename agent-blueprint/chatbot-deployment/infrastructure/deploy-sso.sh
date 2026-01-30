#!/bin/bash
# Deploy ChatbotStack with SSO enabled
# This script deploys Lambda@Edge to us-east-1 first, then ChatbotStack to eu-west-1

set -e

# Use the correct AWS profile
export AWS_PROFILE=AWSAdministratorAccess-538825684220

export ENABLE_SSO=true
export ENABLE_COGNITO=true
export USE_EXISTING_TABLES=true
export USE_EXISTING_ECR=true
export USE_EXISTING_BUCKET=true
export SSO_LOGIN_URL="https://chatbot-dev-53882568.auth.eu-west-1.amazoncognito.com/login?client_id=37osr3ctqscb4m33gqqdlc8i4v&response_type=code&scope=openid+email+profile&redirect_uri=https://d1ystqalgm445b.cloudfront.net/oauth2/idpresponse"

# Set CDK environment variables
export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
export CDK_DEFAULT_REGION=eu-west-1

echo "Using AWS Profile: $AWS_PROFILE"
echo "Deploying with account: $CDK_DEFAULT_ACCOUNT, region: $CDK_DEFAULT_REGION"
echo ""
echo "=== SSO Deployment ==="
echo "Step 1: Deploy Lambda@Edge to us-east-1 (required for CloudFront)"
echo "Step 2: Deploy CognitoAuthStack to eu-west-1"
echo "Step 3: Deploy ChatbotStack to eu-west-1 with Lambda@Edge integration"
echo ""

# Deploy all stacks - CDK will handle the order based on dependencies
# LambdaEdgeStack -> CognitoAuthStack -> ChatbotStack
npx cdk deploy --all --require-approval never
