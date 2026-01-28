# SSO Authentication Design Document

## 1. Architecture Overview

### 1.1 High-Level Architecture

The SSO authentication system integrates AWS IAM Identity Center with Amazon Cognito to provide seamless single sign-on access to the multi-agent chatbot application. The architecture follows a SAML 2.0 federation pattern with JWT token validation at the CloudFront edge.

```
┌─────────────────────────────────────────────────────────────────┐
│                    AWS IAM Identity Center                      │
│                  (SAML Identity Provider)                       │
└────────────────────────┬────────────────────────────────────────┘
                         │ SAML 2.0 Assertion
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Amazon Cognito User Pool                           │
│              (SAML Service Provider)                            │
│  - Receives SAML assertions                                     │
│  - Issues JWT tokens (ID, Access, Refresh)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ JWT Tokens
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CloudFront Distribution                      │
│                    (with Lambda@Edge)                           │
│  - Viewer Request: JWT validation                               │
│  - Origin Request: Add user identity headers                    │
└────────────────────────┬────────────────────────────────────────┘
                         │ Authenticated Request
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              Application Load Balancer (ALB)                    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ECS Fargate Service                          │
│              (Next.js Frontend + FastAPI BFF)                   │
│  - Receives X-User-Email, X-User-Sub headers                    │
│  - Implements user-specific features                            │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 Authentication Flow

```
User → AWS Access Portal → IAM Identity Center → Cognito → CloudFront → ALB → Application
  1. User clicks app tile in AWS Access Portal
  2. IAM Identity Center authenticates user (SAML IdP)
  3. SAML assertion sent to Cognito (SAML SP)
  4. Cognito validates assertion and issues JWT tokens
  5. User redirected to CloudFront with JWT in cookie
  6. Lambda@Edge validates JWT at edge
  7. Valid request forwarded to ALB with user headers
  8. Application receives authenticated request
```

## 2. Component Design

### 2.1 IAM Identity Center Configuration

**Purpose**: Act as the SAML 2.0 Identity Provider for the application

**Configuration**:

- **Application Type**: Custom SAML 2.0 application
- **Application Name**: "Strands Agent Chatbot" (configurable)
- **Application URL**: CloudFront distribution URL
- **ACS URL**: `https://<cognito-domain>.auth.<region>.amazoncognito.com/saml2/idpresponse`
- **Entity ID**: `urn:amazon:cognito:sp:<user-pool-id>`
- **Attribute Mappings**:
  - `email` → `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress`
  - `name` → `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name`
  - `sub` → `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier`

**Manual Configuration Steps** (documented in deployment guide):
1. Navigate to IAM Identity Center console
2. Create custom SAML 2.0 application
3. Download SAML metadata XML
4. Configure attribute mappings
5. Assign users/groups to application

### 2.2 Amazon Cognito User Pool

**Purpose**: Act as SAML Service Provider and issue JWT tokens

**CDK Implementation**: Enhanced `CognitoAuthStack`

**Key Changes**:
- Add SAML identity provider configuration
- Configure attribute mapping from SAML to Cognito
- Disable self-service sign-up (SSO only)
- Configure JWT token expiration
- Set up hosted UI domain

**Configuration**:
```typescript
// SAML Identity Provider
const samlProvider = new cognito.UserPoolIdentityProviderSaml(this, 'SamlIdP', {
  userPool: userPool,
  name: 'IAMIdentityCenter',
  metadata: cognito.UserPoolIdentityProviderSamlMetadata.file(
    './iam-identity-center-metadata.xml'
  ),
  attributeMapping: {
    email: cognito.ProviderAttribute.other('email'),
    givenName: cognito.ProviderAttribute.other('name'),
    custom: {
      'sub': cognito.ProviderAttribute.other('sub'),
    },
  },
});
```


**User Pool Configuration**:
```typescript
const userPool = new cognito.UserPool(this, 'ChatbotUserPool', {
  userPoolName: 'chatbot-users-sso',
  selfSignUpEnabled: false, // Disable self-signup for SSO-only
  signInAliases: {
    email: true,
  },
  standardAttributes: {
    email: {
      required: true,
      mutable: false,
    },
  },
  accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
  removalPolicy: cdk.RemovalPolicy.RETAIN, // Retain for production
});
```

### 2.3 Lambda@Edge Functions

**Purpose**: Validate JWT tokens at CloudFront edge and inject user identity headers

#### 2.3.1 Viewer Request Function

**Trigger**: CloudFront Viewer Request event
**Runtime**: Node.js 20.x
**Memory**: 128 MB
**Timeout**: 5 seconds

**Responsibilities**:
1. Extract JWT token from cookie or Authorization header
2. Validate JWT signature using Cognito public keys (JWKS)
3. Verify token expiration
4. Verify issuer and audience claims
5. Allow valid requests to proceed
6. Redirect invalid/expired tokens to login

**Implementation Location**: 
`agent-blueprint/chatbot-deployment/infrastructure/lambda-edge/viewer-request.js`

**Key Logic**:
```javascript
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

const client = jwksClient({
  jwksUri: `https://cognito-idp.${region}.amazonaws.com/${userPoolId}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 3600000, // 1 hour
});

