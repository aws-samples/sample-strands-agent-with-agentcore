# Local Embedding Testing Guide

This guide helps you test the chatbot embedding feature in your local development environment.

## 🚀 Quick Start

1. **Start the services:**
   ```bash
   cd chatbot-app
   ./start.sh
   ```

2. **Run the embedding test:**
   ```bash
   ./test-embedding.sh
   ```

3. **Open test pages in your browser:**
   - Local test page: `file://path/to/chatbot-app/test-embedding-local.html`
   - Interactive examples: `http://localhost:3000/embed-example.html`
   - Auth testing: `http://localhost:3000/iframe-test.html`

## 📋 What Gets Tested

### Local Environment Setup
- ✅ Frontend running on port 3000
- ✅ Backend running on port 8000
- ✅ Domain validation configured for localhost
- ✅ CORS configured for local development

### Embedding Functionality
- ✅ Iframe loading from localhost
- ✅ Iframe loading from 127.0.0.1
- ✅ Authentication within iframe context
- ✅ Cross-origin communication
- ✅ Domain validation enforcement

### Interactive Features
- ✅ Reload iframe functionality
- ✅ Connection testing
- ✅ Authentication status monitoring
- ✅ Debug information display

## 🔧 Local Configuration

### Automatic Configuration
The `start.sh` script automatically configures local embedding support:

```bash
# Environment variables set automatically
EMBED_ALLOWED_DOMAINS="localhost,127.0.0.1,localhost:3000,localhost:3001,127.0.0.1:3000,127.0.0.1:3001"
CORS_ORIGINS="http://localhost:3000,http://127.0.0.1:3000"
```

### Manual Configuration
If you need custom configuration, create `.env.local` in the backend directory:

```bash
# chatbot-app/backend/.env.local
EMBED_ALLOWED_DOMAINS=localhost,127.0.0.1,custom-domain.local
CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
DEBUG=true
```

## 🧪 Test Pages

### 1. Local Test Page (`test-embedding-local.html`)
- **Purpose**: Test embedding from a local HTML file
- **Features**: 
  - Multiple iframe configurations
  - Real-time status monitoring
  - Connection testing
  - Debug information
- **Access**: Open the file directly in your browser

### 2. Interactive Examples (`/embed-example.html`)
- **Purpose**: Comprehensive embedding examples
- **Features**:
  - Different embedding patterns
  - Responsive designs
  - Code examples
  - Live authentication events
- **Access**: `http://localhost:3000/embed-example.html`

### 3. Auth Testing (`/iframe-test.html`)
- **Purpose**: Focused authentication testing
- **Features**:
  - Authentication flow testing
  - Session management
  - Cross-origin communication
  - Automated test suite
- **Access**: `http://localhost:3000/iframe-test.html`

## 🔍 Testing Checklist

### Pre-Test Setup
- [ ] Both services started with `./start.sh`
- [ ] No errors in console output
- [ ] Frontend accessible at `http://localhost:3000`
- [ ] Backend accessible at `http://localhost:8000`
- [ ] Health check passes: `curl http://localhost:8000/health`

### Basic Embedding Tests
- [ ] Iframe loads without 403 errors
- [ ] Chatbot interface appears in iframe
- [ ] Authentication form appears (if not logged in)
- [ ] Can interact with chatbot in iframe
- [ ] No console errors in browser

### Domain Validation Tests
- [ ] Embedding works from localhost
- [ ] Embedding works from 127.0.0.1
- [ ] Different ports work (3000, 3001, etc.)
- [ ] Direct access to `/embed` works
- [ ] Unauthorized domains blocked (test with different domain)

### Authentication Tests
- [ ] Login form appears in iframe when not authenticated
- [ ] Login process works within iframe
- [ ] Session maintained after iframe reload
- [ ] Authentication events sent to parent window
- [ ] Logout works properly

