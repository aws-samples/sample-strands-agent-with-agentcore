"""PptxGenJS runner via Code Interpreter (Deno)

Executes PptxGenJS JavaScript code in AWS AgentCore Code Interpreter (Deno 2.x)
and returns the resulting PPTX as bytes.

The Code Interpreter uses Deno, which supports npm packages via `npm:` specifiers.
PptxGenJS is imported on first use (auto-downloaded by Deno).
"""

import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Wrapper that provides `pres` (PptxGenJS instance) to each slide's custom_code.
# User code adds slides via `let slide = pres.addSlide(); ...`
_WRAPPER_TEMPLATE = """\
const PptxGenJS = (await import("npm:pptxgenjs")).default;
let pres = new PptxGenJS();
pres.layout = 'LAYOUT_WIDE';

{slides_code}

await pres.writeFile({{ fileName: "{output_filename}" }});
const _stat = await Deno.stat("{output_filename}");
console.log(`pptxgenjs:created:${{_stat.size}}`);
"""


def run_pptxgenjs(
    slides: list,
    output_filename: str,
    code_interpreter: Any,
) -> bytes:
    """Execute PptxGenJS slide definitions in Code Interpreter and return pptx bytes.

    Args:
        slides: List of dicts with 'custom_code' key (JavaScript for each slide).
                Each custom_code receives `pres` (PptxGenJS instance) in scope.
        output_filename: Output filename inside Code Interpreter (e.g. 'deck.pptx')
        code_interpreter: Active CodeInterpreter instance

    Returns:
        PPTX file bytes

    Raises:
        RuntimeError: If JS execution fails or file cannot be downloaded
    """
    slides_code = "\n\n".join(
        f"// Slide {i + 1}\n{{\n{slide.get('custom_code', '')}\n}}"
        for i, slide in enumerate(slides)
        if slide.get("custom_code")
    )
    wrapped = _WRAPPER_TEMPLATE.format(
        slides_code=slides_code,
        output_filename=output_filename,
    )

    logger.debug(f"Running PptxGenJS for {output_filename} ({len(slides)} slides)")

    response = code_interpreter.invoke("executeCode", {
        "code": wrapped,
        "language": "javascript",
        "clearContext": False,
    })

    stderr_lines = []
    for event in response.get("stream", []):
        result = event.get("result", {})
        if result.get("isError", False):
            stderr = result.get("structuredContent", {}).get("stderr", "Unknown error")
            raise RuntimeError(f"PptxGenJS execution failed:\n{stderr[:1500]}")
        stderr_out = result.get("structuredContent", {}).get("stderr", "")
        if stderr_out:
            stderr_lines.append(stderr_out)

    # Log Deno download messages at debug level (not errors)
    for line in stderr_lines:
        if "Download" in line or "Check" in line:
            logger.debug(f"Deno: {line.strip()}")

    return _download_file(code_interpreter, output_filename)


def _download_file(code_interpreter: Any, filename: str) -> bytes:
    """Download a file from Code Interpreter filesystem and return bytes."""
    response = code_interpreter.invoke("readFiles", {"paths": [filename]})

    for event in response.get("stream", []):
        result = event.get("result", {})
        if "content" in result and result["content"]:
            block = result["content"][0]
            if "data" in block and block["data"]:
                logger.debug(f"Downloaded {filename}: {len(block['data'])} bytes")
                return block["data"]
            if "resource" in block and "blob" in block.get("resource", {}):
                blob = block["resource"]["blob"]
                if blob:
                    logger.debug(f"Downloaded {filename} (blob): {len(blob)} bytes")
                    return blob

    raise RuntimeError(f"Failed to download '{filename}' from Code Interpreter")
