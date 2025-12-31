#!/usr/bin/env python3
"""
DynamoDB Integration Test

Tests the deployed DynamoDB table (Single Table Design):
- User Profile operations
- Session Metadata operations
- Tool Registry operations

Uses same schema as frontend/src/lib/dynamodb-client.ts:
- PK: userId
- SK: 'PROFILE' | 'SESSION#{timestamp}#{sessionId}' | 'CONFIG'

Usage:
    python scripts/test_dynamodb.py
    python scripts/test_dynamodb.py --user-id <id>
    python scripts/test_dynamodb.py --write  # Test write operations
"""

import argparse
import sys
import os
import uuid
from datetime import datetime

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer

# Configuration from environment
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
TABLE_NAME = os.environ.get('DYNAMODB_USERS_TABLE', f'{PROJECT_NAME}-users-v2')

# Initialize clients
dynamodb = boto3.client('dynamodb', region_name=REGION)
deserializer = TypeDeserializer()
serializer = TypeSerializer()


def marshall(item: dict) -> dict:
    """Convert Python dict to DynamoDB format."""
    return {k: serializer.serialize(v) for k, v in item.items() if v is not None}


def unmarshall(item: dict) -> dict:
    """Convert DynamoDB format to Python dict."""
    return {k: deserializer.deserialize(v) for k, v in item.items()}


def test_table_connection():
    """Test connection to DynamoDB table."""
    print("\n📋 Test: DynamoDB Table Connection")
    print("─" * 50)

    try:
        response = dynamodb.describe_table(TableName=TABLE_NAME)
        table = response['Table']

        print(f"✅ Connected to table: {TABLE_NAME}")
        print(f"   Status: {table['TableStatus']}")
        print(f"   Item Count: {table.get('ItemCount', 'N/A')}")
        print(f"   Size (bytes): {table.get('TableSizeBytes', 'N/A')}")

        # Show key schema
        key_schema = table['KeySchema']
        print(f"   Key Schema:")
        for key in key_schema:
            print(f"     - {key['AttributeName']}: {key['KeyType']}")

        return True

    except Exception as e:
        print(f"❌ Error connecting to table: {e}")
        return False


def test_get_user_profile(user_id: str):
    """Test getting user profile (same as dynamodb-client.ts getUserProfile)."""
    print(f"\n👤 Test: Get User Profile")
    print("─" * 50)

    try:
        response = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key=marshall({
                'userId': user_id,
                'sk': 'PROFILE'
            })
        )

        if 'Item' not in response:
            print(f"⚠️  No profile found for userId: {user_id}")
            return True, None

        profile = unmarshall(response['Item'])
        print(f"✅ Profile found:")
        print(f"   userId: {profile.get('userId')}")
        print(f"   email: {profile.get('email')}")
        print(f"   username: {profile.get('username', 'N/A')}")
        print(f"   createdAt: {profile.get('createdAt')}")
        print(f"   lastAccessAt: {profile.get('lastAccessAt')}")

        preferences = profile.get('preferences', {})
        if preferences:
            print(f"   Preferences:")
            print(f"     - defaultModel: {preferences.get('defaultModel', 'N/A')}")
            print(f"     - enabledTools: {len(preferences.get('enabledTools', []))} tools")

        return True, profile

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_get_user_sessions(user_id: str, limit: int = 5):
    """Test getting user sessions (same as dynamodb-client.ts getUserSessions)."""
    print(f"\n📁 Test: Get User Sessions")
    print("─" * 50)

    try:
        response = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression='userId = :userId AND begins_with(sk, :sessionPrefix)',
            ExpressionAttributeValues=marshall({
                ':userId': user_id,
                ':sessionPrefix': 'SESSION#'
            }),
            ScanIndexForward=False,  # Descending order (newest first)
            Limit=limit * 2  # Fetch more to account for filtering
        )

        items = response.get('Items', [])
        if not items:
            print(f"⚠️  No sessions found for userId: {user_id}")
            return True, []

        sessions = [unmarshall(item) for item in items]

        # Filter active sessions
        active_sessions = [s for s in sessions if s.get('status') == 'active'][:limit]

        print(f"✅ Found {len(active_sessions)} active sessions:")
        for i, session in enumerate(active_sessions[:5]):
            print(f"   [{i+1}] {session.get('title', 'Untitled')}")
            print(f"       sessionId: {session.get('sessionId')}")
            print(f"       lastMessageAt: {session.get('lastMessageAt')}")
            print(f"       messageCount: {session.get('messageCount', 0)}")

        if len(active_sessions) > 5:
            print(f"   ... and {len(active_sessions) - 5} more sessions")

        return True, active_sessions

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, []


