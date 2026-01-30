# Deployment Guide

Complete deployment instructions for the AgentCore-based chatbot platform.

## Prerequisites

- **AWS Account** with Bedrock access (Claude models enabled)
- **AWS CLI** configured with credentials
- **Docker** installed and running
- **Node.js** and **Python** installed
- **CDK CLI**: `npm install -g aws-cdk`
- **AgentCore** enabled in your AWS account region

## Architecture Overview

```
User → CloudFront → ALB → Frontend+BFF (Fargate)
                              ↓ HTTP
                         AgentCore Runtime
                         (Strands Agent container)
                              ↓
            ┌─────────────────┼─────────────────┐
            │                 │                 │
            ↓ SigV4           ↓ A2A             ↓ AWS SDK
     AgentCore Gateway   Research Agent    Built-in Tools
     (MCP endpoints)     Runtime ✅        (Code Interpreter,
            ↓                               Browser + Nova Act)
     Lambda Functions (5x)
     └─ Wikipedia, ArXiv,
        Google, Tavily, Finance

     AgentCore Memory
     └─ Conversation history
        User preferences & facts
```

## Quick Deployment

### Deploy All Components

```bash
# 1. Configure environment
cd agent-blueprint
cp .env.example .env
# Edit .env with your AWS credentials

# 2. Deploy everything
./deploy.sh
```

This deploys:
- Frontend + BFF (Fargate)
- AgentCore Runtime with Memory
- AgentCore Gateway + Lambda tools
- Research Agent Runtime (A2A)

**Estimated Time**: 30-40 minutes

### Remove All Components

```bash
cd agent-blueprint
./destroy.sh
```

## What Gets Deployed

### 1. Frontend + BFF Stack
- **Service**: Fargate
- **Components**: Next.js UI + API routes (BFF)
- **Infrastructure**: VPC, ALB, CloudFront, Cognito
- **Location**: `agent-blueprint/chatbot-deployment/`

### 2. AgentCore Runtime
- **Container**: Strands Agent with local tools
- **Documentation**: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
- **Location**: `agent-blueprint/agentcore-runtime-stack/`

### 3. AgentCore Memory
- **Purpose**: Persistent conversation storage with user preferences/facts retrieval
- **Features**: Short-term (conversation history) + Long-term (user context)
- **Documentation**: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
- **Location**: Deployed with AgentCore Runtime

### 4. Built-in Tools
- **Protocol**: AWS SDK + WebSocket
- **Tools**:
  - Code Interpreter: Python code execution for diagrams/charts
  - Browser Automation: Web navigation and data extraction (Nova Act AI)
- **Documentation**: https://docs.aws.amazon.com/bedrock/latest/userguide/
- **Location**: Integrated with AgentCore Runtime

### 5. AgentCore Gateway
- **Purpose**: MCP tool endpoints with SigV4 authentication
- **Architecture**: Lambda functions exposed as MCP endpoints via AgentCore Gateway
- **Tools**: 5 Lambda functions (12 tools total)
  - Wikipedia (2 tools)
  - ArXiv (2 tools)
  - Google Search (2 tools)
  - Tavily (2 tools)
  - Finance (4 tools)
- **Documentation**: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
- **Location**: `agent-blueprint/agentcore-gateway-stack/`

### 6. Research Agent Runtime (A2A)
- **Protocol**: A2A (Agent-to-Agent) with main Runtime
- **Features**: Comprehensive web research with markdown reports and citations
- **Storage**: S3 bucket for generated charts
- **Status**: ✅ Production Ready
- **Location**: `agent-blueprint/agentcore-runtime-a2a-stack/research-agent/`

## Step-by-Step Deployment

### Step 1: Configure Environment

```bash
cd agent-blueprint
cp .env.example .env
```

Edit `.env`:

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCOUNT_ID=your-account-id

# AgentCore Configuration
AGENTCORE_MODEL_ID=eu.anthropic.claude-sonnet-4-20250514-v1:0
AGENTCORE_TEMPERATURE=0.7

# Gateway Tools API Keys (optional)
TAVILY_API_KEY=your-tavily-key
GOOGLE_API_KEY=your-google-key
GOOGLE_SEARCH_ENGINE_ID=your-engine-id
```

### Step 2: Deploy

```bash
cd agent-blueprint

# Deploy all components
./deploy.sh

# Or deploy individually:
# ./deploy.sh --frontend     # Frontend + BFF only
# ./deploy.sh --runtime      # AgentCore Runtime only
# ./deploy.sh --gateway      # Gateway + Lambda tools only
# ./deploy.sh --research-agent # Research Agent Runtime only
```

### Step 3: Configure API Keys (if not in .env)

```bash
# Tavily API Key
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/tavily-api-key \
  --secret-string "YOUR_TAVILY_KEY"

# Google Search Credentials
aws secretsmanager put-secret-value \
  --secret-id strands-agent-chatbot/mcp/google-credentials \
  --secret-string '{"api_key":"YOUR_KEY","search_engine_id":"YOUR_ID"}'
```

### Step 4: Access Application

```bash
# Get CloudFront URL
aws cloudformation describe-stacks \
  --stack-name ChatbotStack \
  --query 'Stacks[0].Outputs[?OutputKey==`CloudFrontUrl`].OutputValue' \
  --output text
