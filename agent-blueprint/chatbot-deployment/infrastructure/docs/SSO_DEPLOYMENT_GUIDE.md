# SSO Deployment Guide

This guide walks you through deploying the SSO authentication feature for the Strands Agent Chatbot.

## Prerequisites

- AWS CLI configured with appropriate credentials
- Node.js 18+ installed
- CDK CLI installed (`npm install -g aws-cdk`)
- Access to AWS IAM Identity Center (if enabling SSO)

## Deployment Steps

### Step 1: Clean Deployment (Without SSO)

First, deploy the basic Cognito authentication without SSO to ensure the infrastructure is working.

```bash
cd agent-blueprint/chatbot-deployment/infrastructure

# Set environment variables
export AWS_REGION=eu-west-1
export ENABLE_COGNITO=true
export ENABLE_SSO=false

# Install dependencies
npm install

# Deploy Cognito stack
npx cdk deploy CognitoAuthStack

# Deploy Chatbot stack
npx cdk deploy ChatbotStack
```

### Step 2: Verify Basic Cognito Deployment

After deployment completes, verify the outputs:

```bash
aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs'
```

You should see outputs including:
- `UserPoolId`
- `UserPoolClientId`
- `UserPoolDomain`
- `AuthLoginUrl`
- `SamlAcsUrl` (for future SSO configuration)
- `SamlEntityId` (for future SSO configuration)

### Step 3: Enable SSO (Optional)

If you want to enable SSO with IAM Identity Center:

#### 3.1 Configure IAM Identity Center

1. Navigate to IAM Identity Center console
2. Create a new custom SAML 2.0 application
3. Configure the application with values from CognitoAuthStack outputs:
   - **ACS URL**: Use the `SamlAcsUrl` output
   - **Entity ID**: Use the `SamlEntityId` output
4. Download the IAM Identity Center SAML metadata XML file
5. Save it as `iam-identity-center-metadata.xml` in the infrastructure directory

#### 3.2 Build Lambda@Edge Functions with Configuration

Lambda@Edge functions don't support environment variables, so configuration must be embedded at build time:

```bash
cd lambda-edge

# Get values from CognitoAuthStack outputs
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

# Build the viewer request function with configuration
node build-viewer-request.js "$REGION" "$USER_POOL_ID" "$CLIENT_ID" "$LOGIN_URL" "id_token"

cd ..
```

#### 3.3 Update Lambda@Edge Stack to Use Built Code

Edit `lambda-edge/lambda-edge-stack.ts` and change the code path:

```typescript
// Change from:
code: lambda.Code.fromAsset('./lambda-edge/viewer-request'),

// To:
code: lambda.Code.fromAsset('./lambda-edge/viewer-request-build'),
```

#### 3.4 Deploy with SSO Enabled

```bash
# Set SSO environment variables
export ENABLE_SSO=true
export SSO_LOGIN_URL="$LOGIN_URL"
export SSO_TOKEN_COOKIE_NAME="id_token"

# Update CognitoAuthStack with SAML provider
npx cdk deploy CognitoAuthStack

# Deploy Lambda@Edge functions (must be in us-east-1)
# Note: This will be handled by ChatbotStack

# Update ChatbotStack with Lambda@Edge functions
npx cdk deploy ChatbotStack
```

#### 3.5 Upload SAML Metadata to Cognito

After IAM Identity Center is configured:

```bash
# Upload the SAML metadata to Cognito
aws cognito-idp update-identity-provider \
  --region eu-west-1 \
  --user-pool-id "$USER_POOL_ID" \
  --provider-name "IAMIdentityCenter" \
  --provider-details file://iam-identity-center-metadata.xml
```

#### 3.6 Assign Users in IAM Identity Center

1. Navigate to IAM Identity Center console
2. Go to Applications
3. Find your application
4. Assign users or groups to the application

### Step 4: Test the Deployment

#### Test Basic Cognito (Without SSO)

```bash
# Get the login URL
LOGIN_URL=$(aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`AuthLoginUrl`].OutputValue' \
  --output text)

echo "Login URL: $LOGIN_URL"

# Open in browser and test login
```

#### Test SSO (If Enabled)

```bash
# Get the SSO login URL
SSO_LOGIN_URL=$(aws cloudformation describe-stacks \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --query 'Stacks[0].Outputs[?OutputKey==`SsoLoginUrl`].OutputValue' \
  --output text)

echo "SSO Login URL: $SSO_LOGIN_URL"

# Or access via AWS Access Portal
# Users should see the application tile and can click to access
```

## Troubleshooting

### Issue: Domain prefix validation error

**Error**: `domainPrefix for cognitoDomain can contain only lowercase alphabets, numbers and hyphens`

**Solution**: The domain prefix is automatically generated from the account ID. Ensure the account ID doesn't contain special characters. The code now sanitizes the domain prefix automatically.

### Issue: Custom attribute error

**Error**: `Invalid AttributeDataType input`

**Solution**: Custom attributes cannot be added to existing Cognito User Pools. If you need custom attributes, you must create a new user pool. The current implementation no longer uses custom attributes.

### Issue: Lambda@Edge environment variables error

**Error**: Lambda@Edge functions don't support environment variables

**Solution**: Use the build script to inject configuration at build time:
```bash
cd lambda-edge
node build-viewer-request.js <region> <userPoolId> <clientId> <loginUrl>
```

### Issue: Stack in UPDATE_ROLLBACK_FAILED state

**Solution**: Continue the rollback by skipping failed resources:
```bash
aws cloudformation continue-update-rollback \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --resources-to-skip <ResourceLogicalId>
```

### Issue: Cannot delete stack due to exports in use

**Solution**: Delete dependent stacks first:
```bash
# Delete ChatbotStack first
aws cloudformation delete-stack --region eu-west-1 --stack-name ChatbotStack
aws cloudformation wait stack-delete-complete --region eu-west-1 --stack-name ChatbotStack

# Then delete CognitoAuthStack
aws cloudformation delete-stack --region eu-west-1 --stack-name CognitoAuthStack
aws cloudformation wait stack-delete-complete --region eu-west-1 --stack-name CognitoAuthStack
```

### Issue: S3 bucket preventing stack deletion

**Solution**: Empty the bucket first, or retain it during deletion:
```bash
# Option 1: Empty the bucket
aws s3 rm s3://<bucket-name> --recursive --region eu-west-1

# Option 2: Retain the bucket
aws cloudformation delete-stack \
  --region eu-west-1 \
  --stack-name ChatbotStack \
  --retain-resources FrontendSourceBucketA204C1E7
```

## Rollback Procedure

If you need to rollback the deployment:

```bash
# Disable SSO
export ENABLE_SSO=false

# Redeploy without SSO
npx cdk deploy CognitoAuthStack
npx cdk deploy ChatbotStack
```

Or completely remove the stacks:

```bash
# Delete in reverse order
npx cdk destroy ChatbotStack
npx cdk destroy CognitoAuthStack
```

## Next Steps

After successful deployment:

1. Configure monitoring and alarms (see `SsoMonitoringStack`)
2. Set up user access in IAM Identity Center
3. Test the authentication flow end-to-end
4. Update documentation with your specific URLs
5. Train support team on SSO troubleshooting

## Additional Resources

- [AWS Cognito SAML Documentation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-saml-idp.html)
- [IAM Identity Center Documentation](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [Lambda@Edge Documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-edge.html)
- [CloudFront Documentation](https://docs.aws.amazon.com/cloudfront/latest/developerguide/Introduction.html)
