#!/usr/bin/env python3
"""
AgentCore Memory Integration Test

Tests the deployed Memory service using the actual project code:
- AgentCoreMemorySessionManager with Strands Agent (same as ChatbotAgent)
- LocalSessionBuffer for local development mode

Usage:
    python scripts/test_memory.py
    python scripts/test_memory.py --session-id <id>  # Test specific session
    python scripts/test_memory.py --with-agent       # Test with actual Strands Agent
"""

import argparse
import sys
import os
import uuid
from datetime import datetime

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

import boto3

# Configuration from environment
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')


def get_memory_id() -> str:
    """Get Memory ID from SSM Parameter Store (same as agent.py)."""
    memory_id = os.environ.get('MEMORY_ID')
    if memory_id:
        return memory_id

    try:
        ssm = boto3.client('ssm', region_name=REGION)
        response = ssm.get_parameter(
            Name=f'/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/memory-id'
        )
        return response['Parameter']['Value']
    except Exception as e:
        print(f"❌ Failed to get Memory ID: {e}")
        return None


def check_agentcore_memory_available():
    """Check if AgentCore Memory SDK is available."""
    try:
        from bedrock_agentcore.memory.integrations.strands.config import AgentCoreMemoryConfig, RetrievalConfig
        from bedrock_agentcore.memory.integrations.strands.session_manager import AgentCoreMemorySessionManager
        return True, AgentCoreMemoryConfig, RetrievalConfig, AgentCoreMemorySessionManager
    except ImportError as e:
        print(f"❌ AgentCore Memory SDK not available: {e}")
        return False, None, None, None


def test_session_manager_init(memory_id: str, session_id: str, actor_id: str):
    """Test initializing AgentCoreMemorySessionManager (same as ChatbotAgent)."""
    print("\n🔧 Test: Initialize Session Manager")
    print("─" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, AgentCoreMemorySessionManager = check_agentcore_memory_available()
    if not available:
        return False, None

    try:
        # Same configuration as ChatbotAgent._setup_session_manager()
        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
            retrieval_config={
                f"/preferences/{actor_id}": RetrievalConfig(top_k=5, relevance_score=0.7),
                f"/facts/{actor_id}": RetrievalConfig(top_k=10, relevance_score=0.3),
            }
        )

        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=REGION
        )

        print(f"✅ Session Manager initialized")
        print(f"   Memory ID: {memory_id[:40]}...")
        print(f"   Session ID: {session_id}")
        print(f"   Actor ID: {actor_id}")

        return True, session_manager

    except Exception as e:
        print(f"❌ Failed to initialize: {e}")
        import traceback
        traceback.print_exc()
        return False, None