async function handler(event) {
  const request = event.Records[0].cf.request;
  const headers = request.headers;
  
  // Extract token from cookie
  const token = extractTokenFromCookie(headers.cookie);
  
  if (!token) {
    return redirectToLogin(request);
  }
  
  try {
    // Verify token
    const decoded = await verifyToken(token);
    
    // Add user info to request for origin request function
    request.headers['x-jwt-payload'] = [{
      key: 'X-JWT-Payload',
      value: JSON.stringify(decoded)
    }];
    
    return request;
  } catch (error) {
    console.error('Token validation failed:', error);
    return redirectToLogin(request);
  }
}
```


#### 2.3.2 Origin Request Function

**Trigger**: CloudFront Origin Request event
**Runtime**: Node.js 20.x
**Memory**: 128 MB
**Timeout**: 5 seconds

**Responsibilities**:
1. Extract decoded JWT payload from viewer request
2. Add user identity headers for backend
3. Remove internal headers before forwarding

**Implementation Location**:
`agent-blueprint/chatbot-deployment/infrastructure/lambda-edge/origin-request.js`

**Key Logic**:
```javascript
async function handler(event) {
  const request = event.Records[0].cf.request;
  const headers = request.headers;
  
  // Extract JWT payload added by viewer request function
  const jwtPayload = headers['x-jwt-payload']?.[0]?.value;
  
  if (jwtPayload) {
    const payload = JSON.parse(jwtPayload);
    
    // Add user identity headers
    request.headers['x-user-email'] = [{
      key: 'X-User-Email',
      value: payload.email
    }];
    
    request.headers['x-user-sub'] = [{
      key: 'X-User-Sub',
      value: payload.sub
    }];
    
    request.headers['x-user-name'] = [{
      key: 'X-User-Name',
      value: payload.name || payload.email
    }];
    
    // Remove internal header
    delete request.headers['x-jwt-payload'];
  }
  
  return request;
}
```

### 2.4 CloudFront Distribution Updates

**Purpose**: Integrate Lambda@Edge functions and configure caching

**CDK Implementation**: Update `ChatbotStack`

**Changes**:
```typescript
// Create Lambda@Edge functions
const viewerRequestFunction = new cloudfront.experimental.EdgeFunction(
  this,
  'ViewerRequestFunction',
  {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('./lambda-edge/viewer-request'),
    memorySize: 128,
    timeout: cdk.Duration.seconds(5),
  }
);

const originRequestFunction = new cloudfront.experimental.EdgeFunction(
  this,
  'OriginRequestFunction',
  {
    runtime: lambda.Runtime.NODEJS_20_X,
    handler: 'index.handler',
    code: lambda.Code.fromAsset('./lambda-edge/origin-request'),
    memorySize: 128,
    timeout: cdk.Duration.seconds(5),
  }
);

// Update CloudFront distribution
const distribution = new cloudfront.Distribution(this, 'ChatbotCloudFront', {
  defaultBehavior: {
    origin: new origins.LoadBalancerV2Origin(alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
    }),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
    originRequestPolicy: customOriginRequestPolicy,
    edgeLambdas: [
      {
        functionVersion: viewerRequestFunction.currentVersion,
        eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
      },
      {
        functionVersion: originRequestFunction.currentVersion,
        eventType: cloudfront.LambdaEdgeEventType.ORIGIN_REQUEST,
      },
    ],
  },
});
```


### 2.5 Backend Integration

**Purpose**: Consume user identity headers and implement user-specific features

#### 2.5.1 FastAPI Middleware

**Implementation Location**: `chatbot-app/agentcore/src/middleware/auth_middleware.py`

**Responsibilities**:
1. Extract user identity from headers
2. Validate header presence
3. Attach user context to request
4. Log authentication events

**Implementation**:
```python
from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Extract user identity from headers
        user_email = request.headers.get('X-User-Email')
        user_sub = request.headers.get('X-User-Sub')
        user_name = request.headers.get('X-User-Name')
        
        # Skip auth for health check endpoints
        if request.url.path in ['/api/health', '/health']:
            return await call_next(request)
        
        # Validate required headers
        if not user_email or not user_sub:
            logger.error(f"Missing authentication headers for {request.url.path}")
            raise HTTPException(
                status_code=401,
                detail="Authentication required"
            )
        
        # Attach user context to request state
        request.state.user = {
            'email': user_email,
            'sub': user_sub,
            'name': user_name or user_email,
        }
        
        logger.info(f"Authenticated request from {user_email} to {request.url.path}")
        
        response = await call_next(request)
        return response
```

**Registration in main.py**:
```python
from middleware.auth_middleware import AuthMiddleware

app = FastAPI()
app.add_middleware(AuthMiddleware)
```


#### 2.5.2 Next.js API Route Middleware

**Implementation Location**: `chatbot-app/frontend/src/middleware/auth.ts`

**Responsibilities**:
1. Extract user identity from headers
2. Provide user context to API routes
3. Handle authentication errors

**Implementation**:
```typescript
import { NextRequest, NextResponse } from 'next/server';

export interface AuthenticatedUser {
  email: string;
  sub: string;
  name: string;
}

export function getAuthenticatedUser(request: NextRequest): AuthenticatedUser | null {
  const email = request.headers.get('X-User-Email');
  const sub = request.headers.get('X-User-Sub');
  const name = request.headers.get('X-User-Name');
  
  if (!email || !sub) {
    return null;
  }
  
  return {
    email,
    sub,
    name: name || email,
  };
}

