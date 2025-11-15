#!/bin/bash

echo "🚀 Setting up Agent Chatbot Template..."

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8 or higher."
    exit 1
fi

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm."
    exit 1
fi

echo "✅ Prerequisites check passed"

# Install AgentCore dependencies
echo "📦 Installing AgentCore dependencies..."
cd agentcore
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

echo "Activating virtual environment..."
source venv/bin/activate

echo "Upgrading pip..."
./venv/bin/python -m pip install --upgrade pip

echo "Installing requirements..."
./venv/bin/python -m pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo "✅ AgentCore dependencies installed successfully"
    deactivate
else
    echo "❌ Failed to install AgentCore dependencies"
    deactivate
    exit 1
fi

cd ..

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
cd frontend
npm install

if [ $? -eq 0 ]; then
    echo "✅ Frontend dependencies installed successfully"
else
    echo "❌ Failed to install frontend dependencies"
    exit 1
fi

cd ..

echo "🎉 Setup completed successfully!"
echo ""
echo "To start the application:"
echo "  ./start.sh"
echo ""
echo "Or start components separately:"
echo "  AgentCore: cd agentcore && source venv/bin/activate && cd src && python main.py"
echo "  Frontend:  cd frontend && npm run dev"
