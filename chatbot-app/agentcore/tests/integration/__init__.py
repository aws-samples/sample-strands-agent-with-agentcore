"""
Integration tests for Agent ↔ Tool ↔ Protocol compatibility.

Test Modules:
- test_a2a_protocol.py: A2A (Agent-to-Agent) protocol format tests
- test_mcp_gateway.py: MCP Gateway Lambda tool format tests
- test_tool_agent_contracts.py: Contract-based compatibility tests

Usage:
    # Run all integration tests
    pytest tests/integration/ -v

    # Run specific contract tests
    pytest tests/integration/test_tool_agent_contracts.py -v

    # Run before merging changes
    pytest tests/integration/ -v --tb=short
"""