export function requireAuth(request: NextRequest): AuthenticatedUser {
  const user = getAuthenticatedUser(request);
  
  if (!user) {
    throw new Error('Authentication required');
  }
  
  return user;
}
```

**Usage in API routes**:
```typescript
import { NextRequest } from 'next/server';
import { requireAuth } from '@/middleware/auth';

export async function GET(request: NextRequest) {
  const user = requireAuth(request);
  
  // Use user.email, user.sub, user.name
  return Response.json({
    message: `Hello ${user.name}`,
    userId: user.sub,
  });
}
```

### 2.6 Session Management

**Purpose**: Manage user sessions with configurable timeouts

**Implementation**: DynamoDB-based session storage

**Table Schema**:
```typescript
{
  sessionId: string;        // Partition key
  userId: string;           // Sort key (from Cognito sub)
  email: string;
  name: string;
  createdAt: string;        // ISO timestamp
  lastAccessedAt: string;   // ISO timestamp
  expiresAt: number;        // Unix timestamp for TTL
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
  };
}
```

**Session Configuration**:
- Session duration: 8 hours (configurable)
- Idle timeout: 1 hour (configurable)
- Automatic cleanup via DynamoDB TTL


## 3. Security Design

### 3.1 Token Security

**JWT Token Configuration**:
- Algorithm: RS256 (RSA with SHA-256)
- ID Token expiration: 1 hour
- Access Token expiration: 1 hour
- Refresh Token expiration: 30 days
- Token rotation on refresh

**Token Validation**:
- Signature verification using Cognito public keys (JWKS)
- Expiration time validation
- Issuer validation: `https://cognito-idp.<region>.amazonaws.com/<user-pool-id>`
- Audience validation: Cognito User Pool Client ID
- Not-before time validation

### 3.2 SAML Security

**SAML Assertion Requirements**:
- Assertions must be signed by IAM Identity Center
- Signature algorithm: RSA-SHA256
- Assertion validity: 5 minutes
- Recipient validation
- Audience restriction validation

**Certificate Management**:
- SAML signing certificates stored in IAM Identity Center
- Automatic certificate rotation supported
- Certificate expiration monitoring via CloudWatch

### 3.3 Network Security

**CloudFront Security**:
- TLS 1.2 minimum
- HTTPS redirect enforced
- Origin access restricted to CloudFront IPs only
- Custom headers for origin validation

**ALB Security**:
- Security group restricts access to CloudFront prefix list
- No direct internet access
- Internal communication over HTTP (within VPC)

**Lambda@Edge Security**:
- Execution role with minimal permissions
- No outbound internet access required (JWKS cached)
- CloudWatch Logs encryption at rest

### 3.4 Secrets Management

**AWS Secrets Manager**:
- Store SAML metadata
- Store Cognito client secret (if needed)
- Automatic rotation support
- Encryption at rest with KMS

**IAM Policies**:
- Principle of least privilege
- Separate roles for each component
- No wildcard permissions in production


## 4. Monitoring and Logging

### 4.1 CloudWatch Metrics

**Custom Metrics**:
- `AuthenticationSuccess` - Successful authentications per minute
- `AuthenticationFailure` - Failed authentications per minute
- `TokenValidationLatency` - JWT validation time at edge
- `SAMLAssertionProcessing` - SAML assertion processing time
- `SessionCreation` - New sessions created per minute
- `SessionExpiration` - Sessions expired per minute

**Metric Dimensions**:
- Environment (dev, staging, production)
- Region
- Error type (expired token, invalid signature, etc.)

### 4.2 CloudWatch Logs

**Log Groups**:
- `/aws/lambda/us-east-1.viewer-request` - Lambda@Edge viewer request logs
- `/aws/lambda/us-east-1.origin-request` - Lambda@Edge origin request logs
- `/aws/cognito/userpool/<pool-id>` - Cognito authentication logs
- `/ecs/chatbot-frontend` - Application logs

**Log Retention**:
- Lambda@Edge: 7 days
- Cognito: 90 days (compliance requirement)
- Application: 30 days

**Structured Logging Format**:
```json
{
  "timestamp": "2024-01-28T10:30:00Z",
  "level": "INFO",
  "event": "authentication_success",
  "userId": "user-sub-123",
  "email": "user@example.com",
  "ipAddress": "203.0.113.1",
  "userAgent": "Mozilla/5.0...",
  "requestId": "req-abc-123",
  "duration": 45
}
```

### 4.3 CloudWatch Alarms

**Critical Alarms**:
1. **High Authentication Failure Rate**
   - Threshold: > 10% failure rate over 5 minutes
   - Action: SNS notification to DevOps team

2. **Lambda@Edge Errors**
   - Threshold: > 5 errors per minute
   - Action: SNS notification + PagerDuty

3. **Token Validation Latency**
   - Threshold: > 100ms p99 latency
   - Action: SNS notification

4. **SAML Certificate Expiration**
   - Threshold: < 30 days until expiration
   - Action: Email to security team

### 4.4 CloudTrail Logging

**Events to Log**:
- IAM Identity Center application access changes
- Cognito User Pool configuration changes
- Lambda@Edge function updates
- CloudFront distribution changes
- Secrets Manager secret access

**Log Retention**: 90 days minimum (compliance requirement)


## 5. Deployment Strategy

### 5.1 Deployment Order

1. **Update Cognito Stack** (CognitoAuthStack)
   - Add SAML identity provider
   - Configure attribute mappings
   - Update user pool settings

