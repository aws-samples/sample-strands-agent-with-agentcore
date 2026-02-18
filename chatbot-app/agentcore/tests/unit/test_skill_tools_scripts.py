"""
Unit tests for skill_tools script execution.

Tests the new script execution functionality in skill_executor.
"""

import os
import json
import pytest
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock

# Add src to path for imports
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from skill.skill_registry import SkillRegistry
from skill import skill_tools
from strands.types.tools import ToolContext


@pytest.fixture
def temp_skills_dir():
    """Create a temporary skills directory with test fixtures."""
    temp_dir = tempfile.mkdtemp()

    # Create test-skill with scripts
    skill_dir = Path(temp_dir) / "test-skill"
    skill_dir.mkdir()

    # Create SKILL.md
    (skill_dir / "SKILL.md").write_text("""---
name: test-skill
description: Test skill
---
# Test Skill
""")

    # Create scripts directory
    scripts_dir = skill_dir / "scripts"
    scripts_dir.mkdir()

    # Create echo script
    echo_script = scripts_dir / "echo.py"
    echo_script.write_text("""#!/usr/bin/env python3
import json
import sys
input_data = json.load(sys.stdin)
print(json.dumps({"status": "success", "input": input_data}))
""")
    os.chmod(echo_script, 0o755)

    # Create calculation script
    calc_script = scripts_dir / "calc.sh"
    calc_script.write_text("""#!/bin/bash
echo '{"status": "success", "result": 42}'
""")
    os.chmod(calc_script, 0o755)

    yield temp_dir

    # Cleanup
    shutil.rmtree(temp_dir)


@pytest.fixture
def registry(temp_skills_dir):
    """Create a SkillRegistry with test fixtures."""
    registry = SkillRegistry(skills_dir=temp_skills_dir)
    registry.discover_skills()
    return registry


@pytest.fixture
def tool_context():
    """Create a mock ToolContext."""
    context = Mock(spec=ToolContext)
    context.tool_use = {"toolUseId": "test-123"}
    context.invocation_state = {
        "session_id": "session-456",
        "user_id": "user-789",
    }
    return context


