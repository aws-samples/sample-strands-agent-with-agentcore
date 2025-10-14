# Chatbot Embedding Integration Guide

This comprehensive guide provides everything you need to embed the AI chatbot into your website or application.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Basic Integration](#basic-integration)
3. [Responsive Embedding](#responsive-embedding)
4. [Advanced Configuration](#advanced-configuration)
5. [Domain Configuration](#domain-configuration)
6. [Authentication](#authentication)
7. [Troubleshooting](#troubleshooting)
8. [Examples](#examples)

## Quick Start

The fastest way to embed the chatbot is using a simple iframe:

```html
<iframe 
  src="https://your-chatbot-domain.com/embed"
  width="400" 
  height="600"
  frameborder="0"
  title="AI Chatbot">
</iframe>
```

Replace `your-chatbot-domain.com` with your actual chatbot domain.

### 🎯 Full Feature Parity

The embedded chatbot includes all the same features as the main application:
- **Complete tool suite** with configurable sidebar
- **File upload support** for images and PDFs
- **Authentication flow** with Cognito integration
- **Real-time agent analysis** and reasoning display
- **Tool management** - enable/disable tools, clear chat
- **Suggested questions** based on available tools
- **Scratch pad** showing live tool execution progress

Users can access the tool configuration sidebar by clicking the menu button in the embedded interface.

## Basic Integration

### Standard Iframe Embedding

For most use cases, a standard iframe provides the best integration:

```html
<!DOCTYPE html>
<html>
<head>
    <title>My Website with AI Chatbot</title>
</head>
<body>
    <h1>Welcome to My Website</h1>
    
    <!-- Your website content -->
    <div class="content">
        <p>Your website content goes here...</p>
    </div>
    
    <!-- Embedded Chatbot -->
    <div class="chatbot-container">
        <h2>Need Help? Ask Our AI Assistant</h2>
        <iframe 
          src="https://your-chatbot-domain.com/embed"
          width="400" 
          height="600"
          frameborder="0"
          style="border: 1px solid #ddd; border-radius: 8px;"
          title="AI Chatbot">
        </iframe>
    </div>
</body>
</html>
```

### Fixed Position Chatbot

Create a floating chatbot that stays in the corner of the page:

```html
<style>
.floating-chatbot {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: 350px;
    height: 500px;
    z-index: 1000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    border-radius: 12px;
    overflow: hidden;
}

.floating-chatbot iframe {
    width: 100%;
    height: 100%;
    border: none;
}
</style>

<div class="floating-chatbot">
    <iframe 
      src="https://your-chatbot-domain.com/embed"
      title="AI Assistant">
    </iframe>
</div>
```

## Responsive Embedding

### Full-Width Responsive

Make the chatbot adapt to different screen sizes:

```html
<style>
.responsive-chatbot {
    position: relative;
    width: 100%;
    height: 600px;
    max-width: 800px;
    margin: 0 auto;
}

.responsive-chatbot iframe {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border: 1px solid #e0e0e0;
    border-radius: 8px;
}

/* Mobile adjustments */
@media (max-width: 768px) {
    .responsive-chatbot {
        height: 500px;
        margin: 10px;
    }
}
</style>

<div class="responsive-chatbot">
    <iframe 
      src="https://your-chatbot-domain.com/embed"
      title="AI Chatbot">
    </iframe>
</div>
```

### Collapsible Chatbot Widget

Create a chatbot that can be minimized/maximized:

```html
<style>
.chatbot-widget {
    position: fixed;
    bottom: 20px;
    right: 20px;
    z-index: 1000;
}

.chatbot-toggle {
    background: #007bff;
    color: white;
    border: none;
    border-radius: 50%;
    width: 60px;
    height: 60px;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    font-size: 24px;
}

.chatbot-container {
    position: absolute;
    bottom: 70px;
    right: 0;
    width: 350px;
    height: 500px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    overflow: hidden;
    display: none;
}

.chatbot-container.open {
    display: block;
}

.chatbot-container iframe {
    width: 100%;
    height: 100%;
    border: none;
}
</style>

<div class="chatbot-widget">
    <button class="chatbot-toggle" onclick="toggleChatbot()">💬</button>
    <div class="chatbot-container" id="chatbotContainer">
        <iframe 
          src="https://your-chatbot-domain.com/embed"
          title="AI Assistant">
        </iframe>
    </div>
</div>

<script>
function toggleChatbot() {
    const container = document.getElementById('chatbotContainer');
    container.classList.toggle('open');
}
</script>
```

## Advanced Configuration

### Custom Styling

Customize the appearance to match your website:

```html
<style>
.custom-chatbot {
    border: 2px solid #your-brand-color;
    border-radius: 15px;
    box-shadow: 0 8px 25px rgba(0,0,0,0.1);
    background: #f9f9f9;
    padding: 10px;
}

.custom-chatbot iframe {
    width: 100%;
    height: 600px;
    border: none;
    border-radius: 10px;
}

/* Dark theme example */
.dark-theme .custom-chatbot {
    background: #2d2d2d;
    border-color: #555;
}
</style>

<div class="custom-chatbot">
    <iframe 
      src="https://your-chatbot-domain.com/embed"
      title="AI Chatbot">
    </iframe>
</div>
```

### Multiple Chatbot Instances

Embed multiple chatbots for different purposes:

```html
<!-- Customer Support Chatbot -->
<div class="support-chatbot">
    <h3>Customer Support</h3>
    <iframe 
      src="https://your-chatbot-domain.com/embed"
      width="400" 
      height="500"
      title="Customer Support Bot">
    </iframe>
</div>

<!-- Sales Assistant Chatbot -->
<div class="sales-chatbot">
    <h3>Sales Assistant</h3>
    <iframe 
      src="https://your-chatbot-domain.com/embed"
      width="400" 
      height="500"
      title="Sales Assistant Bot">
    </iframe>
</div>
```

## Domain Configuration

### Setting Up Allowed Domains

During deployment, you'll be prompted to configure allowed domains. This security feature prevents unauthorized embedding.

#### During Deployment

```bash
# You'll see this prompt during deployment:
Enter allowed embedding domains (comma-separated) [leave empty to disable]: 

# Examples:
example.com
example.com,subdomain.example.com
mysite.com,partner.org,staging.mysite.com
```

#### Environment Variable Configuration

You can also set domains via environment variable:

```bash
export EMBED_ALLOWED_DOMAINS="example.com,subdomain.example.com,partner.org"
```

#### Domain Validation Rules

- **Exact Match**: `example.com` allows only `example.com`
- **Subdomain Support**: Include each subdomain explicitly
- **Protocol Agnostic**: Works with both HTTP and HTTPS
- **Port Agnostic**: Works regardless of port number

#### Testing Domain Configuration

1. **Allowed Domain**: Embedding works normally
2. **Unauthorized Domain**: Returns 403 Forbidden error
3. **No Configuration**: Embedding disabled for security

### Updating Domain Configuration

To update allowed domains after deployment:

1. Update the environment variable in your deployment
2. Redeploy the application
3. Test embedding from new domains

## Authentication

The embedded chatbot maintains full Cognito authentication functionality.

### Authentication Flow

1. **Unauthenticated User**: Sees login form within iframe
2. **Login Process**: Handled within iframe context
3. **Session Management**: Maintains session across page reloads
4. **Logout**: Can be handled within iframe or parent page

### Authentication Events

Listen for authentication status changes:

```javascript
window.addEventListener('message', function(event) {
    // Check if message is from chatbot iframe
    if (event.origin !== 'https://your-chatbot-domain.com') return;
    
    if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
        const { isAuthenticated, userId } = event.data.payload;
        console.log('User authentication status:', isAuthenticated);
        
        // Update your UI based on auth status
        if (isAuthenticated) {
            showAuthenticatedUI();
        } else {
            showUnauthenticatedUI();
        }
    }
    
    if (event.data?.type === 'CHATBOT_AUTH_ERROR') {
        const { error } = event.data.payload;
        console.error('Authentication error:', error);
        handleAuthError(error);
    }
});
```

### Custom Authentication Handling

```javascript
function handleAuthenticationEvents() {
    window.addEventListener('message', function(event) {
        if (event.origin !== 'https://your-chatbot-domain.com') return;
        
        switch (event.data?.type) {
            case 'CHATBOT_AUTH_STATUS':
                updateAuthStatus(event.data.payload);
                break;
            case 'CHATBOT_AUTH_ERROR':
                showAuthError(event.data.payload.error);
                break;
            case 'CHATBOT_SESSION_EXPIRED':
                handleSessionExpiry();
                break;
        }
    });
}

function updateAuthStatus(payload) {
    const { isAuthenticated, userId, userAttributes } = payload;
    
    if (isAuthenticated) {
        // User is logged in
        document.getElementById('user-status').textContent = `Welcome, ${userAttributes?.name || userId}`;
        document.getElementById('login-prompt').style.display = 'none';
    } else {
        // User is not logged in
        document.getElementById('user-status').textContent = 'Please log in to continue';
        document.getElementById('login-prompt').style.display = 'block';
    }
}
```

## Troubleshooting

### Common Issues

#### 1. Iframe Not Loading

**Symptoms**: Blank iframe or loading error
**Solutions**:
- Check domain configuration
- Verify HTTPS is used
- Check browser console for errors
- Test direct access to `/embed` URL

#### 2. Authentication Not Working

**Symptoms**: Login form not appearing or authentication failing
**Solutions**:
- Check browser cookie settings
- Verify iframe security headers
- Test authentication in standalone mode first
- Check for cross-origin restrictions

#### 3. Domain Validation Errors

**Symptoms**: 403 Forbidden error when embedding
**Solutions**:
- Verify domain is in allowed list
- Check exact domain spelling
- Include subdomains explicitly
- Test from correct domain

#### 4. Responsive Issues

**Symptoms**: Chatbot not sizing correctly
**Solutions**:
- Use CSS flexbox or grid for layout
- Set explicit height on container
- Test on different screen sizes
- Check iframe CSS properties

### Debug Mode

Enable debug logging in browser console:

```javascript
// Enable debug mode
localStorage.setItem('debug', 'chatbot:*');

// Check authentication status
localStorage.setItem('debug', 'chatbot:auth');

// Monitor iframe communication
localStorage.setItem('debug', 'chatbot:iframe');
```

### Testing Checklist

- [ ] Iframe loads without errors
- [ ] Authentication works within iframe
- [ ] All chatbot functionality available
- [ ] Responsive design works
- [ ] Domain validation enforced
- [ ] Cross-origin communication works
- [ ] Session management functions
- [ ] Error handling works properly

## Examples

### Complete Integration Example

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>My Website - AI Assistant</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #f5f5f5;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        
        .chatbot-section {
            margin-top: 40px;
            padding: 20px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        
        .chatbot-wrapper {
            position: relative;
            width: 100%;
            height: 600px;
            max-width: 800px;
            margin: 20px auto;
        }
        
        .chatbot-wrapper iframe {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            border: 1px solid #ddd;
            border-radius: 8px;
        }
        
        .auth-status {
            padding: 10px;
            margin: 10px 0;
            border-radius: 4px;
            background: #e3f2fd;
            border-left: 4px solid #2196f3;
        }
        
        @media (max-width: 768px) {
            .chatbot-wrapper {
                height: 500px;
                margin: 10px 0;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Welcome to My Website</h1>
        <p>This is an example of how to integrate the AI chatbot into your website.</p>
        
        <div class="auth-status" id="authStatus">
            Authentication status: Checking...
        </div>
        
        <div class="chatbot-section">
            <h2>AI Assistant</h2>
            <p>Ask our AI assistant any questions you have:</p>
            
            <div class="chatbot-wrapper">
                <iframe 
                  id="chatbotFrame"
                  src="https://your-chatbot-domain.com/embed"
                  title="AI Assistant"
                  allow="microphone; camera">
                </iframe>
            </div>
        </div>
    </div>

    <script>
        // Handle authentication events
        window.addEventListener('message', function(event) {
            // Verify origin for security
            if (event.origin !== 'https://your-chatbot-domain.com') return;
            
            const authStatus = document.getElementById('authStatus');
            
            if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
                const { isAuthenticated, userId } = event.data.payload;
                
                if (isAuthenticated) {
                    authStatus.innerHTML = `✅ Authenticated as: ${userId}`;
                    authStatus.style.background = '#e8f5e8';
                    authStatus.style.borderLeftColor = '#4caf50';
                } else {
                    authStatus.innerHTML = '🔒 Please log in to use the chatbot';
                    authStatus.style.background = '#fff3e0';
                    authStatus.style.borderLeftColor = '#ff9800';
                }
            }
            
            if (event.data?.type === 'CHATBOT_AUTH_ERROR') {
                authStatus.innerHTML = `❌ Authentication error: ${event.data.payload.error}`;
                authStatus.style.background = '#ffebee';
                authStatus.style.borderLeftColor = '#f44336';
            }
        });
        
        // Handle iframe loading
        document.getElementById('chatbotFrame').addEventListener('load', function() {
            console.log('Chatbot iframe loaded successfully');
        });
        
        // Handle iframe errors
        document.getElementById('chatbotFrame').addEventListener('error', function() {
            const authStatus = document.getElementById('authStatus');
            authStatus.innerHTML = '❌ Failed to load chatbot. Please check your connection.';
            authStatus.style.background = '#ffebee';
            authStatus.style.borderLeftColor = '#f44336';
        });
    </script>
</body>
</html>
```

### WordPress Integration

For WordPress sites, add this to your theme or use a custom HTML block:

```html
<!-- Add to your WordPress theme or custom HTML block -->
<div class="wp-chatbot-container">
    <h3>Need Help? Ask Our AI Assistant</h3>
    <div style="position: relative; width: 100%; height: 600px; max-width: 600px;">
        <iframe 
          src="https://your-chatbot-domain.com/embed"
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border: 1px solid #ddd; border-radius: 8px;"
          title="AI Assistant">
        </iframe>
    </div>
</div>

<style>
.wp-chatbot-container {
    margin: 20px 0;
    padding: 20px;
    background: #f9f9f9;
    border-radius: 8px;
}

@media (max-width: 768px) {
    .wp-chatbot-container iframe {
        height: 500px !important;
    }
}
</style>
```

### React Integration

For React applications:

```jsx
import React, { useEffect, useState } from 'react';

const ChatbotEmbed = ({ domain, width = "100%", height = "600px" }) => {
    const [authStatus, setAuthStatus] = useState('checking');
    const [userId, setUserId] = useState(null);

    useEffect(() => {
        const handleMessage = (event) => {
            if (event.origin !== `https://${domain}`) return;

            if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
                const { isAuthenticated, userId } = event.data.payload;
                setAuthStatus(isAuthenticated ? 'authenticated' : 'unauthenticated');
                setUserId(userId);
            }

            if (event.data?.type === 'CHATBOT_AUTH_ERROR') {
                setAuthStatus('error');
                console.error('Chatbot auth error:', event.data.payload.error);
            }
        };

        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [domain]);

    return (
        <div className="chatbot-embed">
            <div className={`auth-status ${authStatus}`}>
                {authStatus === 'checking' && 'Checking authentication...'}
                {authStatus === 'authenticated' && `✅ Authenticated as: ${userId}`}
                {authStatus === 'unauthenticated' && '🔒 Please log in to use the chatbot'}
                {authStatus === 'error' && '❌ Authentication error occurred'}
            </div>
            
            <div style={{ position: 'relative', width, height }}>
                <iframe
                    src={`https://${domain}/embed`}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '100%',
                        border: '1px solid #ddd',
                        borderRadius: '8px'
                    }}
                    title="AI Chatbot"
                    allow="microphone; camera"
                />
            </div>
        </div>
    );
};

export default ChatbotEmbed;
```

## Support

For additional support or questions:

1. Check the troubleshooting section above
2. Review browser console for error messages
3. Test the `/embed` URL directly in your browser
4. Verify domain configuration in deployment settings
5. Check authentication works in standalone mode first

Remember to replace `your-chatbot-domain.com` with your actual chatbot domain in all examples.