### Responsive Tests
- [ ] Iframe resizes properly
- [ ] Mobile view works correctly
- [ ] Different iframe sizes work
- [ ] Responsive CSS applies correctly

## 🛠️ Troubleshooting

### Common Issues

#### 1. 403 Forbidden Error
**Symptoms**: Iframe shows "Embedding not allowed from this domain"
**Solutions**:
- Check that `EMBED_ALLOWED_DOMAINS` includes your domain
- Verify the start script loaded the local configuration
- Check backend logs for domain validation messages

#### 2. Iframe Not Loading
**Symptoms**: Blank iframe or loading indefinitely
**Solutions**:
- Verify both services are running
- Check browser console for errors
- Test direct access to `http://localhost:3000/embed`
- Check for firewall blocking local connections

#### 3. Authentication Not Working
**Symptoms**: Login form not appearing or authentication failing
**Solutions**:
- Test authentication in standalone mode first
- Check Cognito configuration
- Verify iframe security headers
- Check browser cookie settings

#### 4. CORS Errors
**Symptoms**: Cross-origin request blocked errors
**Solutions**:
- Verify `CORS_ORIGINS` includes your test domain
- Check that backend CORS middleware is configured
- Test with different browsers

### Debug Commands

```bash
# Check service status
curl http://localhost:3000
curl http://localhost:8000/health

# Test embed endpoint directly
curl -H "Origin: http://localhost" http://localhost:3000/embed

# Check backend logs
tail -f chatbot-app/backend.log

# Test domain validation
curl -H "Origin: http://unauthorized-domain.com" http://localhost:3000/embed
```

### Browser Console Debugging

```javascript
// Enable debug logging
localStorage.setItem('debug', 'chatbot:*');

// Check iframe status
console.log(document.querySelector('iframe').contentWindow);

// Test postMessage communication
window.postMessage({ type: 'AUTH_STATUS_REQUEST' }, '*');

// Use debug helpers (available on test pages)
window.embeddingTest.getResults();
window.embeddingTest.testEndpoints();
```

## 📊 Expected Results

### Successful Test Results
- ✅ All iframes load without errors
- ✅ Authentication status displayed correctly
- ✅ No 403 or CORS errors in console
- ✅ Chatbot functionality works within iframe
- ✅ Connection tests pass
- ✅ Debug information shows correct configuration

### Health Check Response
```json
{
  "status": "healthy",
  "registry_available": true,
  "total_sessions": 0
}
```

### Domain Validation Logs
```
INFO: Authorized embed access from domain: localhost
INFO: No embed domains configured - allowing all embed requests (development mode)
```

## 🔄 Continuous Testing

### During Development
1. Keep services running with `./start.sh`
2. Use test pages to verify changes
3. Check browser console regularly
4. Test after any configuration changes

### Before Deployment
1. Test all embedding patterns
2. Verify authentication flows
3. Check responsive behavior
4. Test domain validation
5. Validate production configuration

## 📚 Related Documentation

- [EMBEDDING_GUIDE.md](frontend/EMBEDDING_GUIDE.md) - Complete integration guide
- [DOMAIN_CONFIGURATION.md](DOMAIN_CONFIGURATION.md) - Production domain setup
- [IFRAME_AUTH_GUIDE.md](frontend/IFRAME_AUTH_GUIDE.md) - Authentication details
- [QUICK_REFERENCE.md](frontend/QUICK_REFERENCE.md) - Developer quick reference

## 🆘 Getting Help

If you encounter issues:

1. **Check the logs**: Backend logs in `backend.log`
2. **Verify configuration**: Environment variables and domain settings
3. **Test step by step**: Start with direct access, then embedding
4. **Use debug tools**: Browser console and debug helpers
5. **Check documentation**: Refer to the guides above

### Common Solutions
- Restart services if configuration changed
- Clear browser cache if authentication issues
- Check firewall settings for local connections
- Verify no other services using ports 3000/8000