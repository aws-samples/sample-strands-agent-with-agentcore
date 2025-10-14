# Design Document

## Overview

This design implements a minimal embeddable chatbot frontend that can be integrated into external websites via iframe. The solution creates a simple `/embed` endpoint that serves a streamlined version of the chatbot interface, with basic domain validation and Cognito authentication support.

## Architecture

### High-Level Architecture

```mermaid
graph TB
    subgraph "External Website"
        EW[External Website]
        IF[Iframe pointing to /embed]
    end
    
    subgraph "Existing Infrastructure"
        CF[CloudFront]
        ALB[Application Load Balancer]
        FS[Frontend Service]
        BS[Backend Service]
    end
    
    subgraph "New Components"
        EP[/embed Page]
        DV[Domain Validation]
    end
    
    EW --> IF
    IF --> CF
    CF --> ALB
    ALB --> FS
    FS --> EP
    EP --> BS
    BS --> DV
```

### Component Interaction Flow

1. **External Website Integration**: Website embeds chatbot via iframe pointing to `/embed` endpoint
2. **Domain Validation**: Simple origin header check against configured allowed domains
3. **Authentication Flow**: Uses existing Cognito authentication within iframe
4. **API Communication**: Uses existing backend APIs without modification

## Components and Interfaces

### Frontend Components

#### 1. Embeddable Page Component (`/embed`)
- **Location**: `chatbot-app/frontend/src/app/embed/page.tsx`
- **Purpose**: Minimal chatbot interface for iframe embedding
- **Features**:
  - Reuses existing chat components
  - Removes navigation and branding elements
  - Same functionality as main page
  - Iframe-optimized styling

### Backend Components

#### 1. Domain Validation
- **Location**: Updates to `chatbot-app/backend/app.py`
- **Purpose**: Simple origin validation for embed requests
- **Features**:
  - Check Origin header against allowed domains
  - Environment variable configuration
  - Development mode bypass

### Infrastructure Components

#### 1. Deployment Configuration
- **Location**: `agent-blueprint/chatbot-deployment/infrastructure/scripts/deploy.sh`
- **Purpose**: Collect allowed domains during deployment
- **Features**:
  - Prompt for comma-separated domain list
  - Set environment variable for backend

## Data Models

### Environment Configuration
```bash
# Simple comma-separated list of allowed domains
EMBED_ALLOWED_DOMAINS=example.com,subdomain.example.com,another-site.org
```

## Error Handling

### Domain Validation Errors
- **Unauthorized Domain**: Return 403 with error message
- **Missing Origin**: Allow request (development mode)
- **No Configuration**: Allow all domains (development mode)

### Authentication Errors
- **Authentication Required**: Use existing Cognito flow within iframe
- **Session Expired**: Handle with existing authentication logic

## Testing Strategy

### Manual Testing
- Test iframe embedding in sample HTML page
- Verify domain validation works
- Confirm authentication flows work in iframe
- Test basic chatbot functionality

## Security Considerations

### Domain Validation
- Basic origin header validation
- Allow development mode without restrictions
- Log unauthorized access attempts

### Authentication
- Use existing Cognito authentication
- Maintain existing security model

## Deployment Configuration

### Environment Variables
```bash
# Simple embedding configuration
EMBED_ALLOWED_DOMAINS=example.com,subdomain.example.com,another-site.org
```

### Deployment Process
1. Prompt user for allowed domains during deployment
2. Set environment variable in deployment script
3. Deploy with new configuration

## Integration Examples

### Basic Iframe Embedding
```html
<iframe 
  src="https://your-chatbot-domain.com/embed"
  width="400" 
  height="600"
  frameborder="0">
</iframe>
```

### Responsive Embedding
```html
<div style="position: relative; width: 100%; height: 500px;">
  <iframe 
    src="https://your-chatbot-domain.com/embed"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
    frameborder="0">
  </iframe>
</div>
```