"""Transfer mounted workspace files through Code Interpreter's file API root."""

import logging
import shlex
import uuid
from typing import Any

logger = logging.getLogger(__name__)


def _results(response: dict):
    for event in response.get("stream", []):
        result = event.get("result", {})
        structured = result.get("structuredContent", {})
        if result.get("isError") or structured.get("exitCode", 0) != 0:
            details = structured.get("stderr") or "\n".join(
                block.get("text", "") for block in result.get("content", [])
            )
            raise RuntimeError(details or "Code Interpreter file transfer failed")
        yield result


def download_workspace_file(code_interpreter: Any, source_path: str) -> bytes:
    """Copy to the file API's own root, read bytes, then remove that temporary copy.

    readFiles rejects mounted absolute paths. executeCommand starts in the file
    API root, independently of the Python kernel's mounted working directory.
    A unique staging name avoids collisions and preserves the source file.
    """
    staging_name = f"workspace-transfer-{uuid.uuid4().hex}.bin"
    copy_code = f"import shutil; shutil.copyfile({source_path!r}, {staging_name!r})"
    try:
        list(_results(code_interpreter.invoke("executeCommand", {
            "command": f"python -c {shlex.quote(copy_code)}",
        })))
        response = code_interpreter.invoke("readFiles", {"paths": [staging_name]})
        file_bytes = None
        for result in _results(response):
            for block in result.get("content", []):
                value = block.get("data")
                if value is None:
                    value = block.get("resource", {}).get("blob")
                if isinstance(value, (bytes, bytearray)):
                    file_bytes = bytes(value)
        if file_bytes is None:
            raise RuntimeError(f"No file content returned for {source_path}")
        return file_bytes
    finally:
        try:
            list(_results(code_interpreter.invoke("removeFiles", {"paths": [staging_name]})))
        except Exception:
            logger.warning("Could not remove temporary Code Interpreter transfer file", exc_info=True)
