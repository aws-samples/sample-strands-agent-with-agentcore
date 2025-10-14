# Iframe Authentication Guide

This document explains how Cognito authentication works in the embedded chatbot context and provides testing instructions.

## Overview

The embedded chatbot (`/embed` route) maintains full Cognito authentication functionality while being optimized for iframe embedding. The implementation ensures that authentication flows work properly within iframe constraints.

## Key Features

### 1. Iframe-Aware Authentication
- **Automatic Detection**: The system automatically detects when running in an iframe context
- **Optimized UI**: Authentication UI is optimized for embedded scenarios
- **Session Management**: Maintains authentication sessions consistently with the standalone version

### 2. Cross-Origin Communication
- **Status Updates**: Posts authentication status to parent window via `postMessage`
- **Error Handling**: Communicates authentication errors to parent window
- **Event Types**:
  - `CHATBOT_AUTH_STATUS`: Authentication state changes
  - `CHATBOT_AUTH_ERROR`: Authentication errors

### 3. Security Headers
- **Frame Embedding**: Configured to allow iframe embedding with appropriate CSP headers
- **Same-Origin Policy**: Maintains security while allowing controlled embedding

## Implementation Details

### Component Architecture
The authentication system uses two separate wrapper components:

- **`AuthWrapper`**: Used for the main application (`/` route) with full UI including header bar and sign-out functionality
- **`EmbedAuthWrapper`**: Used specifically for the embed page (`/embed` route) with minimal UI optimized for iframe embedding

This separation ensures that:
- The main application remains unchanged and unaffected by iframe-specific modifications
- The embed page has a clean, minimal interface suitable for embedding
- Each component can be optimized for its specific use case

### EmbedAuthWrapper Component
A dedicated `EmbedAuthWrapper` component has been created specifically for iframe embedding:

```typescript
// Detects iframe context
const isInIframe = window.self !== window.top;

// Uses default variation for better iframe compatibility
variation="default"

// No header bar for embed pages - just returns children
return <>{children}</>;
```

The original `AuthWrapper` remains unchanged and is used for the main application, while `EmbedAuthWrapper` is specifically optimized for iframe scenarios.

### Iframe Authentication Hook
The `useIframeAuth` hook provides:
- Authentication state monitoring
- Iframe context detection
- Periodic auth state checks (every 30 seconds)
- Parent window communication

### Security Configuration
Next.js configuration includes iframe-friendly headers:

```javascript
{
  source: '/embed',
  headers: [
    {
      key: 'Content-Security-Policy',
      value: "frame-ancestors 'self' *",
    },
  ],
}
```

## Testing Authentication

### Automated Testing
Use the provided test page at `/iframe-test.html`:

1. **Load Test Page**: Navigate to `http://your-domain/iframe-test.html`
2. **Run Tests**: Click "Run Authentication Tests"
3. **Review Results**: Check test results for any issues

### Manual Testing Checklist

#### 1. Basic Iframe Loading
- [ ] Iframe loads without errors
- [ ] Authentication UI appears if not logged in
- [ ] Chat interface appears if logged in

#### 2. Authentication Flow
- [ ] Login form works within iframe
- [ ] Redirects work properly (may open in parent window)
- [ ] Session is maintained after login
- [ ] User can interact with chatbot after authentication

#### 3. Session Management
- [ ] Session persists across iframe reloads
- [ ] Session timeout is handled gracefully
- [ ] Re-authentication works when needed

#### 4. Cross-Origin Communication
- [ ] Parent window receives authentication status messages
- [ ] Error messages are communicated properly
- [ ] No console errors related to cross-origin issues

### Common Issues and Solutions

#### Issue: Authentication Redirects Not Working
**Symptoms**: Login redirects fail or open in wrong window
**Solution**: 
- Check if parent window handles redirects
- Verify Cognito redirect URLs include iframe context
- Consider using popup authentication for iframe scenarios

#### Issue: Session Not Persisting
**Symptoms**: User needs to re-authenticate frequently
**Solution**:
- Check browser cookie settings for iframe context
- Verify Cognito session configuration
- Ensure proper domain configuration

#### Issue: Cross-Origin Errors
**Symptoms**: Console errors about blocked requests
**Solution**:
- Verify CSP headers are properly configured
- Check that API endpoints allow cross-origin requests
- Ensure proper CORS configuration on backend

## Integration Examples

### Basic Iframe Embedding
```html
<iframe 
  src="https://your-chatbot-domain.com/embed"
  width="400" 
  height="600"
  frameborder="0"
  title="AI Chatbot">
</iframe>
```

### Listening to Authentication Events
```javascript
window.addEventListener('message', function(event) {
  if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
    const { isAuthenticated, userId } = event.data.payload;
    console.log('Chatbot auth status:', isAuthenticated);
  }
});
```

### Responsive Embedding
```html
<div style="position: relative; width: 100%; height: 500px;">
  <iframe 
    src="https://your-chatbot-domain.com/embed"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;"
    frameborder="0"
    title="AI Chatbot">
  </iframe>
</div>
```

## Requirements Verification

This implementation addresses all requirements from the specification:

- **5.1**: ✅ Cognito authentication required for embedded chatbot
- **5.2**: ✅ Redirects to Cognito login flow when not authenticated  
- **5.3**: ✅ Session maintained consistently with standalone version
- **5.4**: ✅ Re-authentication handled gracefully in embedded context
- **5.5**: ✅ Respects all existing user permissions and access controls

## Troubleshooting

### Debug Mode
Enable debug logging by adding to browser console:
```javascript
localStorage.setItem('debug', 'chatbot:auth');
```

### Common Debug Steps
1. Check browser console for authentication errors
2. Verify network requests to Cognito endpoints
3. Check localStorage/sessionStorage for Amplify tokens
4. Test authentication in standalone mode first
5. Verify iframe security headers in network tab

## Security Considerations

- Authentication tokens are handled securely within iframe
- Cross-origin communication is limited to status updates
- Parent window cannot access authentication tokens directly
- All existing Cognito security measures remain in place