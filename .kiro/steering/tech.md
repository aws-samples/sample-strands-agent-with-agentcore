# Technology Stack

## Backend (AgentCore)

**Language**: Python 3.13+  
**Framework**: FastAPI 0.116.1 with Uvicorn  
**Agent Framework**: Strands Agents (>=1.21.0) with A2A support  
**AWS SDK**: boto3, bedrock-agentcore (>=1.1.5)  
**Testing**: pytest with pytest-asyncio

### Key Dependencies
- `strands-agents[a2a]` - Multi-agent orchestration framework
- `strands-agents-tools[a2a_client]` - A2A protocol tools
- `a2a-sdk` - Agent-to-Agent communication
- `bedrock-agentcore[strands-agents]` - AgentCore Memory integration
- `ddgs` - Web search capabilities
- `httpx`, `anyio` - Async HTTP client

### Common Commands
```bash
# Setup (from chatbot-app/)
./setup.sh

# Start local development
./start.sh

# Backend only (from chatbot-app/agentcore/)
source venv/bin/activate
cd src && python main.py

# Run tests
pytest
pytest tests/unit/
pytest tests/integration/
```

## Frontend

**Language**: TypeScript  
**Framework**: Next.js 15.5.9 with React 18  
**Styling**: Tailwind CSS with shadcn/ui components  
**State Management**: SWR for data fetching  
**Testing**: Vitest with React Testing Library

### Key Dependencies
- `@aws-sdk/client-bedrock-agentcore` - AgentCore API client
- `@aws-sdk/client-dynamodb` - Session storage
- `@aws-sdk/client-s3` - File uploads
- `aws-amplify` - Authentication (Cognito)
- `react-markdown` with `remark-gfm` - Markdown rendering
- `recharts` - Data visualization
- `lucide-react` - Icon library

### Common Commands
```bash
# Install dependencies (from chatbot-app/frontend/)
npm install

# Development server
npm run dev

# Build for production
npm run build

# Type checking
npm run type-check

# Run tests
npm test
npm run test:watch
npm run test:coverage

# Linting
npm run lint
```

## Infrastructure (CDK)

**Language**: TypeScript  
**Framework**: AWS CDK 2.224.0  
**Deployment**: CloudFormation via CDK

### Stacks
- `agentcore-runtime-stack` - AgentCore Runtime deployment
- `agentcore-gateway-stack` - MCP Gateway + Lambda functions
- `chatbot-deployment` - Frontend + ALB + CloudFront
- `agentcore-runtime-a2a-stack` - A2A agents (research, browser-use)

### Common Commands
```bash
# Deploy full stack (from agent-blueprint/)
./deploy.sh

# Deploy specific components
cd agentcore-runtime-stack
npm install
npm run build
npx cdk deploy

# Destroy infrastructure
./destroy.sh
```

## Development Environment

**Required**:
- Python 3.13+
- Node.js 18+
- Docker (for containerized deployments)
- AWS CLI configured

**Recommended**:
- AWS account with Bedrock access
- Environment variables in `agent-blueprint/.env`

## Testing Strategy

### Backend
- **Unit tests**: `tests/unit/` - Test individual components
- **Integration tests**: `tests/integration/` - Test AWS service integration
- **Async tests**: Use `pytest-asyncio` with `asyncio_mode = auto`

### Frontend
- **Component tests**: `__tests__/components/` - React component testing
- **Hook tests**: `__tests__/hooks/` - Custom hook testing
- **API tests**: `__tests__/api/` - API route testing
- **Utilities**: `__tests__/lib/` - Utility function testing

## Code Quality

- **Python**: Follow PEP 8, use type hints
- **TypeScript**: Strict mode enabled, ESLint configured
- **Formatting**: Consistent indentation (2 spaces for TS/JS, 4 for Python)
- **Logging**: Use structured logging with appropriate levels
