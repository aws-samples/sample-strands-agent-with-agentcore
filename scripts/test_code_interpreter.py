#!/usr/bin/env python3
"""
AgentCore Code Interpreter Integration Test

Tests the deployed Code Interpreter using the actual project code:
- diagram_tool.py: Diagram generation using Bedrock Code Interpreter
- workspace module: Image saving and management

Usage:
    python scripts/test_code_interpreter.py
    python scripts/test_code_interpreter.py --list-only  # Only check configuration
    python scripts/test_code_interpreter.py --execute    # Actually execute code (uses API credits)
"""

import argparse
import sys
import os

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

import boto3

# Configuration from environment
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')


def get_code_interpreter_id() -> str:
    """Get Code Interpreter ID from environment or Parameter Store (same as diagram_tool.py)."""
    # 1. Check environment variable
    code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
    if code_interpreter_id:
        return code_interpreter_id

    # 2. Try Parameter Store
    try:
        ssm = boto3.client('ssm', region_name=REGION)
        param_name = f"/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/code-interpreter-id"
        response = ssm.get_parameter(Name=param_name)
        return response['Parameter']['Value']
    except Exception as e:
        print(f"   Failed to get from SSM: {e}")
        return None


def test_code_interpreter_config():
    """Test Code Interpreter configuration."""
    print("\n📋 Test: Code Interpreter Configuration")
    print("─" * 50)

    try:
        code_interpreter_id = get_code_interpreter_id()

        if code_interpreter_id:
            print(f"✅ Code Interpreter ID found:")
            print(f"   ID: {code_interpreter_id}")
            print(f"   Region: {REGION}")
            return True, code_interpreter_id
        else:
            print("❌ Code Interpreter ID not found")
            print(f"   Set CODE_INTERPRETER_ID env var or SSM parameter:")
            print(f"   /{PROJECT_NAME}/{ENVIRONMENT}/agentcore/code-interpreter-id")
            return False, None

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_code_interpreter_sdk():
    """Test Code Interpreter SDK import."""
    print("\n📦 Test: Code Interpreter SDK")
    print("─" * 50)

    try:
        from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

        print(f"✅ CodeInterpreter SDK imported successfully")
        print(f"   Module: bedrock_agentcore.tools.code_interpreter_client")

        # Try to instantiate
        code_interpreter = CodeInterpreter(REGION)
        print(f"   Instance created for region: {REGION}")

        return True

    except ImportError as e:
        print(f"❌ SDK import failed: {e}")
        print("   Install: pip install bedrock-agentcore")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_workspace_integration():
    """Test workspace integration for saving images."""
    print("\n🗂️  Test: Workspace Integration")
    print("─" * 50)

    try:
        from workspace import ImageManager
        from workspace.config import get_workspace_bucket

        # Create a test image manager
        image_manager = ImageManager(user_id="test-user", session_id="test-session")

        print(f"✅ ImageManager created successfully")
        print(f"   User ID: test-user")
        print(f"   Session ID: test-session")

        # Check S3 bucket configuration (same as workspace/config.py)
        try:
            bucket = get_workspace_bucket()
            print(f"   S3 Bucket: {bucket}")
        except ValueError as e:
            print(f"   ⚠️  {e}")

        return True

    except ImportError as e:
        print(f"❌ Workspace import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_code_execution(code_interpreter_id: str):
    """Test actual code execution (uses API credits)."""
    print("\n🔧 Test: Code Execution")
    print("─" * 50)

    try:
        from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

        code_interpreter = CodeInterpreter(REGION)

        print(f"   Starting Code Interpreter (ID: {code_interpreter_id})...")
        code_interpreter.start(identifier=code_interpreter_id)

        # Simple test code
        test_code = """
import matplotlib.pyplot as plt
import numpy as np

# Generate simple chart
x = np.linspace(0, 10, 100)
y = np.sin(x)

plt.figure(figsize=(8, 4))
plt.plot(x, y, 'b-', linewidth=2)
plt.title('Test Chart')
plt.xlabel('X axis')
plt.ylabel('Y axis')
plt.grid(True)
plt.savefig('test_chart.png', dpi=150, bbox_inches='tight')
print("Chart generated successfully!")
"""

        print(f"   Executing test code...")
        response = code_interpreter.invoke("executeCode", {
            "code": test_code,
            "language": "python",
            "clearContext": False
        })

        # Check response
        execution_success = False
        for event in response.get("stream", []):
            result = event.get("result", {})
            if result.get("isError", False):
                error_msg = result.get("structuredContent", {}).get("stderr", "Unknown error")
                print(f"❌ Execution failed: {error_msg[:200]}")
                code_interpreter.stop()
                return False

            stdout = result.get("structuredContent", {}).get("stdout", "")
            if stdout:
                print(f"   Output: {stdout}")
            execution_success = True

        if execution_success:
            print(f"✅ Code executed successfully!")

            # Try to download the generated file
            print(f"   Downloading generated file...")
            download_response = code_interpreter.invoke("readFiles", {"paths": ["test_chart.png"]})

            file_found = False
            for event in download_response.get("stream", []):
                result = event.get("result", {})
                if "content" in result and len(result["content"]) > 0:
                    content_block = result["content"][0]
                    file_data = content_block.get("data") or content_block.get("resource", {}).get("blob")
                    if file_data:
                        print(f"   ✅ File downloaded: {len(file_data)} bytes")
                        file_found = True
                        break

            if not file_found:
                print(f"   ⚠️  File not found in download response")

        code_interpreter.stop()
        print(f"   Code Interpreter stopped")

        return execution_success

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_diagram_tool_import():
    """Test diagram tool import."""
    print("\n📊 Test: Diagram Tool Import")
    print("─" * 50)

    try:
        from builtin_tools import generate_diagram_and_validate

        print(f"✅ generate_diagram_and_validate imported successfully")
        print(f"   Tool name: {generate_diagram_and_validate.__name__}")
        print(f"   Callable: {callable(generate_diagram_and_validate)}")

        return True

    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore Code Interpreter")
    parser.add_argument("--list-only", action="store_true", help="Only check configuration")
    parser.add_argument("--execute", action="store_true", help="Actually execute code (uses API credits)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║    AgentCore Code Interpreter Integration Test    ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    print(f"📍 Region: {REGION}")
    print(f"📁 Project: {PROJECT_NAME}")
    print(f"🌍 Environment: {ENVIRONMENT}")

    results = []

    # Test 1: Configuration
    success, code_interpreter_id = test_code_interpreter_config()
    results.append(("Configuration", success))

    if args.list_only:
        print("\n✅ Configuration check completed (--list-only mode)")
        return

    # Test 2: SDK import
    results.append(("SDK Import", test_code_interpreter_sdk()))

    # Test 3: Workspace integration
    results.append(("Workspace Integration", test_workspace_integration()))

    # Test 4: Diagram tool import
    results.append(("Diagram Tool Import", test_diagram_tool_import()))

    # Test 5: Code execution (optional, uses API credits)
    if args.execute and code_interpreter_id:
        print("\n⚠️  Running execution test (will use API credits)")
        results.append(("Code Execution", test_code_execution(code_interpreter_id)))
    else:
        print("\n⏭️  Skipping execution test (use --execute to enable)")

    # Summary
    print()
    print("═" * 50)
    print("📊 Test Summary")
    print("─" * 50)

    all_passed = True
    for name, passed in results:
        status = "✅" if passed else "❌"
        print(f"   {status} {name}")
        if not passed:
            all_passed = False

    print()
    if all_passed:
        print("✅ All Code Interpreter tests passed!")
    else:
        print("⚠️  Some Code Interpreter tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
