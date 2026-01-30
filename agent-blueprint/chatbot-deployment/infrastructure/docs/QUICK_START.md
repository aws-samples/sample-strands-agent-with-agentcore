# Quick Start Guide - SSO Deployment

## Prerequisites Check

```bash
# Verify AWS CLI
aws --version

# Verify Node.js
node --version  # Should be 18+

# Verify CDK
npx cdk --version

# Verify AWS credentials
aws sts get-caller-identity
```

## Clean Deployment (No SSO)

```bash
cd agent-blueprint/chatbot-deployment/infrastructure

# Set environment
export AWS_REGION=eu-west-1
export ENABLE_COGNITO=true
export ENABLE_SSO=false

# Install and deploy
npm install
npx cdk bootstrap  # Only needed once per account/region
npx cdk deploy CognitoAuthStack
npx cdk deploy ChatbotStack
```

## Get Deployment Outputs

```bash
# Get Cognito configuration
aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[].{Key:OutputKey,Value:OutputValue}' \
  --output table

# Get application URL
aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name ChatbotStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
  --output text
```

## Enable SSO (After Basic Deployment Works)

### 1. Configure IAM Identity Center

1. Go to IAM Identity Center console
2. Create custom SAML 2.0 application
3. Use these values from CognitoAuthStack outputs:
   - **ACS URL**: `SamlAcsUrl` output
   - **Entity ID**: `SamlEntityId` output
4. Download SAML metadata XML
5. Save as `iam-identity-center-metadata.xml`

### 2. Build Lambda@Edge Functions

```bash
cd lambda-edge

# Get Cognito values
REGION="eu-west-1"
USER_POOL_ID=$(aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
  --output text)

CLIENT_ID=$(aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`UserPoolClientId`].OutputValue' \
  --output text)

LOGIN_URL=$(aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SsoLoginUrl`].OutputValue' \
  --output text)

# Build with configuration
node build-viewer-request.js "$REGION" "$USER_POOL_ID" "$CLIENT_ID" "$LOGIN_URL"

cd ..
```

### 3. Update Lambda@Edge Stack

Edit `lambda-edge/lambda-edge-stack.ts`:

```typescript
// Change line ~140 from:
code: lambda.Code.fromAsset('./lambda-edge/viewer-request'),

// To:
code: lambda.Code.fromAsset('./lambda-edge/viewer-request-build'),
```

### 4. Deploy with SSO

```bash
export ENABLE_SSO=true
export SSO_LOGIN_URL="$LOGIN_URL"

npx cdk deploy CognitoAuthStack
npx cdk deploy ChatbotStack
```

### 5. Assign Users

1. Go to IAM Identity Center console
2. Navigate to Applications
3. Find your application
4. Assign users or groups

## Troubleshooting

### Stack Stuck in Failed State

```bash
# Continue rollback
aws cloudformation continue-update-rollback \
  --region eu-west-1 \
  --stack-name <StackName> \
  --resources-to-skip <FailedResourceId>
```

### Delete Stacks

```bash
# Delete in order (dependent first)
npx cdk destroy ChatbotStack
npx cdk destroy CognitoAuthStack
```

### Empty S3 Bucket

```bash
# Find bucket name
aws cloudformation describe-stack-resources \
  --region eu-west-1 \
  --stack-name ChatbotStack \
  --query 'StackResources[?ResourceType==`AWS::S3::Bucket`].PhysicalResourceId'

# Empty bucket
aws s3 rm s3://<bucket-name> --recursive --region eu-west-1
```

## Verification

```bash
# Check stack status
aws cloudformation describe-stacks \
  --region eu-west-1 \
  --query 'Stacks[?contains(StackName, `Cognito`) || contains(StackName, `Chatbot`)].{Name:StackName,Status:StackStatus}' \
  --output table

# Test login URL
echo "Login URL:"
aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuthLoginUrl`].OutputValue' \
  --output text
```

## Common Commands

```bash
# View CDK diff before deploying
npx cdk diff CognitoAuthStack

# Deploy with approval
npx cdk deploy CognitoAuthStack --require-approval never

# View CloudFormation events
aws cloudformation describe-stack-events \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --max-items 10

# List all stacks
aws cloudformation list-stacks \
  --region eu-west-1 \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
  --query 'StackSummaries[].StackName'
```

## Next Steps

1. ✅ Deploy basic Cognito authentication
2. ✅ Verify login works
3. ⏭️ Configure IAM Identity Center (if SSO needed)
4. ⏭️ Build and deploy Lambda@Edge functions
5. ⏭️ Test SSO authentication flow
6. ⏭️ Set up monitoring and alarms
7. ⏭️ Document for your team

## Documentation

- [SSO_DEPLOYMENT_GUIDE.md](./SSO_DEPLOYMENT_GUIDE.md) - Full deployment guide
- [RECOVERY_SUMMARY.md](./RECOVERY_SUMMARY.md) - Issues and solutions
- [tasks.md](../../../.kiro/specs/sso-authentication/tasks.md) - Task list
- [design.md](../../../.kiro/specs/sso-authentication/design.md) - Architecture
