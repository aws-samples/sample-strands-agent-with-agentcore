#!/usr/bin/env python3
"""
Direct API test for Google Maps tool with name mapping verification
"""
import requests
import json
import sys

def test_maps_tool():
    """Test Google Maps search-places tool directly via API"""

    url = "http://localhost:8080/invocations"

    # AgentCore Runtime standard format: {"input": {...}}
    payload = {
        "input": {
            "user_id": "test-user",
            "session_id": "test-session-maps-direct",
            "message": "search for cafes in Gangnam Seoul",
            "enabled_tools": [
                "gateway_search-places___search_places"
            ]
        }
    }

    print("=" * 60)
    print("🧪 Testing Google Maps Tool via Direct API Call")
    print("=" * 60)
    print(f"\n📤 Request:")
    print(f"   URL: {url}")
    print(f"   Message: {payload['input']['message']}")
    print(f"   Enabled Tools: {payload['input']['enabled_tools']}")
    print("\n⏳ Sending request...\n")

    try:
        response = requests.post(url, json=payload, stream=True, timeout=60)

        if response.status_code != 200:
            print(f"❌ Error: HTTP {response.status_code}")
            print(response.text)
            return False

        print("📥 Streaming response:\n")
        print("-" * 60)

        # Track tool calls
        tool_calls = []
        tool_results = []
        errors = []

        for line in response.iter_lines():
            if line:
                line_str = line.decode('utf-8')
                if line_str.startswith('data: '):
                    try:
                        event_data = json.loads(line_str[6:])
                        event_type = event_data.get('type')

                        if event_type == 'tool_use':
                            tool_name = event_data.get('name')
                            tool_calls.append(tool_name)
                            print(f"🔧 Tool Call: {tool_name}")
                            print(f"   Input: {json.dumps(event_data.get('input', {}), indent=2)}")

                        elif event_type == 'tool_result':
                            tool_id = event_data.get('toolUseId')
                            status = event_data.get('status', 'success')
                            result = event_data.get('result', '')
                            tool_results.append({
                                'id': tool_id,
                                'status': status,
                                'result': result[:200]  # First 200 chars
                            })
                            print(f"\n✅ Tool Result (status: {status}):")
                            print(f"   {result[:200]}...")

                        elif event_type == 'error':
                            error_msg = event_data.get('message', 'Unknown error')
                            errors.append(error_msg)
                            print(f"\n❌ Error: {error_msg}")

                        elif event_type == 'response':
                            text = event_data.get('text', '')
                            if text:
                                print(f"💬 Response: {text}")

                        elif event_type == 'complete':
                            message = event_data.get('message', '')
                            print(f"\n✨ Complete: {message[:200]}...")

                    except json.JSONDecodeError:
                        pass

        print("\n" + "=" * 60)
        print("📊 Summary:")
        print("=" * 60)
        print(f"✓ Total tool calls: {len(tool_calls)}")
        if tool_calls:
            for i, name in enumerate(tool_calls, 1):
                print(f"  {i}. {name}")

        print(f"\n✓ Total tool results: {len(tool_results)}")
        for result in tool_results:
            print(f"  - {result['id'][:20]}... → {result['status']}")

        print(f"\n✓ Errors: {len(errors)}")
        for error in errors:
            print(f"  - {error}")

        # Check for success
        success = (
            len(tool_calls) > 0 and
            len(tool_results) > 0 and
            all(r['status'] == 'success' for r in tool_results) and
            len(errors) == 0
        )

        if success:
            print("\n✅ TEST PASSED: Tool executed successfully!")
            print("   → Tool name mapping is working correctly")
            return True
        else:
            print("\n❌ TEST FAILED: Check errors above")
            return False

    except Exception as e:
        print(f"\n❌ Exception: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    success = test_maps_tool()
    sys.exit(0 if success else 1)
