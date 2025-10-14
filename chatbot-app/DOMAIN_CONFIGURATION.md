# Domain Configuration Guide

This guide explains how to configure allowed domains for chatbot embedding during deployment and after deployment.

## Overview

The chatbot embedding feature includes domain validation to prevent unauthorized usage while allowing legitimate integrations. This security measure ensures that only approved websites can embed your chatbot.

## Configuration During Deployment

### Interactive Configuration

During the deployment process, you'll be prompted to configure allowed domains:

```bash
🌐 Embedding Configuration
Configure which domains are allowed to embed the chatbot via iframe.
This helps prevent unauthorized usage while allowing legitimate integrations.

Examples:
  - Single domain: example.com
  - Multiple domains: example.com,subdomain.example.com,another-site.org
  - Leave empty to disable embedding

Enter allowed embedding domains (comma-separated) [leave empty to disable]: 
```

### Example Configurations

#### Single Domain
```bash
Enter allowed embedding domains: example.com
```
- Allows embedding from `https://example.com` and `http://example.com`
- Blocks all other domains

#### Multiple Domains
```bash
Enter allowed embedding domains: example.com,blog.example.com,partner.org
```
- Allows embedding from:
  - `example.com`
  - `blog.example.com` 
  - `partner.org`
- Blocks all other domains

#### Development/Testing
```bash
Enter allowed embedding domains: localhost,127.0.0.1,example.com
```
- Allows local development and production domain
- Useful for testing before going live

#### Disable Embedding
```bash
Enter allowed embedding domains: [press enter without typing anything]
```
- Completely disables iframe embedding
- Returns 403 Forbidden for all embedding attempts

## Environment Variable Configuration

### Pre-deployment Configuration

Set the environment variable before running the deployment:

```bash
# Single domain
export EMBED_ALLOWED_DOMAINS="example.com"

# Multiple domains
export EMBED_ALLOWED_DOMAINS="example.com,subdomain.example.com,partner.org"

# Disable embedding
export EMBED_ALLOWED_DOMAINS=""

# Run deployment
./deploy.sh
```

### Docker Environment

For Docker deployments, set the environment variable in your container:

```bash
docker run -e EMBED_ALLOWED_DOMAINS="example.com,partner.org" your-chatbot-image
```

### Kubernetes Configuration

In your Kubernetes deployment:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: chatbot-backend
spec:
  template:
    spec:
      containers:
      - name: chatbot
        image: your-chatbot-image
        env:
        - name: EMBED_ALLOWED_DOMAINS
          value: "example.com,subdomain.example.com,partner.org"
```

## Domain Validation Rules

### Exact Matching
- Domain validation uses exact string matching
- `example.com` only allows `example.com`
- Subdomains must be explicitly listed

### Protocol Agnostic
- Works with both HTTP and HTTPS
- `example.com` allows both `http://example.com` and `https://example.com`

### Port Agnostic
- Works regardless of port number
- `example.com` allows `example.com:8080`, `example.com:3000`, etc.

### Subdomain Handling
- Subdomains must be explicitly configured
- `example.com` does NOT automatically allow `blog.example.com`
- Include each subdomain separately: `example.com,blog.example.com`

### Wildcard Support
Currently, wildcard domains are not supported. Each domain must be explicitly listed.

## Testing Domain Configuration

### Allowed Domain Test
1. Deploy with your domain in the allowed list
2. Create a test HTML page on that domain
3. Embed the chatbot using iframe
4. Verify it loads successfully

### Unauthorized Domain Test
1. Try embedding from a domain not in the allowed list
2. Should receive a 403 Forbidden error
3. Check browser console for error messages

### Local Development Test
```bash
# Include localhost for development
export EMBED_ALLOWED_DOMAINS="localhost,127.0.0.1,example.com"
```

## Updating Domain Configuration

### Method 1: Redeploy with New Configuration

```bash
# Update environment variable
export EMBED_ALLOWED_DOMAINS="example.com,newdomain.com,partner.org"

# Redeploy
./deploy.sh
```

### Method 2: Update Container Environment

For containerized deployments, update the environment variable and restart:

```bash
# Update environment in your container orchestration system
# Then restart the backend service
```

### Method 3: CloudFormation Parameter Update

If using AWS CloudFormation, update the parameter:

```bash
aws cloudformation update-stack \
  --stack-name ChatbotStack \
  --use-previous-template \
  --parameters ParameterKey=EmbedAllowedDomains,ParameterValue="example.com,newdomain.com"
```

