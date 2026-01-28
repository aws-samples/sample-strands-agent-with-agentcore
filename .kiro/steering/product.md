# Product Overview

This is a multi-agent chatbot platform built with **Strands Agents** and **Amazon Bedrock AgentCore**. It demonstrates production-ready agentic AI workflows with tool execution, memory persistence, browser automation, and agent-to-agent collaboration.

## Core Capabilities

- **Multi-agent orchestration** using Strands framework
- **Tool-enabled agents** with 50+ tools across 18+ tool sets (search, finance, weather, browser, code interpreter)
- **Autonomous workflows** for research, web browsing, and document generation
- **Memory persistence** via AgentCore Memory (short-term conversation + long-term user preferences)
- **Agent-to-Agent (A2A) protocol** for multi-agent collaboration
- **Real-time voice interaction** with Amazon Nova Sonic 2
- **Browser automation** with Amazon Nova Act for visual reasoning

## Architecture

The system follows a layered architecture:
- **Frontend**: Next.js with React, TypeScript, Tailwind CSS
- **Backend (BFF)**: FastAPI with streaming SSE support
- **AgentCore Runtime**: Containerized Strands agents on AWS Bedrock
- **AgentCore Gateway**: MCP-based tool integration with SigV4 auth
- **AgentCore Memory**: Persistent conversation state and summarization
- **Tools**: Local Python tools, AWS SDK tools, MCP Gateway tools, A2A tools

## Use Cases

- Financial research and analysis
- Technical research with multi-agent patterns
- Autonomous web browsing and data extraction
- Memory-backed conversational assistants
- Document generation (Word, Excel, PowerPoint)
