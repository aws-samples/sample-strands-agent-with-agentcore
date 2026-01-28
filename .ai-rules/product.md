# Product Vision & Goals

## What We're Building

**Strands Agent Chatbot with Amazon Bedrock AgentCore** - An end-to-end reference architecture for building agentic workflows using Strands Agents and Amazon Bedrock AgentCore.

## Core Purpose

This is a production-ready, extensible sample for teams exploring advanced agent architectures on AWS. It demonstrates how to design and deploy a multi-agent chatbot that combines tool execution, memory, browser automation, and agent-to-agent collaboration.

## Target Audience

- AWS developers building agentic AI applications
- Teams exploring multi-agent architectures
- Organizations implementing tool-augmented AI assistants
- Developers learning Bedrock AgentCore integration patterns

## Core Features

### Multi-Agent Orchestration
- Supervisor-Worker multi-agent patterns using A2A protocol
- Human-in-the-loop approval workflows
- Remote agent delegation and coordination

### Tool-Enabled Agents
- **Gateway Tools**: Google Search/Maps, Wikipedia, ArXiv, Yahoo Finance, Tavily, Weather (50+ tools across 18+ tool sets)
- **Built-in Tools**: Code Interpreter, Browser automation with Amazon Nova Act
- **Local Tools**: Web search, URL fetcher, visualization
- **A2A Tools**: Research Agent, Browser-Use Agent

### Memory & Context Management
- Short-term session memory via AgentCore Memory
- Long-term summarized memory with automatic compaction
- Cross-session user preferences retention
- Token optimization via prompt caching

### Autonomous Capabilities
- Browser automation with live view streaming
- Code execution for charts and documents (Excel, Word, PowerPoint)
- Web research with citations and visualizations

### Multimodal Interactions
- Vision, charts, documents, screenshots
- Real-time voice interaction with Amazon Nova Sonic 2
- Seamless switching between voice and text

## Key Use Cases

1. **Financial Research Agents** - Stock analysis, statistical analysis, report generation
2. **Technical Research Assistants** - Multi-agent research workflows with citations
3. **Autonomous Web Automation** - Browser-based tasks and data extraction
4. **Memory-Backed Conversational Assistants** - Context-aware, multi-turn dialogues
5. **Hybrid Research Workflows** - Combining MCP, A2A, and AWS SDK tools

## Design Principles

- **Extensibility**: Modular architecture adaptable to real customer use cases
- **Observability**: Clear logging and monitoring of agent actions
- **Separation of Concerns**: Clean boundaries between UI, orchestration, tools, and infrastructure
- **Secure by Design**: SigV4 authentication, IAM-based access, centralized secret management
- **Cost Optimization**: Dynamic tool filtering, prompt caching, context compaction

## Success Criteria

- Demonstrates production-ready patterns for AgentCore integration
- Provides clear examples for each major use case
- Deployable with minimal configuration
- Extensible for custom tools and workflows
- Well-documented for learning and adaptation