def test_agent_with_memory(memory_id: str, session_id: str, actor_id: str):
    """Test Strands Agent with AgentCore Memory (same as ChatbotAgent)."""
    print("\n🤖 Test: Strands Agent with Memory")
    print("─" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, AgentCoreMemorySessionManager = check_agentcore_memory_available()
    if not available:
        return False

    try:
        from strands import Agent
        from strands.models import BedrockModel

        # Same configuration as ChatbotAgent
        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
            retrieval_config={
                f"/preferences/{actor_id}": RetrievalConfig(top_k=5, relevance_score=0.7),
                f"/facts/{actor_id}": RetrievalConfig(top_k=10, relevance_score=0.3),
            }
        )

        session_manager = AgentCoreMemorySessionManager(
            agentcore_memory_config=config,
            region_name=REGION
        )

        print(f"   Creating Strands Agent with Memory...")
        print(f"   Model: Claude Haiku 4.5")
        print(f"   Session ID: {session_id}")

        # Create agent with memory (same as ChatbotAgent.create_agent())
        model = BedrockModel(
            model_id="us.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        agent = Agent(
            model=model,
            session_manager=session_manager,
            system_prompt="You are a helpful assistant. Keep responses brief."
        )

        # Send a test message
        test_message = f"Hello! This is a memory test at {datetime.now().strftime('%H:%M:%S')}. Please respond with a short greeting."
        print(f"   Sending: '{test_message[:50]}...'")
        print()

        response = agent(test_message)

        # Extract response text
        if response.message and response.message.get('content'):
            for content_block in response.message['content']:
                if content_block.get('text'):
                    response_text = content_block['text']
                    print(f"✅ Agent response ({len(response_text)} chars):")
                    print(f"   {response_text[:200]}...")
                    break
        else:
            print(f"✅ Agent completed (no text response)")

        # Verify message was saved to memory
        print()
        print(f"   Message should be persisted to AgentCore Memory")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_local_session_buffer():
    """Test LocalSessionBuffer (for local development mode)."""
    print("\n💾 Test: Local Session Buffer")
    print("─" * 50)

    try:
        from agent.local_session_buffer import LocalSessionBuffer, encode_bytes_for_json

        # Test encode_bytes_for_json
        test_data = {
            "text": "hello",
            "bytes": b"binary data",
            "nested": {
                "more_bytes": b"\x00\x01\x02"
            }
        }

        encoded = encode_bytes_for_json(test_data)

        assert encoded["text"] == "hello"
        assert encoded["bytes"]["__bytes_encoded__"] == True
        assert "data" in encoded["bytes"]
        assert encoded["nested"]["more_bytes"]["__bytes_encoded__"] == True

        print(f"✅ encode_bytes_for_json works correctly")
        print(f"   Original bytes encoded to base64 with __bytes_encoded__ marker")

        return True

    except Exception as e:
        print(f"❌ Failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_memory_config_validation(memory_id: str):
    """Test that memory configuration matches ChatbotAgent pattern."""
    print("\n🔍 Test: Memory Config Validation")
    print("─" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, _ = check_agentcore_memory_available()
    if not available:
        return False

    try:
        test_user_id = "test-user-123"
        test_session_id = "test-session-456"

        # Validate config creation (same pattern as ChatbotAgent)
        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=test_session_id,
            actor_id=test_user_id,
            enable_prompt_caching=True,
            retrieval_config={
                f"/preferences/{test_user_id}": RetrievalConfig(top_k=5, relevance_score=0.7),
                f"/facts/{test_user_id}": RetrievalConfig(top_k=10, relevance_score=0.3),
            }
        )

        print(f"✅ Memory config created successfully")
        print(f"   memory_id: {memory_id[:40]}...")
        print(f"   session_id: {test_session_id}")
        print(f"   actor_id: {test_user_id}")
        print(f"   enable_prompt_caching: True")
        print(f"   retrieval_config paths:")
        print(f"     - /preferences/{test_user_id}")
        print(f"     - /facts/{test_user_id}")

        return True

    except Exception as e:
        print(f"❌ Config validation failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore Memory")
    parser.add_argument("--session-id", type=str, help="Test specific session")
    parser.add_argument("--actor-id", type=str, default="test-user", help="Actor ID")
    parser.add_argument("--with-agent", action="store_true", help="Test with actual Strands Agent (uses API credits)")
    args = parser.parse_args()

    print("╔═══════════════════════════════════════════════════╗")
    print("║       AgentCore Memory Integration Test           ║")
    print("╚═══════════════════════════════════════════════════╝")
    print()

    # Get Memory ID
    memory_id = get_memory_id()
    if not memory_id:
        print("❌ Cannot proceed without Memory ID")
        print("   Set MEMORY_ID env var or ensure SSM parameter exists")
        sys.exit(1)

    print(f"🧠 Memory ID: {memory_id[:40]}...")
    print(f"📍 Region: {REGION}")
    print(f"👤 Actor ID: {args.actor_id}")

    # Use provided session ID or generate test session
    session_id = args.session_id or f"test-session-{uuid.uuid4().hex[:8]}"
    print(f"📝 Session ID: {session_id}")

    results = []

    # Test 1: Local session buffer (always available)
    results.append(("Local Session Buffer", test_local_session_buffer()))

    # Test 2: Memory config validation
    results.append(("Memory Config Validation", test_memory_config_validation(memory_id)))

    # Test 3: Initialize session manager
    success, session_manager = test_session_manager_init(memory_id, session_id, args.actor_id)
    results.append(("Session Manager Init", success))

    # Test 4: Agent with Memory (optional, uses API credits)
    if args.with_agent:
        print("\n⚠️  Running agent test (will use API credits)")
        results.append(("Agent with Memory", test_agent_with_memory(memory_id, session_id, args.actor_id)))
    else:
        print("\n⏭️  Skipping agent test (use --with-agent to enable)")

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
        print("✅ All Memory tests passed!")
    else:
        print("⚠️  Some Memory tests failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
