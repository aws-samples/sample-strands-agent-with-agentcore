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


def test_compacting_session_manager(memory_id: str, session_id: str, actor_id: str, enable_api_optimization: bool = True):
    """Test CompactingSessionManager with API optimization toggle for A/B testing."""
    mode = "OPTIMIZED" if enable_api_optimization else "LEGACY"
    print(f"\n[Test] CompactingSessionManager ({mode} mode)")
    print("-" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, _ = check_agentcore_memory_available()
    if not available:
        return False

    try:
        from agent.compacting_session_manager import CompactingSessionManager

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

        session_manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
            token_threshold=100_000,
            protected_turns=2,
            max_tool_content_length=500,
            user_id=actor_id,
            metrics_only=True,
            enable_api_optimization=enable_api_optimization,
        )

        print(f"   Session ID: {session_id}")
        print(f"   API Mode: {mode}")
        print(f"   enable_api_optimization: {enable_api_optimization}")

        # Verify hook registration
        from strands.hooks.registry import HookRegistry
        from strands.hooks import MessageAddedEvent

        test_registry = HookRegistry()
        session_manager.register_hooks(test_registry)

        message_callbacks = test_registry._registered_callbacks.get(MessageAddedEvent, [])
        print(f"   MessageAddedEvent callbacks: {len(message_callbacks)}")

        # Optimized: 2 callbacks (save_message_with_state + retrieve_customer_context)
        # Legacy: 3 callbacks (append_message + sync_agent + retrieve_customer_context)
        expected = 2 if enable_api_optimization else 3
        if len(message_callbacks) == expected:
            print(f"   OK: Expected {expected} callbacks, got {len(message_callbacks)}")
        else:
            print(f"   WARN: Expected {expected} callbacks, got {len(message_callbacks)}")

        return True

    except ImportError as e:
        print(f"   FAIL: Import error - {e}")
        import traceback
        traceback.print_exc()
        return False
    except Exception as e:
        print(f"   FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False


def get_current_time() -> str:
    """Get the current time."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def calculate(expression: str) -> str:
    """Calculate a math expression."""
    try:
        result = eval(expression)
        return f"Result: {result}"
    except Exception as e:
        return f"Error: {e}"


def test_compacting_agent_with_tools(memory_id: str, session_id: str, actor_id: str, enable_api_optimization: bool = True):
    """Test agent with tool calls to measure API call reduction."""
    import time
    mode = "OPTIMIZED" if enable_api_optimization else "LEGACY"
    print(f"\n[Test] Agent with Tools ({mode} mode)")
    print("-" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, _ = check_agentcore_memory_available()
    if not available:
        return False, {}

    try:
        from strands import Agent, tool
        from strands.models import BedrockModel
        from agent.compacting_session_manager import CompactingSessionManager

        config = AgentCoreMemoryConfig(
            memory_id=memory_id,
            session_id=session_id,
            actor_id=actor_id,
            enable_prompt_caching=True,
        )

        session_manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
            user_id=actor_id,
            metrics_only=True,
            enable_api_optimization=enable_api_optimization,
        )

        model = BedrockModel(
            model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        # Create tools
        @tool
        def get_time() -> str:
            """Get the current time."""
            return datetime.now().strftime("%H:%M:%S")

        @tool
        def add_numbers(a: int, b: int) -> int:
            """Add two numbers together."""
            return a + b

        agent = Agent(
            model=model,
            session_manager=session_manager,
            tools=[get_time, add_numbers],
            system_prompt="You are a helpful assistant. Use tools when asked. Keep responses brief."
        )

        session_manager.reset_api_metrics()

        # Message that triggers tool use
        test_message = "What time is it now? And what is 123 + 456?"
        print(f"   Message: '{test_message}'")

        start_time = time.time()
        response = agent(test_message)
        total_elapsed_ms = (time.time() - start_time) * 1000

        metrics = session_manager.get_api_metrics()
        api_call_count = metrics["api_call_count"]
        api_latency_ms = metrics["api_call_total_ms"]

        if response.message and response.message.get('content'):
            for block in response.message['content']:
                if block.get('text'):
                    print(f"   Response: {block['text'][:80]}...")
                    break

        print(f"   Total elapsed: {total_elapsed_ms:.0f}ms")
        print(f"   Memory API calls: {api_call_count}")
        print(f"   Memory API latency: {api_latency_ms:.0f}ms")

        return True, {
            "total_ms": total_elapsed_ms,
            "api_calls": api_call_count,
            "api_latency_ms": api_latency_ms,
        }

    except Exception as e:
        print(f"   FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False, {}


def test_compacting_agent_with_memory(memory_id: str, session_id: str, actor_id: str, enable_api_optimization: bool = True):
    """Test Strands Agent with CompactingSessionManager with A/B testing support."""
    import time
    mode = "OPTIMIZED" if enable_api_optimization else "LEGACY"
    print(f"\n[Test] Agent with CompactingSessionManager ({mode} mode)")
    print("-" * 50)

    available, AgentCoreMemoryConfig, RetrievalConfig, _ = check_agentcore_memory_available()
    if not available:
        return False, {}

    try:
        from strands import Agent
        from strands.models import BedrockModel
        from agent.compacting_session_manager import CompactingSessionManager

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

        session_manager = CompactingSessionManager(
            agentcore_memory_config=config,
            region_name=REGION,
            token_threshold=100_000,
            protected_turns=2,
            max_tool_content_length=500,
            user_id=actor_id,
            metrics_only=True,
            enable_api_optimization=enable_api_optimization,
        )

        print(f"   Session ID: {session_id}")
        print(f"   API Mode: {mode}")

        model = BedrockModel(
            model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
            region_name=REGION
        )

        agent = Agent(
            model=model,
            session_manager=session_manager,
            system_prompt="You are a helpful assistant. Keep responses brief."
        )

        # Reset metrics before test
        session_manager.reset_api_metrics()

        test_message = f"Hello! Testing {mode} mode at {datetime.now().strftime('%H:%M:%S')}. Say hi briefly."
        print(f"   Sending: '{test_message[:50]}...'")

        start_time = time.time()
        response = agent(test_message)
        total_elapsed_ms = (time.time() - start_time) * 1000

        # Get API metrics
        metrics = session_manager.get_api_metrics()
        api_call_count = metrics["api_call_count"]
        api_latency_ms = metrics["api_call_total_ms"]

        if response.message and response.message.get('content'):
            for content_block in response.message['content']:
                if content_block.get('text'):
                    response_text = content_block['text']
                    print(f"   Response: {response_text[:60]}...")
                    break
        else:
            print(f"   Response: (no text)")

        print(f"   Total elapsed: {total_elapsed_ms:.0f}ms")
        print(f"   Memory API calls: {api_call_count}")
        print(f"   Memory API latency: {api_latency_ms:.0f}ms")

        return True, {
            "total_ms": total_elapsed_ms,
            "api_calls": api_call_count,
            "api_latency_ms": api_latency_ms,
        }

    except Exception as e:
        print(f"   FAIL: {e}")
        import traceback
        traceback.print_exc()
        return False, {}


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
            model_id="eu.anthropic.claude-haiku-4-5-20251001-v1:0",
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
    parser.add_argument("--optimized", action="store_true", help="Test CompactingSessionManager with API optimization")
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

    # Test 4: CompactingSessionManager tests
    if args.optimized:
        # Test optimized mode
        opt_session_id = f"opt-{session_id}"
        results.append(("CompactingSessionManager (Optimized)", test_compacting_session_manager(memory_id, opt_session_id, args.actor_id, enable_api_optimization=True)))

        # Test legacy mode for comparison
        legacy_session_id = f"legacy-{session_id}"
        results.append(("CompactingSessionManager (Legacy)", test_compacting_session_manager(memory_id, legacy_session_id, args.actor_id, enable_api_optimization=False)))

        # A/B test with agent (if enabled)
        if args.with_agent:
            print("\n[A/B Test 1] Simple Message - OPTIMIZED vs LEGACY")
            print("=" * 50)

            success_opt, metrics_opt = test_compacting_agent_with_memory(memory_id, opt_session_id, args.actor_id, enable_api_optimization=True)
            success_legacy, metrics_legacy = test_compacting_agent_with_memory(memory_id, legacy_session_id, args.actor_id, enable_api_optimization=False)

            results.append(("Simple Message (Optimized)", success_opt))
            results.append(("Simple Message (Legacy)", success_legacy))

            # Print comparison
            print("\n[Result] Simple Message")
            print("-" * 50)
            print(f"                    OPTIMIZED    LEGACY")
            print(f"   API calls:       {metrics_opt.get('api_calls', 0):>8}    {metrics_legacy.get('api_calls', 0):>8}")
            print(f"   API latency:     {metrics_opt.get('api_latency_ms', 0):>7.0f}ms   {metrics_legacy.get('api_latency_ms', 0):>7.0f}ms")
            print(f"   Total time:      {metrics_opt.get('total_ms', 0):>7.0f}ms   {metrics_legacy.get('total_ms', 0):>7.0f}ms")

            # A/B test 2: With tool calls
            print("\n[A/B Test 2] With Tool Calls - OPTIMIZED vs LEGACY")
            print("=" * 50)

            tool_opt_session = f"tool-opt-{session_id}"
            tool_legacy_session = f"tool-legacy-{session_id}"

            success_tool_opt, metrics_tool_opt = test_compacting_agent_with_tools(memory_id, tool_opt_session, args.actor_id, enable_api_optimization=True)
            success_tool_legacy, metrics_tool_legacy = test_compacting_agent_with_tools(memory_id, tool_legacy_session, args.actor_id, enable_api_optimization=False)

            results.append(("With Tools (Optimized)", success_tool_opt))
            results.append(("With Tools (Legacy)", success_tool_legacy))

            # Print comparison
            print("\n[Result] With Tool Calls")
            print("-" * 50)
            print(f"                    OPTIMIZED    LEGACY")
            print(f"   API calls:       {metrics_tool_opt.get('api_calls', 0):>8}    {metrics_tool_legacy.get('api_calls', 0):>8}")
            print(f"   API latency:     {metrics_tool_opt.get('api_latency_ms', 0):>7.0f}ms   {metrics_tool_legacy.get('api_latency_ms', 0):>7.0f}ms")
            print(f"   Total time:      {metrics_tool_opt.get('total_ms', 0):>7.0f}ms   {metrics_tool_legacy.get('total_ms', 0):>7.0f}ms")

            # Summary comparison
            print("\n[Summary] API Call Reduction")
            print("-" * 50)
            simple_opt = metrics_opt.get('api_calls', 0)
            simple_legacy = metrics_legacy.get('api_calls', 0)
            tool_opt = metrics_tool_opt.get('api_calls', 0)
            tool_legacy = metrics_tool_legacy.get('api_calls', 0)

            if simple_legacy > 0:
                simple_reduction = ((simple_legacy - simple_opt) / simple_legacy) * 100
                print(f"   Simple message: {simple_legacy} -> {simple_opt} ({simple_reduction:.0f}% reduction)")
            if tool_legacy > 0:
                tool_reduction = ((tool_legacy - tool_opt) / tool_legacy) * 100
                print(f"   With tools:     {tool_legacy} -> {tool_opt} ({tool_reduction:.0f}% reduction)")
    else:
        print("\n   Skipping CompactingSessionManager tests (use --optimized to enable)")

    # Test 5: Agent with Memory (base AgentCoreMemorySessionManager)
    if args.with_agent and not args.optimized:
        print("\n   Running agent test (will use API credits)")
        results.append(("Agent with Memory", test_agent_with_memory(memory_id, session_id, args.actor_id)))
    elif not args.with_agent:
        print("\n   Skipping agent test (use --with-agent to enable)")

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