## Security Considerations

### Origin Header Validation
- The system validates the `Origin` header from incoming requests
- This header is set by the browser and cannot be easily spoofed
- Provides protection against unauthorized embedding

### Development Mode
- When no domains are configured, embedding is disabled
- This is a security-first approach
- Prevents accidental exposure in production

### HTTPS Recommendation
- Always use HTTPS for production deployments
- Mixed content (HTTP iframe in HTTPS page) may be blocked by browsers
- Ensure both your site and the chatbot use HTTPS

### Regular Review
- Periodically review the allowed domains list
- Remove domains that no longer need access
- Monitor logs for unauthorized access attempts

## Common Scenarios

### Corporate Website
```bash
# Main website and blog
EMBED_ALLOWED_DOMAINS="company.com,blog.company.com,support.company.com"
```

### Multi-brand Organization
```bash
# Multiple brand websites
EMBED_ALLOWED_DOMAINS="brand1.com,brand2.com,corporate.com"
```

### Partner Integration
```bash
# Your site plus partner sites
EMBED_ALLOWED_DOMAINS="yoursite.com,partner1.com,partner2.org"
```

### Development and Staging
```bash
# Include all environments
EMBED_ALLOWED_DOMAINS="localhost,dev.yoursite.com,staging.yoursite.com,yoursite.com"
```

## Troubleshooting

### Common Issues

#### 1. 403 Forbidden Error
**Cause**: Domain not in allowed list
**Solution**: Add domain to `EMBED_ALLOWED_DOMAINS` and redeploy

#### 2. Embedding Works Locally but Not in Production
**Cause**: Different domains between environments
**Solution**: Ensure production domain is in allowed list

#### 3. Subdomain Not Working
**Cause**: Subdomain not explicitly listed
**Solution**: Add subdomain to allowed list: `example.com,blog.example.com`

#### 4. HTTPS/HTTP Mixed Content
**Cause**: Protocol mismatch
**Solution**: Ensure both sites use HTTPS

### Debug Steps

1. **Check Current Configuration**
   ```bash
   # In your backend container
   echo $EMBED_ALLOWED_DOMAINS
   ```

2. **Test Direct Access**
   ```bash
   # Test the embed endpoint directly
   curl -H "Origin: https://yoursite.com" https://chatbot-domain.com/embed
   ```

3. **Check Browser Console**
   - Look for CORS errors
   - Check for 403 Forbidden responses
   - Verify Origin header is being sent

4. **Verify Domain Spelling**
   - Ensure exact match with your website domain
   - Check for typos in configuration
   - Verify subdomain inclusion

### Log Analysis

Check backend logs for domain validation messages:

```bash
# AWS CloudWatch Logs
aws logs tail /aws/ecs/chatbot-backend --follow

# Look for messages like:
# "Domain validation failed for origin: unauthorized-site.com"
# "Embedding allowed for origin: example.com"
```

## Best Practices

### Security
1. **Principle of Least Privilege**: Only allow necessary domains
2. **Regular Audits**: Review allowed domains quarterly
3. **Monitor Logs**: Watch for unauthorized access attempts
4. **Use HTTPS**: Always use secure connections

### Maintenance
1. **Document Changes**: Keep track of domain additions/removals
2. **Test After Updates**: Verify embedding works after configuration changes
3. **Staging Environment**: Test domain changes in staging first
4. **Backup Configuration**: Keep a record of current allowed domains

### Performance
1. **Minimize Domain List**: Only include actively used domains
2. **Cache Headers**: Ensure proper caching for embed endpoint
3. **Monitor Usage**: Track which domains are actively embedding

## Integration Examples

### WordPress Site
```bash
# Allow WordPress site and staging
EMBED_ALLOWED_DOMAINS="myblog.com,staging.myblog.com"
```

### E-commerce Platform
```bash
# Main store and help center
EMBED_ALLOWED_DOMAINS="store.com,help.store.com,checkout.store.com"
```

### SaaS Application
```bash
# App domains and customer portals
EMBED_ALLOWED_DOMAINS="app.saas.com,portal.saas.com,docs.saas.com"
```

## Support

If you encounter issues with domain configuration:

1. Verify the domain spelling and format
2. Check that the domain is accessible via HTTPS
3. Test embedding with a simple HTML page first
4. Review backend logs for validation errors
5. Ensure the deployment completed successfully

For additional help, check the main [Embedding Guide](EMBEDDING_GUIDE.md) for complete integration instructions.