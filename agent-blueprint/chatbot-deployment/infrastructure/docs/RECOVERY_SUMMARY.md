# SSO Deployment Recovery Summary

## Date: January 28, 2026

## Issues Encountered and Resolved

### 1. Domain Prefix Validation Error ✅ FIXED

**Issue**: Cognito User Pool Domain prefix contained invalid characters
```
ValidationError: domainPrefix for cognitoDomain can contain only lowercase alphabets, numbers and hyphens
```

**Root Cause**: The domain prefix was generated from the AWS account ID which contained special characters or wasn't properly sanitized.

**Solution**: Updated `cognito-auth-stack.ts` to sanitize the account ID:
```typescript
const accountId = this.account.substring(0, 8).replace(/[^a-zA-Z0-9-]/g, '');
const domainPrefix = `chatbot-${environment}-${accountId}`.toLowerCase();
```

### 2. Lambda@Edge Environment Variables Error ✅ FIXED

**Issue**: Lambda@Edge functions don't support environment variables
```
Error: Lambda@Edge functions cannot use environment variables
```

**Root Cause**: The Lambda@Edge construct was attempting to set environment variables, which is not supported by Lambda@Edge.

**Solution**: 
1. Removed all environment variable references from `lambda-edge-stack.ts`
2. Updated `viewer-request/index.js` to use placeholder values: `{{COGNITO_REGION}}`, `{{COGNITO_USER_POOL_ID}}`, etc.
3. Created `build-viewer-request.js` script to inject configuration at build time
4. Updated deployment documentation to include build step

### 3. Custom Attribute Error ✅ FIXED

**Issue**: Attempted to add custom attribute to existing Cognito User Pool
```
Invalid AttributeDataType input, consider using the provided AttributeDataType enum
```

**Root Cause**: Custom attributes cannot be added to existing Cognito User Pools. They must be defined when the pool is created.

**Solution**: Removed the custom `saml_sub` attribute mapping from `cognito-auth-stack.ts`. The `sub` claim is already available in the standard JWT payload.

### 4. Stack in UPDATE_ROLLBACK_FAILED State ✅ RESOLVED

**Issue**: CognitoAuthStack stuck in UPDATE_ROLLBACK_FAILED state due to custom attribute error

**Solution**: 
```bash
# Continued the rollback by skipping the failed resource
aws cloudformation continue-update-rollback \
  --region eu-west-1 \
  --stack-name CognitoAuthStack \
  --resources-to-skip ChatbotUserPool01970AAD
```

### 5. Stack Deletion Blocked by Exports ✅ RESOLVED

**Issue**: CognitoAuthStack couldn't be deleted because ChatbotStack was importing its exports

**Solution**: Deleted stacks in correct order:
1. First deleted ChatbotStack (dependent)
2. Then deleted CognitoAuthStack (dependency)

### 6. S3 Bucket Preventing Stack Deletion ✅ RESOLVED

**Issue**: ChatbotStack deletion failed due to non-empty S3 bucket with service control policy preventing deletion

**Solution**: 
```bash
# Emptied the bucket
aws s3 rm s3://strands-agent-chatbot-frontend-sources-538825684220-eu-west-1 --recursive

# Retained the bucket during stack deletion
aws cloudformation delete-stack \
  --stack-name ChatbotStack \
  --retain-resources FrontendSourceBucketA204C1E7
```

## Current State

### Stacks Status
- ✅ CognitoAuthStack: DELETED
- ✅ ChatbotStack: DELETED
- ✅ Ready for clean deployment

### Code Changes Made

1. **cognito-auth-stack.ts**
   - Fixed domain prefix sanitization
   - Removed custom attribute mapping
   - Added validation for domain prefix format

2. **lambda-edge-stack.ts**
   - Removed environment variables
   - Added comments about configuration injection
   - Updated documentation

3. **viewer-request/index.js**
   - Replaced `process.env` with placeholder values
   - Added comments about build-time configuration

4. **New Files Created**
   - `build-viewer-request.js` - Build script for configuration injection
   - `SSO_DEPLOYMENT_GUIDE.md` - Comprehensive deployment guide
   - `RECOVERY_SUMMARY.md` - This file

## Next Steps for Deployment

### Option 1: Deploy Without SSO (Recommended First)

This validates the basic infrastructure works:

```bash
cd agent-blueprint/chatbot-deployment/infrastructure

export AWS_REGION=eu-west-1
export ENABLE_COGNITO=true
export ENABLE_SSO=false

npm install
npx cdk deploy CognitoAuthStack
npx cdk deploy ChatbotStack
```

### Option 2: Deploy With SSO

After validating basic Cognito works:

1. Configure IAM Identity Center application
2. Download SAML metadata
3. Build Lambda@Edge functions with configuration:
   ```bash
   cd lambda-edge
   node build-viewer-request.js <region> <userPoolId> <clientId> <loginUrl>
   ```
4. Update Lambda@Edge stack to use built code
5. Deploy with SSO enabled:
   ```bash
   export ENABLE_SSO=true
   export SSO_LOGIN_URL="<your-login-url>"
   npx cdk deploy CognitoAuthStack
   npx cdk deploy ChatbotStack
   ```

## Lessons Learned

1. **Lambda@Edge Limitations**: Lambda@Edge functions have significant limitations:
   - No environment variables
   - Must be deployed to us-east-1
   - No X-Ray tracing
   - Configuration must be embedded at build time

2. **Cognito User Pool Constraints**: Custom attributes cannot be added to existing user pools. Plan attribute schema carefully during initial creation.

3. **CloudFormation Dependencies**: Be careful with cross-stack exports. Deletion order matters and can cause stacks to get stuck.

4. **Domain Prefix Validation**: Cognito domain prefixes have strict validation rules. Always sanitize and validate before deployment.

5. **S3 Bucket Deletion**: Service control policies can prevent bucket deletion. Always have a retention strategy.

## Testing Checklist

Before considering the deployment complete:

- [ ] CognitoAuthStack deploys successfully
- [ ] ChatbotStack deploys successfully
- [ ] Cognito User Pool is created with correct configuration
- [ ] User Pool Domain is accessible
- [ ] SAML endpoints are configured (if SSO enabled)
- [ ] Lambda@Edge functions are deployed (if SSO enabled)
- [ ] CloudFront distribution is updated (if SSO enabled)
- [ ] Authentication flow works end-to-end
- [ ] User identity headers reach the backend
- [ ] Session management works correctly
- [ ] Logout flow works correctly

## Support Contacts

For issues during deployment:
- AWS Support: [AWS Support Center](https://console.aws.amazon.com/support/)
- CDK Issues: [AWS CDK GitHub](https://github.com/aws/aws-cdk/issues)
- Cognito Documentation: [AWS Cognito Docs](https://docs.aws.amazon.com/cognito/)

## References

- [SSO_DEPLOYMENT_GUIDE.md](./SSO_DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- [.kiro/specs/sso-authentication/](../../../.kiro/specs/sso-authentication/) - Complete SSO specification
- [tasks.md](../../../.kiro/specs/sso-authentication/tasks.md) - Implementation task list
- [design.md](../../../.kiro/specs/sso-authentication/design.md) - Architecture and design decisions
