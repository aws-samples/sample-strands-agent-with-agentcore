#!/usr/bin/env python3
"""
AgentCore Browser Integration Test

Tests the deployed Browser using the actual project code:
- nova_act_browser_tools.py: Browser automation tools using Nova Act
- browser_controller.py: Browser session management
- Nova Act SDK direct usage

Usage:
    python scripts/test_browser.py                # Config check only
    python scripts/test_browser.py --list-only    # Only check configuration

    # AgentCore Browser tests (requires BROWSER_ID):
    python scripts/test_browser.py --navigate     # Test AgentCore Browser navigation
    python scripts/test_browser.py --full         # Full AgentCore Browser test with actions

    # Nova Act standalone tests (uses local browser):
    python scripts/test_browser.py --nova-act     # Test Nova Act act() with local browser
    python scripts/test_browser.py --nova-extract # Test Nova Act extract() with local browser

    # Combined:
    python scripts/test_browser.py --nova-act --nova-extract  # Both Nova Act tests
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


def get_browser_id() -> str:
    """Get Browser ID from environment or Parameter Store (same as browser_controller.py)."""
    # 1. Check environment variable
    browser_id = os.getenv('BROWSER_ID')
    if browser_id:
        return browser_id

    # 2. Try Parameter Store
    try:
        ssm = boto3.client('ssm', region_name=REGION)
        param_name = f"/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/browser-id"
        response = ssm.get_parameter(Name=param_name)
        return response['Parameter']['Value']
    except Exception as e:
        print(f"   Failed to get from SSM: {e}")
        return None


def get_nova_act_config() -> dict:
    """Get Nova Act configuration (IAM-based only)."""
    return {
        'workflow_definition_name': os.getenv('NOVA_ACT_WORKFLOW_DEFINITION_NAME'),
        'model_id': os.getenv('NOVA_ACT_MODEL_ID', 'nova-act-latest')
    }


def test_browser_config():
    """Test Browser configuration."""
    print("\n📋 Test: Browser Configuration")
    print("─" * 50)

    try:
        browser_id = get_browser_id()

        if browser_id:
            print(f"✅ Browser ID found:")
            print(f"   ID: {browser_id}")
            print(f"   Region: {REGION}")
        else:
            print("❌ Browser ID not found")
            print(f"   Set BROWSER_ID env var or SSM parameter:")
            print(f"   /{PROJECT_NAME}/{ENVIRONMENT}/agentcore/browser-id")
            return False, None

        # Check Nova Act config
        nova_config = get_nova_act_config()
        print()
        print(f"   Nova Act Configuration:")

        if nova_config['workflow_definition_name']:
            print(f"   ✅ Workflow: {nova_config['workflow_definition_name']}")
            print(f"   Model: {nova_config['model_id']}")
            print(f"   Auth method: AWS IAM")
        else:
            print(f"   ⚠️  No Nova Act authentication configured")
            print(f"   Set NOVA_ACT_WORKFLOW_DEFINITION_NAME")

        return True, browser_id

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_browser_sdk():
    """Test Browser SDK import."""
    print("\n📦 Test: Browser SDK")
    print("─" * 50)

    try:
        from bedrock_agentcore.tools.browser_client import BrowserClient

        print(f"✅ BrowserClient SDK imported successfully")
        print(f"   Module: bedrock_agentcore.tools.browser_client")

        return True

    except ImportError as e:
        print(f"❌ SDK import failed: {e}")
        print("   Install: pip install bedrock-agentcore")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_nova_act_sdk():
    """Test Nova Act SDK import."""
    print("\n🤖 Test: Nova Act SDK")
    print("─" * 50)

    try:
        from nova_act import (
            NovaAct,
            ActInvalidModelGenerationError,
            ActExceededMaxStepsError,
            ActTimeoutError,
            ActAgentError,
            ActClientError
        )

        print(f"✅ Nova Act SDK imported successfully")
        print(f"   Module: nova_act")
        print(f"   Error types available:")
        print(f"     - ActInvalidModelGenerationError")
        print(f"     - ActExceededMaxStepsError")
        print(f"     - ActTimeoutError")
        print(f"     - ActAgentError")
        print(f"     - ActClientError")

        return True

    except ImportError as e:
        print(f"❌ SDK import failed: {e}")
        print("   Install: pip install nova-act")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_browser_tools_import():
    """Test browser tools import."""
    print("\n🔧 Test: Browser Tools Import")
    print("─" * 50)

    try:
        from builtin_tools import (
            browser_navigate,
            browser_act,
            browser_extract,
            browser_get_page_info,
            browser_manage_tabs,
            browser_save_screenshot
        )

        tools = [
            ('browser_navigate', browser_navigate),
            ('browser_act', browser_act),
            ('browser_extract', browser_extract),
            ('browser_get_page_info', browser_get_page_info),
            ('browser_manage_tabs', browser_manage_tabs),
            ('browser_save_screenshot', browser_save_screenshot),
        ]

        print(f"✅ All browser tools imported successfully:")
        for name, tool in tools:
            print(f"   • {name}")

        return True

    except ImportError as e:
        print(f"❌ Import failed: {e}")
        import traceback
        traceback.print_exc()
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_browser_controller_import():
    """Test browser controller import."""
    print("\n🎮 Test: Browser Controller Import")
    print("─" * 50)

    try:
        from builtin_tools.lib.browser_controller import BrowserController, get_or_create_controller

        print(f"✅ BrowserController imported successfully")
        print(f"   Module: builtin_tools.lib.browser_controller")
        print(f"   Classes: BrowserController")
        print(f"   Functions: get_or_create_controller")

        return True

    except ImportError as e:
        print(f"❌ Import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False


def test_browser_navigation(browser_id: str):
    """Test browser navigation (uses API credits)."""
    print("\n🌐 Test: Browser Navigation")
    print("─" * 50)

    try:
        from builtin_tools.lib.browser_controller import BrowserController

        test_session_id = f"test-session-{os.urandom(8).hex()}"
        print(f"   Creating browser controller...")
        print(f"   Session ID: {test_session_id}")
        print(f"   Browser ID: {browser_id}")

        controller = BrowserController(test_session_id)

        print(f"   Connecting to browser...")
        controller.connect()

        print(f"   Navigating to example.com...")
        result = controller.navigate("https://example.com")

        if result["status"] == "success":
            print(f"✅ Navigation successful!")
            print(f"   URL: {result.get('current_url', 'N/A')}")
            print(f"   Title: {result.get('page_title', 'N/A')}")

            if result.get('screenshot'):
                print(f"   Screenshot: {len(result['screenshot'])} bytes")

            # Clean up
            print(f"   Closing browser session...")
            controller.close()

            return True
        else:
            print(f"❌ Navigation failed: {result.get('message', 'Unknown error')}")
            controller.close()
            return False

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_browser_action(browser_id: str):
    """Test browser action with Nova Act (uses API credits)."""
    print("\n🎯 Test: Browser Action (Nova Act)")
    print("─" * 50)

    try:
        from builtin_tools.lib.browser_controller import BrowserController

        test_session_id = f"test-session-{os.urandom(8).hex()}"
        print(f"   Session ID: {test_session_id}")

        controller = BrowserController(test_session_id)
        controller.connect()

        # Navigate first
        print(f"   Navigating to example.com...")
        nav_result = controller.navigate("https://example.com")

        if nav_result["status"] != "success":
            print(f"❌ Navigation failed")
            controller.close()
            return False

        # Try simple action
        print(f"   Executing action: 'Click the More information link'")
        act_result = controller.act("Click the 'More information' link if visible")

        status_emoji = "✅" if act_result["status"] == "success" else "⚠️"
        print(f"{status_emoji} Action result:")
        print(f"   Status: {act_result['status']}")
        print(f"   Message: {act_result.get('message', 'N/A')[:100]}")
        print(f"   Current URL: {act_result.get('current_url', 'N/A')}")

        controller.close()
        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_nova_act_direct():
    """Test Nova Act directly without AgentCore Browser (standalone mode)."""
    print("\n🤖 Test: Nova Act Direct (Standalone)")
    print("─" * 50)

    try:
        from nova_act import NovaAct, Workflow

        nova_config = get_nova_act_config()

        if not nova_config['workflow_definition_name']:
            print("⚠️  NOVA_ACT_WORKFLOW_DEFINITION_NAME not configured, skipping")
            return True  # Not a failure, just skip

        print(f"   Creating Nova Act workflow...")

        workflow = Workflow(
            model_id=nova_config['model_id'],
            workflow_definition_name=nova_config['workflow_definition_name']
        )
        print(f"   Auth: AWS IAM (workflow: {nova_config['workflow_definition_name']})")

        print(f"   Model: {nova_config['model_id']}")

        # Use context managers for proper resource cleanup
        with workflow:
            print(f"   Starting Nova Act with local browser...")
            # NovaAct without CDP endpoint will use local browser
            with NovaAct(
                starting_page="https://example.com",
                workflow=workflow,
                headless=True  # Run headless for testing
            ) as nova:
                print(f"   Browser started, navigated to example.com")

                # Get page info
                page = nova.page
                title = page.title()
                url = page.url

                print(f"   Page title: {title}")
                print(f"   Page URL: {url}")

                # Simple act test
                print(f"   Executing simple action...")
                result = nova.act(
                    "Find and read the main heading text on this page",
                    max_steps=2,
                    timeout=30
                )

                print(f"✅ Nova Act test completed!")
                print(f"   Action result: {str(result)[:200]}...")

        return True

    except ImportError as e:
        print(f"❌ Nova Act import failed: {e}")
        return False
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_nova_act_extract():
    """Test Nova Act extraction capability."""
    print("\n📊 Test: Nova Act Extract")
    print("─" * 50)

    try:
        from nova_act import NovaAct, Workflow

        nova_config = get_nova_act_config()

        if not nova_config['workflow_definition_name']:
            print("⚠️  NOVA_ACT_WORKFLOW_DEFINITION_NAME not configured, skipping")
            return True

        workflow = Workflow(
            model_id=nova_config['model_id'],
            workflow_definition_name=nova_config['workflow_definition_name']
        )

        with workflow:
            with NovaAct(
                starting_page="https://example.com",
                workflow=workflow,
                headless=True
            ) as nova:
                print(f"   Testing extraction on example.com...")

                # Define extraction schema
                schema = {
                    "type": "object",
                    "properties": {
                        "title": {"type": "string", "description": "Page title or main heading"},
                        "has_more_info_link": {"type": "boolean", "description": "Whether there is a 'More information' link"}
                    }
                }

                result = nova.extract(
                    "Extract the page title and check if there's a More information link",
                    schema=schema,
                    max_steps=3,
                    timeout=30
                )

                print(f"✅ Extraction completed!")
                print(f"   Extracted data: {result}")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore Browser")
    parser.add_argument("--list-only", action="store_true", help="Only check configuration")
    parser.add_argument("--navigate", action="store_true", help="Test AgentCore Browser navigation (uses API credits)")
    parser.add_argument("--full", action="store_true", help="Full AgentCore Browser test with actions (uses API credits)")
    parser.add_argument("--nova-act", action="store_true", help="Test Nova Act standalone (local browser, uses API credits)")
    parser.add_argument("--nova-extract", action="store_true", help="Test Nova Act extraction (local browser, uses API credits)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║       AgentCore Browser Integration Test          ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    print(f"📍 Region: {REGION}")
    print(f"📁 Project: {PROJECT_NAME}")
    print(f"🌍 Environment: {ENVIRONMENT}")

    results = []

    # Test 1: Configuration
    success, browser_id = test_browser_config()
    results.append(("Configuration", success))

    if args.list_only:
        print("\n✅ Configuration check completed (--list-only mode)")
        return

    # Test 2: Browser SDK import
    results.append(("Browser SDK Import", test_browser_sdk()))

    # Test 3: Nova Act SDK import
    results.append(("Nova Act SDK Import", test_nova_act_sdk()))

    # Test 4: Browser tools import
    results.append(("Browser Tools Import", test_browser_tools_import()))

    # Test 5: Browser controller import
    results.append(("Browser Controller Import", test_browser_controller_import()))

    # Test 6: AgentCore Browser Navigation (optional, uses API credits)
    if (args.navigate or args.full) and browser_id:
        print("\n⚠️  Running AgentCore Browser navigation test (will use API credits)")
        results.append(("AgentCore Browser Navigation", test_browser_navigation(browser_id)))

        # Test 7: AgentCore Browser Action (only with --full)
        if args.full:
            print("\n⚠️  Running AgentCore Browser action test (will use API credits)")
            results.append(("AgentCore Browser Action", test_browser_action(browser_id)))
    elif not (args.nova_act or args.nova_extract):
        print("\n⏭️  Skipping AgentCore Browser tests (use --navigate or --full to enable)")

    # Test 8: Nova Act Direct (standalone with local browser)
    if args.nova_act:
        print("\n⚠️  Running Nova Act standalone test (will use local browser + API credits)")
        results.append(("Nova Act Direct", test_nova_act_direct()))

    # Test 9: Nova Act Extract
    if args.nova_extract:
        print("\n⚠️  Running Nova Act extraction test (will use local browser + API credits)")
        results.append(("Nova Act Extract", test_nova_act_extract()))

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
        print("✅ All Browser tests passed!")
    else:
        print("⚠️  Some Browser tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
