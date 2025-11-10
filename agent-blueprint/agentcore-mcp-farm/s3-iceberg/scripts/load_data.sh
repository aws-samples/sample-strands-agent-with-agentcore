#!/bin/bash
#
# Load Sample Data Wrapper Script
#
# This script provides a convenient wrapper around generate_sample_data.py
# Usage:
#   ./load_data.sh              # Load sample data
#   ./load_data.sh --regenerate # Clear and reload data
#

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/generate_sample_data.py"

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}===========================================================${NC}"
echo -e "${GREEN}  S3 Iceberg AgentCore - Sample Data Loader${NC}"
echo -e "${GREEN}===========================================================${NC}"

# Check if Python script exists
if [ ! -f "$PYTHON_SCRIPT" ]; then
    echo -e "${RED}❌ Error: Python script not found: $PYTHON_SCRIPT${NC}"
    exit 1
fi

# Check Python version
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Error: python3 is required but not installed${NC}"
    exit 1
fi

# Check required dependencies
echo -e "\n${YELLOW}📦 Checking Python dependencies...${NC}"
python3 -c "import boto3, pyarrow, pyiceberg" 2>/dev/null || {
    echo -e "${RED}❌ Missing dependencies. Installing...${NC}"
    pip3 install boto3 pyarrow pyiceberg pandas || {
        echo -e "${RED}❌ Failed to install dependencies${NC}"
        exit 1
    }
}

# Run the Python script
echo -e "\n${GREEN}🚀 Running data generation script...${NC}\n"
python3 "$PYTHON_SCRIPT" "$@"

EXIT_CODE=$?
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}✅ Data loading complete!${NC}"
else
    echo -e "\n${RED}❌ Data loading failed (exit code: $EXIT_CODE)${NC}"
    exit $EXIT_CODE
fi
