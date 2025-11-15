# Strands Agent Chatbot - Deployment Guide

## Architecture Overview

```
Browser
  │
  ▼
Frontend + BFF (ECS Fargate)
  │ Next.js + API Routes
  │ @aws-sdk/client-bedrock-agentcore
  │
  ▼ InvokeAgentRuntimeCommand
AWS Bedrock AgentCore Runtime
  │ (Managed Service)
  │ Runtime ARN: arn:aws:bedrock-agentcore:...
  │
  ├─ Agent Core Container (ECR)
  │  └─ FastAPI + Strands Agent
  │     ├─ Calculator
  │     ├─ Weather
  │     ├─ Visualization
  │     ├─ Web Search
  │     └─ URL Fetcher
  │
  └─> MCP Servers (Lambda + ECS)
```

## Quick Start

### Prerequisites

- Docker Desktop running
- AWS CLI configured (`aws configure`)
- Node.js 18+
- Python 3.11+

### One-Command Deployment

```bash
cd agent-blueprint
./deploy.sh
```

### Deployment Options

When you run `./deploy.sh`, you'll see:

```
========================================
  Strands Agent Chatbot - Deployment
========================================

Select AWS Region:
  1) us-east-1      (US East - N. Virginia)
  2) us-west-2      (US West - Oregon) [default]
  ...

What would you like to deploy?
  1) AgentCore Runtime      (Agent container on Bedrock AgentCore)
  2) Frontend + BFF         (Next.js + CloudFront + ALB)
  3) MCP Servers            (Serverless Lambda + Fargate)
  4) Full Stack             (AgentCore + Frontend + MCPs)

  0) Exit
```

## Components

### 1. AgentCore Runtime (Option 1)

Deploys:
- ECR Repository for Agent Core container
- IAM Execution Role with Bedrock permissions
- Docker image build and push
- Bedrock AgentCore Runtime creation
- Parameter Store configuration

**Output**: Runtime ARN stored in `/strands-agent-chatbot/dev/agentcore/runtime-arn`

### 2. Frontend + BFF (Option 2)

Deploys:
- Next.js application (Frontend)
- FastAPI BFF (Backend for Frontend)
- CloudFront CDN
- Application Load Balancer
- Cognito authentication

**Output**: CloudFront URL for accessing the application

### 3. MCP Servers (Option 3)

Deploys:
- **Serverless MCPs** (Lambda):
  - AWS Documentation
  - AWS Pricing
  - Bedrock KB Retrieval
  - Tavily Web Search

- **Stateful MCPs** (Fargate):
  - Nova Act Browser
  - Python Runtime

### 4. Full Stack (Option 4)

Deploys all components in order:
1. AgentCore Runtime
2. Frontend + BFF
3. MCP Servers

## Configuration

### Environment Variables

Create `.env` file in `agent-blueprint/`:

```bash
# AWS Configuration
AWS_REGION=us-west-2
AWS_ACCOUNT=123456789012

# Project Configuration
PROJECT_NAME=strands-agent-chatbot
ENVIRONMENT=dev

# Optional: AgentCore Runtime ARN (if already deployed)
AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:us-west-2:123456789012:agent-runtime/...
```

### Parameter Store

After deployment, the following parameters are available:

```
/strands-agent-chatbot/dev/agentcore/runtime-arn
/strands-agent-chatbot/dev/agentcore/runtime-id
/mcp/endpoints/serverless/*
/mcp/endpoints/stateful/*
```

## Local Development

### Test Agent Core Locally

```bash
cd ../chatbot-app/agent-core
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn src.main:app --host 0.0.0.0 --port 8080 --reload
```

### Test Frontend Locally

```bash
cd ../chatbot-app/frontend

# Set environment variables
export AGENTCORE_RUNTIME_ARN="arn:aws:bedrock-agentcore:..."
export AWS_REGION="us-west-2"

npm install
npm run dev
```

Visit http://localhost:3000

## Troubleshooting

### Docker not running

```bash
# macOS
open -a Docker

# Linux
sudo systemctl start docker
```

### AWS CLI not configured

```bash
aws configure
# Enter your AWS Access Key ID
# Enter your AWS Secret Access Key
# Enter default region: us-west-2
# Enter default output format: json
```

### CDK not bootstrapped

```bash
cd agentcore-runtime-stack
npx cdk bootstrap aws://ACCOUNT-ID/REGION
```

### AgentCore Runtime creation failed

Check Bedrock service availability in your region:
```bash
aws bedrock-agentcore list-agent-runtimes --region us-west-2
```

If service is not available, try `us-east-1` or `us-west-2`.

## Cost Estimation

### Monthly Costs (approximate)

- **AgentCore Runtime**: ~$50-100 (depends on usage)
- **Frontend + BFF (ECS)**: ~$30-50
- **CloudFront**: ~$1-10 (depends on traffic)
- **MCP Servers (Lambda)**: ~$5-20 (pay per request)
- **MCP Servers (Fargate)**: ~$30-50 each
- **ALB**: ~$20

**Total**: ~$150-300/month for full stack

## Cleanup

To remove all resources:

```bash
# Delete AgentCore Runtime
aws bedrock-agentcore delete-agent-runtime \
  --agent-runtime-arn $(aws ssm get-parameter --name /strands-agent-chatbot/dev/agentcore/runtime-arn --query Parameter.Value --output text) \
  --region us-west-2

# Delete CDK stacks
cd agentcore-runtime-stack
npx cdk destroy

cd ../chatbot-deployment/infrastructure
npx cdk destroy

# Delete MCP servers
cd ../serverless-mcp-farm
./destroy-all-mcp.sh

cd ../fargate-mcp-farm
./destroy-all-mcp.sh
```

## Support

For issues:
1. Check CloudWatch Logs: `/aws/bedrock-agentcore/{runtime-id}`
2. Check ECS Task Logs: `/ecs/strands-agent-chatbot`
3. Review deployment output for specific error messages
