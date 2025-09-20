# Sample Strands Agent Chatbot - Complete Deployment Guide

This guide provides step-by-step instructions for deploying the complete Sample Strands Agent Chatbot system, including the web application and MCP servers.

## Overview

The deployment consists of three main components:

1. **Web Application** (Frontend + Backend) - The main chat interface with dynamic tool management
2. **MCP Servers** - External tools and data sources (Lambda-based and Fargate-based)
3. **Security Layer** - CloudFront CDN with Cognito authentication

## Prerequisites

### Required Tools

- **AWS CLI** - Configured with appropriate permissions
- **Docker** - For containerized deployment
- **Node.js** (v18+) - For local development and CDK
- **Python 3.8+** - For Python-based CDK stacks
- **Git** - For cloning and version control

### AWS Setup

```bash
# Install AWS CLI
# macOS: brew install awscli
# Ubuntu: sudo apt-get install awscli

# Configure AWS credentials
aws configure
# Enter your AWS Access Key ID, Secret Access Key, Region, and Output format
```

### Required AWS Permissions

- CloudFormation (create, update, delete stacks)
- Lambda (create, update functions)
- API Gateway (create, manage APIs)
- ECS/Fargate (for web application and containerized MCP servers)
- ECR (for Docker images)
- IAM (create roles and policies)
- Cognito (for user authentication)
- CloudFront (for CDN and security)
- ElasticLoadBalancingV2 (for load balancers)

## Quick Deployment (Recommended)

For complete system deployment with all components, use the automated deployment script:

```bash
cd agent-blueprint
./deploy-all.sh
```

This script will:
1. Deploy the web application with Cognito authentication
2. Deploy all serverless MCP servers (Lambda-based)
3. Deploy shared infrastructure for Fargate MCP servers
4. Deploy containerized MCP servers (Python MCP, Nova Act MCP)
5. Configure all MCP endpoints automatically

**Security Features:**
- **CloudFront CDN**: All user traffic goes through CloudFront for performance and security
- **Cognito Authentication**: Users must sign up and verify email before access
- **ALB Protection**: Application Load Balancer only accepts traffic from CloudFront
- **VPC Isolation**: MCP servers run in private subnets with controlled access

### Clean Removal

To remove all deployed components:

```bash
cd agent-blueprint
./destroy-all.sh
```

## Local Development

For local development and testing:

```bash
# Frontend only (no authentication required)
cd chatbot-app/frontend
npm install
npm run dev
```

**Note**: For testing MCP servers locally, you'll need to deploy the MCP Farm to AWS first, as MCP servers require cloud infrastructure for proper testing.

## Individual Component Deployment

If you need to deploy components individually (for debugging or partial deployment):

### Step 1: Deploy Web Application (~15-20 minutes)

The web application creates the VPC that other components will use.

#### Configure AWS Region (Optional)

By default, the application deploys to **us-west-2**. To use a different region:

```bash
# Navigate to deployment directory
cd agent-blueprint/chatbot-deployment/infrastructure

# Edit main deployment configuration (only if changing from us-west-2)
vim config.json
# Change "defaultRegion" to your preferred region
```


#### Deploy Web Application

```bash
# Install dependencies
npm install

# Deploy the application (creates VPC)
./scripts/deploy.sh

# Expected output:
# ✅ Frontend deployed to: https://your-app.amazonaws.com
# ✅ Backend API available at: https://your-api.amazonaws.com
# ✅ VPC exported for other components
```

**Estimated Time:** 15-20 minutes

#### Authentication Setup

The application now includes **AWS Cognito authentication** to meet security compliance requirements. After deployment, you'll need to:

1. **Create your first user account:**
   ```bash
   # Get the Cognito login URL from deployment output
   aws cloudformation describe-stacks --stack-name ChatbotStack --query 'Stacks[0].Outputs[?OutputKey==`CognitoLoginUrl`].OutputValue' --output text

   # Or check the application URL - it will redirect to Cognito login
   ```

2. **Sign up process:**
   - Visit the application URL (it will redirect to Cognito login)
   - Click "Sign up" to create a new account
   - Provide email and password (must meet policy: 8+ chars, uppercase, lowercase, number, symbol)
   - Check your email for verification code
   - Complete email verification

3. **Subsequent logins:**
   - Use your email and password to access the application
   - Sessions persist for the configured duration

**Security Features:**
- All endpoints except `/health` require authentication
- Strong password policy enforced
- Email verification required
- Secure session management via Cognito

