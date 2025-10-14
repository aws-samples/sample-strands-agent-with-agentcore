# Chatbot Embedding Quick Reference

## 🚀 Quick Start

```html
<iframe 
  src="https://your-chatbot-domain.com/embed"
  width="400" 
  height="600"
  frameborder="0"
  title="AI Chatbot">
</iframe>
```

**✨ Full Feature Parity**: The embed page includes all main app features - tool configuration, file uploads, authentication, and real-time analysis.

## 📐 Common Sizes

### Standard Desktop
```html
<iframe src="https://your-domain.com/embed" width="400" height="600"></iframe>
```

### Mobile Optimized
```html
<iframe src="https://your-domain.com/embed" width="350" height="500"></iframe>
```

### Full Width Responsive
```html
<div style="position: relative; width: 100%; height: 600px;">
  <iframe 
    src="https://your-domain.com/embed"
    style="position: absolute; top: 0; left: 0; width: 100%; height: 100%;">
  </iframe>
</div>
```

## 🎨 Styling Examples

### Basic Styling
```css
iframe {
  border: 1px solid #ddd;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
```

### Floating Widget
```css
.floating-chatbot {
  position: fixed;
  bottom: 20px;
  right: 20px;
  width: 350px;
  height: 500px;
  z-index: 1000;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
}
```

## 🔐 Authentication Events

```javascript
window.addEventListener('message', function(event) {
  if (event.origin !== 'https://your-chatbot-domain.com') return;
  
  if (event.data?.type === 'CHATBOT_AUTH_STATUS') {
    const { isAuthenticated, userId } = event.data.payload;
    console.log('Auth status:', isAuthenticated);
  }
});
```

## 🌐 Domain Configuration

### During Deployment
```bash
Enter allowed embedding domains: example.com,blog.example.com,partner.org
```

### Environment Variable
```bash
export EMBED_ALLOWED_DOMAINS="example.com,subdomain.example.com"
```

## 📱 Framework Examples

### React
```jsx
const ChatbotEmbed = () => (
  <iframe 
    src="https://your-domain.com/embed"
    width="100%" 
    height="600px"
    style={{ border: 'none', borderRadius: '8px' }}
  />
);
```

### Vue.js
```vue
<template>
  <iframe 
    src="https://your-domain.com/embed"
    width="100%" 
    height="600px"
    frameborder="0">
  </iframe>
</template>
```

### Angular
```html
<iframe 
  src="https://your-domain.com/embed"
  width="100%" 
  height="600px"
  [style]="{ border: 'none', borderRadius: '8px' }">
</iframe>
```

## 🛠️ Troubleshooting

### Common Issues
- **403 Forbidden**: Domain not in allowed list
- **Blank iframe**: Check HTTPS and domain configuration
- **Auth not working**: Verify Cognito configuration
- **Not responsive**: Use CSS positioning instead of fixed dimensions

### Debug Commands
```javascript
// Check iframe status
console.log(document.querySelector('iframe').contentWindow);

// Test authentication
window.postMessage({ type: 'AUTH_STATUS_REQUEST' }, '*');

// Enable debug mode
localStorage.setItem('debug', 'chatbot:*');
```

## 📋 Checklist

- [ ] Replace `your-domain.com` with actual chatbot URL
- [ ] Add your website domain to allowed domains list
- [ ] Test embedding on your actual domain
- [ ] Verify authentication works in iframe
- [ ] Test responsive behavior on mobile
- [ ] Check browser console for errors
- [ ] Validate all chatbot features work

## 🔗 Resources

- [Complete Embedding Guide](EMBEDDING_GUIDE.md)
- [Domain Configuration](../DOMAIN_CONFIGURATION.md)
- [Authentication Guide](IFRAME_AUTH_GUIDE.md)
- [Test Page](public/embed-example.html)
- [Interactive Examples](public/iframe-test.html)

## 🧪 Local Testing

### Start Local Testing
```bash
cd chatbot-app
./start.sh              # Start services
./test-embedding.sh     # Run embedding tests
```

### Test URLs
- Local test page: `file://path/to/test-embedding-local.html`
- Interactive examples: `http://localhost:3000/embed-example.html`
- Auth testing: `http://localhost:3000/iframe-test.html`
- Direct embed: `http://localhost:3000/embed`

### Debug Commands
```bash
curl http://localhost:8000/health                    # Check backend
curl http://localhost:3000/embed                     # Check embed endpoint
tail -f chatbot-app/backend.log                      # View logs
```

## 📞 Support

1. Check domain configuration in deployment
2. Test `/embed` URL directly in browser
3. Verify HTTPS is used for both sites
4. Check browser console for error messages
5. Review authentication in standalone mode first
6. For local testing, see [LOCAL_TESTING_GUIDE.md](../LOCAL_TESTING_GUIDE.md)