class TestSkillExecutorScriptValidation:
    """Test validation logic in skill_executor for scripts."""

    def test_skill_executor_requires_tool_or_script(self, tool_context, registry):
        """skill_executor should require either tool_name or script_name."""
        skill_tools._registry = registry

        result = skill_tools.skill_executor(
            tool_context=tool_context,
            skill_name="test-skill",
            # Neither tool_name nor script_name provided
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "error"
        assert "Must specify either tool_name or script_name" in result_dict["error"]

    def test_skill_executor_rejects_both_tool_and_script(self, tool_context, registry):
        """skill_executor should reject both tool_name and script_name."""
        skill_tools._registry = registry

        result = skill_tools.skill_executor(
            tool_context=tool_context,
            skill_name="test-skill",
            tool_name="some_tool",
            script_name="some_script.py",
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "error"
        assert "Cannot specify both" in result_dict["error"]


class TestExecuteScriptFunction:
    """Test the _execute_script helper function."""

    @patch('strands_tools.shell.shell')
    def test_execute_script_python(self, mock_shell, tool_context, registry):
        """_execute_script should execute Python scripts correctly."""
        skill_tools._registry = registry

        # Mock shell tool response
        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": '{"result": "test output"}'}]
        }

        result = skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input={"message": "hello"},
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "success"
        assert result_dict["script"] == "echo.py"

        # Verify shell was called
        mock_shell.assert_called_once()
        call_args = mock_shell.call_args
        assert "python" in call_args[1]["command"] or "python3" in call_args[1]["command"]
        assert "echo.py" in call_args[1]["command"]

    @patch('strands_tools.shell.shell')
    def test_execute_script_bash(self, mock_shell, tool_context, registry):
        """_execute_script should execute shell scripts correctly."""
        skill_tools._registry = registry

        # Mock shell tool response
        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": '{"result": 42}'}]
        }

        result = skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="calc.sh",
            script_input={},
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "success"

        # Verify shell was called with bash
        mock_shell.assert_called_once()
        call_args = mock_shell.call_args
        assert "/bin/bash" in call_args[1]["command"]

    @patch('strands_tools.shell.shell')
    def test_execute_script_passes_environment_vars(self, mock_shell, tool_context, registry):
        """_execute_script should pass environment variables."""
        skill_tools._registry = registry

        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": "{}"}]
        }

        skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input={},
        )

        # Verify environment variables in command
        call_args = mock_shell.call_args
        command = call_args[1]["command"]
        assert "SKILL_NAME=test-skill" in command
        assert "SCRIPT_NAME=echo.py" in command
        assert "SESSION_ID=session-456" in command
        assert "USER_ID=user-789" in command

    def test_execute_script_unknown_script_raises_error(self, tool_context, registry):
        """_execute_script should handle unknown scripts gracefully."""
        skill_tools._registry = registry

        result = skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="nonexistent.py",
            script_input={},
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "error"
        assert "not found" in result_dict["error"]

    def test_execute_script_security_checks(self, tool_context, registry):
        """_execute_script should perform security validation."""
        skill_tools._registry = registry

        # Create a mock script outside skill directory
        with patch.object(registry, 'get_script') as mock_get_script:
            mock_get_script.return_value = {
                "path": "/tmp/evil_script.py",
                "executable": True
            }

            result = skill_tools._execute_script(
                tool_context=tool_context,
                skill_name="test-skill",
                script_name="evil.py",
                script_input={},
            )

            result_dict = json.loads(result)
            assert result_dict["status"] == "error"
            assert "Security violation" in result_dict["error"]

    @patch('strands_tools.shell.shell')
    def test_execute_script_with_json_input(self, mock_shell, tool_context, registry):
        """_execute_script should pass JSON input via stdin."""
        skill_tools._registry = registry

        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": "{}"}]
        }

        test_input = {"key": "value", "number": 123}

        skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input=test_input,
        )

        # Verify temp file was created and used
        call_args = mock_shell.call_args
        command = call_args[1]["command"]
        assert "<" in command  # stdin redirection

    @patch('strands_tools.shell.shell')
    def test_execute_script_timeout_parameter(self, mock_shell, tool_context, registry):
        """_execute_script should set timeout for shell execution."""
        skill_tools._registry = registry

        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": "{}"}]
        }

        skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input={},
        )

        # Verify timeout was set
        call_args = mock_shell.call_args
        assert call_args[1]["timeout"] == 300  # 5 minutes default

    @patch('strands_tools.shell.shell')
    def test_execute_script_non_interactive_mode(self, mock_shell, tool_context, registry):
        """_execute_script should run in non-interactive mode."""
        skill_tools._registry = registry

        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": "{}"}]
        }

        skill_tools._execute_script(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input={},
        )

        # Verify non_interactive flag
        call_args = mock_shell.call_args
        assert call_args[1]["non_interactive"] is True


class TestSkillExecutorIntegration:
    """Integration tests for skill_executor with scripts."""

    @patch('strands_tools.shell.shell')
    def test_skill_executor_full_flow(self, mock_shell, tool_context, registry):
        """Test full flow from skill_executor to script execution."""
        skill_tools._registry = registry

        # Mock successful execution
        mock_shell.return_value = {
            "status": "success",
            "content": [{"text": '{"status": "success", "message": "test"}'}]
        }

        result = skill_tools.skill_executor(
            tool_context=tool_context,
            skill_name="test-skill",
            script_name="echo.py",
            script_input={"test": "data"},
        )

        result_dict = json.loads(result)
        assert result_dict["status"] == "success"
        assert result_dict["script"] == "echo.py"
        assert "output" in result_dict


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
