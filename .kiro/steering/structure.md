# Project Structure

## Root Organization

```
sample-strands-agent-with-agentcore/
├── chatbot-app/              # Application code (frontend + backend)
├── agent-blueprint/          # Infrastructure deployment (CDK)
├── docs/                     # Documentation and guides
└── scripts/                  # Testing and utility scripts
```

## Application Code (`chatbot-app/`)

### Backend (`chatbot-app/agentcore/`)

```
agentcore/
├── src/
│   ├── agent/                # Core agent implementation
│   │   ├── agent.py          # Main ChatbotAgent class
│   │   ├── config/           # Prompt building and configuration
│   │   ├── factory/          # Session manager factory
│   │   ├── gateway/          # MCP Gateway client
│   │   ├── hooks/            # Agent hooks (caching, approval)
│   │   ├── processor/        # File and multimodal processing
│   │   └── session/          # Session management (Memory, compaction)
│   ├── builtin_tools/        # AWS Bedrock-powered tools
│   │   ├── diagram_tool.py
│   │   ├── excel_spreadsheet_tool.py
│   │   ├── powerpoint_presentation_tool.py
│   │   ├── word_document_tool.py
│   │   └── nova_act_browser_tools.py
│   ├── local_tools/          # General-purpose Python tools
│   │   ├── web_search.py
│   │   ├── url_fetcher.py
│   │   └── visualization.py
│   ├── models/               # Data schemas (Pydantic)
│   ├── routers/              # FastAPI route handlers
│   ├── streaming/            # SSE event processing
│   ├── workspace/            # Document workspace management
│   └── main.py               # FastAPI application entry point
├── tests/
│   ├── unit/                 # Unit tests
│   └── integration/          # Integration tests
└── requirements.txt          # Python dependencies
```

**Key Patterns**:
- **Agent**: `ChatbotAgent` class manages Strands agent lifecycle, tools, and memory
- **Tools**: Organized by type (local, builtin, gateway, A2A)
- **Session Management**: Supports both AgentCore Memory (cloud) and file-based (local)
- **Hooks**: Strands hooks for caching and approval workflows
- **Streaming**: SSE-based event streaming for real-time responses

### Frontend (`chatbot-app/frontend/`)

```
frontend/
├── src/
│   ├── app/                  # Next.js App Router
│   │   ├── api/              # API routes (proxy to backend)
│   │   ├── embed/            # Embeddable chat widget
│   │   ├── page.tsx          # Main chat page
│   │   └── layout.tsx        # Root layout
│   ├── components/           # React components
│   │   ├── chat/             # Chat-specific components
│   │   ├── sidebar/          # Sidebar components
│   │   └── ui/               # Reusable UI components (shadcn/ui)
│   ├── hooks/                # Custom React hooks
│   ├── lib/                  # Utilities and clients
│   ├── types/                # TypeScript type definitions
│   └── utils/                # Helper functions
├── __tests__/                # Test files (mirrors src/ structure)
├── public/                   # Static assets
└── package.json              # Node.js dependencies
```

**Key Patterns**:
- **App Router**: Next.js 15 with server/client components
- **API Routes**: Backend proxy with authentication
- **Hooks**: Custom hooks for chat, sessions, streaming
- **Components**: Atomic design with shadcn/ui base
- **Styling**: Tailwind CSS with CSS variables for theming

## Infrastructure (`agent-blueprint/`)

### Deployment Stacks

```
agent-blueprint/
├── agentcore-runtime-stack/          # Main agent runtime
│   ├── lib/
│   │   └── agent-runtime-stack.ts    # CDK stack definition
│   └── bin/                          # CDK app entry point
├── agentcore-gateway-stack/          # MCP Gateway + Lambda tools
│   ├── infrastructure/               # CDK stack
│   ├── lambda-functions/             # Tool implementations
│   │   ├── arxiv/
│   │   ├── finance/
│   │   ├── google-maps/
│   │   ├── google-search/
│   │   ├── tavily/
│   │   ├── weather/
│   │   └── wikipedia/
│   └── scripts/                      # Deployment scripts
├── agentcore-runtime-a2a-stack/      # A2A agents
│   ├── research-agent/               # Research agent runtime
│   └── browser-use-agent/            # Browser automation agent
├── chatbot-deployment/               # Frontend infrastructure
│   └── infrastructure/
│       ├── lib/
│       │   ├── chatbot-stack.ts      # Main frontend stack
│       │   └── cognito-auth-stack.ts # Authentication
│       └── scripts/
├── deploy.sh                         # Interactive deployment
└── destroy.sh                        # Cleanup script
```

**Key Patterns**:
- **CDK Stacks**: TypeScript-based infrastructure as code
- **Lambda Functions**: Python 3.13 on ARM64 architecture
- **Gateway Tools**: MCP protocol with SigV4 authentication
- **A2A Agents**: Separate runtimes for specialized agents

## Configuration Files

### Backend
- `requirements.txt` - Python dependencies
- `pytest.ini` - Test configuration
- `.env` - Environment variables (local dev)

### Frontend
- `package.json` - Node.js dependencies and scripts
- `tsconfig.json` - TypeScript configuration (strict mode)
- `next.config.js` - Next.js configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `vitest.config.ts` - Test configuration

### Infrastructure
- `cdk.json` - CDK configuration
- `package.json` - CDK dependencies
- `tsconfig.json` - TypeScript for CDK

## Important Conventions

### File Naming
- **Python**: `snake_case.py`
- **TypeScript/React**: `PascalCase.tsx` for components, `camelCase.ts` for utilities
- **Tests**: `test_*.py` (Python), `*.test.ts(x)` (TypeScript)

### Module Organization
- **Tools**: Register in `__all__` list in `__init__.py`
- **Components**: Export from index files for cleaner imports
- **Types**: Centralized in `types/` directories

### Environment Variables
- **Local**: `agent-blueprint/.env` (master config)
- **Cloud**: AWS Parameter Store and Secrets Manager
- **Frontend**: `NEXT_PUBLIC_*` prefix for client-side variables

### Session Storage
- **Cloud**: AgentCore Memory (DynamoDB-backed)
- **Local**: File-based in `chatbot-app/agentcore/sessions/`
- **Format**: Unified JSON format for voice/text compatibility
