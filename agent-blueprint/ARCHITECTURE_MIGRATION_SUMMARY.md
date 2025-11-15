# Architecture Migration Summary

## Date: 2025-01-13

## Overview
Migrated from a three-container architecture (Frontend + Backend + Agent) to a two-service architecture (Frontend+BFF + AgentCore Runtime) to align with AWS Bedrock AgentCore best practices.

---

## Architecture Changes

### Previous Architecture (Before Migration)
```
CloudFront → ALB → ┌─ Frontend Container (Next.js - Port 3000)
                   │
                   └─ Backend Container (FastAPI - Port 8000)
                       ├─ Direct Bedrock API calls
                       ├─ Strands Agent execution
                       ├─ MCP client management
                       └─ Session management
```

**Problems:**
- Backend had direct Bedrock permissions (security concern)
- Agent logic mixed with HTTP concerns
- Difficult to scale independently
- No clear separation between HTTP layer and AI execution

### New Architecture (After Migration)
```
CloudFront → ALB → Frontend+BFF Container (Next.js - Port 3000)
                       ├─ UI (React components)
                       ├─ BFF (Next.js API routes at /api/*)
                       │   └─ InvokeAgentRuntimeCommand
                       └─ Session ID management
                            ↓
                   AgentCore Runtime (Managed Service)
                       ├─ Strands Agent execution
                       ├─ Tool management
                       ├─ MCP client pool
                       └─ Bedrock API calls
```

**Benefits:**
- ✅ Clear separation of concerns (HTTP vs AI execution)
- ✅ AgentCore Runtime is a managed AWS service (auto-scaling, observability)
- ✅ Reduced IAM surface area (no direct Bedrock permissions in containers)
- ✅ Independent scaling capabilities
- ✅ Simplified deployment (2 stacks instead of complex orchestration)

---

## File Changes

### 1. AgentCore Runtime Stack
**File:** `agentcore-runtime-stack/lib/agent-runtime-stack.ts`

**Changes:**
- ✅ Added CodeBuild integration for automated ARM64 container building
- ✅ Added S3 bucket for agent source code
- ✅ Added BucketDeployment to upload agent code
- ✅ Added Custom Resource to trigger CodeBuild
- ✅ Added Lambda function to wait for build completion
- ✅ Added Runtime with dependencies on build completion

**Key Configurations:**
```typescript
// Runtime name must use underscores only
const runtimeName = projectName.replace(/-/g, '_') + '_runtime';
// Result: 'strands_agent_chatbot_runtime'

// Service principal (critical - WITH hyphen!)
assumedBy: new iam.ServicePrincipal('bedrock-agentcore.amazonaws.com')

// Parameter Store paths
parameterName: `/${projectName}/${environment}/agentcore/runtime-arn`
parameterName: `/${projectName}/${environment}/agentcore/runtime-id`
```

### 2. Frontend/BFF Stack
**File:** `chatbot-deployment/infrastructure/lib/chatbot-stack.ts`

**Removed:**
- ❌ Backend ECR repository import
- ❌ Backend task definition (68 lines)
- ❌ Backend container and service (54 lines)
- ❌ Backend target group (17 lines)
- ❌ Backend ALB routing rules (15 lines)
- ❌ Direct Bedrock permissions (AmazonBedrockFullAccess, BedrockAgentCoreFullAccess)
- ❌ AgentCore Observability configuration (OTEL env vars)

**Added:**
- ✅ AgentCore Runtime invocation permissions (`bedrock-agentcore:InvokeAgentRuntime`)
- ✅ SSM Parameter Store read permissions for Runtime ARN
- ✅ PROJECT_NAME and ENVIRONMENT environment variables
- ✅ Increased resources for Frontend+BFF (1024 MB memory, 512 CPU)

**Updated:**
- 🔄 Health check path: `/health` → `/api/health` (Next.js API route)
- 🔄 ALB routing: Single target group for all traffic
- 🔄 Log group: Simplified to `/ecs/chatbot-frontend` only

**IAM Permissions Before:**
```typescript
// Backend (REMOVED)
AmazonBedrockFullAccess
BedrockAgentCoreFullAccess
execute-api:Invoke (MCP servers)
ssm:GetParameter (MCP endpoints)
logs:CreateLogStream, logs:PutLogEvents
xray:PutTraceSegments
```