2. **Deploy Lambda@Edge Functions**
   - Deploy to us-east-1 (required for Lambda@Edge)
   - Wait for replication to all edge locations (~15 minutes)

3. **Update CloudFront Distribution** (ChatbotStack)
   - Add Lambda@Edge associations
   - Update cache behaviors
   - Wait for distribution deployment (~15 minutes)

4. **Configure IAM Identity Center** (Manual)
   - Create SAML application
   - Upload metadata
   - Assign users/groups

5. **Update Backend Application**
   - Deploy auth middleware
   - Update API routes
   - Deploy to ECS

6. **Verification**
   - Test authentication flow
   - Verify user identity headers
   - Check monitoring dashboards

### 5.2 Rollback Strategy

**Automated Rollback Triggers**:
- Authentication failure rate > 50%
- Lambda@Edge error rate > 10%
- CloudFront 5xx error rate > 5%

**Rollback Steps**:
1. Remove Lambda@Edge associations from CloudFront
2. Revert to previous CloudFront distribution version
3. Restore previous Cognito configuration
4. Notify team of rollback

**Manual Rollback**:
```bash
cd agent-blueprint/chatbot-deployment/infrastructure
cdk deploy --rollback
```

### 5.3 Blue-Green Deployment

**Strategy**: Use CloudFront distribution aliases for zero-downtime deployment

**Steps**:
1. Deploy new CloudFront distribution (green)
2. Test authentication on green distribution
3. Update DNS to point to green distribution
4. Monitor for issues
5. Decommission blue distribution after 24 hours


## 6. Testing Strategy

### 6.1 Unit Tests

**Lambda@Edge Functions**:
- Test JWT validation logic
- Test token extraction from cookies
- Test error handling
- Test header injection
- Mock JWKS client responses

**Backend Middleware**:
- Test header extraction
- Test authentication failure scenarios
- Test user context attachment
- Test health check bypass

**Test Framework**: Jest for Lambda@Edge, pytest for backend

### 6.2 Integration Tests

**SAML Flow**:
- Test SAML assertion generation
- Test attribute mapping
- Test Cognito token issuance
- Test token refresh flow

**End-to-End Authentication**:
- Test complete authentication flow
- Test session management
- Test logout flow
- Test concurrent sessions

**Test Environment**: Dedicated test IAM Identity Center instance

### 6.3 Load Testing

**Scenarios**:
1. **Normal Load**: 100 concurrent users
2. **Peak Load**: 1000 concurrent users
3. **Spike Load**: 0 to 500 users in 1 minute

**Metrics to Monitor**:
- Authentication latency (p50, p95, p99)
- Token validation latency at edge
- Error rates
- Lambda@Edge cold start times

**Tools**: Apache JMeter, AWS Load Testing Solution

### 6.4 Security Testing

**Penetration Testing**:
- Token tampering attempts
- Replay attack simulation
- Session hijacking attempts
- CSRF protection validation

**Compliance Testing**:
- SAML assertion validation
- JWT signature verification
- Certificate validation
- Encryption verification


## 7. Error Handling

### 7.1 Error Scenarios

**Authentication Errors**:
1. **Expired Token**
   - Response: 302 redirect to login
   - User message: "Your session has expired. Please log in again."

2. **Invalid Token Signature**
   - Response: 302 redirect to login
   - User message: "Authentication failed. Please log in again."
   - Alert: Security team notification

3. **Missing Token**
   - Response: 302 redirect to login
   - User message: "Please log in to continue."

4. **SAML Assertion Failure**
   - Response: Error page with support contact
   - User message: "Authentication service unavailable. Please contact support."
   - Alert: DevOps team notification

**Network Errors**:
1. **JWKS Endpoint Unavailable**
   - Fallback: Use cached JWKS (1 hour cache)
   - Alert: DevOps team notification if cache expires

2. **Cognito Service Unavailable**
   - Response: Error page with retry option
   - User message: "Service temporarily unavailable. Please try again."

### 7.2 Error Response Format

**JSON Error Response**:
```json
{
  "error": {
    "code": "AUTHENTICATION_FAILED",
    "message": "Your session has expired",
    "details": "Token expired at 2024-01-28T10:30:00Z",
    "requestId": "req-abc-123",
    "timestamp": "2024-01-28T10:35:00Z"
  }
}
```

**HTML Error Page**:
- Consistent branding with application
- Clear error message
- Action buttons (Login, Contact Support)
- Request ID for support reference

### 7.3 Retry Logic

**Token Validation**:
- No automatic retry (security concern)
- User must re-authenticate

**JWKS Fetch**:
- 3 retries with exponential backoff
- Fallback to cached keys
- Alert after 3 failures

**Session Creation**:
- 2 retries with 1 second delay
- Fallback to stateless mode
- Alert after failures


## 8. Performance Optimization

### 8.1 Lambda@Edge Optimization

**Cold Start Mitigation**:
- Keep functions warm with CloudWatch Events (every 5 minutes)
- Minimize dependencies (use native Node.js modules)
- Use Lambda SnapStart when available

**JWKS Caching**:
- Cache JWKS response for 1 hour
- Store in Lambda execution context
- Reduce latency from ~100ms to ~5ms

**Code Optimization**:
- Minimize function size (< 1 MB)
- Use async/await for better performance
- Avoid synchronous operations

### 8.2 Token Validation Optimization

**JWT Verification**:
- Use fast JWT libraries (jsonwebtoken)
- Cache decoded tokens in CloudFront (not implemented for security)
- Validate only required claims

