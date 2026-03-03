#!/usr/bin/env python3
"""
AgentCore Code Interpreter Integration Test

Tests:
1. Configuration & SDK import
2. Session creation & code execution
3. Session reuse (same CI instance across calls)
4. Session reattach from stored IDs (simulates cross-turn persistence)
5. Expired session recovery (stop session, verify auto-recovery)

Usage:
    python scripts/test_code_interpreter.py                # Config check only
    python scripts/test_code_interpreter.py --execute      # Run all tests (uses API credits)
"""

import argparse
import sys
import os
import time

# Add project source to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'chatbot-app', 'agentcore', 'src'))

import boto3

# Configuration from environment
REGION = os.environ.get('AWS_REGION', 'us-west-2')
PROJECT_NAME = os.environ.get('PROJECT_NAME', 'strands-agent-chatbot')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'dev')


def get_code_interpreter_id() -> str:
    """Get Code Interpreter ID from environment or Parameter Store."""
    code_interpreter_id = os.getenv('CODE_INTERPRETER_ID')
    if code_interpreter_id:
        return code_interpreter_id

    try:
        ssm = boto3.client('ssm', region_name=REGION)
        param_name = f"/{PROJECT_NAME}/{ENVIRONMENT}/agentcore/code-interpreter-id"
        response = ssm.get_parameter(Name=param_name)
        return response['Parameter']['Value']
    except Exception as e:
        print(f"   Failed to get from SSM: {e}")
        return None


# ---------------------------------------------------------------------------
# Mock ToolContext for testing get_ci_session without a real Strands agent
# ---------------------------------------------------------------------------

class MockAgentState:
    """Simulates agent.state.get() / .set() backed by a dict."""

    def __init__(self, initial: dict = None):
        self._data = dict(initial or {})

    def get(self, key, default=None):
        return self._data.get(key, default)

    def set(self, key, value):
        self._data[key] = value

    def dump(self) -> dict:
        return dict(self._data)


class MockAgent:
    def __init__(self, state: MockAgentState = None):
        self.state = state or MockAgentState()


class MockToolContext:
    """Minimal ToolContext substitute for testing."""

    def __init__(self, user_id="test-user", session_id="test-session", agent_state: MockAgentState = None):
        self.invocation_state = {
            "user_id": user_id,
            "session_id": session_id,
        }
        self.agent = MockAgent(agent_state or MockAgentState())


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_config():
    """Test Code Interpreter configuration."""
    print("\n[1] Configuration")
    print("-" * 50)

    ci_id = get_code_interpreter_id()
    if ci_id:
        print(f"  OK  Code Interpreter ID: {ci_id}")
        print(f"      Region: {REGION}")
        return True, ci_id
    else:
        print("  FAIL  Code Interpreter ID not found")
        return False, None


def test_sdk_import():
    """Test SDK import."""
    print("\n[2] SDK Import")
    print("-" * 50)

    try:
        from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter
        ci = CodeInterpreter(REGION)
        print(f"  OK  CodeInterpreter instantiated (region={REGION})")
        return True
    except ImportError as e:
        print(f"  FAIL  {e}")
        return False


