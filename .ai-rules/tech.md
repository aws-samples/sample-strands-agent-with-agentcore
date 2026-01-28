# Technology Stack & Tools

## Core Technologies

### Agent Framework
- **Strands** - Multi-turn reasoning and tool orchestration framework
- **Amazon Bedrock AgentCore** - Managed, containerized agent execution environment
  - AgentCore Runtime - Container execution
  - AgentCore Memory - Conversation persistence and summarization
  - AgentCore Gateway - MCP-based tool integration with SigV4 auth
  - AgentCore Code Interpreter - Secure code execution
  - AgentCore Browser - Headless browser automation with live view

### AI Models
- **Claude 4 Sonnet** (primary)
- **Amazon Nova Act** (browser automation with visual reasoning)
- **Amazon Nova Sonic 2** (voice interaction)
- 20+ additional models supported via Bedrock

### Frontend
- **Next.js 14+** with App Router
- **React 18+** with TypeScript
- **Tailwind CSS** for styling
- **shadcn/ui** component library
- **Server-Sent Events (SSE)** for streaming responses
- **WebSocket** for voice mode

### Backend (BFF)
- **Python 3.13+**
- **FastAPI** framework
- **Strands SDK** for agent orchestration
- **Boto3** for AWS service integration
- **Pydantic** for data validation

### Infrastructure
- **AWS CDK** (TypeScript) for Infrastructure as Code
- **Docker** for containerization
- **Amazon ECS Fargate** for runtime deployment
- **Amazon API Gateway** (REST + WebSocket)
- **AWS Lambda** for Gateway tools
- **Amazon DynamoDB** for session storage
- **AWS Secrets Manager** for API key management
- **Amazon S3** for file storage
- **CloudWatch** for logging and monitoring

### Tool Protocols
- **MCP (Model Context Protocol)** - Gateway tool integration
- **A2A (Agent-to-Agent)** - Multi-agent communication
- **AWS SDK** - Built-in tool access
- **Direct Python** - Local tool execution

## Development Tools

### Package Management
- **npm** (frontend)
- **pip** (backend)
- **Docker Compose** (local development)

### Testing
- **Vitest** (frontend unit tests)
- **pytest** (backend unit tests)
- **pytest-asyncio** (async test support)

### Code Quality
- **TypeScript** strict mode
- **ESLint** for linting
- **Black** for Python formatting
- **mypy** for Python type checking

## AWS Services Used

| Service | Purpose |
|---------|---------|
| Amazon Bedrock | LLM inference |
| Bedrock AgentCore Runtime | Agent execution environment |
| Bedrock AgentCore Memory | Conversation persistence |
| Bedrock AgentCore Gateway | Tool integration layer |
| ECS Fargate | Container hosting |
| API Gateway | HTTP/WebSocket API |
| Lambda | Serverless tool execution |
| DynamoDB | Session storage |
| S3 | File storage |
| Secrets Manager | API key management |
| CloudWatch | Logging and monitoring |
| IAM | Authentication and authorization |

## External APIs & Services

### Gateway Tools (via MCP)
- **Google Search API** - Web search
- **Google Maps/Places API** - Location data
- **Wikipedia API** - Encyclopedia queries
- **ArXiv API** - Academic paper search
- **Yahoo Finance API** - Stock quotes and financial data
- **Tavily API** - Enhanced web research
- **Open-Meteo API** - Weather data

### Local Tool Libraries
- **matplotlib** - Chart generation
- **pandas** - Data analysis
- **python-docx** - Word document generation
- **openpyxl** - Excel document generation
- **python-pptx** - PowerPoint generation

## Coding Conventions

### Python
- **Style**: PEP 8 with Black formatter
- **Type hints**: Required for all public functions
- **Async/await**: Used for all I/O operations
- **Error handling**: Explicit exception handling with logging
- **Imports**: Absolute imports, grouped by standard/third-party/local

### TypeScript
- **Style**: ESLint + Prettier
- **Type safety**: Strict mode enabled
- **Components**: Functional components with hooks
- **State management**: React hooks (useState, useEffect, useContext)
- **API calls**: Async/await with proper error handling

### Infrastructure (CDK)
- **Language**: TypeScript
- **Stack organization**: Separate stacks for runtime, gateway, frontend
- **Resource naming**: Consistent kebab-case with project prefix
- **Configuration**: Environment-specific config files

## Authentication & Authorization

- **AgentCore Runtime**: IAM-based authentication with SigV4 signing
- **Gateway Tools**: SigV4 signing for Lambda invocations
- **API Gateway**: AWS_IAM authentication
- **A2A Communication**: SigV4 signing with runtime credentials

## Performance Optimization

- **Prompt Caching**: Implemented via Strands hooks for system prompts
- **Context Compaction**: Long conversation summarization to control token growth
- **Dynamic Tool Filtering**: Only include user-selected tools in prompts
- **Streaming Responses**: SSE for real-time user feedback
- **Turn-Based Memory**: Batch memory persistence to reduce API calls

## Deployment

### Local Development
```bash
cd chatbot-app
./setup.sh      # Install dependencies
./start.sh      # Start frontend + backend
```

### Cloud Deployment
```bash
cd agent-blueprint
./deploy.sh     # Interactive deployment script
```

## Documentation References

- Strands Framework: Internal AWS SDK documentation
- AgentCore Runtime: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/agents-tools-runtime.html
- AgentCore Memory: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/memory.html
- AgentCore Gateway: https://docs.aws.amazon.com/bedrock-agentcore/latest/devguide/gateway.html