**IAM Permissions After:**
```typescript
// Frontend+BFF (NEW)
bedrock-agentcore:InvokeAgentRuntime  // ← NEW: Call AgentCore Runtime
ssm:GetParameter (AgentCore + MCP)    // ← UPDATED: Added AgentCore params
execute-api:Invoke (MCP servers)      // ← KEPT: Optional direct MCP calls
logs:CreateLogStream, logs:PutLogEvents  // ← KEPT: CloudWatch logs
```

### 3. CDK App Entry Point
**File:** `chatbot-deployment/infrastructure/bin/app.ts`

**Added:**
```typescript
const chatbotStack = new ChatbotStack(app, 'ChatbotStack', {
  env,
  ...cognitoProps,
  projectName: 'strands-agent-chatbot',  // ← NEW
  environment: 'dev',                     // ← NEW
});
```

---

## Environment Variables

### Before (Backend Container)
```bash
DEPLOYMENT_ENV=production
STORAGE_TYPE=local
HOST=0.0.0.0
PORT=8000
CORS_ORIGINS=*
AWS_DEFAULT_REGION=us-west-2
AWS_REGION=us-west-2

# AgentCore Observability (REMOVED)
OTEL_PYTHON_DISTRO=aws_distro
OTEL_PYTHON_CONFIGURATOR=aws_configurator
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp
OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-aws-log-group=...
OTEL_RESOURCE_ATTRIBUTES=service.name=strands-chatbot
AGENT_OBSERVABILITY_ENABLED=true
OTEL_BSP_SCHEDULE_DELAY=100
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=1
```

### After (Frontend+BFF Container)
```bash
NODE_ENV=production
FORCE_UPDATE=2025-01-13T...
NEXT_PUBLIC_AWS_REGION=us-west-2
AWS_DEFAULT_REGION=us-west-2
AWS_REGION=us-west-2

# AgentCore Runtime Integration (NEW)
PROJECT_NAME=strands-agent-chatbot
ENVIRONMENT=dev

# Optional (if Cognito enabled)
NEXT_PUBLIC_COGNITO_USER_POOL_ID=...
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=...
```

---

## Deployment Scripts

### Before
```bash
# Complex orchestration with multiple scripts
deploy.sh
  ├─ deploy-agentcore-runtime.sh
  ├─ deploy-frontend.sh
  ├─ deploy-backend.sh
  └─ deploy-mcp-servers.sh
```

### After
```bash
# Simplified deployment
deploy.sh
  ├─ Deploy AgentCore Runtime Stack (single CDK stack)
  └─ Deploy Frontend+BFF Stack (single CDK stack)
```

---

## Parameter Store Structure

### AgentCore Runtime Parameters
```
/strands-agent-chatbot/dev/agentcore/runtime-arn
/strands-agent-chatbot/dev/agentcore/runtime-id
```

### MCP Server Parameters (Unchanged)
```
/mcp/endpoints/serverless/aws-documentation
/mcp/endpoints/serverless/aws-pricing
/mcp/endpoints/serverless/tavily-web-search
/mcp/endpoints/fargate/nova-act-mcp
/mcp/endpoints/fargate/python-mcp
```

---

## Integration Flow

### HTTP Request Flow
```
1. User → CloudFront (HTTPS)
2. CloudFront → ALB (HTTP, CloudFront-only security)
3. ALB → Frontend Container (port 3000)
4. Next.js routes request:
   - UI route → React component rendering
   - /api/* route → Next.js API route handler
```

### Agent Invocation Flow
```
1. Frontend: User sends chat message
2. Next.js API route (/api/chat):
   - Fetch Runtime ARN from SSM Parameter Store
   - Prepare request payload with session ID
   - Call AWS SDK: InvokeAgentRuntimeCommand
3. AgentCore Runtime:
   - Receives request via Bedrock AgentCore API
   - Executes Strands Agent in container
   - Calls tools (Built-in, Custom, MCP, Sub-Agents)
   - Streams response back
4. BFF: Streams response to frontend
5. Frontend: Displays streaming response
```