#### Option B: Local Development

```bash
# Start the application locally
cd chatbot-app
./start.sh

# Application will be available at:
# Frontend: http://localhost:3000 (with file upload support)
# Backend: http://localhost:8000
```

**Estimated Time:** 2-3 minutes

### Step 2: Deploy Serverless MCP Servers (~10-15 minutes)

Deploy serverless MCP servers (independent of VPC).

```bash
# Navigate to serverless MCP farm directory
cd agent-blueprint/serverless-mcp-farm

# Configure region (optional - defaults to us-west-2)
# Only edit if you changed region in Step 1
vim deploy-config.json

# Deploy all enabled MCP servers
./deploy-server.sh

# Expected output:
# ✅ aws-documentation: https://your-aws-docs-endpoint.execute-api.region.amazonaws.com/prod/mcp
# ✅ aws-pricing: https://your-aws-pricing-endpoint.execute-api.region.amazonaws.com/prod/mcp
# ✅ bedrock-kb-retrieval: https://your-bedrock-endpoint.execute-api.region.amazonaws.com/prod/mcp
# ✅ tavily-web-search: https://your-tavily-endpoint.execute-api.region.amazonaws.com/prod/mcp
```

**Estimated Time:** 10-15 minutes

### Step 3: Deploy Shared Infrastructure (~5-10 minutes)

Deploy shared ALB that uses the VPC created in Step 1.

```bash
# Navigate to shared infrastructure directory
cd agent-blueprint/fargate-mcp-farm/shared-infrastructure

# Deploy shared ALB infrastructure
./deploy.sh

# Expected output:
# ✅ Shared ALB deployed: http://your-shared-alb.amazonaws.com
# ✅ ALB references exported for stateful MCP servers
```

**Estimated Time:** 5-10 minutes

### Step 4: Deploy Stateful MCP Servers (~15-20 minutes)

Deploy stateful MCP servers that use both VPC and shared ALB.

#### Configure Nova Act API Key

Before deploying Nova Act Browser MCP, you need to configure your Nova Act API key:

```bash
# Navigate to Nova Act MCP directory
cd agent-blueprint/fargate-mcp-farm/nova-act-mcp/src

# Create .env.local file with your Nova Act API key
cat > .env.local << EOF
NOVA_ACT_API_KEY=your_nova_act_api_key_here
EOF

# Note: .env.local is gitignored for security
# The deployment will automatically create AWS Parameter Store entry with this value
```

#### Deploy Stateful MCP Servers

```bash
# Navigate to fargate MCP farm directory
cd agent-blueprint/fargate-mcp-farm

# Deploy Nova Act Browser MCP server
./deploy-all.sh -s nova-act-mcp

# Deploy Python MCP server (optional)
# ./deploy-all.sh -s python-mcp

# Expected output:
# ✅ Nova Act Browser MCP: http://your-shared-alb.amazonaws.com/nova-act/mcp
# ✅ Python MCP: http://your-shared-alb.amazonaws.com/python/mcp
```

**Estimated Time:** 15-20 minutes

#### MCP Server Configuration

Edit `deploy-config.json` to customize which servers to deploy:

```json
{
  "deployment": {
    "region": "us-west-2",
    "stage": "prod",
    "servers": {
      "aws-documentation": { "enabled": true },
      "aws-pricing": { "enabled": true },
      "bedrock-kb-retrieval": { "enabled": false },
      "tavily-web-search": { "enabled": true }
    }
  },
  "environment_variables": {
    "tavily-web-search": {
      "TAVILY_API_KEY": "your-tavily-api-key"
    }
  }
}
```

> **Important**: This configuration only controls which serverless MCP servers are deployed to AWS. To use these servers in your web application, you must complete Step 5 (Integration) below.

### Step 5: Integrate MCP Servers (~5 minutes)

Connect the deployed MCP servers to your web application.

#### Option A: Web Interface Integration

1. **Access your deployed web application**
2. **Navigate to MCP Servers section** (gear icon → MCP Servers)
3. **Add each MCP server endpoint:**

```
Name: AWS Documentation
URL: https://your-aws-docs-endpoint.execute-api.region.amazonaws.com/prod/mcp
Description: Search AWS documentation

Name: AWS Pricing  
URL: https://your-aws-pricing-endpoint.execute-api.region.amazonaws.com/prod/mcp
Description: Get AWS pricing information

Name: Tavily Web Search
URL: https://your-tavily-endpoint.execute-api.region.amazonaws.com/prod/mcp
Description: Perform web searches

Name: Nova Act Browser
URL: http://your-shared-alb.amazonaws.com/nova-act/mcp
Description: Natural language browser automation with Playwright API access
```

