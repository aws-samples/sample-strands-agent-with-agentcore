# DynamoDB Tables Fix - January 28, 2025

## Issue
After the previous deployment, the application was experiencing HTTP 500 errors with `ResourceNotFoundException` from DynamoDB. The backend logs showed:
```
[DynamoDB] Error getting session: ResourceNotFoundException: Requested resource not found
[DynamoDB] Error upserting session: ResourceNotFoundException: Requested resource not found
```

## Root Cause
The DynamoDB tables (`strands-agent-chatbot-users-v2` and `strands-agent-chatbot-sessions`) were deleted during the last deployment because the environment variable `USE_EXISTING_TABLES=true` was not set. This caused CDK to delete and attempt to recreate the tables.

## Solution
Redeployed the ChatbotStack with the correct environment variables to recreate the DynamoDB tables:

```bash
export USE_EXISTING_TABLES=false  # Create new tables
export USE_EXISTING_ECR=true      # Use existing ECR repository
export USE_EXISTING_BUCKET=true   # Use existing S3 bucket
npx cdk deploy ChatbotStack --require-approval never
```

## Verification

### 1. DynamoDB Tables Status
Both tables are now ACTIVE:
- `strands-agent-chatbot-users-v2`: ACTIVE (0 items)
- `strands-agent-chatbot-sessions`: ACTIVE (0 items)

### 2. ECS Service Status
- Service: `ChatbotStack-ChatbotFrontendService1BBA8B0F-E9mptTdWSuQB`
- Status: ACTIVE
- Running Tasks: 1/1

### 3. Test User
- Email: `test@example.com`
- Password: `TestUser123!`
- Status: CONFIRMED and ENABLED in Cognito User Pool `eu-west-1_xQOe0A93M`

## Next Steps
1. Test login at: https://d1ystqalgm445b.cloudfront.net
2. Test chat functionality by sending a message
3. Verify that session data is being stored in DynamoDB

## Important Notes
- **Always set `USE_EXISTING_TABLES=true`** in future deployments to prevent table deletion
- The tables were recreated empty, so all previous user data and sessions were lost
- The test user credentials remain the same (stored in Cognito, not DynamoDB)
- User profiles will be automatically created in DynamoDB on first login

## Deployment Output
```
✅  ChatbotStack

Outputs:
ChatbotStack.ApplicationUrl = https://d1ystqalgm445b.cloudfront.net
ChatbotStack.SessionsTableName = strands-agent-chatbot-sessions
ChatbotStack.UsersTableName = strands-agent-chatbot-users-v2
ChatbotStack.StreamingAlbUrl = http://Chatbo-Chatb-24QlFnTXYFr1-424007574.eu-west-1.elb.amazonaws.com
```

Deployment completed successfully in ~8 minutes.