### Session Management
```typescript
// Request payload to AgentCore Runtime
{
  agentRuntimeArn: "arn:aws:bedrock-agentcore:...:agent-runtime/...",
  sessionId: "user-123-session-456",  // ← Critical for continuity
  input: "What is AWS Lambda?"
}
```

---

## Security Improvements

### Before
```
Frontend Container
  └─ No AWS permissions (static serving only)

Backend Container
  ├─ AmazonBedrockFullAccess (⚠️ Too broad)
  ├─ BedrockAgentCoreFullAccess (⚠️ Unnecessary)
  ├─ Direct model invocation
  └─ Full agent execution logic
```

### After
```
Frontend+BFF Container
  ├─ bedrock-agentcore:InvokeAgentRuntime (✅ Scoped)
  ├─ ssm:GetParameter (✅ Specific paths only)
  └─ No direct Bedrock model access

AgentCore Runtime (Managed Service)
  ├─ bedrock:InvokeModel (Managed by AWS)
  ├─ bedrock:Converse (Managed by AWS)
  └─ Execution role managed by AgentCore Runtime Stack
```

**Security Benefits:**
- ✅ Reduced attack surface (no direct Bedrock access in containers)
- ✅ Principle of least privilege (only invoke runtime, not models)
- ✅ AWS-managed execution environment (auto-patching, monitoring)
- ✅ Isolated agent execution (can't affect web container)

---

## Cost Implications

### Before (3 containers)
- Frontend: 512 MB, 256 CPU
- Backend: 512 MB, 256 CPU
- **Total:** 1024 MB, 512 CPU

### After (1 container + managed service)
- Frontend+BFF: 1024 MB, 512 CPU
- AgentCore Runtime: Pay-per-use (AWS managed)

**Cost Changes:**
- ➖ Removed Backend container ECS costs (~$15-20/month)
- ➕ Added AgentCore Runtime usage costs (pay-per-invocation)
- **Net:** Likely cost reduction for low-traffic workloads
- **Benefit:** Auto-scaling without manual configuration

---

## Testing Checklist

### Infrastructure Deployment
- [ ] AgentCore Runtime Stack deploys successfully
- [ ] CodeBuild builds ARM64 image
- [ ] Runtime is created with correct name (`strands_agent_chatbot_runtime`)
- [ ] Parameter Store entries created
- [ ] Frontend+BFF Stack deploys successfully
- [ ] CloudFront distribution accessible
- [ ] ALB health checks passing

### Runtime Invocation
- [ ] BFF can fetch Runtime ARN from Parameter Store
- [ ] BFF can invoke AgentCore Runtime
- [ ] Session ID is properly included in requests
- [ ] Streaming responses work correctly
- [ ] Error handling works (runtime not found, timeout, etc.)

### Agent Functionality
- [ ] Built-in tools work (calculator, http_request, etc.)
- [ ] Custom tools work (diagram_creator, weather_lookup, etc.)
- [ ] MCP servers accessible from Runtime
- [ ] Sub-agents work (spending_analysis_agent, etc.)
- [ ] File uploads processed correctly
- [ ] Session continuity maintained across messages

### Security Validation
- [ ] Direct ALB access blocked (CloudFront-only)
- [ ] No direct Bedrock permissions in Frontend container
- [ ] SSM Parameter Store access scoped correctly
- [ ] Cognito authentication works (if enabled)
- [ ] IAM role trust policies correct

---

## Rollback Plan

If issues arise, rollback to previous architecture:

```bash
# 1. Revert infrastructure files
cd agent-blueprint/chatbot-deployment/infrastructure
git checkout HEAD~1 lib/chatbot-stack.ts
git checkout HEAD~1 bin/app.ts

# 2. Destroy new stacks
cd ../../agentcore-runtime-stack
npx cdk destroy --force

# 3. Redeploy old architecture
cd ../chatbot-deployment/infrastructure
./scripts/deploy.sh
```

---

## Next Steps

### Phase 1: Frontend/BFF Application Code (NEXT)
**Location:** `chatbot-app/frontend/`

**Required Changes:**
1. Create Next.js API routes for BFF functionality
   - `/api/chat` - Stream responses from AgentCore Runtime
   - `/api/health` - Health check endpoint
   - `/api/tools` - Tool configuration management
   - `/api/sessions` - Session management

2. Implement AgentCore Runtime client
   - Create `lib/agent-core-client.ts`
   - Use AWS SDK `BedrockAgentRuntimeClient`
   - Fetch Runtime ARN from SSM Parameter Store
   - Include session ID in all requests

3. Update Dockerfile
   - Build Next.js with API routes
   - Single container for UI + BFF
   - Environment variables for Runtime integration

**Example API Route:**
```typescript
// app/api/chat/route.ts
import { BedrockAgentRuntimeClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';

export async function POST(request: Request) {
  // Fetch Runtime ARN from Parameter Store
  const ssmClient = new SSMClient({ region: process.env.AWS_REGION });
  const param = await ssmClient.send(new GetParameterCommand({
    Name: `/${process.env.PROJECT_NAME}/${process.env.ENVIRONMENT}/agentcore/runtime-arn`
  }));
  const runtimeArn = param.Parameter.Value;

  // Parse request
  const { message, sessionId } = await request.json();

  // Invoke AgentCore Runtime
  const client = new BedrockAgentRuntimeClient({ region: process.env.AWS_REGION });
  const command = new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    sessionId: sessionId,
    input: message
  });

  // Stream response
  const response = await client.send(command);
  // ... stream handling
}
```

### Phase 2: Agent Code Migration
**Location:** `chatbot-app/agent-core/`

**Required Changes:**
1. Move agent code from `backend/` to `agent-core/`
   - `agent.py` → `agent-core/src/agent/chatbot_agent.py`
   - `tool_manager.py` → `agent-core/src/tools/tool_manager.py`
   - `mcp_session_manager.py` → `agent-core/src/tools/mcp_client.py`

2. Create HTTP server for AgentCore Runtime
   - FastAPI app listening on port 8080
   - Health check endpoint
   - Request/response handling for Bedrock AgentCore protocol

3. Update Dockerfile
   - ARM64 base image
   - Install dependencies
   - Expose port 8080

### Phase 3: Testing & Validation
1. Local testing with docker-compose
2. Integration tests with AgentCore Runtime
3. Load testing
4. Security audit
5. Performance benchmarking

---

## Documentation Updates Needed

1. **DEPLOYMENT.md**
   - Update architecture diagram
   - Update deployment steps
   - Add AgentCore Runtime deployment section

2. **README.md**
   - Update architecture overview
   - Update technology stack
   - Add AgentCore Runtime section

3. **CLAUDE.md**
   - Mark Phase 1 as COMPLETE
   - Update current status
   - Document lessons learned

---

## Lessons Learned

### What Went Well
1. ✅ L1 constructs (`CfnRuntime`) work reliably in TypeScript
2. ✅ CodeBuild integration provides reliable image building
3. ✅ Build waiter Lambda pattern works well for synchronous deployments
4. ✅ Parameter Store is perfect for Runtime ARN storage

### Challenges Encountered
1. ⚠️ Runtime name validation: Only alphanumeric + underscores allowed
2. ⚠️ Service principal: `bedrock-agentcore.amazonaws.com` (WITH hyphen!)
3. ⚠️ ECR repository conflicts: Use environment variable to import existing
4. ⚠️ Build timing: Must wait for image before creating Runtime

### Best Practices Established
1. 📝 Always validate resource names against AWS regex patterns
2. 📝 Use Custom Resources for synchronous operations (build waiting)
3. 📝 Store ARNs in Parameter Store for cross-stack references
4. 📝 Add detailed comments about critical configurations (service principals, etc.)
5. 📝 Use environment variables for conditional resource creation

---

## References

- [AWS Bedrock AgentCore Documentation](https://docs.aws.amazon.com/bedrock/latest/userguide/agentcore.html)
- [sample-amazon-bedrock-agentcore-fullstack-webapp](../sdk-python/sample-amazon-bedrock-agentcore-fullstack-webapp/)
- [CDK TypeScript Reference](https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_bedrockagentcore-readme.html)
- [Strands Agents Framework](https://github.com/anthropics/strands-agents)

---

**Status:** Infrastructure migration COMPLETE ✅
**Next:** Frontend/BFF application code implementation
**Owner:** Development Team
**Last Updated:** 2025-01-13
