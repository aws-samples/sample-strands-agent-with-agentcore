# Lambda@Edge Functions for SSO Authentication

This directory contains Lambda@Edge functions for JWT validation and user identity header injection at the CloudFront edge.

## Overview

The SSO authentication system uses two Lambda@Edge functions:

1. **Viewer Request Function** (`viewer-request/`)
   - Intercepts all requests at the CloudFront edge
   - Extracts JWT tokens from cookies or Authorization headers
   - Validates JWT signature using Cognito JWKS
   - Verifies token expiration, issuer, and audience claims
   - Redirects to login for invalid/expired tokens
   - Passes decoded JWT payload to origin request function

2. **Origin Request Function** (`origin-request/`)
   - Extracts decoded JWT payload from viewer request
   - Adds user identity headers (X-User-Email, X-User-Sub, X-User-Name)
   - Removes internal headers before forwarding to origin
   - Prevents header spoofing by removing externally-set protected headers

## Directory Structure

```
lambda-edge/
├── viewer-request/
│   ├── index.js          # Main handler function
│   └── package.json      # Dependencies (jsonwebtoken, jwks-rsa)
├── origin-request/
│   ├── index.js          # Main handler function
│   └── package.json      # Dependencies (minimal)
├── lambda-edge-stack.ts  # CDK construct for deployment
└── README.md             # This file
```

## Configuration

### Viewer Request Function

The viewer request function requires the following configuration:

| Variable | Description | Default |
|----------|-------------|---------|
| `COGNITO_REGION` | AWS region where Cognito is deployed | `eu-west-1` |
| `COGNITO_USER_POOL_ID` | Cognito User Pool ID | Required |
| `COGNITO_CLIENT_ID` | Cognito User Pool Client ID | Required |
| `TOKEN_COOKIE_NAME` | Cookie name containing JWT token | `id_token` |
| `LOGIN_URL` | URL to redirect for authentication | `/login` |

### Public Paths

The following paths are allowed without authentication:

- `/health` - Health check endpoint
- `/api/health` - API health check
- `/_next/static` - Next.js static assets
- `/favicon.ico` - Favicon
- `/robots.txt` - Robots file
- `/login` - Login page
- `/logout` - Logout page
- `/oauth2/callback` - OAuth2 callback
- `/saml2/idpresponse` - SAML response endpoint

## User Identity Headers

After successful authentication, the following headers are added to requests:

| Header | Description | Source |
|--------|-------------|--------|
| `X-User-Email` | User's email address | JWT `email` claim |
| `X-User-Sub` | User's unique identifier | JWT `sub` claim |
| `X-User-Name` | User's display name | JWT `name` or `email` claim |
| `X-User-Groups` | User's group memberships | JWT `cognito:groups` claim |

## Deployment

### Prerequisites

1. Node.js 20.x or later
2. AWS CDK 2.x
3. AWS CLI configured with appropriate permissions
4. Cognito User Pool configured with SAML identity provider

### Install Dependencies

```bash
# Install viewer-request dependencies
cd viewer-request
npm install

# Install origin-request dependencies
cd ../origin-request
npm install
```

### Deploy with CDK

Lambda@Edge functions must be deployed to `us-east-1`:

```bash
cd ../..  # Back to infrastructure directory
npm run build
npx cdk deploy --region us-east-1
```

### Manual Deployment

If deploying manually:

1. Package the functions:
   ```bash
   cd viewer-request
   npm install --production
   zip -r ../viewer-request.zip .
   
   cd ../origin-request
   npm install --production
   zip -r ../origin-request.zip .
   ```

2. Create Lambda functions in us-east-1
3. Publish versions
4. Associate with CloudFront distribution

## Testing

### Unit Tests

```bash
# Run viewer-request tests
cd viewer-request
npm test

# Run origin-request tests
cd ../origin-request
npm test
```

### Integration Testing

1. Deploy to a test CloudFront distribution
2. Test with valid JWT token in cookie
3. Test with expired token (should redirect)
4. Test with invalid token (should redirect)
5. Test without token (should redirect)
6. Verify user identity headers reach backend

## Monitoring

### CloudWatch Logs

Lambda@Edge logs are written to CloudWatch Logs in the region where the function executes:

- Log group: `/aws/lambda/us-east-1.<function-name>`
- Logs may appear in multiple regions depending on edge location

### Metrics

Monitor the following CloudWatch metrics:

- `Invocations` - Number of function invocations
- `Errors` - Number of function errors
- `Duration` - Function execution time
- `Throttles` - Number of throttled invocations

### Alarms

Recommended alarms:

1. **High Error Rate**: > 5% errors over 5 minutes
2. **High Latency**: > 100ms p99 latency
3. **Throttling**: Any throttles

## Security Considerations

1. **Token Validation**: All tokens are validated against Cognito JWKS
2. **Header Spoofing Prevention**: Protected headers are removed before adding user identity
3. **HTTPS Only**: CloudFront should be configured to redirect HTTP to HTTPS
4. **Minimal Permissions**: Lambda@Edge role has only required permissions
5. **No Secrets in Code**: Configuration is injected during deployment

## Troubleshooting

### Common Issues

1. **Token validation fails**
   - Check Cognito User Pool ID and Client ID
   - Verify JWKS endpoint is accessible
   - Check token expiration

2. **Redirect loop**
   - Verify login URL is in public paths
   - Check cookie domain and path settings

3. **Headers not reaching backend**
   - Verify origin request function is attached
   - Check CloudFront cache behavior settings

4. **High latency**
   - JWKS is cached for 1 hour
   - First request may be slower due to cold start

### Debug Logging

Enable debug logging by checking CloudWatch Logs:

```bash
aws logs tail /aws/lambda/us-east-1.viewer-request-auth-dev --follow
```

## Performance

### Optimization

- JWKS responses are cached for 1 hour
- JWT validation typically completes in < 50ms
- Cold start time is approximately 200-500ms

### Limits

- Lambda@Edge memory: 128 MB
- Lambda@Edge timeout: 5 seconds
- Maximum response size: 40 KB (viewer request)
- Maximum request body: 1 MB

## References

- [Lambda@Edge Documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-edge.html)
- [CloudFront Events](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/lambda-event-structure.html)
- [Cognito JWT Tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-tokens-verifying-a-jwt.html)
- [JWKS Specification](https://tools.ietf.org/html/rfc7517)
