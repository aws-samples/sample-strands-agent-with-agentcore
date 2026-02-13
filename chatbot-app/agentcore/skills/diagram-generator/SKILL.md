---
name: diagram-generator
description: Generate diagrams and charts using Python code via Bedrock Code Interpreter (matplotlib, pandas, numpy).
---

# Diagram Generator

This tool executes **Python code** in Bedrock Code Interpreter to generate diagrams. You must write matplotlib code — this is NOT a simple diagram type selector.

## Available Tool
- **generate_diagram_and_validate**: Execute Python code to create a diagram image.

## Parameters (MUST match exactly)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `python_code` | str | Yes | Python code that generates a diagram using matplotlib |
| `diagram_filename` | str | Yes | Output PNG filename (must end with `.png`) |

**WARNING**: There is NO `diagram_type` parameter. You must write Python code.

## Example tool_input

```json
{
  "python_code": "import matplotlib.pyplot as plt\nimport numpy as np\n\ncategories = ['A', 'B', 'C', 'D']\nvalues = [25, 40, 30, 55]\n\nfig, ax = plt.subplots(figsize=(10, 6))\nax.bar(categories, values, color=['#2196F3', '#4CAF50', '#FF9800', '#F44336'])\nax.set_title('Sample Chart', fontsize=16)\nax.set_ylabel('Value')\nplt.grid(True, alpha=0.3)\nplt.savefig('sample-chart.png', dpi=300, bbox_inches='tight')",
  "diagram_filename": "sample-chart.png"
}
```

## Code Requirements
- The code MUST include: `plt.savefig(diagram_filename, dpi=300, bbox_inches='tight')`
- The filename in `plt.savefig()` must match `diagram_filename`
- Available libraries: `matplotlib`, `pandas`, `numpy`
- Recommended: `figsize=(10, 6)` or larger, `plt.grid(True, alpha=0.3)` for readability

## Usage Guidelines
- Generated diagrams are saved to workspace and can be reused in Word, Excel, or PowerPoint documents.
- Use descriptive filenames (e.g., `revenue-trend-2025.png`, not `chart.png`).
