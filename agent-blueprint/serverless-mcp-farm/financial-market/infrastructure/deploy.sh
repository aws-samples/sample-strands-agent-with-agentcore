#!/bin/bash

STACK_NAME="mcp-financial-analysis-server"
REGION="${AWS_DEFAULT_REGION:-us-west-2}"
STAGE="${DEPLOYMENT_STAGE:-prod}"
LAYER_NAME="financial-market-pandas-layer"

echo "Creating Lambda Layer for pandas and yfinance using Docker..."

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is required but not installed. Please install Docker first."
    exit 1
fi

echo "Building Lambda Layer and deployment package (lambda-yfinance approach)..."

# Create Layer with all dependencies using correct architecture
echo "Creating Lambda Layer for yfinance + pandas..."
mkdir -p layer-build

echo "Checking existing stack status..."
STACK_STATUS=$(aws cloudformation describe-stacks --stack-name $STACK_NAME --region $REGION --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "STACK_NOT_EXISTS")

if [[ "$STACK_STATUS" == "ROLLBACK_IN_PROGRESS" || "$STACK_STATUS" == "ROLLBACK_COMPLETE" || "$STACK_STATUS" == "CREATE_FAILED" ]]; then
    echo "Stack is in $STACK_STATUS state. Deleting existing stack..."
    aws cloudformation delete-stack --stack-name $STACK_NAME --region $REGION
    echo "Waiting for stack deletion to complete..."
    aws cloudformation wait stack-delete-complete --stack-name $STACK_NAME --region $REGION

    # Clean up any orphaned SSM parameters
    echo "Cleaning up orphaned SSM parameters..."
    aws ssm delete-parameter --name "/mcp/endpoints/serverless/financial-market" --region $REGION 2>/dev/null || echo "No orphaned SSM parameter found"
fi

# Build Layer with all dependencies (lambda-yfinance approach with wheel)
docker run --rm --platform linux/amd64 \
    -v "$(pwd)/layer-build:/app" \
    -v "$(pwd)/../src:/src" \
    python:3.13-slim \
    bash -c "
        apt-get update && apt-get install -y gcc g++ &&
        cd /tmp && 
        mkdir -p wheels &&
        # Download wheels for Linux x86_64
        pip wheel --no-cache-dir -r /src/requirements.txt -w wheels/ &&
        # Install from wheels to ensure clean installation
        mkdir -p /app/python &&
        pip install --no-cache-dir --find-links wheels/ --target /app/python/ \
            --platform linux_x86_64 --only-binary=:all: \
            yfinance pandas requests loguru pydantic awslabs-mcp-lambda-handler ||
        pip install --no-cache-dir --find-links wheels/ --target /app/python/ \
            yfinance pandas requests loguru pydantic awslabs-mcp-lambda-handler &&
        cd /app/python/ &&
        # Remove AWS packages (already in Lambda runtime)
        rm -rf boto3* botocore* s3transfer* jmespath* urllib3* &&
        # Clean up
        rm -rf */tests/ */test/ */__pycache__/ &&
        find . -name '*.pyc' -delete &&
        find . -name '*.pyo' -delete &&
        # Keep metadata for packages that need it, only remove large unused ones
        find . -name '*boto3*.dist-info' -type d -exec rm -rf {} + 2>/dev/null || true &&
        find . -name '*botocore*.dist-info' -type d -exec rm -rf {} + 2>/dev/null || true
    "

# Create layer zip
cd layer-build
zip -r ../layer.zip python/ -q
cd ..
rm -rf layer-build

# Publish Layer
echo "Publishing Lambda Layer..."
LAYER_VERSION=$(timeout 60 aws lambda publish-layer-version \
    --layer-name $LAYER_NAME \
    --zip-file fileb://layer.zip \
    --compatible-runtimes python3.13 \
    --region $REGION \
    --query 'Version' \
    --output text 2>&1)

# Check if the command timed out or failed
if [ $? -ne 0 ] || [ -z "$LAYER_VERSION" ] || [[ "$LAYER_VERSION" == *"Connection was closed"* ]]; then
    echo "Layer publishing timed out or failed. Checking if layer was created..."
    sleep 5
    # Get the latest layer version
    LAYER_VERSION=$(aws lambda list-layer-versions \
        --layer-name $LAYER_NAME \
        --region $REGION \
        --query 'LayerVersions[0].Version' \
        --output text)

    if [ -z "$LAYER_VERSION" ] || [ "$LAYER_VERSION" == "None" ]; then
        echo "Failed to create layer. Please try again."
        rm layer.zip
        exit 1
    fi
    echo "Found existing layer version: $LAYER_VERSION"
fi

LAYER_ARN="arn:aws:lambda:${REGION}:$(aws sts get-caller-identity --query Account --output text):layer:${LAYER_NAME}:${LAYER_VERSION}"
echo "Layer ARN: $LAYER_ARN"
rm layer.zip

# Create lightweight Lambda package (source code only)
mkdir -p temp
cd temp
cp ../../src/*.py .

# Remove AWS Lambda runtime packages (already included in Lambda)
echo "Removing AWS Lambda runtime packages..."
rm -rf boto3* botocore* s3transfer* jmespath* urllib3* certifi* 2>/dev/null || true
# Keep all pandas dependencies: six, python_dateutil, pytz, tzdata, numpy

# Additional cleanup (Docker container already handled numpy/pandas)

# Clean up unnecessary files
find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete
find . -name "*.pyo" -delete
find . -name "*.dist-info" -type d -exec rm -rf {} + 2>/dev/null || true
find . -name "*.egg-info" -type d -exec rm -rf {} + 2>/dev/null || true

# Create deployment package
echo "Creating ZIP package..."
echo "Contents before zipping:"
ls -la | head -20
zip -r ../lambda-deployment.zip . -x "*.pyc" "*/__pycache__/*" "*.pyo" "*.dist-info/*" "*.egg-info/*"
echo "ZIP package created. Size:"
ls -lh ../lambda-deployment.zip

# Clean up temp directory
cd ..
rm -rf temp

# Check package size
PACKAGE_SIZE=$(wc -c < lambda-deployment.zip)
PACKAGE_SIZE_MB=$((PACKAGE_SIZE / 1024 / 1024))

echo "Package size: ${PACKAGE_SIZE_MB}MB"

if [ $PACKAGE_SIZE_MB -gt 50 ]; then
    echo "Package size exceeds 50MB. Please reduce package size."
    rm lambda-deployment.zip
    exit 1
fi

# Deploy CloudFormation stack
echo "Deploying CloudFormation stack..."
aws cloudformation deploy \
  --template-file cloudformation.yaml \
  --stack-name $STACK_NAME \
  --parameter-overrides DeploymentStage=$STAGE LayerArn=$LAYER_ARN \
  --capabilities CAPABILITY_NAMED_IAM \
  --region $REGION

if [ $? -eq 0 ]; then
    echo "Updating Lambda function code..."
    aws lambda update-function-code \
      --function-name ${STACK_NAME}-mcp-server \
      --zip-file fileb://lambda-deployment.zip \
      --region $REGION
    
    echo "Getting API Gateway URL..."
    API_URL=$(aws cloudformation describe-stacks \
      --stack-name $STACK_NAME \
      --region $REGION \
      --query 'Stacks[0].Outputs[?OutputKey==`ApiUrl`].OutputValue' \
      --output text)
    
    echo "Deployment successful!"
    echo "API URL: $API_URL"
else
    echo "Deployment failed!"
    exit 1
fi