**Performance Targets**:
- Token validation: < 50ms p99
- Total authentication latency: < 200ms p99
- Cold start: < 500ms

### 8.3 Session Management Optimization

**DynamoDB Optimization**:
- Use on-demand billing for variable load
- Enable DAX for read-heavy workloads (optional)
- Use TTL for automatic cleanup
- Batch operations where possible

**Caching Strategy**:
- Cache user profiles in application memory (5 minutes)
- Cache session metadata in Redis (optional)
- Invalidate cache on logout


## 9. Multi-Environment Configuration

### 9.1 Environment-Specific Settings

**Development Environment**:
```typescript
{
  environment: 'dev',
  cognitoUserPoolName: 'chatbot-users-dev',
  iamIdentityCenterApp: 'Chatbot Dev',
  sessionDuration: 4, // hours
  idleTimeout: 30, // minutes
  logLevel: 'DEBUG',
  enableDetailedLogging: true,
}
```

**Staging Environment**:
```typescript
{
  environment: 'staging',
  cognitoUserPoolName: 'chatbot-users-staging',
  iamIdentityCenterApp: 'Chatbot Staging',
  sessionDuration: 8, // hours
  idleTimeout: 60, // minutes
  logLevel: 'INFO',
  enableDetailedLogging: true,
}
```

**Production Environment**:
```typescript
{
  environment: 'production',
  cognitoUserPoolName: 'chatbot-users-prod',
  iamIdentityCenterApp: 'Chatbot Production',
  sessionDuration: 8, // hours
  idleTimeout: 60, // minutes
  logLevel: 'WARN',
  enableDetailedLogging: false,
  removalPolicy: cdk.RemovalPolicy.RETAIN,
}
```

### 9.2 Configuration Management

**CDK Context**:
```json
{
  "environments": {
    "dev": {
      "account": "111111111111",
      "region": "us-west-2",
      "identityCenterInstanceArn": "arn:aws:sso:::instance/ssoins-dev"
    },
    "staging": {
      "account": "222222222222",
      "region": "us-west-2",
      "identityCenterInstanceArn": "arn:aws:sso:::instance/ssoins-staging"
    },
    "production": {
      "account": "333333333333",
      "region": "us-west-2",
      "identityCenterInstanceArn": "arn:aws:sso:::instance/ssoins-prod"
    }
  }
}
```

**Environment Variables**:
- Stored in AWS Systems Manager Parameter Store
- Encrypted with KMS
- Accessed by Lambda@Edge and ECS tasks


## 10. Data Models

### 10.1 JWT Token Structure

**ID Token Claims**:
```json
{
  "sub": "user-uuid-123",
  "email": "user@example.com",
  "email_verified": true,
  "name": "John Doe",
  "cognito:username": "user@example.com",
  "iss": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123",
  "aud": "client-id-123",
  "token_use": "id",
  "auth_time": 1706443200,
  "iat": 1706443200,
  "exp": 1706446800,
  "custom:saml_provider": "IAMIdentityCenter"
}
```

**Access Token Claims**:
```json
{
  "sub": "user-uuid-123",
  "iss": "https://cognito-idp.us-west-2.amazonaws.com/us-west-2_ABC123",
  "client_id": "client-id-123",
  "token_use": "access",
  "scope": "openid email profile",
  "auth_time": 1706443200,
  "iat": 1706443200,
  "exp": 1706446800,
  "username": "user@example.com"
}
```

### 10.2 SAML Assertion Structure

**Key Attributes**:
```xml
<saml:Assertion>
  <saml:Subject>
    <saml:NameID>user@example.com</saml:NameID>
  </saml:Subject>
  <saml:AttributeStatement>
    <saml:Attribute Name="email">
      <saml:AttributeValue>user@example.com</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="name">
      <saml:AttributeValue>John Doe</saml:AttributeValue>
    </saml:Attribute>
    <saml:Attribute Name="sub">
      <saml:AttributeValue>user-uuid-123</saml:AttributeValue>
    </saml:Attribute>
  </saml:AttributeStatement>
</saml:Assertion>
```

### 10.3 User Session Model

**DynamoDB Schema**:
```typescript
interface UserSession {
  sessionId: string;           // PK: uuid
  userId: string;              // SK: Cognito sub
  email: string;
  name: string;
  createdAt: string;           // ISO 8601
  lastAccessedAt: string;      // ISO 8601
  expiresAt: number;           // Unix timestamp (TTL)
  metadata: {
    ipAddress?: string;
    userAgent?: string;
    deviceId?: string;
    location?: {
      country?: string;
      region?: string;
      city?: string;
    };
  };
  preferences?: {
    theme?: 'light' | 'dark';
    language?: string;
    notifications?: boolean;
  };
}
```


## 11. API Specifications

### 11.1 Authentication Endpoints

#### POST /api/auth/callback
**Purpose**: Handle OAuth2 callback from Cognito

**Request**:
```http
POST /api/auth/callback
Content-Type: application/x-www-form-urlencoded

code=auth-code-123&state=state-token-456
```

**Response**:
```json
{
  "success": true,
  "redirectUrl": "/",
  "sessionId": "session-uuid-123"
}
```

#### POST /api/auth/logout
**Purpose**: Terminate user session

**Request**:
```http
POST /api/auth/logout
Authorization: Bearer <id-token>
```

