"""
Unit tests for SkillRegistry script discovery and loading.

Tests the new script-related methods:
- list_scripts()
- get_script()
"""

import os
import pytest
import tempfile
import shutil
from pathlib import Path

# Add src to path for imports
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from skill.skill_registry import SkillRegistry


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

    # Create test scripts
    (scripts_dir / "test_script.py").write_text("#!/usr/bin/env python3\nprint('test')")
    (scripts_dir / "test_script.sh").write_text("#!/bin/bash\necho 'test'")
    (scripts_dir / "readme.txt").write_text("Not a script")  # Should be ignored

    # Make scripts executable
    os.chmod(scripts_dir / "test_script.py", 0o755)
    os.chmod(scripts_dir / "test_script.sh", 0o755)

    yield temp_dir

    # Cleanup
    shutil.rmtree(temp_dir)


@pytest.fixture
def registry(temp_skills_dir):
    """Create a SkillRegistry with test fixtures."""
    registry = SkillRegistry(skills_dir=temp_skills_dir)
    registry.discover_skills()
    return registry


class TestSkillRegistryScripts:
    """Test script discovery and loading functionality."""

    def test_list_scripts_returns_only_py_and_sh(self, registry):
        """list_scripts should only return .py and .sh files."""
        scripts = registry.list_scripts("test-skill")

        assert len(scripts) == 2
        assert "test_script.py" in scripts
        assert "test_script.sh" in scripts
        assert "readme.txt" not in scripts

    def test_list_scripts_returns_empty_when_no_scripts_dir(self, temp_skills_dir):
        """list_scripts should return empty list if scripts/ doesn't exist."""
        # Create skill without scripts/ directory
        skill_dir = Path(temp_skills_dir) / "no-scripts-skill"
        skill_dir.mkdir()
        (skill_dir / "SKILL.md").write_text("""---
name: no-scripts-skill
description: No scripts
---
# No Scripts
""")

        registry = SkillRegistry(skills_dir=temp_skills_dir)
        registry.discover_skills()

        scripts = registry.list_scripts("no-scripts-skill")
        assert scripts == []

    def test_list_scripts_unknown_skill_raises_keyerror(self, registry):
        """list_scripts should raise KeyError for unknown skill."""
        with pytest.raises(KeyError, match="Unknown skill"):
            registry.list_scripts("unknown-skill")

    def test_get_script_returns_correct_info(self, registry):
        """get_script should return script path and executable status."""
        script_info = registry.get_script("test-skill", "test_script.py")

        assert "path" in script_info
        assert "executable" in script_info
        assert script_info["path"].endswith("test-skill/scripts/test_script.py")
        assert script_info["executable"] is True

    def test_get_script_validates_path_traversal(self, registry):
        """get_script should reject path traversal attempts."""
        with pytest.raises(ValueError, match="path separators"):
            registry.get_script("test-skill", "../evil.py")

        with pytest.raises(ValueError, match="path separators"):
            registry.get_script("test-skill", "subdir/script.py")

        with pytest.raises(ValueError, match="path separators"):
            registry.get_script("test-skill", "..\\evil.py")

    def test_get_script_validates_extension(self, registry):
        """get_script should only allow .py and .sh files."""
        with pytest.raises(ValueError, match="Invalid script type"):
            registry.get_script("test-skill", "readme.txt")

        with pytest.raises(ValueError, match="Invalid script type"):
            registry.get_script("test-skill", "evil.exe")

    def test_get_script_not_found_raises_keyerror(self, registry):
        """get_script should raise KeyError if script doesn't exist."""
        with pytest.raises(KeyError, match="Script 'nonexistent.py' not found"):
            registry.get_script("test-skill", "nonexistent.py")

    def test_get_script_unknown_skill_raises_keyerror(self, registry):
        """get_script should raise KeyError for unknown skill."""
        with pytest.raises(KeyError, match="Unknown skill"):
            registry.get_script("unknown-skill", "script.py")

    def test_list_scripts_sorted_alphabetically(self, registry):
        """list_scripts should return scripts in alphabetical order."""
        scripts = registry.list_scripts("test-skill")

        assert scripts == sorted(scripts)
        assert scripts == ["test_script.py", "test_script.sh"]


class TestSkillRegistryScriptsEdgeCases:
    """Test edge cases for script functionality."""

    def test_list_scripts_with_hidden_files(self, temp_skills_dir):
        """list_scripts should handle hidden files correctly."""
        scripts_dir = Path(temp_skills_dir) / "test-skill" / "scripts"

        # Create hidden script (should still be listed)
        (scripts_dir / ".hidden.py").write_text("#!/usr/bin/env python3\nprint('hidden')")

        registry = SkillRegistry(skills_dir=temp_skills_dir)
        registry.discover_skills()

        scripts = registry.list_scripts("test-skill")

        # Hidden files should be included
        assert ".hidden.py" in scripts

    def test_get_script_absolute_path(self, registry):
        """get_script should return absolute paths."""
        script_info = registry.get_script("test-skill", "test_script.py")

        path = script_info["path"]
        assert os.path.isabs(path)
        assert os.path.exists(path)

    def test_get_script_non_executable_file(self, temp_skills_dir):
        """get_script should correctly report non-executable scripts."""
        scripts_dir = Path(temp_skills_dir) / "test-skill" / "scripts"

        # Create non-executable script
        non_exec_script = scripts_dir / "non_exec.py"
        non_exec_script.write_text("#!/usr/bin/env python3\nprint('test')")
        os.chmod(non_exec_script, 0o644)  # Not executable

        registry = SkillRegistry(skills_dir=temp_skills_dir)
        registry.discover_skills()

        script_info = registry.get_script("test-skill", "non_exec.py")

        assert script_info["executable"] is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