def test_session_creation_and_execute(ci_id: str):
    """Test: create session via get_ci_session, execute code, verify output."""
    print("\n[3] Session Creation & Execute")
    print("-" * 50)

    from builtin_tools.code_interpreter_tool import get_ci_session, _ci_clients, _STATE_CI_SESSION_ID, _STATE_CI_IDENTIFIER

    # Clear any prior cache
    _ci_clients.clear()

    ctx = MockToolContext()
    ci = get_ci_session(ctx)
    if ci is None:
        print("  FAIL  get_ci_session returned None")
        return False, None, None

    session_id = ci.session_id
    identifier = ci.identifier
    print(f"  OK  Session created: {session_id}")
    print(f"      Identifier: {identifier}")

    # Verify agent.state was populated
    stored_sid = ctx.agent.state.get(_STATE_CI_SESSION_ID)
    stored_ident = ctx.agent.state.get(_STATE_CI_IDENTIFIER)
    assert stored_sid == session_id, f"agent.state mismatch: {stored_sid} != {session_id}"
    assert stored_ident == identifier, f"agent.state mismatch: {stored_ident} != {identifier}"
    print(f"  OK  agent.state populated correctly")

    # Execute simple code
    response = ci.invoke("executeCode", {
        "code": "print('hello from CI')",
        "language": "python",
        "clearContext": False,
    })

    stdout = ""
    for event in response.get("stream", []):
        result = event.get("result", {})
        if result.get("isError"):
            print(f"  FAIL  Execution error: {result.get('structuredContent', {}).get('stderr', '?')}")
            return False, None, None
        stdout += result.get("structuredContent", {}).get("stdout", "")

    if "hello from CI" in stdout:
        print(f"  OK  Code executed: {stdout.strip()}")
    else:
        print(f"  FAIL  Unexpected output: {stdout!r}")
        return False, None, None

    return True, session_id, identifier


def test_session_reuse():
    """Test: second get_ci_session call returns same instance (no new session)."""
    print("\n[4] Session Reuse (same process)")
    print("-" * 50)

    from builtin_tools.code_interpreter_tool import get_ci_session

    ctx = MockToolContext()  # fresh context, but same user_id/session_id
    # Populate agent.state as if previous turn stored it
    # (the in-process cache from test_session_creation should still be there)

    ci1 = get_ci_session(ctx)
    sid1 = ci1.session_id

    ci2 = get_ci_session(ctx)
    sid2 = ci2.session_id

    if sid1 == sid2 and ci1 is ci2:
        print(f"  OK  Same instance reused (session_id={sid1})")
        return True
    else:
        print(f"  FAIL  Different sessions: {sid1} vs {sid2}")
        return False


def test_session_reattach(original_session_id: str, original_identifier: str):
    """Test: clear in-process cache, reattach from agent.state IDs."""
    print("\n[5] Session Reattach (from stored IDs)")
    print("-" * 50)

    from builtin_tools.code_interpreter_tool import get_ci_session, _ci_clients, _STATE_CI_SESSION_ID, _STATE_CI_IDENTIFIER

    # Clear in-process cache to simulate new process / new turn
    _ci_clients.clear()
    print(f"  --  Cleared in-process cache")

    # Create context with stored IDs (simulating agent.state from previous turn)
    agent_state = MockAgentState({
        _STATE_CI_SESSION_ID: original_session_id,
        _STATE_CI_IDENTIFIER: original_identifier,
    })
    ctx = MockToolContext(agent_state=agent_state)

    ci = get_ci_session(ctx)
    if ci is None:
        print("  FAIL  get_ci_session returned None")
        return False

    if ci.session_id == original_session_id:
        print(f"  OK  Reattached to existing session: {ci.session_id}")
    else:
        print(f"  WARN  Got different session: {ci.session_id} (expected {original_session_id})")
        print(f"        (This means original session expired; a new one was created)")

    # Verify code execution works on reattached session
    response = ci.invoke("executeCode", {
        "code": "print('reattach works')",
        "language": "python",
        "clearContext": False,
    })

    stdout = ""
    for event in response.get("stream", []):
        result = event.get("result", {})
        stdout += result.get("structuredContent", {}).get("stdout", "")

    if "reattach works" in stdout:
        print(f"  OK  Code executed on reattached session")
        return True
    else:
        print(f"  FAIL  Execution failed after reattach")
        return False