**Response**:
```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### GET /api/auth/session
**Purpose**: Get current session information

**Request**:
```http
GET /api/auth/session
Cookie: session=<session-id>
```

**Response**:
```json
{
  "user": {
    "email": "user@example.com",
    "sub": "user-uuid-123",
    "name": "John Doe"
  },
  "session": {
    "id": "session-uuid-123",
    "createdAt": "2024-01-28T10:00:00Z",
    "expiresAt": "2024-01-28T18:00:00Z"
  }
}
```

### 11.2 User Management Endpoints

#### GET /api/users/me
**Purpose**: Get current user profile

**Request**:
```http
GET /api/users/me
X-User-Email: user@example.com
X-User-Sub: user-uuid-123
```

**Response**:
```json
{
  "userId": "user-uuid-123",
  "email": "user@example.com",
  "name": "John Doe",
  "preferences": {
    "theme": "dark",
    "language": "en"
  },
  "createdAt": "2024-01-01T00:00:00Z",
  "lastLoginAt": "2024-01-28T10:00:00Z"
}
```

#### PUT /api/users/me/preferences
**Purpose**: Update user preferences

**Request**:
```http
PUT /api/users/me/preferences
Content-Type: application/json
X-User-Sub: user-uuid-123

{
  "theme": "dark",
  "language": "en",
  "notifications": true
}
```

**Response**:
```json
{
  "success": true,
  "preferences": {
    "theme": "dark",
    "language": "en",
    "notifications": true
  }
}
```


## 12. Migration Strategy

### 12.1 Migration from Current Authentication

**Current State**: Basic Cognito authentication with self-service sign-up

**Migration Steps**:

1. **Phase 1: Parallel Authentication (Week 1)**
   - Deploy SSO infrastructure alongside existing auth
   - Configure IAM Identity Center application
   - Test SSO flow with pilot users
   - Keep existing Cognito authentication active

2. **Phase 2: User Migration (Week 2-3)**
   - Identify existing users in Cognito
   - Create corresponding users in IAM Identity Center
   - Send migration notifications to users
   - Provide migration guide and support

3. **Phase 3: SSO Enforcement (Week 4)**
   - Disable self-service sign-up in Cognito
   - Redirect all login attempts to SSO
   - Monitor for migration issues
   - Provide fallback for edge cases

4. **Phase 4: Cleanup (Week 5)**
   - Remove old authentication code
   - Archive old user data
   - Update documentation
   - Conduct post-migration review

### 12.2 Data Migration

**User Profile Migration**:
```python
async def migrate_user_profile(cognito_user: dict) -> dict:
    """Migrate user profile from Cognito to IAM Identity Center format"""
    return {
        'email': cognito_user['email'],
        'name': cognito_user.get('name', cognito_user['email']),
        'preferences': cognito_user.get('custom:preferences', {}),
        'migrated_at': datetime.utcnow().isoformat(),
        'original_sub': cognito_user['sub'],
    }
