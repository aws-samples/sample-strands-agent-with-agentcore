import shlex
from unittest.mock import Mock

import pytest

from builtin_tools.lib.code_interpreter_files import download_workspace_file


def response(result):
    return {"stream": iter([{"result": result}])}


@pytest.mark.parametrize("block", [{"data": b"PK\x03\x04"}, {"resource": {"blob": b"PK\x03\x04"}}, {"data": b""}])
def test_stages_in_api_root_and_preserves_binary_bytes(block):
    ci = Mock()
    ci.invoke.side_effect = [response({}), response({"content": [{"text": "status"}, block]}), response({})]
    source = "/mnt/workspace/report with 'quote.xlsx"
    data = download_workspace_file(ci, source)
    assert data == block.get("data", block.get("resource", {}).get("blob"))
    command = shlex.split(ci.invoke.call_args_list[0].args[1]["command"])
    assert command[:2] == ["python", "-c"]
    stage = ci.invoke.call_args_list[1].args[1]["paths"][0]
    assert "/" not in stage
    copied = Mock()
    import sys
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setitem(sys.modules, "shutil", Mock(copyfile=copied))
        exec(command[2], {})
    copied.assert_called_once_with(source, stage)
    assert ci.invoke.call_args_list[2].args == ("removeFiles", {"paths": [stage]})


@pytest.mark.parametrize("failed_step", ["copy", "read", "missing"])
def test_transfer_errors_are_visible_and_staging_is_cleaned(failed_step):
    ci = Mock()
    error = {"isError": True, "content": [{"text": "access denied"}]}
    if failed_step == "copy":
        ci.invoke.side_effect = [response(error), response({})]
    else:
        ci.invoke.side_effect = [response({}), response(error if failed_step == "read" else {}), response({})]
    with pytest.raises(RuntimeError, match="access denied|No file content"):
        download_workspace_file(ci, "/mnt/workspace/report.xlsx")
    assert ci.invoke.call_args_list[-1].args[0] == "removeFiles"


def test_cleanup_failure_does_not_discard_downloaded_file():
    ci = Mock()
    ci.invoke.side_effect = [response({}), response({"content": [{"data": b"file"}]}), RuntimeError("cleanup unavailable")]
    assert download_workspace_file(ci, "/mnt/workspace/report.xlsx") == b"file"


def test_copy_exit_code_is_not_misreported_as_missing_file():
    ci = Mock()
    ci.invoke.side_effect = [response({"structuredContent": {"exitCode": 1, "stderr": "source missing"}}), response({})]
    with pytest.raises(RuntimeError, match="source missing"):
        download_workspace_file(ci, "/mnt/workspace/report.xlsx")
    assert ci.invoke.call_count == 2
