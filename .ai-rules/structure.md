# Project Structure & File Organization

## High-Level Architecture

```
stormy-strands-agent-with-agentcore-1/
├── chatbot-app/              # Application layer (frontend + backend)
├── agent-blueprint/          # Infrastructure layer (CDK stacks)
├── docs/                     # Documentation
└── scripts/                  # Testing and utility scripts
```

## Detailed Structure

### chatbot-app/
Application code for the chatbot frontend and backend.

```
chatbot-app/
├── frontend/                 # Next.js frontend application
│   ├── src/
│   │   ├── app/             # Next.js App Router pages and API routes
│   │   ├── components/      # React components
│   │   ├── hooks/           # Custom React hooks
│   │   ├── lib/             # Utility libraries
│   │   ├── types/           # TypeScript type definitions
│   │   └── utils/           # Helper functions
│   ├── public/              # Static assets
│   ├── __tests__/           # Frontend tests
│   ├── package.json
│   ├── tsconfig.json
│   └── next.config.js
│
├── agentcore/               # Python backend (AgentCore Runtime)
│   ├── src/
│   │   ├── agent/          # Strands Agent implementation
│   │   │   ├── agent.py                    # Main agent class
│   │   │   ├── turn_based_session_manager.py  # Memory optimization
│   │   │   ├── gateway_mcp_client.py       # Gateway tool client
│   │   │   └── tool_*.py                   # Tool implementations
│   │   ├── builtin_tools/  # Built-in tools (Code Interpreter, Browser)
│   │   ├── local_tools/    # Local tools (Web Search, Visualization)
│   │   ├── models/         # Data models
│   │   ├── routers/        # FastAPI routers
│   │   ├── streaming/      # SSE streaming logic
│   │   ├── workspace/      # File management
│   │   ├── a2a_tools.py    # A2A tool integration
│   │   └── main.py         # FastAPI application entry point
│   ├── tests/              # Backend tests
│   │   ├── unit/
│   │   └── integration/
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   └── Dockerfile
│
├── setup.sh                # Development setup script
└── start.sh                # Local development launcher
```

### agent-blueprint/
Infrastructure as Code (CDK) for deploying to AWS.

```
agent-blueprint/
├── chatbot-deployment/      # Frontend + BFF deployment
│   └── infrastructure/
│       ├── bin/            # CDK app entry point
│       ├── lib/            # CDK stack definitions
│       ├── scripts/        # Deployment scripts
│       └── config.json     # Deployment configuration
│
├── agentcore-gateway-stack/ # MCP Gateway + Lambda tools
│   ├── infrastructure/
│   │   ├── bin/            # CDK app entry point
│   │   ├── lib/            # CDK stack definitions
│   │   └── cdk.json
│   ├── lambda-functions/   # Lambda function code
│   │   ├── arxiv/          # ArXiv tool
│   │   ├── finance/        # Yahoo Finance tool
│   │   ├── google-maps/    # Google Maps tool
│   │   ├── google-search/  # Google Search tool
│   │   ├── tavily/         # Tavily tool
│   │   ├── weather/        # Weather tool
│   │   └── wikipedia/      # Wikipedia tool
│   └── tests/              # Gateway tests
│
├── agentcore-runtime-stack/ # AgentCore Runtime deployment
│   ├── bin/                # CDK app entry point
│   ├── lib/                # CDK stack definitions
│   └── cdk.json
│
├── agentcore-runtime-a2a-stack/  # A2A agent deployments
│   ├── research-agent/     # Deep research agent
│   │   ├── cdk/            # CDK for deployment
│   │   ├── src/            # Agent implementation
│   │   └── Dockerfile
│   └── browser-use-agent/  # Browser automation agent
│       ├── cdk/            # CDK for deployment
│       ├── src/            # Agent implementation
│       └── Dockerfile
│
├── deploy.sh               # Interactive deployment script
└── destroy.sh              # Cleanup script
```

### docs/
Project documentation.

```
docs/
├── guides/
│   ├── TOOLS.md                    # Tool reference
│   ├── TROUBLESHOOTING.md          # Common issues
│   ├── GATEWAY_TOOL_NAMING.md      # Tool naming conventions
│   ├── GATEWAY_TOOL_TEMPLATE.md    # Template for new tools
└── images/                         # Architecture diagrams and screenshots
```

### scripts/
Testing and utility scripts.

```
scripts/
├── test_a2a.py             # A2A integration tests
├── test_browser.py         # Browser tool tests
├── test_caching.py         # Prompt caching tests
├── test_code_interpreter.py # Code Interpreter tests
├── test_compaction.py      # Memory compaction tests
├── test_config.py          # Configuration tests
├── test_dynamodb.py        # DynamoDB integration tests
├── test_gateway.py         # Gateway tool tests
├── test_memory.py          # Memory persistence tests
├── test_swarm.py           # Multi-agent tests
└── fixtures/               # Test fixtures
```

## Key Files & Their Purpose