```

**Session Migration**:
- Existing sessions remain valid until expiration
- New sessions use SSO authentication
- No forced logout during migration

### 12.3 Rollback Plan

**Rollback Triggers**:
- Authentication failure rate > 25%
- User complaints > 10 per hour
- Critical security issue discovered

**Rollback Steps**:
1. Re-enable self-service sign-up
2. Remove Lambda@Edge functions
3. Restore previous CloudFront configuration
4. Notify users of rollback
5. Investigate and fix issues


## 13. Documentation Requirements

### 13.1 Architecture Documentation

**Documents to Create**:
1. **Architecture Diagram** (`docs/guides/SSO_ARCHITECTURE.md`)
   - Component diagram
   - Authentication flow diagram
   - Network diagram
   - Data flow diagram

2. **Integration Guide** (`docs/guides/SSO_INTEGRATION.md`)
   - IAM Identity Center setup
   - Cognito configuration
   - Lambda@Edge deployment
   - Testing procedures

3. **API Documentation** (`docs/guides/SSO_API.md`)
   - Authentication endpoints
   - User management endpoints
   - Error codes and responses
   - Example requests/responses

### 13.2 Operational Documentation

**Runbooks**:
1. **User Access Management** (`docs/runbooks/USER_ACCESS.md`)
   - Adding users to application
   - Removing user access
   - Managing groups
   - Troubleshooting access issues

2. **Certificate Rotation** (`docs/runbooks/CERTIFICATE_ROTATION.md`)
   - SAML certificate rotation procedure
   - JWT signing key rotation
   - Monitoring certificate expiration
   - Emergency rotation process

3. **Incident Response** (`docs/runbooks/AUTH_INCIDENT_RESPONSE.md`)
   - Authentication outage response
   - Security incident response
   - Rollback procedures
   - Communication templates

### 13.3 User Documentation

**End User Guides**:
1. **Login Guide** (`docs/user-guides/LOGIN.md`)
   - How to access the application
   - Troubleshooting login issues
   - Session management
   - Logout procedure

2. **FAQ** (`docs/user-guides/AUTH_FAQ.md`)
   - Common questions
   - Known issues
   - Support contact information


## 14. Compliance and Audit

### 14.1 Compliance Requirements

**SOC 2 Compliance**:
- All authentication events logged
- Access logs retained for 90 days
- Encryption at rest and in transit
- Regular access reviews

**GDPR Compliance**:
- User consent for data processing
- Right to data deletion
- Data portability support
- Privacy policy updates

**HIPAA Compliance** (if applicable):
- PHI encryption requirements
- Audit logging requirements
- Access control requirements
- Business Associate Agreements

### 14.2 Audit Logging

**Events to Log**:
```typescript
interface AuditEvent {
  eventId: string;
  eventType: 'LOGIN' | 'LOGOUT' | 'ACCESS_GRANTED' | 'ACCESS_DENIED' | 'TOKEN_REFRESH' | 'SESSION_EXPIRED';
  timestamp: string;
  userId: string;
  email: string;
  ipAddress: string;
  userAgent: string;
  resource: string;
  action: string;
  result: 'SUCCESS' | 'FAILURE';
  errorCode?: string;
  metadata?: Record<string, any>;
}
```

**Audit Log Storage**:
- Primary: CloudWatch Logs
- Archive: S3 with Glacier transition
- Retention: 7 years (configurable)
- Encryption: AES-256

### 14.3 Access Reviews

**Quarterly Access Review**:
- Review all user access assignments
- Identify inactive users
- Remove unnecessary permissions
- Document review results

**Automated Reporting**:
- Weekly access summary report
- Monthly security metrics report
- Quarterly compliance report
- Annual audit report


## 15. Cost Estimation

### 15.1 AWS Service Costs (Monthly)

**Cognito**:
- MAU (Monthly Active Users): 1000 users
- Cost: $0.0055 per MAU = $5.50/month

**Lambda@Edge**:
- Requests: 10M requests/month
- Duration: 50ms average
- Cost: ~$20/month

**CloudFront**:
- Data transfer: 100 GB/month
- Requests: 10M requests/month
- Cost: ~$15/month

**DynamoDB**:
- On-demand pricing
- Read/Write units: ~1M per month
- Storage: 1 GB
- Cost: ~$5/month

**CloudWatch**:
- Logs: 10 GB/month
- Metrics: 100 custom metrics
- Alarms: 10 alarms
- Cost: ~$10/month

**Secrets Manager**:
- Secrets: 5 secrets
- API calls: 10,000/month
- Cost: ~$2.50/month

**Total Estimated Cost**: ~$58/month for 1000 users

### 15.2 Cost Optimization

**Strategies**:
1. Use CloudFront caching for static assets
2. Optimize Lambda@Edge function size
3. Use DynamoDB on-demand for variable load
4. Implement log retention policies
5. Use S3 Intelligent-Tiering for audit logs

**Cost Monitoring**:
- Set up AWS Budgets alerts
- Monitor cost anomalies
- Review cost allocation tags
- Optimize based on usage patterns


## 16. Risk Assessment and Mitigation

### 16.1 Security Risks

**Risk 1: Token Theft**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**:
  - Use HttpOnly, Secure cookies
  - Implement token rotation
  - Monitor for suspicious activity
  - Short token expiration (1 hour)

**Risk 2: SAML Assertion Replay**
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**:
  - Validate assertion timestamps
  - Implement nonce validation
  - Short assertion validity (5 minutes)
  - Monitor for duplicate assertions

**Risk 3: Lambda@Edge Compromise**
- **Likelihood**: Low
- **Impact**: Critical
- **Mitigation**:
  - Minimal IAM permissions
  - Code signing
  - Regular security audits
  - Automated vulnerability scanning

### 16.2 Operational Risks

**Risk 1: IAM Identity Center Outage**
- **Likelihood**: Low
- **Impact**: Critical
- **Mitigation**:
  - Multi-region deployment (future)
  - Cached authentication (limited)
  - Clear communication plan
  - SLA monitoring

**Risk 2: Certificate Expiration**
- **Likelihood**: Medium
- **Impact**: Critical
- **Mitigation**:
  - Automated expiration monitoring
  - 30-day advance alerts
  - Documented rotation procedure
  - Backup certificates

**Risk 3: Lambda@Edge Deployment Failure**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**:
  - Canary deployments
  - Automated rollback
  - Pre-deployment testing
  - Blue-green deployment strategy

### 16.3 Compliance Risks

**Risk 1: Audit Log Loss**
- **Likelihood**: Low
- **Impact**: High
- **Mitigation**:
  - Multi-region log replication
  - S3 versioning enabled
  - Immutable log storage
  - Regular backup verification

**Risk 2: Unauthorized Access**
- **Likelihood**: Medium
- **Impact**: High
- **Mitigation**:
  - Regular access reviews
  - Automated access revocation
  - MFA enforcement
  - Anomaly detection


## 17. Future Enhancements

### 17.1 Planned Enhancements

**Phase 2 (Q2 2024)**:
1. **Multi-Region Support**
   - Deploy Lambda@Edge to additional regions
   - Multi-region DynamoDB tables
   - Global session management

2. **Advanced Session Management**
   - Device fingerprinting
   - Anomaly detection
   - Concurrent session limits
   - Session activity tracking

3. **Enhanced Monitoring**
   - Real-time authentication dashboard
   - Predictive alerting
   - User behavior analytics
   - Security posture scoring

**Phase 3 (Q3 2024)**:
1. **API Key Authentication**
   - Support for programmatic access
   - API key management UI
   - Rate limiting per key
   - Key rotation automation

2. **Mobile App Support**
   - PKCE flow implementation
   - Biometric authentication
   - Push notifications
   - Offline mode support

3. **Advanced Authorization**
   - Role-based access control (RBAC)
   - Attribute-based access control (ABAC)
   - Fine-grained permissions
   - Dynamic policy evaluation

### 17.2 Research Items

**Under Investigation**:
1. **Passwordless Authentication**
   - WebAuthn/FIDO2 support
   - Magic link authentication
   - Biometric authentication

2. **Zero Trust Architecture**
   - Continuous authentication
   - Context-aware access
   - Micro-segmentation
   - Device trust verification

3. **Blockchain-Based Identity**
   - Decentralized identity
   - Self-sovereign identity
   - Verifiable credentials


## 18. Implementation Checklist

### 18.1 Infrastructure Tasks

- [ ] Update CognitoAuthStack with SAML provider
- [ ] Create Lambda@Edge viewer request function
- [ ] Create Lambda@Edge origin request function
- [ ] Update CloudFront distribution with Lambda@Edge
- [ ] Configure IAM roles and policies
- [ ] Set up CloudWatch alarms and dashboards
- [ ] Configure Secrets Manager for SAML metadata
- [ ] Update DynamoDB tables for session management
- [ ] Deploy to dev environment
- [ ] Deploy to staging environment
- [ ] Deploy to production environment

### 18.2 Application Tasks

- [ ] Implement FastAPI auth middleware
- [ ] Implement Next.js auth middleware
- [ ] Create authentication API routes
- [ ] Update user management endpoints
- [ ] Implement session management
- [ ] Add user identity headers handling
- [ ] Update error handling
- [ ] Add authentication logging
- [ ] Update frontend components
- [ ] Add logout functionality

### 18.3 Configuration Tasks

- [ ] Configure IAM Identity Center application
- [ ] Upload SAML metadata to Cognito
- [ ] Configure attribute mappings
- [ ] Assign test users to application
- [ ] Configure callback URLs
- [ ] Set up environment variables
- [ ] Configure secrets in Secrets Manager
- [ ] Update DNS records (if needed)
- [ ] Configure SSL certificates
- [ ] Set up monitoring dashboards

### 18.4 Testing Tasks

- [ ] Unit tests for Lambda@Edge functions
- [ ] Unit tests for backend middleware
- [ ] Integration tests for SAML flow
- [ ] End-to-end authentication tests
- [ ] Load testing
- [ ] Security testing
- [ ] User acceptance testing
- [ ] Performance testing
- [ ] Failover testing
- [ ] Rollback testing

### 18.5 Documentation Tasks

- [ ] Architecture documentation
- [ ] Deployment guide
- [ ] User access management runbook
- [ ] Certificate rotation runbook
- [ ] Incident response runbook
- [ ] API documentation
- [ ] User login guide
- [ ] FAQ document
- [ ] Migration guide
- [ ] Troubleshooting guide

### 18.6 Operational Tasks

- [ ] Set up monitoring alerts
- [ ] Configure log retention
- [ ] Set up backup procedures
- [ ] Create access review process
- [ ] Train support team
- [ ] Create communication plan
- [ ] Schedule maintenance windows
- [ ] Plan rollback procedures
- [ ] Conduct security review
- [ ] Obtain compliance approval

## 19. Success Criteria

### 19.1 Functional Success Criteria

- ✅ Users can authenticate through AWS Access Portal
- ✅ SAML assertions are correctly processed
- ✅ JWT tokens are validated at CloudFront edge
- ✅ User identity headers are correctly injected
- ✅ Sessions are properly managed
- ✅ Logout functionality works correctly
- ✅ Error handling provides clear messages
- ✅ All API endpoints respect authentication

### 19.2 Performance Success Criteria

- ✅ Authentication latency < 3 seconds (p95)
- ✅ Token validation latency < 50ms (p99)
- ✅ System supports 1000+ concurrent users
- ✅ No performance degradation under load
- ✅ Lambda@Edge cold start < 500ms

### 19.3 Security Success Criteria

- ✅ All tokens are properly validated
- ✅ SAML assertions are signed and verified
- ✅ No security vulnerabilities identified
- ✅ Audit logging captures all events
- ✅ Compliance requirements met
- ✅ Penetration testing passed

### 19.4 Operational Success Criteria

- ✅ Monitoring dashboards operational
- ✅ Alerts configured and tested
- ✅ Documentation complete
- ✅ Runbooks tested
- ✅ Support team trained
- ✅ Rollback procedures validated

## 20. Appendices

### 20.1 Glossary

- **SAML**: Security Assertion Markup Language
- **IdP**: Identity Provider (IAM Identity Center)
- **SP**: Service Provider (Cognito)
- **JWT**: JSON Web Token
- **JWKS**: JSON Web Key Set
- **ACS**: Assertion Consumer Service
- **SSO**: Single Sign-On
- **MFA**: Multi-Factor Authentication
- **TTL**: Time To Live

### 20.2 References

- [AWS IAM Identity Center Documentation](https://docs.aws.amazon.com/singlesignon/)
- [Amazon Cognito SAML Federation](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-saml-idp.html)
- [Lambda@Edge Documentation](https://docs.aws.amazon.com/lambda/latest/dg/lambda-edge.html)
- [SAML 2.0 Specification](http://docs.oasis-open.org/security/saml/v2.0/)
- [JWT RFC 7519](https://tools.ietf.org/html/rfc7519)

### 20.3 Contact Information

- **DevOps Team**: devops@example.com
- **Security Team**: security@example.com
- **Support Team**: support@example.com
- **On-Call**: +1-555-0100
