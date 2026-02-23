"""
Tests for CI workspace sync tools (ci_push_to_workspace, ci_pull_from_workspace)
and related helper functions (_is_text_file, _ws_path_to_s3_key, _extract_file_list).

Tests cover:
- _is_text_file: various file extensions
- _ws_path_to_s3_key: all three namespace prefixes
- _extract_file_list: JSON list, dict with 'files', newline-separated, empty
- ci_push_to_workspace: specific paths, auto-discover, binary blob, text content, partial failure
- ci_pull_from_workspace: text files, binary via decode script, S3 read error, CI unavailable
"""
import base64
import json
import pytest
from unittest.mock import patch, MagicMock, call


def _make_context(user_id="user1", session_id="sess1"):
    ctx = MagicMock()
    ctx.invocation_state = {"user_id": user_id, "session_id": session_id}
    return ctx


def _make_interpreter_mock(session_name="user1-sess1"):
    interp = MagicMock()
    return interp, session_name


# ============================================================
# _is_text_file Tests
# ============================================================

class TestIsTextFile:
    """Tests for _is_text_file helper."""

    def test_py_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("script.py") is True

    def test_js_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("app.js") is True

    def test_json_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("data.json") is True

    def test_csv_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("report.csv") is True

    def test_md_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("README.md") is True

    def test_txt_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("notes.txt") is True

    def test_sql_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("query.sql") is True

    def test_yaml_is_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("config.yaml") is True

    def test_png_is_not_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("chart.png") is False

    def test_xlsx_is_not_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("data.xlsx") is False

    def test_pdf_is_not_text(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("report.pdf") is False

    def test_case_insensitive(self):
        from builtin_tools.code_interpreter_tool import _is_text_file
        assert _is_text_file("SCRIPT.PY") is True
        assert _is_text_file("IMAGE.PNG") is False


# ============================================================
# _ws_path_to_s3_key Tests
# ============================================================

class TestWsPathToS3Key:
    """Tests for _ws_path_to_s3_key helper."""

    def test_code_interpreter_prefix(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key = _ws_path_to_s3_key("u1", "s1", "code-interpreter/chart.png")
        assert key == "code-interpreter-workspace/u1/s1/chart.png"

    def test_code_agent_prefix(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key = _ws_path_to_s3_key("u1", "s1", "code-agent/output.py")
        assert key == "code-agent-workspace/u1/s1/output.py"

    def test_documents_prefix(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key = _ws_path_to_s3_key("u1", "s1", "documents/excel/data.xlsx")
        assert key == "documents/u1/s1/excel/data.xlsx"

    def test_unknown_prefix_falls_back_to_documents(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key = _ws_path_to_s3_key("u1", "s1", "something/file.txt")
        assert key == "documents/u1/s1/something/file.txt"

    def test_leading_slash_stripped(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key = _ws_path_to_s3_key("u1", "s1", "/code-interpreter/chart.png")
        assert key == "code-interpreter-workspace/u1/s1/chart.png"

    def test_different_users_produce_different_keys(self):
        from builtin_tools.code_interpreter_tool import _ws_path_to_s3_key
        key_a = _ws_path_to_s3_key("alice", "s1", "code-interpreter/file.csv")
        key_b = _ws_path_to_s3_key("bob", "s1", "code-interpreter/file.csv")
        assert key_a != key_b


# ============================================================
# _extract_file_list Tests
# ============================================================

class TestExtractFileList:
    """Tests for _extract_file_list helper."""

    def test_parses_json_list(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": '["foo.py", "bar.csv"]'}]}
        files = _extract_file_list(result)
        assert files == ["foo.py", "bar.csv"]

    def test_parses_json_dict_with_files_key(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": '{"files": ["a.txt", "b.json"]}'}]}
        files = _extract_file_list(result)
        assert files == ["a.txt", "b.json"]

    def test_parses_newline_separated_filenames(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": "foo.py\nbar.csv\nbaz.json"}]}
        files = _extract_file_list(result)
        assert "foo.py" in files
        assert "bar.csv" in files
        assert "baz.json" in files

    def test_returns_empty_list_for_json_empty_list(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": "[]"}]}
        files = _extract_file_list(result)
        assert files == []

    def test_returns_empty_list_for_empty_files_dict(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": '{"files": []}'}]}
        files = _extract_file_list(result)
        assert files == []

    def test_filters_dot_and_dotdot(self):
        from builtin_tools.code_interpreter_tool import _extract_file_list
        result = {"content": [{"text": ".\n..\nfoo.py"}]}
        files = _extract_file_list(result)
        assert "." not in files
        assert ".." not in files
        assert "foo.py" in files


# ============================================================
# ci_push_to_workspace Tests
# ============================================================

class TestCiPushToWorkspace:
    """Tests for ci_push_to_workspace tool."""

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._save_to_workspace')
    def test_pushes_specific_text_file(self, mock_save, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        interp.read_files.return_value = {
            "content": [{"text": "x = 1\n"}]
        }

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=["script.py"], tool_context=_make_context())
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 1
        assert "code-interpreter/script.py" in data['files_saved']
        mock_save.assert_called_once()

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._save_to_workspace')
    def test_pushes_binary_blob_file(self, mock_save, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        interp.read_files.return_value = {
            "content": [{"data": b'\x89PNG\r\n\x1a\n'}]
        }

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=["chart.png"], tool_context=_make_context())
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 1
        mock_save.assert_called_once()
        saved_bytes = mock_save.call_args[0][2]
        assert saved_bytes == b'\x89PNG\r\n\x1a\n'

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._save_to_workspace')
    def test_auto_discovers_files_when_no_paths(self, mock_save, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        interp.list_files.return_value = {
            "content": [{"text": '["auto_file.csv"]'}]
        }
        interp.read_files.return_value = {
            "content": [{"text": "a,b\n1,2\n"}]
        }

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=None, tool_context=_make_context())
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 1
        interp.list_files.assert_called_once()

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    def test_returns_empty_when_no_files_discovered(self, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        interp.list_files.return_value = {"content": [{"text": ""}]}

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=None, tool_context=_make_context())
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 0
        assert data['files_saved'] == []

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._save_to_workspace')
    def test_skips_failed_file_and_continues(self, mock_save, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)

        def read_side_effect(action):
            if "fail.py" in action.paths:
                raise Exception("read error")
            return {"content": [{"text": "ok"}]}

        interp.read_files.side_effect = read_side_effect

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(
            paths=["ok.py", "fail.py"],
            tool_context=_make_context(),
        )
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 1
        assert any("ok.py" in p for p in data['files_saved'])

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    def test_returns_error_when_ci_not_available(self, mock_get_interp):
        mock_get_interp.return_value = (None, None)

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=["file.py"], tool_context=_make_context())
        data = json.loads(result)

        assert data['status'] == 'error'
        assert 'not available' in data['error'].lower()


# ============================================================
# ci_pull_from_workspace Tests
# ============================================================

class TestCiPullFromWorkspace:
    """Tests for ci_pull_from_workspace tool."""

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._ws_path_to_s3_key')
    @patch('boto3.client')
    @patch('workspace.config.get_workspace_bucket', return_value='my-bucket')
    def test_pulls_text_file_via_write_files(self, mock_bucket, mock_boto3_client, mock_key, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        mock_key.return_value = "code-interpreter-workspace/u1/s1/data.csv"

        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": MagicMock(read=MagicMock(return_value=b"col\n1\n2\n"))}
        mock_boto3_client.return_value = mock_s3

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/data.csv"],
            tool_context=_make_context("u1", "s1"),
        )
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 1
        assert "data.csv" in data['files_uploaded']
        interp.write_files.assert_called_once()

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._ws_path_to_s3_key')
    @patch('boto3.client')
    @patch('workspace.config.get_workspace_bucket', return_value='my-bucket')
    def test_pulls_binary_file_via_execute_code(self, mock_bucket, mock_boto3_client, mock_key, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        mock_key.return_value = "code-interpreter-workspace/u1/s1/chart.png"

        png_data = b'\x89PNG\r\n\x1a\n'
        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": MagicMock(read=MagicMock(return_value=png_data))}
        mock_boto3_client.return_value = mock_s3

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/chart.png"],
            tool_context=_make_context("u1", "s1"),
        )
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert "chart.png" in data['files_uploaded']
        # Binary files use execute_code to decode base64
        interp.execute_code.assert_called_once()
        code_arg = interp.execute_code.call_args[0][0].code
        b64_expected = base64.b64encode(png_data).decode('utf-8')
        assert b64_expected in code_arg

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._ws_path_to_s3_key')
    @patch('boto3.client')
    @patch('workspace.config.get_workspace_bucket', return_value='my-bucket')
    def test_skips_missing_s3_file_and_continues(self, mock_bucket, mock_boto3_client, mock_key, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        mock_key.return_value = "code-interpreter-workspace/u1/s1/missing.csv"

        mock_s3 = MagicMock()
        mock_s3.get_object.side_effect = Exception("NoSuchKey")
        mock_boto3_client.return_value = mock_s3

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/missing.csv"],
            tool_context=_make_context(),
        )
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 0
        assert data['files_uploaded'] == []

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    def test_returns_error_when_ci_not_available(self, mock_get_interp):
        mock_get_interp.return_value = (None, None)

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/data.csv"],
            tool_context=_make_context(),
        )
        data = json.loads(result)

        assert data['status'] == 'error'
        assert 'not available' in data['error'].lower()

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    @patch('builtin_tools.code_interpreter_tool._ws_path_to_s3_key')
    @patch('boto3.client')
    @patch('workspace.config.get_workspace_bucket', return_value='my-bucket')
    def test_batch_writes_multiple_text_files(self, mock_bucket, mock_boto3_client, mock_key, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        mock_key.side_effect = lambda u, s, p: f"code-interpreter-workspace/{u}/{s}/{p.split('/')[-1]}"

        mock_s3 = MagicMock()
        mock_s3.get_object.return_value = {"Body": MagicMock(read=MagicMock(return_value=b"data"))}
        mock_boto3_client.return_value = mock_s3

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/a.txt", "code-interpreter/b.json"],
            tool_context=_make_context(),
        )
        data = json.loads(result)

        assert data['status'] == 'ok'
        assert data['count'] == 2
        # Both text files should be written in a single batch call
        interp.write_files.assert_called_once()
        write_content = interp.write_files.call_args[0][0].content
        assert len(write_content) == 2


# ============================================================
# Response Format Tests
# ============================================================

class TestCiSyncResponseFormat:
    """Tests that sync tools always return valid JSON."""

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    def test_push_error_returns_valid_json(self, mock_get_interp):
        interp, session_name = _make_interpreter_mock()
        mock_get_interp.return_value = (interp, session_name)
        interp.list_files.side_effect = Exception("CI exploded")

        from builtin_tools.code_interpreter_tool import ci_push_to_workspace
        result = ci_push_to_workspace(paths=None, tool_context=_make_context())
        data = json.loads(result)
        assert isinstance(data, dict)
        assert data['status'] == 'error'

    @patch('builtin_tools.code_interpreter_tool._get_interpreter')
    def test_pull_unavailable_returns_valid_json(self, mock_get_interp):
        mock_get_interp.return_value = (None, None)

        from builtin_tools.code_interpreter_tool import ci_pull_from_workspace
        result = ci_pull_from_workspace(
            workspace_paths=["code-interpreter/x.csv"],
            tool_context=_make_context(),
        )
        data = json.loads(result)
        assert isinstance(data, dict)
        assert 'status' in data