```

Visit the URL and:
1. Click "Sign up"
2. Create account with email and password
3. Verify email with code
4. Sign in

## Local Development

```bash
# 1. Setup
cd chatbot-app
./setup.sh

# 2. Configure AWS credentials
cd ../agent-blueprint
cp .env.example .env
# Edit with your AWS credentials

# 3. Start services
cd ../chatbot-app
./start.sh
```

**Access**:
- Frontend: http://localhost:3000
- AgentCore Runtime: http://localhost:8000
- API Docs: http://localhost:8000/docs

**What runs locally**:
- ✅ Frontend (Next.js)
- ✅ AgentCore Runtime (Strands Agent)
- ✅ Local Tools (5 tools)
- ✅ Built-in Tools (Code Interpreter, Browser via AWS API)
- ❌ AgentCore Gateway (requires cloud deployment)
- ❌ AgentCore Memory (uses local file storage instead)

**Note**: Local mode runs AgentCore Runtime in a container but still uses AWS Bedrock API for model calls and built-in tools.

## Post-Deployment Configuration

### Enable Gateway Tools

Tools are disabled by default. Enable via UI:
1. Sign in to application
2. Click gear icon → Settings
3. Navigate to "Gateway Tools" section
4. Toggle desired tools ON
5. Click "Save"

Or edit `chatbot-app/frontend/src/config/tools-config.json`:

```json
{
  "gateway_targets": [
    {
      "id": "gateway_wikipedia-search",
      "name": "Wikipedia",
      "enabled": true,  // <- Change to true
      "isDynamic": true
    }
  ]
}
```

### Verify Deployment

```bash
# Test Gateway
cd agent-blueprint/agentcore-gateway-stack
./scripts/test-gateway.sh

# Expected output:
# ✅ Wikipedia tools: 2
# ✅ ArXiv tools: 2
# ✅ Google Search tools: 2
# ✅ Tavily tools: 2
# ✅ Finance tools: 4
```

## Troubleshooting

### Container Build Failures

```bash
# Check CodeBuild logs
aws logs tail /aws/codebuild/agentcore-runtime-build --follow
```

### Runtime Execution Errors

```bash
# Check AgentCore Runtime logs
aws logs tail /aws/bedrock-agentcore/runtimes/your-runtime-arn --follow
```

### Gateway Connection Issues

```bash
# Verify gateway deployment
aws bedrock-agentcore list-gateways

# Check gateway targets
aws bedrock-agentcore list-gateway-targets \
  --gateway-id your-gateway-id
```

### Local Development Issues

```bash
# Check AgentCore Runtime logs
docker logs -f agentcore

# Or check via Docker Compose
cd chatbot-app
docker-compose logs -f agentcore

# Common issues:
# - Port 8000 already in use (kill existing process or change port)
# - Port 3000 already in use (kill existing process)
# - AWS credentials not configured (run aws configure)
# - Bedrock access denied (check IAM permissions)
# - AgentCore not enabled in region (contact AWS support)
```

## Updating Deployment

### Update Frontend or Runtime

```bash
cd agent-blueprint
./deploy.sh --frontend  # Update frontend only
./deploy.sh --runtime   # Update runtime only
./deploy.sh             # Update all
```

### Update Gateway Lambda Functions

```bash
cd agent-blueprint/agentcore-gateway-stack
./scripts/build-lambdas.sh
./scripts/deploy.sh
```

### Update Tool Configuration

```bash
# Edit tool config
vim chatbot-app/frontend/src/config/tools-config.json

# Redeploy frontend
cd agent-blueprint
./deploy.sh --frontend
```

## Cleanup

### Remove All Components

```bash
cd agent-blueprint
./destroy.sh
```

This deletes (in order):
1. Research Agent Runtime (if deployed)
2. AgentCore Gateway and Lambda functions
3. AgentCore Runtime
4. Frontend + BFF
5. VPC and networking resources

### Remove Individual Components

```bash
cd agent-blueprint

# Remove specific components
./destroy.sh --research-agent # Research Agent only
./destroy.sh --gateway        # Gateway only
./destroy.sh --runtime        # Runtime only
./destroy.sh --frontend       # Frontend only
```

### Clean ECR Repositories

```bash
# Delete ECR repositories (optional)
aws ecr delete-repository \
  --repository-name strands-agent-chatbot-frontend \
  --force

aws ecr delete-repository \
  --repository-name strands-agent-chatbot-agent-core \
  --force
```

## Security Best Practices

1. **Rotate Secrets Regularly**
   ```bash
   aws secretsmanager rotate-secret \
     --secret-id strands-agent-chatbot/mcp/tavily-api-key
   ```

2. **Enable WAF** on CloudFront for DDoS protection

3. **Review IAM Roles** quarterly to ensure least privilege

4. **Enable VPC Flow Logs** for network monitoring

5. **Use Cognito MFA** for admin users

## Support

- **Troubleshooting**: [docs/guides/TROUBLESHOOTING.md](docs/guides/TROUBLESHOOTING.md)
- **Architecture**: See README.md for architecture overview
- **AgentCore Details**: See AGENTCORE.md for AgentCore usage
- **Issues**: [GitHub Issues](https://github.com/aws-samples/sample-strands-agent-chatbot/issues)

---

**Deployment Complete!** Access your chatbot via the CloudFront URL.