### Root Level
| File | Purpose |
|------|---------|
| `README.md` | Project overview and quick start |
| `AGENTCORE.md` | AgentCore integration guide |
| `DEPLOYMENT.md` | Detailed deployment instructions |
| `LICENSE` | MIT License |
| `CODE_OF_CONDUCT.md` | Community guidelines |
| `CONTRIBUTING.md` | Contribution guidelines |

### Frontend Key Files
| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Main chat interface |
| `src/app/api/chat/route.ts` | Chat API endpoint |
| `src/components/ChatInterface.tsx` | Main chat component |
| `src/components/MessageList.tsx` | Message rendering |
| `src/components/ToolSelector.tsx` | Dynamic tool filtering UI |
| `src/hooks/useChat.ts` | Chat state management |
| `src/lib/sseParser.ts` | SSE stream parsing |
| `src/config/tools.ts` | Tool configuration |

### Backend Key Files
| File | Purpose |
|------|---------|
| `src/main.py` | FastAPI app entry point |
| `src/agent/agent.py` | Strands Agent implementation |
| `src/agent/turn_based_session_manager.py` | Memory optimization |
| `src/agent/gateway_mcp_client.py` | Gateway tool client |
| `src/routers/chat.py` | Chat endpoint router |
| `src/streaming/sse_handler.py` | SSE streaming logic |
| `src/builtin_tools/code_interpreter_tool.py` | Code Interpreter integration |
| `src/builtin_tools/browser_tool.py` | Browser tool integration |
| `src/a2a_tools.py` | A2A protocol implementation |

### Infrastructure Key Files
| File | Purpose |
|------|---------|
| `chatbot-deployment/infrastructure/lib/chatbot-stack.ts` | Frontend + BFF stack |
| `agentcore-gateway-stack/lib/gateway-stack.ts` | Gateway infrastructure |
| `agentcore-runtime-stack/lib/agent-runtime-stack.ts` | Runtime deployment |
| `agent-blueprint/deploy.sh` | Interactive deployment |

## File Naming Conventions

### Python
- **Modules**: `snake_case.py` (e.g., `gateway_mcp_client.py`)
- **Classes**: `PascalCase` (e.g., `ChatbotAgent`)
- **Functions**: `snake_case` (e.g., `send_message`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `MAX_TOKENS`)
- **Test files**: `test_*.py` (e.g., `test_agent.py`)

### TypeScript
- **Files**: `camelCase.ts` or `PascalCase.tsx` for components
- **Components**: `PascalCase.tsx` (e.g., `ChatInterface.tsx`)
- **Utilities**: `camelCase.ts` (e.g., `sseParser.ts`)
- **Types**: `PascalCase` (e.g., `ChatMessage`)
- **Test files**: `*.test.ts` or `*.test.tsx`

### Infrastructure
- **CDK files**: `kebab-case.ts` (e.g., `gateway-stack.ts`)
- **Lambda directories**: `kebab-case/` (e.g., `google-search/`)
- **Shell scripts**: `kebab-case.sh` (e.g., `deploy.sh`)

## Configuration Files

### Frontend
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `next.config.js` - Next.js configuration
- `tailwind.config.js` - Tailwind CSS configuration
- `components.json` - shadcn/ui configuration

### Backend
- `requirements.txt` - Production dependencies
- `requirements-dev.txt` - Development dependencies
- `pytest.ini` - Pytest configuration
- `Dockerfile` - Container build instructions

### Infrastructure
- `cdk.json` - CDK configuration
- `package.json` - CDK dependencies
- `tsconfig.json` - TypeScript configuration
- `config.json` - Deployment parameters

## Import Conventions

### Python
```python
# Standard library
import os
from typing import List, Dict

# Third-party
import boto3
from strands import Agent

# Local
from agent.gateway_mcp_client import GatewayMCPClient
from models.message import ChatMessage
```

### TypeScript
```typescript
// React/Next.js
import React from 'react';
import { useRouter } from 'next/navigation';

// Third-party
import { cn } from '@/lib/utils';

// Components
import { ChatInterface } from '@/components/ChatInterface';

// Types
import type { ChatMessage } from '@/types/chat';
```

## Where Code Goes

### New Agent Features
→ `chatbot-app/agentcore/src/agent/`

### New Tools
- **Local tools**: `chatbot-app/agentcore/src/local_tools/`
- **Built-in tools**: `chatbot-app/agentcore/src/builtin_tools/`
- **Gateway tools**: `agent-blueprint/agentcore-gateway-stack/lambda-functions/`
- **A2A tools**: `agent-blueprint/agentcore-runtime-a2a-stack/`

### New UI Components
→ `chatbot-app/frontend/src/components/`

### New API Routes
→ `chatbot-app/frontend/src/app/api/` or `chatbot-app/agentcore/src/routers/`

### New Infrastructure
→ `agent-blueprint/` in appropriate stack directory

### Documentation
→ `docs/guides/`

### Tests
- **Frontend**: `chatbot-app/frontend/__tests__/`
- **Backend unit**: `chatbot-app/agentcore/tests/unit/`
- **Backend integration**: `chatbot-app/agentcore/tests/integration/`
- **Gateway**: `agent-blueprint/agentcore-gateway-stack/tests/`
- **End-to-end**: `scripts/`
