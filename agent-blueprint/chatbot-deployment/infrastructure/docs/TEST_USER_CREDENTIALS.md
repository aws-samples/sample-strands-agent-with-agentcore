# Test User Credentials

## ✅ Test User Created Successfully

**Date**: January 28, 2026  
**User Pool ID**: eu-west-1_xQOe0A93M  
**Status**: CONFIRMED and ENABLED

---

## 🔑 Login Credentials

```
Email:    test@example.com
Password: TestUser123!
```

**⚠️ IMPORTANT**: Keep these credentials secure. Do not commit this file to version control.

---

## 🌐 Application URLs

### Main Application
**URL**: https://d1ystqalgm445b.cloudfront.net

When you visit this URL, you will be automatically redirected to the Cognito login page.

### Direct Cognito Login
**URL**: https://chatbot-dev-53882568.auth.eu-west-1.amazoncognito.com/login?client_id=37osr3ctqscb4m33gqqdlc8i4v&response_type=code&scope=openid+email+profile&redirect_uri=https://d1ystqalgm445b.cloudfront.net/oauth2/idpresponse

---

## 📝 How to Test Login

### Option 1: Via Application URL (Recommended)
1. Open your browser
2. Navigate to: https://d1ystqalgm445b.cloudfront.net
3. You will be redirected to Cognito login
4. Enter credentials:
   - Email: `test@example.com`
   - Password: `TestUser123!`
5. Click "Sign in"
6. You should be redirected back to the application

### Option 2: Via Direct Cognito URL
1. Open the Cognito login URL above
2. Enter the test credentials
3. After successful login, you'll be redirected to the application

---

## 🔍 Verification Steps

### 1. Check User Status
```bash
aws cognito-idp list-users \
  --user-pool-id eu-west-1_xQOe0A93M \
  --region eu-west-1 \
  --query 'Users[*].[Username,UserStatus,Enabled]' \
  --output table
```

### 2. Test Application Health
```bash
# Check if CloudFront is serving content
curl -I https://d1ystqalgm445b.cloudfront.net

# Check backend health (may require authentication)
curl https://d1ystqalgm445b.cloudfront.net/api/health
```

### 3. Check ECS Service
```bash
aws ecs describe-services \
  --cluster chatbot-cluster \
  --services ChatbotFrontendService \
  --region eu-west-1 \
  --query 'services[0].[serviceName,status,runningCount,desiredCount]' \
  --output table
```

---

## 🛠️ User Management

### Create Additional Users
```bash
cd agent-blueprint/chatbot-deployment/infrastructure/scripts
AWS_REGION=eu-west-1 ./create-test-user.sh
```

### Reset Password
```bash
aws cognito-idp admin-set-user-password \
  --user-pool-id eu-west-1_xQOe0A93M \
  --username test@example.com \
  --password "NewPassword123!" \
  --permanent \
  --region eu-west-1
```

### Delete User
```bash
aws cognito-idp admin-delete-user \
  --user-pool-id eu-west-1_xQOe0A93M \
  --username test@example.com \
  --region eu-west-1
```

### List All Users
```bash
aws cognito-idp list-users \
  --user-pool-id eu-west-1_xQOe0A93M \
  --region eu-west-1
```

---

## 🐛 Troubleshooting

### Login Fails
1. **Check user status**: User must be CONFIRMED and Enabled
2. **Verify password**: Ensure you're using the correct password
3. **Check CloudFront**: Wait 5-10 minutes after deployment for full propagation
4. **Review logs**: Check CloudWatch logs for authentication errors

### Redirect Issues
1. **Verify callback URL**: Should be configured in Cognito User Pool Client
2. **Check CloudFront URL**: Must match the redirect_uri parameter
3. **Browser cache**: Clear browser cache and cookies

### Application Not Loading
1. **ECS Service**: Verify the service is running
2. **CodeBuild**: Check if the build completed successfully
3. **CloudFront**: Ensure distribution is deployed (not "In Progress")
4. **ALB Health**: Check target group health status

---

## 📊 User Details

### User Attributes
- **Email**: test@example.com
- **Email Verified**: true
- **User Status**: CONFIRMED
- **Enabled**: true
- **Created**: 2026-01-28

### Authentication Flow
1. User visits application URL
2. CloudFront serves the frontend
3. Frontend detects no authentication
4. Redirects to Cognito Hosted UI
5. User enters credentials
6. Cognito validates and issues tokens
7. User redirected back with authorization code
8. Frontend exchanges code for tokens
9. User authenticated and can access application

---

## 🔐 Security Notes

- **Password Requirements**: Minimum 8 characters, must include uppercase, lowercase, and numbers
- **Token Expiration**: ID tokens expire after 1 hour by default
- **Refresh Tokens**: Valid for 30 days by default
- **MFA**: Not currently enabled (can be configured in Cognito)

---

## 📚 Related Documentation

- **Deployment Guide**: [DEPLOYMENT_SUCCESS.md](./DEPLOYMENT_SUCCESS.md)
- **Quick Start**: [QUICK_START.md](./QUICK_START.md)
- **SSO Guide**: [SSO_DEPLOYMENT_GUIDE.md](./SSO_DEPLOYMENT_GUIDE.md)
- **Recovery Guide**: [RECOVERY_SUMMARY.md](./RECOVERY_SUMMARY.md)

---

## ✅ Next Steps

1. ✅ Test user created
2. ⏭️ Test login at application URL
3. ⏭️ Verify application functionality
4. ⏭️ Create additional users if needed
5. ⏭️ Optional: Enable SSO with IAM Identity Center

---

**Test user is ready to use!** 🎉

Try logging in at: https://d1ystqalgm445b.cloudfront.net
