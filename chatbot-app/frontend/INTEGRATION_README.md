# Chatbot Integration Documentation

This directory contains comprehensive documentation and examples for integrating the AI chatbot into external websites.

## 📚 Documentation Files

### Core Guides
- **[EMBEDDING_GUIDE.md](EMBEDDING_GUIDE.md)** - Complete integration guide with examples
- **[DOMAIN_CONFIGURATION.md](../DOMAIN_CONFIGURATION.md)** - Domain security configuration
- **[IFRAME_AUTH_GUIDE.md](IFRAME_AUTH_GUIDE.md)** - Authentication in iframe context
- **[QUICK_REFERENCE.md](QUICK_REFERENCE.md)** - Quick reference for developers
- **[LOCAL_TESTING_GUIDE.md](../LOCAL_TESTING_GUIDE.md)** - Local development and testing

### Interactive Examples
- **[embed-example.html](public/embed-example.html)** - Interactive embedding examples
- **[iframe-test.html](public/iframe-test.html)** - Authentication testing page

## 🚀 Quick Start

### For Local Development/Testing
1. **Start the services**: `./start.sh` in the chatbot-app directory
2. **Run embedding tests**: `./test-embedding.sh`
3. **Open test pages**: 
   - Local test: `file://path/to/test-embedding-local.html`
   - Interactive examples: `http://localhost:3000/embed-example.html`

### For Production Deployment
1. **Deploy your chatbot** with domain configuration
2. **Add your domain** to the allowed domains list during deployment
3. **Copy the iframe code** and update the src URL:
   ```html
   <iframe 
     src="https://your-chatbot-domain.com/embed"
     width="400" 
     height="600"
     frameborder="0"
     title="AI Chatbot">
   </iframe>
   ```
4. **Test the integration** on your website

### 🎯 Full Feature Access
The embedded chatbot provides the same functionality as the main application:
- **Complete tool suite** - All available tools accessible via sidebar
- **Configuration options** - Enable/disable tools, manage settings
- **File upload support** - Images, PDFs, and other file types
- **Authentication** - Full Cognito login and session management
- **Real-time features** - Agent analysis, tool progress, suggestions

## 📖 Documentation Overview

### 1. Embedding Guide
The main integration guide covers:
- Basic iframe embedding
- Responsive design patterns
- Advanced configuration options
- Framework-specific examples (React, Vue, Angular)
- Troubleshooting common issues

### 2. Domain Configuration
Security configuration guide covering:
- Setting up allowed domains during deployment
- Environment variable configuration
- Domain validation rules and testing
- Updating configuration after deployment

### 3. Authentication Guide
Authentication-specific documentation covering:
- How Cognito works in iframe context
- Cross-origin communication
- Authentication event handling
- Testing authentication flows

### 4. Quick Reference
Developer-friendly quick reference with:
- Common code snippets
- Standard sizing options
- Framework examples
- Troubleshooting checklist

## 🎯 Interactive Examples

### Embed Examples Page
Visit `/embed-example.html` to see:
- **Standard Embedding** - Basic iframe with fixed dimensions
- **Responsive Embedding** - Flexible sizing for different screens
- **Mobile Optimized** - Compact version for mobile devices
- **Floating Widget** - Collapsible chat widget
- **Integration Guide** - Setup instructions and code examples

### Full Feature Parity
The embedded chatbot now includes all the same features as the main application:
- **Tool Configuration** - Full access to all available tools via sidebar
- **Tool Management** - Enable/disable tools, clear chat, refresh tools
- **Suggested Questions** - Context-aware question suggestions
- **File Upload** - Support for images and PDF files
- **Agent Analysis** - Real-time agent reasoning and analysis
- **Scratch Pad** - Live tool execution progress
- **Authentication** - Complete Cognito authentication flow

### Authentication Test Page
Visit `/iframe-test.html` to test:
- Authentication flows in iframe context
- Cross-origin communication
- Session management
- Error handling

## 🔧 Integration Patterns

### Basic Website Integration
```html
<!-- Simple iframe embedding -->
<div class="chatbot-container">
  <iframe src="https://your-domain.com/embed" width="400" height="600"></iframe>
</div>
```

### Responsive Integration
```html
<!-- Responsive iframe that adapts to container -->
<div style="position: relative; width: 100%; height: 600px;">
  <iframe 
    src="https://your-domain.com/embed"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
  </iframe>
</div>
```

### Floating Widget
```html
<!-- Floating chatbot widget -->
<div class="floating-chatbot">
  <button onclick="toggleChat()">💬</button>
  <div class="chat-container" id="chatContainer">
    <iframe src="https://your-domain.com/embed"></iframe>
  </div>
</div>
```

