#!/bin/bash

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  👤 Cognito Test User Creator"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Set region - use environment variable or default
export AWS_REGION=${AWS_REGION:-us-west-2}
echo "🌍 Using region: $AWS_REGION"
echo ""

# Get Cognito User Pool ID from CloudFormation
echo "🔍 Retrieving Cognito User Pool ID..."
COGNITO_USER_POOL_ID=$(aws cloudformation describe-stacks \
    --stack-name CognitoAuthStack \
    --region "$AWS_REGION" \
    --query 'Stacks[0].Outputs[?OutputKey==`UserPoolId`].OutputValue' \
    --output text 2>/dev/null || echo "")

if [ -z "$COGNITO_USER_POOL_ID" ] || [ "$COGNITO_USER_POOL_ID" = "None" ]; then
    echo -e "${RED}✗${NC} Cognito User Pool not found!"
    echo ""
    echo "Please deploy Cognito stack first:"
    echo "  cd ../.. && ENABLE_COGNITO=true ./scripts/deploy.sh"
    exit 1
fi

echo -e "${GREEN}✓${NC} Found User Pool ID: $COGNITO_USER_POOL_ID"
echo ""

# Default test user credentials
DEFAULT_EMAIL="test@example.com"
DEFAULT_PASSWORD="TestUser123!"

# Ask for custom credentials or use defaults
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Test User Configuration"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Press Enter to use default credentials, or provide custom values:"
echo ""

read -p "Email [$DEFAULT_EMAIL]: " TEST_USER_EMAIL
TEST_USER_EMAIL=${TEST_USER_EMAIL:-$DEFAULT_EMAIL}

read -p "Password [$DEFAULT_PASSWORD]: " TEST_USER_PASSWORD
TEST_USER_PASSWORD=${TEST_USER_PASSWORD:-$DEFAULT_PASSWORD}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if user already exists
echo "🔍 Checking if user exists..."
USER_EXISTS=$(aws cognito-idp list-users \
    --user-pool-id "$COGNITO_USER_POOL_ID" \
    --region "$AWS_REGION" \
    --filter "email=\"$TEST_USER_EMAIL\"" \
    --query 'Users[0].Username' \
    --output text 2>/dev/null || echo "")

if [ -n "$USER_EXISTS" ] && [ "$USER_EXISTS" != "None" ]; then
    echo -e "${YELLOW}⚠${NC}  User already exists: $TEST_USER_EMAIL"
    echo ""
    read -p "Do you want to reset the password? (y/N): " RESET_PASSWORD

    if [[ "$RESET_PASSWORD" =~ ^[Yy]$ ]]; then
        echo ""
        echo "🔄 Resetting password..."
        aws cognito-idp admin-set-user-password \
            --user-pool-id "$COGNITO_USER_POOL_ID" \
            --username "$TEST_USER_EMAIL" \
            --password "$TEST_USER_PASSWORD" \
            --permanent \
            --region "$AWS_REGION" > /dev/null 2>&1

        echo -e "${GREEN}✓${NC} Password reset successfully!"
    else
        echo ""
        echo "Skipped password reset."
    fi
else
    # Create test user
    echo "👤 Creating test user..."
    aws cognito-idp admin-create-user \
        --user-pool-id "$COGNITO_USER_POOL_ID" \
        --username "$TEST_USER_EMAIL" \
        --user-attributes Name=email,Value="$TEST_USER_EMAIL" Name=email_verified,Value=true \
        --temporary-password "$TEST_USER_PASSWORD" \
        --message-action SUPPRESS \
        --region "$AWS_REGION" > /dev/null 2>&1

    # Set permanent password
    aws cognito-idp admin-set-user-password \
        --user-pool-id "$COGNITO_USER_POOL_ID" \
        --username "$TEST_USER_EMAIL" \
        --password "$TEST_USER_PASSWORD" \
        --permanent \
        --region "$AWS_REGION" > /dev/null 2>&1

    echo -e "${GREEN}✓${NC} Test user created successfully!"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔑 Test User Credentials"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Email:    $TEST_USER_EMAIL"
echo "Password: $TEST_USER_PASSWORD"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Use these credentials to log in to your application"
echo ""
