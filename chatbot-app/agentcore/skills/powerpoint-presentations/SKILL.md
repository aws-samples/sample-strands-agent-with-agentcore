---
name: powerpoint-presentations
description: Create, modify, and manage PowerPoint presentations with python-pptx via Bedrock Code Interpreter.
---

# PowerPoint Presentations

## Quick Reference

| Task | How |
|------|-----|
| Create new | `get_slide_code_examples` → `create_presentation` |
| Edit existing | `analyze_presentation` → `update_slide_content`. Read [editing-guide.md](editing-guide.md) for details. |
| Verify | `preview_presentation_slides` after every change |

## Design Ideas

**Don't create boring slides.** Plain bullets on a white background won't impress anyone.

### Before Starting

- **Pick a bold, content-informed color palette**: The palette should feel designed for THIS topic.
- **Dominance over equality**: One color dominates (60-70% visual weight), with 1-2 supporting tones and one sharp accent. Never give all colors equal weight.
- **Dark/light contrast**: Dark backgrounds for title + conclusion slides, lighter tints for content slides. Or commit to dark throughout for a premium feel.
- **Commit to a visual motif**: Pick ONE distinctive element and repeat it — rounded image frames, icons in colored circles, thick single-side borders.

### Color Palettes

Choose colors that match your topic — don't default to generic blue.

| Theme | Primary | Accent | Text |
|-------|---------|--------|------|
| **Midnight Executive** | `1E2761` (navy) | `408EC6` (blue) | `FFFFFF` |
| **Teal Trust** | `0A1A2A` (charcoal) | `028090` (teal) | `FFFFFF` |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `FFFFFF` |
| **Berry & Cream** | `ECE2D0` (cream) | `6D2E46` (berry) | `333333` |
| **Coral Energy** | `1A1A2E` (midnight) | `FF6F61` (coral) | `FFFFFF` |
| **Ocean Gradient** | `065A82` (ocean) | `1B9AAA` (aqua) | `FFFFFF` |
| **Charcoal Minimal** | `1C1C1E` (near-black) | `E8E8E8` (gray) | `FFFFFF` |
| **Cherry Bold** | `150E11` (burgundy) | `990011` (cherry) | `FFFFFF` |
| **Sage Calm** | `2D3A2D` (sage) | `8FB96A` (green) | `FFFFFF` |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

Layout options: two-column, icon + text rows, 2x2 grid, half-bleed image with overlay, large stat callouts (48-120pt), timeline/process flow.

### Typography

| Element | Size | Font |
|---------|------|------|
| Slide title | 36-44pt bold | Georgia or Arial Black |
| Body text | 14-16pt | Calibri |
| Stats/numbers | 48-120pt bold | — |

Font pairings: Georgia + Calibri (classic), Arial Black + Arial (modern), Calibri Bold + Calibri Light (corporate). Left-align body text; center only titles and stats.

### Spacing

- 0.5″+ margins from edges. 0.3-0.5″ between elements. 0.5″+ below titles.

### Avoid (Common Mistakes)

- Plain bullets on white background
- Default PowerPoint blue (`#4472C4`)
- Accent lines directly under titles
- Text-only slides without visual elements
- More than 4 bullet points per slide
- Repeating the same layout on every slide

See [design-guide.md](design-guide.md) for visual element code patterns (accent bars, icon circles, side stripes) and detailed anti-pattern explanations.

## Workflow

1. **Create**: Call `get_slide_code_examples` first (use `"design_reference"` for palettes and font pairings) → then `create_presentation` with `slides` parameter.
2. **Edit**: Read [editing-guide.md](editing-guide.md) for detailed editing workflows. Then: `analyze_presentation` → identify element IDs → `update_slide_content`.
3. **Verify**: Call `preview_presentation_slides` after any modification. Assume there are problems — inspect carefully.

## Rules

- Batch all edits in ONE `update_slide_content` call. Parallel calls cause data loss.
- `output_name` must differ from `presentation_name`.
- All slide indices are 0-based EXCEPT `preview_presentation_slides` which uses 1-based `slide_numbers`.
- Filenames: letters, numbers, hyphens only.

---

## Tool Reference

### get_slide_code_examples
Get python-pptx code examples as reference for creating slides.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `category` | str | No (default "text_layout") | `"text_layout"`, `"number_highlight"`, `"grid_layout"`, `"image_text"`, `"visual_emphasis"`, `"design_reference"`, `"all"` |

### create_presentation
Create a new presentation with custom-designed slides (16:9 widescreen).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Filename without extension (letters, numbers, hyphens only) |
| `slides` | list or null | Yes | List of `{"custom_code": "..."}` dicts, or null for blank |
| `template_name` | str | No | Template filename to use as base |

Example tool_input:
```json
{
  "presentation_name": "my-deck",
  "slides": [
    {"custom_code": "from pptx.util import Inches, Pt\nfrom pptx.dml.color import RGBColor\nfrom pptx.enum.text import PP_ALIGN\ntitle = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(8), Inches(1.5))\ntf = title.text_frame\np = tf.paragraphs[0]\np.text = 'Welcome'\np.font.size = Pt(44)\np.font.bold = True\np.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)\nslide.background.fill.solid()\nslide.background.fill.fore_color.rgb = RGBColor(0x1E, 0x27, 0x61)"}
  ]
}
```

**IMPORTANT**: The `slides` parameter takes a list of `{"custom_code": "..."}` dicts. Available in custom_code: `prs`, `slide`, `slide_width`, `slide_height`, `Inches`, `Pt`, `RGBColor`, `PP_ALIGN`, `MSO_SHAPE`.

### analyze_presentation
Analyze structure with element IDs and positions for editing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Presentation to analyze |
| `slide_index` | int | No | Analyze a specific slide only |
| `include_notes` | bool | No (default false) | Include speaker notes |

### update_slide_content
Update one or more slides with operations in a single call.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Source file |
| `slide_updates` | list | Yes | List of update operations |
| `output_name` | str | Yes | Output filename (MUST differ from source) |

Supported actions per operation: `set_text`, `replace_text`, `replace_image`, `run_code`. See [editing-guide.md](editing-guide.md) for details.

### add_slide
Add a new slide at a specific position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Source presentation |
| `layout_name` | str | Yes | Layout name from `get_presentation_layouts` |
| `position` | int | Yes | 0-based index (-1 to append at end) |
| `output_name` | str | Yes | Output filename |
| `custom_code` | str | No | Python-pptx code to customize the slide |

### delete_slides
Delete slides by indices.

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `slide_indices` | list[int] | Yes (0-based) |
| `output_name` | str | Yes |

### move_slide
Move a slide from one position to another.

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `from_index` | int | Yes (0-based) |
| `to_index` | int | Yes (0-based) |
| `output_name` | str | Yes |

### duplicate_slide
Duplicate a slide to a specified position.

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `slide_index` | int | Yes (0-based) |
| `position` | int | Yes (0-based) |
| `output_name` | str | Yes |

### update_slide_notes
Update speaker notes for a specific slide.

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `slide_index` | int | Yes (0-based) |
| `notes_text` | str | Yes |
| `output_name` | str | Yes |

### list_my_powerpoint_presentations
List all presentations in workspace. No parameters needed.

### get_presentation_layouts
Get available slide layouts from a presentation.

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |

### preview_presentation_slides
Get slide screenshots for visual inspection.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Presentation to preview |
| `slide_numbers` | list[int] | Yes | **1-based** slide numbers (not 0-based) |
