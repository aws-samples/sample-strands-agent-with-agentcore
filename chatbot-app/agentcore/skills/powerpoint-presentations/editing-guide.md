# PowerPoint Editing Guide

## Editing Existing Presentations

### Step 1: Analyze Structure

Always call `analyze_presentation` first to get element IDs and positions.

```json
{ "presentation_name": "my-deck", "slide_index": 0 }
```

The response includes:
- `element_id`: Unique identifier for each element (shape)
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
          "action": "set_text",
          "element_id": 2,
          "text": "New Title"
        }
      ]
    }
  ]
}
```

### Available Actions

| Action | Required Fields | Description |
|--------|----------------|-------------|
| `set_text` | `element_id`, `text` | Replace all text in a shape |
| `replace_text` | `element_id`, `old_text`, `new_text` | Replace specific text within a shape (preserves formatting) |
| `replace_image` | `element_id`, `image_path` | Replace an existing image with a new one |
| `run_code` | `code` | Execute arbitrary python-pptx code on the slide |

### EMU Unit Reference

1 inch = 914400 EMU. Common slide dimensions (16:9):
- Slide width: 12192000 EMU (13.333 inches)
- Slide height: 6858000 EMU (7.5 inches)

### run_code Action

Use `run_code` for operations not covered by the other actions (adding shapes, changing styles, deleting elements, etc.):

```json
{
  "action": "run_code",
  "code": "from pptx.util import Inches, Pt\nfrom pptx.dml.color import RGBColor\ntf = slide.shapes[0].text_frame\ntf.paragraphs[0].font.color.rgb = RGBColor(0xFF, 0x00, 0x00)"
}
```

Available variables in `run_code`: `prs` (presentation), `slide` (current slide), `slide_width`, `slide_height`, `Inches`, `Pt`, `RGBColor`, `PP_ALIGN`, `MSO_SHAPE`.

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
        { "action": "set_text", "element_id": 2, "text": "Updated Title" },
        { "action": "set_text", "element_id": 3, "text": "Updated Subtitle" }
      ]
    }
  ]
}
```

### Replace specific text (preserve formatting)

```json
{
  "slide_updates": [
    {
      "slide_index": 1,
      "operations": [
        { "action": "replace_text", "element_id": 3, "old_text": "Q3", "new_text": "Q4" }
      ]
    }
  ]
}
```

### Add content with run_code

```json
{
  "slide_updates": [
    {
      "slide_index": 2,
      "operations": [
        {
          "action": "run_code",
          "code": "from pptx.util import Inches, Pt\nfrom pptx.dml.color import RGBColor\nfrom pptx.enum.text import PP_ALIGN\ntxBox = slide.shapes.add_textbox(Inches(0.5), Inches(6.0), Inches(4.0), Inches(0.5))\ntf = txBox.text_frame\np = tf.paragraphs[0]\np.text = 'New annotation'\np.font.size = Pt(12)\np.font.color.rgb = RGBColor(0x66, 0x66, 0x66)"
        }
      ]
    }
  ]
}
```