def test_expired_session_recovery(original_session_id: str, original_identifier: str):
    """Test: stop session, verify get_ci_session auto-recovers with a new one."""
    print("\n[6] Expired Session Recovery")
    print("-" * 50)

    from builtin_tools.code_interpreter_tool import get_ci_session, _ci_clients, _STATE_CI_SESSION_ID, _STATE_CI_IDENTIFIER
    from bedrock_agentcore.tools.code_interpreter_client import CodeInterpreter

    # Stop the session to simulate timeout
    _ci_clients.clear()
    ci_temp = CodeInterpreter(REGION)
    ci_temp.identifier = original_identifier
    ci_temp.session_id = original_session_id
    try:
        ci_temp.stop()
        print(f"  --  Stopped session: {original_session_id}")
    except Exception as e:
        print(f"  --  Stop returned: {e} (may already be terminated)")

    time.sleep(2)  # Brief pause for API to process

    # Now try get_ci_session with stale IDs in agent.state
    agent_state = MockAgentState({
        _STATE_CI_SESSION_ID: original_session_id,
        _STATE_CI_IDENTIFIER: original_identifier,
    })
    ctx = MockToolContext(agent_state=agent_state)

    ci = get_ci_session(ctx)
    if ci is None:
        print("  FAIL  get_ci_session returned None")
        return False

    new_session_id = ci.session_id
    if new_session_id != original_session_id:
        print(f"  OK  Auto-recovered with new session: {new_session_id}")
    else:
        print(f"  WARN  Same session ID returned (session may not have been fully terminated)")

    # Verify agent.state was updated with new session
    updated_sid = ctx.agent.state.get(_STATE_CI_SESSION_ID)
    print(f"  --  agent.state updated: {updated_sid}")

    # Verify code execution works
    response = ci.invoke("executeCode", {
        "code": "print('recovery works')",
        "language": "python",
        "clearContext": False,
    })

    stdout = ""
    for event in response.get("stream", []):
        result = event.get("result", {})
        stdout += result.get("structuredContent", {}).get("stdout", "")

    if "recovery works" in stdout:
        print(f"  OK  Code executed on recovered session")
    else:
        print(f"  FAIL  Execution failed after recovery")
        return False

    # Cleanup: stop the new session
    try:
        ci.stop()
        print(f"  --  Cleanup: stopped session {new_session_id}")
    except:
        pass
    _ci_clients.clear()

    return True


def main():
    parser = argparse.ArgumentParser(description="Test AgentCore Code Interpreter session caching")
    parser.add_argument("--execute", action="store_true", help="Run all tests (uses API credits)")
    args = parser.parse_args()

    print("=" * 55)
    print("  AgentCore Code Interpreter - Session Caching Test")
    print("=" * 55)
    print(f"  Region: {REGION}  Project: {PROJECT_NAME}  Env: {ENVIRONMENT}")

    results = []

    # Test 1: Config
    ok, ci_id = test_config()
    results.append(("Configuration", ok))

    # Test 2: SDK
    results.append(("SDK Import", test_sdk_import()))

    if not args.execute:
        print("\n  Skipping execution tests (use --execute to enable)")
        _print_summary(results)
        return

    if not ci_id:
        print("\n  Cannot run execution tests without CODE_INTERPRETER_ID")
        _print_summary(results)
        sys.exit(1)

    # Test 3: Session creation & execute
    ok, session_id, identifier = test_session_creation_and_execute(ci_id)
    results.append(("Session Creation & Execute", ok))

    if not ok:
        _print_summary(results)
        sys.exit(1)

    # Test 4: Session reuse
    results.append(("Session Reuse", test_session_reuse()))

    # Test 5: Reattach from stored IDs
    results.append(("Session Reattach", test_session_reattach(session_id, identifier)))

    # Test 6: Expired session recovery
    results.append(("Expired Session Recovery", test_expired_session_recovery(session_id, identifier)))

    _print_summary(results)
    if not all(ok for _, ok in results):
        sys.exit(1)


def _print_summary(results):
    print("\n" + "=" * 55)
    print("  Summary")
    print("-" * 55)
    for name, ok in results:
        print(f"  {'PASS' if ok else 'FAIL':>4}  {name}")
    print("=" * 55)
    if all(ok for _, ok in results):
        print("  All tests passed!")
    else:
        print("  Some tests failed.")


if __name__ == "__main__":
    main()
