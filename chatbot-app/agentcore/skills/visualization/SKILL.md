---
name: visualization
description: Create interactive chart visualizations (bar, line, pie) from data.
---

# Visualization

## Available Tool
- **create_visualization**: Create a chart specification for frontend rendering.

## Parameters (MUST match exactly)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chart_type` | str | Yes | `"bar"`, `"line"`, or `"pie"` |
| `data` | list[dict] | Yes | Array of data objects — see formats below |
| `title` | str | No | Chart title |
| `x_label` | str | No | X-axis label (bar/line only) |
| `y_label` | str | No | Y-axis label (bar/line only) |

## Data Formats (CRITICAL — use exact field names)

**Bar / Line charts** — each object MUST have `"x"` and `"y"` keys:
```json
[{"x": "Jan", "y": 100}, {"x": "Feb", "y": 150}, {"x": "Mar", "y": 120}]
```

**Pie charts** — each object MUST have `"segment"` and `"value"` keys:
```json
[{"segment": "Category A", "value": 30}, {"segment": "Category B", "value": 70}]
```

Optional: add `"color": "hsl(210, 100%, 50%)"` to any data point for custom color.

## Example tool_input

Bar chart:
```json
{
  "chart_type": "bar",
  "data": [{"x": "Q1", "y": 250}, {"x": "Q2", "y": 310}, {"x": "Q3", "y": 280}],
  "title": "Quarterly Revenue",
  "x_label": "Quarter",
  "y_label": "Revenue ($K)"
}
```

Pie chart:
```json
{
  "chart_type": "pie",
  "data": [{"segment": "Mobile", "value": 60}, {"segment": "Desktop", "value": 35}, {"segment": "Tablet", "value": 5}],
  "title": "Traffic by Device"
}
```

## Common Mistakes to Avoid
- Do NOT use `{"labels": [...], "values": [...]}` format — data MUST be a list of dicts.
- Bar/line data MUST use `"x"` and `"y"` keys, NOT `"label"` or `"name"`.
