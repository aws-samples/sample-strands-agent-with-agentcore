#!/bin/bash

echo "🔍 Setting up AgentCore Observability..."

# Check AWS CLI and credentials
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI not found. Please install AWS CLI first."
    exit 1
fi

if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Please run 'aws configure' first."
    exit 1
fi

# Get AWS region
AWS_REGION=${AWS_REGION:-$(aws configure get region)}
if [ -z "$AWS_REGION" ]; then
    echo "❌ AWS region not set. Please set AWS_REGION environment variable or configure default region."
    exit 1
fi

echo "✅ Using AWS region: $AWS_REGION"

# Create CloudWatch Log Group for AgentCore
LOG_GROUP_NAME="agents/strands-agent-logs"
echo "📋 Creating CloudWatch Log Group: $LOG_GROUP_NAME"

if aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_NAME" --region "$AWS_REGION" | grep -q "$LOG_GROUP_NAME"; then
    echo "✅ Log group '$LOG_GROUP_NAME' already exists"
else
    aws logs create-log-group --log-group-name "$LOG_GROUP_NAME" --region "$AWS_REGION"
    echo "✅ Created log group: $LOG_GROUP_NAME"
fi

# Create CloudWatch Log Stream
TIMESTAMP=$(date +%y%m%d)
LOG_STREAM_NAME="agent-$TIMESTAMP"
echo "📋 Creating CloudWatch Log Stream: $LOG_STREAM_NAME"

if aws logs describe-log-streams --log-group-name "$LOG_GROUP_NAME" --log-stream-name-prefix "$LOG_STREAM_NAME" --region "$AWS_REGION" 2>/dev/null | grep -q "$LOG_STREAM_NAME"; then
    echo "✅ Log stream '$LOG_STREAM_NAME' already exists"
else
    aws logs create-log-stream --log-group-name "$LOG_GROUP_NAME" --log-stream-name "$LOG_STREAM_NAME" --region "$AWS_REGION"
    echo "✅ Created log stream: $LOG_STREAM_NAME"
fi

# Generate .env configuration
ENV_FILE="chatbot-app/backend/.env"
echo "📋 Generating observability configuration..."

# Create directory if it doesn't exist
mkdir -p "$(dirname "$ENV_FILE")"

# Remove existing observability entries to avoid duplicates
if [ -f "$ENV_FILE" ]; then
    echo "📋 Updating existing .env file (preserving other variables)..."
    # Create temp file without observability entries
    grep -v "^OTEL_" "$ENV_FILE" | grep -v "^AGENT_OBSERVABILITY_ENABLED=" | grep -v "^AWS_LOG_GROUP=" | grep -v "^AWS_LOG_STREAM=" > "$ENV_FILE.tmp" 2>/dev/null || touch "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
else
    echo "📋 Creating new .env file..."
    touch "$ENV_FILE"
fi

# Append observability configuration
cat >> "$ENV_FILE" << EOF
# AWS Distro for OpenTelemetry (ADOT) Configuration
OTEL_PYTHON_DISTRO=aws_distro
OTEL_PYTHON_CONFIGURATOR=aws_configurator
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_LOGS_PROTOCOL=http/protobuf
OTEL_LOGS_EXPORTER=otlp
OTEL_TRACES_EXPORTER=otlp

# CloudWatch Integration
OTEL_EXPORTER_OTLP_LOGS_HEADERS=x-aws-log-group=$LOG_GROUP_NAME,x-aws-log-stream=$LOG_STREAM_NAME,x-aws-metric-namespace=agentsd
OTEL_RESOURCE_ATTRIBUTES=service.name=strands-chatbot

# Enable AgentCore Observability
AGENT_OBSERVABILITY_ENABLED=true
AWS_REGION=$AWS_REGION
AWS_LOG_GROUP=$LOG_GROUP_NAME
AWS_LOG_STREAM=$LOG_STREAM_NAME

# Ultra-fast batch processing for real-time traces
OTEL_BSP_SCHEDULE_DELAY=1000
OTEL_BSP_MAX_EXPORT_BATCH_SIZE=1
OTEL_BSP_EXPORT_TIMEOUT=5000
EOF

echo "✅ Created $ENV_FILE with observability configuration"
echo ""
echo "🎯 Next Steps:"
echo "1. Enable CloudWatch Transaction Search:"
echo "   - Open CloudWatch Console → Application Signals (APM) → Transaction search"
echo "   - Choose 'Enable Transaction Search'"
echo "   - Select 'ingest spans as structured logs'"
echo "   - Choose 'Save'"
echo ""
echo "2. Start the application:"
echo "   cd chatbot-app && ./start.sh"
echo ""
echo "3. View traces in CloudWatch:"
echo "   - CloudWatch Console → Application Signals → Traces"
echo "   - CloudWatch Console → GenAI Observability Dashboard"
echo "   - Filter by service.name = 'strands-chatbot'"
echo ""
echo "✅ AgentCore Observability setup complete!"