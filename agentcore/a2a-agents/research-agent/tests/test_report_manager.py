"""
Tests for ReportManager — file-based session state management.
All tests use a temp base_dir and clean up after themselves.
"""
import os
import threading
import pytest

from report_manager import ReportManager, get_report_manager, _managers


# ============================================================
# Fixtures
# ============================================================

@pytest.fixture
def tmp_base(tmp_path):
    return str(tmp_path)


@pytest.fixture
def manager(tmp_base):
    m = ReportManager("session-abc-123", user_id="user-1", base_dir=tmp_base)
    yield m
    m.cleanup()


# ============================================================
# Initialization and path validation
# ============================================================

class TestReportManagerInit:
    def test_creates_workspace_dirs(self, tmp_base):
        m = ReportManager("sess-001", base_dir=tmp_base)
        assert os.path.isdir(m.workspace)
        assert os.path.isdir(m.charts_dir)
        assert os.path.isdir(m.output_dir)
        m.cleanup()

    def test_rejects_path_traversal_session_id(self, tmp_base):
        with pytest.raises(ValueError, match="Invalid session_id"):
            ReportManager("../../etc/passwd", base_dir=tmp_base)

    def test_rejects_special_chars_in_session_id(self, tmp_base):
        with pytest.raises(ValueError, match="Invalid session_id"):
            ReportManager("session id with spaces", base_dir=tmp_base)

    def test_rejects_invalid_user_id(self, tmp_base):
        with pytest.raises(ValueError, match="Invalid user_id"):
            ReportManager("valid-session", user_id="bad/user", base_dir=tmp_base)

    def test_accepts_uuid_session_id(self, tmp_base):
        m = ReportManager("550e8400-e29b-41d4-a716-446655440000", base_dir=tmp_base)
        m.cleanup()

    def test_default_user_id_when_not_provided(self, tmp_base):
        m = ReportManager("session-xyz", base_dir=tmp_base)
        assert m.user_id == "default_user"
        m.cleanup()


# ============================================================
# Draft read/write
# ============================================================

class TestDraftOperations:
    def test_save_and_read_draft(self, manager):
        content = "# Test Report\n\nContent here."
        manager.save_draft(content)
        assert manager.read_draft() == content

    def test_draft_exists_after_save(self, manager):
        assert not manager.draft_exists()
        manager.save_draft("some content")
        assert manager.draft_exists()

    def test_read_draft_raises_when_missing(self, manager):
        with pytest.raises(FileNotFoundError):
            manager.read_draft()

    def test_save_overwrites_previous_draft(self, manager):
        manager.save_draft("first version")
        manager.save_draft("second version")
        assert manager.read_draft() == "second version"

    def test_save_returns_draft_path(self, manager):
        path = manager.save_draft("content")
        assert path == manager.draft_path

    def test_draft_path_fixed_filename(self, manager):
        assert manager.draft_path.endswith("research_report.md")


# ============================================================
# replace_text
# ============================================================

class TestReplaceText:
    def test_replace_all_occurrences(self, manager):
        manager.save_draft("foo bar foo baz foo")
        count = manager.replace_text("foo", "qux")
        assert count == 3
        assert manager.read_draft() == "qux bar qux baz qux"

    def test_replace_limited_occurrences(self, manager):
        manager.save_draft("a a a a")
        count = manager.replace_text("a", "b", max_replacements=2)
        assert count == 2
        assert manager.read_draft() == "b b a a"

    def test_replace_returns_zero_when_not_found(self, manager):
        manager.save_draft("hello world")
        count = manager.replace_text("xyz", "abc")
        assert count == 0
        assert manager.read_draft() == "hello world"


# ============================================================
# Chart marker parsing
# ============================================================

class TestChartMarkerParsing:
    DRAFT_WITH_CHART = """\
# Report

Some intro text.

<!-- CHART:revenue_chart
{
  "type": "bar",
  "title": "Revenue by Quarter",
  "data": [100, 200, 150]
}
-->

More content here.
"""

    def test_parse_single_chart_marker(self, manager):
        manager.save_draft(self.DRAFT_WITH_CHART)
        charts = manager.parse_chart_markers()
        assert len(charts) == 1
        assert charts[0]["id"] == "revenue_chart"
        assert charts[0]["type"] == "bar"
        assert charts[0]["title"] == "Revenue by Quarter"

    def test_parse_returns_empty_when_no_markers(self, manager):
        manager.save_draft("# No charts here")
        assert manager.parse_chart_markers() == []

    def test_replace_chart_marker(self, manager):
        manager.save_draft(self.DRAFT_WITH_CHART)
        replaced = manager.replace_chart_marker("revenue_chart", "/tmp/charts/revenue_chart.png")
        assert replaced is True
        content = manager.read_draft()
        assert "<!-- CHART:revenue_chart" not in content
        assert "Revenue by Quarter" in content
        assert "/tmp/charts/revenue_chart.png" in content

    def test_replace_chart_marker_returns_false_when_not_found(self, manager):
        manager.save_draft("# No chart here")
        assert manager.replace_chart_marker("missing_chart", "/tmp/x.png") is False


# ============================================================
# get_chart_files
# ============================================================

class TestGetChartFiles:
    def test_returns_empty_when_no_charts(self, manager):
        assert manager.get_chart_files() == []

    def test_lists_saved_png_files(self, manager):
        chart_path = os.path.join(manager.charts_dir, "test_chart.png")
        with open(chart_path, "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\n")
        charts = manager.get_chart_files()
        assert len(charts) == 1
        assert charts[0]["id"] == "test_chart"
        assert charts[0]["path"] == chart_path

    def test_ignores_non_png_files(self, manager):
        with open(os.path.join(manager.charts_dir, "notes.txt"), "w") as f:
            f.write("not a chart")
        assert manager.get_chart_files() == []


# ============================================================
# get_output_path
# ============================================================

class TestGetOutputPath:
    def test_output_path_within_workspace(self, manager):
        path = manager.get_output_path("report.docx")
        assert path.startswith(manager.output_dir)
        assert path.endswith("report.docx")


# ============================================================
# Thread-safe save_draft (concurrency smoke test)
# ============================================================

class TestConcurrency:
    def test_concurrent_draft_saves_do_not_corrupt(self, tmp_base):
        m = ReportManager("session-concurrent", base_dir=tmp_base)
        errors = []

        def write(content):
            try:
                m.save_draft(content)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=write, args=(f"content-{i}" * 100,)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == []
        # The file must be readable and non-empty
        assert len(m.read_draft()) > 0
        m.cleanup()


# ============================================================
# get_report_manager (session cache)
# ============================================================

class TestGetReportManager:
    def test_returns_same_instance_for_same_session(self):
        # Inject directly to avoid filesystem pollution in tmp
        _managers.clear()
        m1 = get_report_manager("shared-session")
        m2 = get_report_manager("shared-session")
        assert m1 is m2
        m1.cleanup()
        _managers.clear()

    def test_returns_different_instances_for_different_sessions(self):
        _managers.clear()
        m1 = get_report_manager("sess-A")
        m2 = get_report_manager("sess-B")
        assert m1 is not m2
        m1.cleanup()
        m2.cleanup()
        _managers.clear()
