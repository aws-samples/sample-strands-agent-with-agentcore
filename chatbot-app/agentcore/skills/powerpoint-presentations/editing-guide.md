# PowerPoint Editing Guide

## Editing Existing Presentations

### Step 1: Analyze Structure

Always call `analyze_presentation` first to get element IDs and positions.

```json
{ "presentation_name": "my-deck", "slide_index": 0 }
```

The response includes:
- `shape_id`: Unique identifier for each element
- `text`: Current text content
- `position`: Left, top, width, height in EMU (English Metric Units)
- `placeholder_idx`: Placeholder index (for template-based slides)

### Step 2: Build Update Operations

`update_slide_content` accepts a list of `slide_updates`, each targeting a specific slide:

```json
{
  "presentation_name": "my-deck",
  "output_name": "my-deck-v2",
  "slide_updates": [
    {
      "slide_index": 0,
      "operations": [
        {
          "operation": "update_text",
          "shape_id": 2,
          "text": "New Title"
        }
      ]
    }
  ]
}
```

### Available Operations

| Operation | Required Fields | Description |
|-----------|----------------|-------------|
| `update_text` | `shape_id`, `text` | Replace text in a shape |
| `update_table_cell` | `shape_id`, `row`, `col`, `text` | Update a specific table cell |
| `delete_shape` | `shape_id` | Remove a shape from the slide |
| `add_text_box` | `text`, `left`, `top`, `width`, `height` | Add a new text box (EMU units) |
| `add_image` | `image_path`, `left`, `top`, `width`, `height` | Add an image |
| `update_shape_style` | `shape_id`, style fields | Change fill color, font, etc. |

### EMU Unit Reference

1 inch = 914400 EMU. Common slide dimensions (16:9):
- Slide width: 12192000 EMU (13.333 inches)
- Slide height: 6858000 EMU (7.5 inches)

### Style Fields for `update_shape_style`

```json
{
  "operation": "update_shape_style",
  "shape_id": 2,
  "fill_color": "FF0000",
  "font_color": "FFFFFF",
  "font_size": 24,
  "font_bold": true
}
```

## Batch Editing Rules

- **Always batch** all slide updates into a single `update_slide_content` call.
- Multiple slides can be updated in one call by adding multiple entries to `slide_updates`.
- **Never** call `update_slide_content` multiple times in sequence on the same file — the second call would overwrite the first.
- The `output_name` must differ from `presentation_name`. Use a versioning convention like `-v2`, `-v3`.

## Common Patterns

### Replace all text on a slide

```json
{
  "slide_updates": [
    {
      "slide_index": 0,
      "operations": [
        { "operation": "update_text", "shape_id": 2, "text": "Updated Title" },
        { "operation": "update_text", "shape_id": 3, "text": "Updated Subtitle" }
      ]
    }
  ]
}
```

### Update table data

```json
{
  "slide_updates": [
    {
      "slide_index": 1,
      "operations": [
        { "operation": "update_table_cell", "shape_id": 5, "row": 0, "col": 0, "text": "Header" },
        { "operation": "update_table_cell", "shape_id": 5, "row": 1, "col": 1, "text": "$1,234" }
      ]
    }
  ]
}
```

### Add content to a blank area

```json
{
  "slide_updates": [
    {
      "slide_index": 2,
      "operations": [
        {
          "operation": "add_text_box",
          "text": "New annotation",
          "left": 457200,
          "top": 5486400,
          "width": 3657600,
          "height": 457200
        }
      ]
    }
  ]
}
```