## 🔐 Security Configuration

### Domain Allowlist
Configure allowed domains during deployment:
```bash
Enter allowed embedding domains: example.com,blog.example.com,partner.org
```

### Environment Variable
```bash
export EMBED_ALLOWED_DOMAINS="example.com,subdomain.example.com"
```

## 📱 Framework Support

### React
```jsx
import React from 'react';

const ChatbotEmbed = ({ domain, width = "400px", height = "600px" }) => (
  <iframe 
    src={`https://${domain}/embed`}
    width={width} 
    height={height}
    style={{ border: 'none', borderRadius: '8px' }}
    title="AI Chatbot"
  />
);
```

### Vue.js
```vue
<template>
  <iframe 
    :src="`https://${domain}/embed`"
    :width="width" 
    :height="height"
    frameborder="0"
    title="AI Chatbot">
  </iframe>
</template>

<script>
export default {
  props: ['domain', 'width', 'height']
}
</script>
```

### Angular
```typescript
import { Component, Input } from '@angular/core';

@Component({
  selector: 'chatbot-embed',
  template: `
    <iframe 
      [src]="embedUrl"
      [width]="width" 
      [height]="height"
      frameborder="0"
      title="AI Chatbot">
    </iframe>
  `
})
export class ChatbotEmbedComponent {
  @Input() domain: string;
  @Input() width: string = '400px';
  @Input() height: string = '600px';
  
  get embedUrl() {
    return `https://${this.domain}/embed`;
  }
}
```

## 🛠️ Testing Your Integration

### Pre-deployment Checklist
- [ ] Chatbot deployed with domain configuration
- [ ] Your website domain added to allowed domains
- [ ] HTTPS enabled on both sites
- [ ] Authentication configured properly

### Integration Testing
- [ ] Iframe loads without errors
- [ ] Authentication works within iframe
- [ ] All chatbot features functional
- [ ] Responsive design works on mobile
- [ ] Cross-origin communication working
- [ ] No console errors

### Browser Testing
- [ ] Chrome/Chromium
- [ ] Firefox
- [ ] Safari
- [ ] Edge
- [ ] Mobile browsers

## 🚨 Troubleshooting

### Common Issues

#### 1. 403 Forbidden Error
- **Cause**: Domain not in allowed list
- **Solution**: Add domain to `EMBED_ALLOWED_DOMAINS` and redeploy

#### 2. Blank Iframe
- **Cause**: HTTPS/HTTP mismatch or domain validation
- **Solution**: Ensure both sites use HTTPS and domain is configured

#### 3. Authentication Not Working
- **Cause**: Cognito configuration or cross-origin issues
- **Solution**: Check Cognito setup and test in standalone mode first

#### 4. Not Responsive
- **Cause**: Fixed dimensions instead of responsive CSS
- **Solution**: Use CSS positioning and percentage-based sizing

### Debug Steps
1. Test `/embed` URL directly in browser
2. Check browser console for errors
3. Verify domain configuration
4. Test authentication in standalone mode
5. Check network requests in developer tools

## 📞 Support Resources

### Documentation
- Complete embedding guide with all integration patterns
- Domain configuration with security best practices
- Authentication guide for iframe context
- Quick reference for common code snippets

### Interactive Tools
- Live embedding examples with different patterns
- Authentication testing page with automated tests
- Code generators for common frameworks

### Troubleshooting
- Common issues and solutions
- Debug commands and tools
- Testing checklists
- Performance optimization tips

## 🔄 Updates and Maintenance

### Keeping Documentation Current
- Review integration examples quarterly
- Update framework versions and syntax
- Test examples with latest browser versions
- Gather feedback from integration users

### Version Compatibility
- Document breaking changes in embedding API
- Provide migration guides for major updates
- Maintain backward compatibility when possible
- Test integrations with each release

## 📈 Best Practices

### Performance
- Use lazy loading for iframes when possible
- Optimize iframe dimensions for your use case
- Consider preloading for critical chat widgets
- Monitor embedding performance metrics

### Security
- Always use HTTPS for production
- Regularly review allowed domains list
- Monitor for unauthorized embedding attempts
- Keep authentication configuration secure

### User Experience
- Provide clear loading states
- Handle authentication gracefully
- Ensure mobile responsiveness
- Test across different devices and browsers

### Maintenance
- Document all customizations
- Test after each deployment
- Monitor user feedback
- Keep integration examples updated

---

For the most up-to-date information and detailed examples, refer to the individual documentation files in this directory.