def test_get_tool_registry():
    """Test getting tool registry (same as dynamodb-client.ts getToolRegistry)."""
    print(f"\n🔧 Test: Get Tool Registry")
    print("─" * 50)

    try:
        response = dynamodb.get_item(
            TableName=TABLE_NAME,
            Key=marshall({
                'userId': 'TOOL_REGISTRY',
                'sk': 'CONFIG'
            })
        )

        if 'Item' not in response:
            print(f"⚠️  Tool registry not found in DynamoDB")
            return True, None

        record = unmarshall(response['Item'])
        registry = record.get('toolRegistry', {})

        print(f"✅ Tool registry found:")
        print(f"   local_tools: {len(registry.get('local_tools', []))} tools")
        print(f"   builtin_tools: {len(registry.get('builtin_tools', []))} tools")
        print(f"   browser_automation: {len(registry.get('browser_automation', []))} groups")
        print(f"   gateway_targets: {len(registry.get('gateway_targets', []))} targets")
        print(f"   agentcore_runtime_a2a: {len(registry.get('agentcore_runtime_a2a', []))} agents")

        # Show some tool details
        builtin = registry.get('builtin_tools', [])
        if builtin:
            print(f"\n   Builtin tools sample:")
            for tool in builtin[:3]:
                tool_id = tool.get('id') or tool.get('name', 'unknown')
                enabled = tool.get('enabled', False)
                print(f"     - {tool_id}: {'enabled' if enabled else 'disabled'}")

        return True, registry

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_write_session(user_id: str):
    """Test creating a session (same as dynamodb-client.ts upsertSession)."""
    print(f"\n✏️  Test: Write Session")
    print("─" * 50)

    try:
        session_id = f"test-{uuid.uuid4().hex[:8]}"
        now = datetime.now().isoformat() + 'Z'

        # Generate SK following the same pattern as dynamodb-schema.ts
        session_sk = f"SESSION#{now}#{session_id}"

        item = {
            'userId': user_id,
            'sk': session_sk,
            'sessionId': session_id,
            'title': f'Integration Test Session ({datetime.now().strftime("%Y-%m-%d %H:%M")})',
            'status': 'active',
            'createdAt': now,
            'lastMessageAt': now,
            'messageCount': 0,
            'starred': False,
            'tags': ['test', 'integration'],
            'metadata': {
                'source': 'test_dynamodb.py',
                'testRun': True
            }
        }

        dynamodb.put_item(
            TableName=TABLE_NAME,
            Item=marshall(item)
        )

        print(f"✅ Session created:")
        print(f"   sessionId: {session_id}")
        print(f"   sk: {session_sk}")
        print(f"   title: {item['title']}")

        return True, session_id

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_delete_session(user_id: str, session_id: str):
    """Test soft-deleting a session (same as dynamodb-client.ts deleteSession)."""
    print(f"\n🗑️  Test: Delete Session (Soft)")
    print("─" * 50)

    try:
        # First, find the session's SK
        response = dynamodb.query(
            TableName=TABLE_NAME,
            KeyConditionExpression='userId = :userId AND begins_with(sk, :sessionPrefix)',
            ExpressionAttributeValues=marshall({
                ':userId': user_id,
                ':sessionPrefix': 'SESSION#'
            })
        )

        items = response.get('Items', [])
        sessions = [unmarshall(item) for item in items]
        target = next((s for s in sessions if s.get('sessionId') == session_id), None)

        if not target:
            print(f"⚠️  Session not found: {session_id}")
            return True

        # Update status to 'deleted' (soft delete)
        dynamodb.update_item(
            TableName=TABLE_NAME,
            Key=marshall({
                'userId': user_id,
                'sk': target['sk']
            }),
            UpdateExpression='SET #status = :deleted',
            ExpressionAttributeNames={'#status': 'status'},
            ExpressionAttributeValues=marshall({':deleted': 'deleted'})
        )

        print(f"✅ Session soft-deleted:")
        print(f"   sessionId: {session_id}")
        print(f"   status: deleted")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_scan_table_stats():
    """Test scanning table for statistics."""
    print(f"\n📊 Test: Table Statistics")
    print("─" * 50)

    try:
        # Count users (PROFILE records)
        user_response = dynamodb.scan(
            TableName=TABLE_NAME,
            Select='COUNT',
            FilterExpression='sk = :profile',
            ExpressionAttributeValues=marshall({':profile': 'PROFILE'})
        )

        # Count sessions (SESSION# records)
        session_response = dynamodb.scan(
            TableName=TABLE_NAME,
            Select='COUNT',
            FilterExpression='begins_with(sk, :session)',
            ExpressionAttributeValues=marshall({':session': 'SESSION#'})
        )

        print(f"✅ Table statistics:")
        print(f"   User profiles: {user_response.get('Count', 0)}")
        print(f"   Sessions: {session_response.get('Count', 0)}")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Test DynamoDB Integration")
    parser.add_argument("--user-id", type=str, help="User ID to test (Cognito sub)")
    parser.add_argument("--write", action="store_true", help="Test write operations (will create test data)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║       DynamoDB Integration Test                   ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    print(f"📍 Region: {REGION}")
    print(f"📋 Table: {TABLE_NAME}")

    # Use provided user ID or a test user ID
    user_id = args.user_id or f"test-user-{uuid.uuid4().hex[:8]}"
    print(f"👤 User ID: {user_id}")

    results = []

    # Test 1: Table connection
    results.append(("Table Connection", test_table_connection()))

    # Test 2: Table statistics
    results.append(("Table Statistics", test_scan_table_stats()))

    # Test 3: Get tool registry
    success, _ = test_get_tool_registry()
    results.append(("Get Tool Registry", success))

    # Test 4: Get user profile
    success, profile = test_get_user_profile(user_id)
    results.append(("Get User Profile", success))

    # Test 5: Get user sessions
    success, sessions = test_get_user_sessions(user_id)
    results.append(("Get User Sessions", success))

    # Test 6-7: Write operations (optional)
    if args.write:
        print("\n⚠️  Running write tests (will create test data)")

        success, session_id = test_write_session(user_id)
        results.append(("Write Session", success))

        if success and session_id:
            results.append(("Delete Session", test_delete_session(user_id, session_id)))
    else:
        print("\n⏭️  Skipping write tests (use --write to enable)")

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
        print("✅ All DynamoDB tests passed!")
    else:
        print("⚠️  Some DynamoDB tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