> **Tip**: For production deployments, you can store endpoints in AWS Parameter Store and reference them using `ssm://parameter-name` format instead of hardcoding URLs.

4. **Test connections** using the "Test" button
5. **Enable servers** by toggling them on

#### Option B: Configuration File Integration

For automated setup, update the unified tools configuration:

```bash
# Edit the unified tools configuration
vim chatbot-app/backend/unified_tools_config.json
```

Add MCP servers to the configuration:

```json
{
  "mcp_servers": [
    {
      "name": "aws-documentation",
      "url": "https://your-aws-docs-endpoint.execute-api.region.amazonaws.com/prod/mcp",
      "description": "Search AWS documentation",
      "enabled": true,
      "category": "documentation"
    },
    {
      "name": "aws-pricing",
      "url": "https://your-aws-pricing-endpoint.execute-api.region.amazonaws.com/prod/mcp",
      "description": "Get AWS pricing information", 
      "enabled": true,
      "category": "aws"
    },
    {
      "name": "tavily-web-search",
      "url": "https://your-tavily-endpoint.execute-api.region.amazonaws.com/prod/mcp",
      "description": "Perform web searches",
      "enabled": true,
      "category": "search"
    },
    {
      "name": "nova-act-browser",
      "url": "http://your-shared-alb.amazonaws.com/nova-act/mcp",
      "description": "Natural language browser automation with Playwright API access",
      "enabled": true,
      "category": "automation"
    }
  ]
}
```

Then restart the backend service:

```bash
# For cloud deployment
cd agent-blueprint/chatbot-deployment/infrastructure
./scripts/deploy.sh

# For local development
cd chatbot-app/backend
python app.py
```

## Verification

### Test Web Application

1. **Access the web interface**
2. **Start a new conversation**
3. **Try basic queries:**
   - "Hello, how are you?"
   - "What tools do you have available?"
4. **Test file upload capabilities:**
   - Upload images and ask for analysis
   - Upload PDF documents and ask questions
   - Try multiple file uploads

### Test MCP Integration

Try queries that utilize MCP servers:

```
# Test AWS Documentation
"How do I create an AWS Lambda function?"

# Test AWS Pricing
"What's the pricing for Amazon S3 storage?"

# Test Web Search (if enabled)
"Search for the latest AWS announcements"

# Test Nova Act Browser
"Navigate to https://example.com and take a screenshot"
"Go to Google and search for 'AWS Lambda'"
"Click the login button on this page"
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                Internet                                      │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
┌─────────────────────────────▼───────────────────────────────────────────────┐
│                       Application Load Balancer                             │
└─────────────────────────────┬───────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                │                           │
        ┌───────▼────────┐         ┌────────▼────────┐
        │   Frontend     │         │    Backend      │
        │  (Next.js)     │◄────────┤   (FastAPI)     │
        │   ECS Fargate  │         │   ECS Fargate   │
        └────────────────┘         └─────────┬───────┘
                                             │
                        ┌────────────────────┼────────────────────┐
                        │                    │                    │
                        │    Serverless      │     Stateful       │
                        │    MCP Farm        │     MCP Farm       │
                        │                    │                    │
          ┌─────────────▼──────────┐    ┌────▼─────────┐   ┌─────▼──────────┐
          │   AWS Documentation   │    │  Nova Act    │   │  Python MCP    │
          │     (Lambda)          │    │  Browser     │   │   (Fargate)    │
          │     + API GW          │    │ (Fargate)    │   │ /python/mcp    │
          └───────────────────────┘    │/nova-act/mcp │   └────────────────┘
                                       └──────────────┘
          ┌───────────────────────┐
          │    AWS Pricing        │
          │     (Lambda)          │
          │     + API GW          │
          └───────────────────────┘
          
          ┌───────────────────────┐
          │  Tavily Web Search    │
          │     (Lambda)          │
          │     + API GW          │
          └───────────────────────┘
```

## Cost Estimation

### Web Application (Monthly)
- **ECS Fargate**: ~$30-50 (2 vCPU, 4GB RAM, always on)
- **Application Load Balancer**: ~$20
- **ECR Storage**: ~$1-2
- **Total**: ~$50-75/month

