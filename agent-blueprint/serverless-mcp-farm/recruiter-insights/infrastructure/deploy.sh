#!/bin/bash

set -e

STACK_NAME="mcp-recruiter-insights-server"
REGION="${AWS_DEFAULT_REGION:-us-west-2}"

echo "🚀 Deploying Recruiter Insights MCP Server (Simplified)..."

# Deploy CloudFormation stack
echo "☁️  Creating infrastructure..."
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name $STACK_NAME \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION \
  --parameter-overrides \
    LogLevel=INFO

# Create Lambda deployment package
echo "📦 Creating minimal Lambda deployment package..."
cd ../src

# Clean up any existing packages
rm -rf awslabs* boto3* botocore* s3transfer* jmespath* urllib3* six* python_dateutil* 2>/dev/null || true
rm -f ../infrastructure/recruiter-insights-lambda.zip

# Create a temporary directory for clean installation
mkdir -p /tmp/lambda-build
cd /tmp/lambda-build

# Install only the MCP handler
python3 -m pip install awslabs-mcp-lambda-handler -t . --upgrade

# Remove all AWS packages (already in Lambda runtime)
rm -rf boto3* botocore* s3transfer* jmespath* urllib3* 2>/dev/null || true

# Copy our source files
cp /Users/awsdeep/Library/CloudStorage/WorkDocsDrive-Documents/code/01-strands/sample-strands-agent-chatbot/agent-blueprint/serverless-mcp-farm/recruiter-insights/src/*.py .

# Clean up unnecessary files
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete
find . -name "*.pyo" -delete
find . -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true

# Create zip with absolute path
INFRASTRUCTURE_DIR="/Users/awsdeep/Library/CloudStorage/WorkDocsDrive-Documents/code/01-strands/sample-strands-agent-chatbot/agent-blueprint/serverless-mcp-farm/recruiter-insights/infrastructure"
zip -r "$INFRASTRUCTURE_DIR/recruiter-insights-lambda.zip" . -q

# Check size
echo "Package size:"
ls -lh "$INFRASTRUCTURE_DIR/recruiter-insights-lambda.zip"

# Clean up temp directory
cd "$INFRASTRUCTURE_DIR"
rm -rf /tmp/lambda-build

# Update Lambda function code
echo "🔄 Updating Lambda function..."
aws lambda update-function-code \
  --function-name $STACK_NAME-mcp-server \
  --zip-file fileb://recruiter-insights-lambda.zip \
  --region $REGION \
  --no-cli-pager > /dev/null

# Wait for function to be ready
echo "⏳ Waiting for Lambda function to be ready..."
aws lambda wait function-updated \
  --function-name $STACK_NAME-mcp-server \
  --region $REGION

echo "✅ Lambda function updated successfully"

# Upload sample resume files to S3
echo "⬆️  Uploading resume files to S3..."
BUCKET_NAME=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`S3BucketName`].OutputValue' \
  --output text)

echo "📁 Bucket name: $BUCKET_NAME"

# Use absolute path to candidate-data directory
CANDIDATE_DATA_DIR="$(dirname "$PWD")/candidate-data"
echo "📂 Uploading from: $CANDIDATE_DATA_DIR"

if [ -d "$CANDIDATE_DATA_DIR" ]; then
    aws s3 sync "$CANDIDATE_DATA_DIR" s3://$BUCKET_NAME/resumes/ --exclude ".*" --region $REGION
    echo "✅ Resume files uploaded successfully"
else
    echo "❌ Error: candidate-data directory not found at $CANDIDATE_DATA_DIR"
    exit 1
fi

# Get outputs from CloudFormation
API_URL=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
  --output text)

SSM_PARAMETER=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --region $REGION \
  --query 'Stacks[0].Outputs[?OutputKey==`SSMParameterName`].OutputValue' \
  --output text)

echo "🎉 Deployment successful!"
echo "API URL: $API_URL"
echo "SSM Parameter: $SSM_PARAMETER"

# Clean up
cd ../infrastructure
rm recruiter-insights-lambda.zip
