# Design Document

## Overview

This design consolidates all environment configuration management to use a single master environment file (`agent-blueprint/.env`) as the sole source of truth. The solution eliminates the current complexity of managing multiple .env files across different components and simplifies the deployment process.

## Architecture

### Current State
- Multiple .env files: `agent-blueprint/.env`, `chatbot-app/backend/.env`, `chatbot-app/frontend/.env.local`
- Deploy script creates and manages multiple files
- Configuration drift between components
- Complex environment variable synchronization

### Target State
- Single master file: `agent-blueprint/.env`
- All applications reference the master file
- Deploy script only reads from master file
- Simplified configuration management

## Components and Interfaces

### 1. Master Environment File
**Location:** `agent-blueprint/.env`
**Purpose:** Single source of truth for all environment variables

**Structure:**
```bash
# AWS & Deployment Configuration
AWS_REGION=us-west-2
ENABLE_COGNITO=true
ALLOWED_IP_RANGES=0.0.0.0/0

# Backend Configuration  
HOST=0.0.0.0
PORT=8000

# Frontend Configuration
NEXT_PUBLIC_API_URL=http://localhost:8000
FRONTEND_URL=http://localhost:3000

# CORS & Security
CORS_ORIGINS=http://localhost:3000,http://localhost:3001

# MCP Server Configuration
TAVILY_API_KEY=your_key_here
NOVA_ACT_API_KEY=your_key_here

# Cognito (populated by deployment)
COGNITO_USER_POOL_ID=
COGNITO_USER_POOL_CLIENT_ID=
NEXT_PUBLIC_COGNITO_USER_POOL_ID=
NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID=
```

### 2. Deploy Script Modifications
**File:** `agent-blueprint/chatbot-deployment/infrastructure/scripts/deploy.sh`

**Changes:**
- Remove all logic for creating/updating multiple .env files
- Only read from master .env file
- Update Cognito configuration in master file only
- Add validation for required environment variables

### 3. Application Configuration
**Backend:** Load environment from `../../.env` (relative to backend directory)
**Frontend:** Load environment from `../../.env` (relative to frontend directory)

### 4. File Cleanup
**Remove:**
- `chatbot-app/backend/.env`
- `chatbot-app/frontend/.env.local`

**Update:**
- Application startup scripts to reference master file
- Docker configurations to mount master file
- Documentation to reflect single-file approach

## Data Models

### Environment Variable Categories
```typescript
interface EnvironmentConfig {
  aws: {
    region: string;
    enableCognito: boolean;
    allowedIpRanges: string;
    allowedMcpCidrs: string;
  };
  backend: {
    host: string;
    port: number;
    debug: boolean;
    uploadDir: string;
    outputDir: string;
  };
  frontend: {
    apiUrl: string;
    frontendUrl: string;
  };
  security: {
    corsOrigins: string;
  };
  mcp: {
    tavilyApiKey: string;
    novaActApiKey: string;
  };
  cognito?: {
    userPoolId: string;
    userPoolClientId: string;
    publicUserPoolId: string;
    publicUserPoolClientId: string;
  };
}
```

## Error Handling

### Missing Master File
- Deploy script checks for `agent-blueprint/.env` existence
- Provides clear error message with setup instructions
- References `.env.example` for template

### Invalid Configuration
- Validate required environment variables before deployment
- Provide specific error messages for missing variables
- Suggest correct values or configuration steps

### Legacy File Detection
- Detect and warn about existing redundant .env files
- Optionally remove legacy files during deployment
- Log cleanup actions for transparency

## Testing Strategy

### Unit Tests
- Environment variable loading functions
- Configuration validation logic
- File path resolution

### Integration Tests
- Deploy script with master .env file
- Application startup with consolidated configuration
- Cognito configuration update process

### End-to-End Tests
- Full deployment process using master file only
- Application functionality with consolidated environment
- Configuration changes propagation

### Validation Tests
- Missing master file scenarios
- Invalid environment variable values
- Legacy file cleanup process