### MCP Servers (Monthly)
- **Lambda**: ~$1-5 (pay per request)
- **API Gateway**: ~$1-3 (pay per request)
- **Total**: ~$2-8/month

### Overall Monthly Cost: ~$55-85

*Costs may vary based on usage patterns and AWS region*

## Environment Variables

### Web Application

Configuration is handled through deployment scripts and infrastructure configuration files:

- `agent-blueprint/chatbot-deployment/infrastructure/config.json` - Main deployment configuration
- Environment variables are automatically set during deployment
- No manual `.env` file creation required

### MCP Servers

#### Serverless MCP Servers

Configure in `agent-blueprint/serverless-mcp-farm/deploy-config.json`:

```json
{
  "environment_variables": {
    "tavily-web-search": {
      "TAVILY_API_KEY": "your-tavily-api-key",
      "LOG_LEVEL": "INFO"
    },
    "bedrock-kb-retrieval": {
      "BEDROCK_REGION": "your-aws-region",
      "LOG_LEVEL": "INFO"
    }
  }
}
```

#### Stateful MCP Servers (Nova Act Browser)

Configure in `agent-blueprint/fargate-mcp-farm/nova-act-mcp/src/.env.local`:

```bash
# Nova Act API Key (required)
NOVA_ACT_API_KEY=your_nova_act_api_key_here

# Optional browser settings
DEFAULT_HEADLESS_MODE=true
SESSION_TTL_SECONDS=600
SESSION_CLEANUP_INTERVAL=60
```

**Note**: The `.env.local` file is automatically gitignored for security. During deployment, the Nova Act API key is stored in AWS Parameter Store as `/nova-act-mcp/api-key` and injected into the container as a secret.

## Troubleshooting

### Common Issues

#### Web Application Deployment

1. **ECS Task Fails to Start**
   ```bash
   # Check ECS logs
   aws logs describe-log-groups --log-group-name-prefix /ecs/
   aws logs get-log-events --log-group-name /ecs/your-task-definition
   ```

2. **Load Balancer Health Check Fails**
   - Verify backend health endpoint: `/health`
   - Check security group rules
   - Ensure container port matches target group

#### MCP Server Deployment

1. **Lambda Function Timeout**
   ```bash
   # Check CloudWatch logs
   aws logs describe-log-groups --log-group-name-prefix /aws/lambda/
   ```

2. **API Gateway 502 Error**
   - Verify Lambda function permissions
   - Check Lambda function response format
   - Review API Gateway integration settings

#### Integration Issues

1. **MCP Server Connection Failed**
   - Verify MCP endpoint URLs
   - Check API Gateway CORS settings
   - Test endpoints manually with curl

2. **Tools Not Available**
   - Check MCP server status in web interface
   - Verify unified tools configuration
   - Restart backend service

### Getting Help

1. **Check AWS CloudFormation Console** for stack deployment status
2. **Review CloudWatch Logs** for application and Lambda function logs
3. **Test endpoints manually** using curl or Postman
4. **Verify AWS permissions** and service quotas

## Cleanup

### Remove All Resources

**Important**: Delete components in reverse order to avoid dependency issues.

```bash
# 1. Delete stateful MCP servers first
cd agent-blueprint/fargate-mcp-farm
./destroy-all-mcp.sh -s nova-act-mcp

# 2. Delete shared infrastructure
cd shared-infrastructure
cdk destroy --all

# 3. Delete serverless MCP servers
cd ../serverless-mcp-farm
./destroy-all-mcp.sh

# 4. Delete web application (VPC) last
cd ../chatbot-deployment/infrastructure
cdk destroy --all

# Clean up ECR repositories (optional)
aws ecr describe-repositories --query 'repositories[].repositoryName' --output text | xargs -n1 aws ecr delete-repository --force --repository-name
```

## Next Steps

After successful deployment:

1. **Customize the application** by modifying tools and prompts
2. **Add more MCP servers** for additional functionality
3. **Set up monitoring** using CloudWatch and AWS X-Ray
4. **Configure backup** for important data and configurations
5. **Set up CI/CD pipeline** for automated deployments

## Support

For deployment issues:

1. Check this troubleshooting guide
2. Review AWS service documentation
3. Check CloudFormation and CloudWatch logs
4. Verify AWS permissions and quotas

---

**Deployment Complete!** 🎉

Your Sample Strands Agent Chatbot is now running with full MCP integration. Users can interact with the chat interface, upload various file types, and leverage all connected tools and data sources with dynamic tool management.
