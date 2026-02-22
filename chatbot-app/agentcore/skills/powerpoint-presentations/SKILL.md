---
name: powerpoint-presentations
description: Create, modify, and manage PowerPoint presentations.
---

# PowerPoint Presentations

## Quick Reference

| Task | How |
|------|-----|
| Create from scratch | `get_slide_design_reference` → `create_presentation` (PptxGenJS). Read [pptxgenjs.md](pptxgenjs.md). |
| **Create from template** | `get_presentation_layouts` → `delete_slides` (strip content) → `add_slide` → `update_slide_content`. **Do NOT use `create_presentation`**. |
| Edit existing | `analyze_presentation` → `update_slide_content`. Read [editing-guide.md](editing-guide.md). |
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

| Theme | Primary | Secondary | Accent |
|-------|---------|-----------|--------|
| **Midnight Executive** | `1E2761` (navy) | `CADCFC` (ice blue) | `FFFFFF` (white) |
| **Teal Trust** | `028090` (teal) | `00A896` (seafoam) | `02C39A` (mint) |
| **Forest & Moss** | `2C5F2D` (forest) | `97BC62` (moss) | `F5F5F5` (cream) |
| **Berry & Cream** | `6D2E46` (berry) | `A26769` (dusty rose) | `ECE2D0` (cream) |
| **Coral Energy** | `F96167` (coral) | `F9E795` (gold) | `2F3C7E` (navy) |
| **Ocean Gradient** | `065A82` (ocean) | `1C7293` (teal) | `21295C` (midnight) |
| **Charcoal Minimal** | `36454F` (charcoal) | `F2F2F2` (off-white) | `212121` (black) |
| **Cherry Bold** | `990011` (cherry) | `FCF6F5` (off-white) | `2F3C7E` (navy) |
| **Sage Calm** | `84B59F` (sage) | `69A297` (eucalyptus) | `50808E` (slate) |
| **Warm Terracotta** | `B85042` (terracotta) | `E7E8D1` (sand) | `A7BEAE` (sage) |

### For Each Slide

**Every slide needs a visual element** — image, chart, icon, or shape. Text-only slides are forgettable.

**Layout options:**
- Two-column (text left, illustration right)
- Icon + text rows (icon in colored circle, bold header, description below)
- 2x2 or 2x3 grid (image one side, content blocks the other)
- Half-bleed image (full left or right) with content overlay

**Data display:**
- Large stat callouts (big numbers 60-72pt with small labels below)
- Comparison columns (before/after, pros/cons, side-by-side options)
- Timeline or process flow (numbered steps, arrows)

**Visual polish:**
- Icons in small colored circles next to section headers
- Italic accent text for key stats or taglines

### Typography

| Header Font | Body Font |
|-------------|-----------|
| Georgia | Calibri |
| Arial Black | Arial |
| Calibri Bold | Calibri Light |
| Cambria | Calibri |
| Trebuchet MS | Calibri |

| Element | Size |
|---------|------|
| Slide title | 36-44pt bold |
| Section header | 20-24pt bold |
| Body text | 14-16pt |
| Captions | 10-12pt muted |

Font pairings: Georgia + Calibri (classic), Arial Black + Arial (modern), Calibri Bold + Calibri Light (corporate). Left-align body text; center only titles and stats.

### Spacing

- 0.5" minimum margins from edges
- 0.3-0.5" between content blocks
- 0.5"+ breathing room below titles

### Avoid (Common Mistakes)

- **Plain bullets on white background** — always fill slides with a palette color
- **Default PowerPoint blue (#4472C4)** — signals "auto-generated"
- **Don't repeat the same layout** — vary columns, cards, and callouts across slides
- **Don't center body text** — left-align paragraphs; center only titles and stats
- **Don't skimp on size contrast** — titles need 36pt+ to stand out from 14-16pt body
- **Don't mix spacing randomly** — choose 0.3" or 0.5" gaps and use consistently
- **Don't style one slide and leave the rest plain** — commit fully or keep it simple throughout
- **Don't create text-only slides** — add shapes, icons, charts, or accent elements
- **Don't forget text box padding** — set `margin: 0` when aligning text with shapes at same x-position
- **Don't use low-contrast elements** — text AND icons need strong contrast against background
- **NEVER use accent lines under titles** — use whitespace or background color instead
- **Don't overcrowd slides** — max 4 bullets; split to multiple slides or use 2x2/3-column grid

See [design-guide.md](design-guide.md) for visual element code patterns (accent bars, icon circles, side stripes, cards).

---

## Workflow

### A. Create from scratch (no template)
1. Call `get_slide_design_reference` for palette and layout ideas
2. Call `create_presentation` with `slides` parameter (PptxGenJS). Read [pptxgenjs.md](pptxgenjs.md) for the full API.

### B. Create from a template (user uploaded a .pptx template)
**Do NOT use `create_presentation`** — that ignores the template entirely and recreates from scratch.

Instead, use the template file as the base:
1. `get_presentation_layouts("template-name")` — see available layout names
2. `preview_presentation_slides` — inspect visual style (colors, logo, footer, chrome elements)
3. `delete_slides("template-name", [indices of all content slides], "working-name")` — strip example content, keep masters/layouts
4. `add_slide("working-name", layout_name, position, "working-name-v2")` — add slides using the template's own layouts (inherits background, logo, footer automatically)
5. `update_slide_content(...)` — fill in text and images

This preserves the template's slide master, theme, logo, footer, and background — things `create_presentation` cannot replicate.

### C. Edit existing presentation
Read [editing-guide.md](editing-guide.md) for detailed workflows. Then: `analyze_presentation` → identify element IDs → `update_slide_content`.

### Verify
Call `preview_presentation_slides` after any modification. Assume there are problems — inspect carefully.

**When continuing a deck across conversation turns**: Do NOT re-preview existing slides just to check the design system. The palette, fonts, and layout decisions from the previous turn are already in the conversation history — use that. Only re-preview if you need to verify the visual state after a modification.

## Rules

- Batch all edits in ONE `update_slide_content` call. Parallel calls cause data loss.
- `output_name` must differ from `presentation_name`.
- All slide indices are 0-based EXCEPT `preview_presentation_slides` which uses 1-based `slide_numbers`.
- Filenames: letters, numbers, hyphens only.

---

## QA (Required)

**Assume there are problems. Your job is to find them.**

Your first render is almost never perfect. Approach QA as a bug hunt, not a confirmation step.

### Visual QA

Call `preview_presentation_slides` and visually inspect the screenshots. Look for:

- Overlapping elements (text through shapes, lines through words)
- Text overflow or cut off at edges
- Elements too close (< 0.3" gaps) or cards nearly touching
- Uneven gaps (large empty area in one place, cramped in another)
- Insufficient margin from slide edges (< 0.5")
- Columns or similar elements not aligned consistently
- Low-contrast text (light text on light background, dark text on dark background)
- Low-contrast icons without a contrasting background circle
- Text boxes too narrow causing excessive wrapping
- Inconsistent font sizes or styles across similar elements

### Verification Loop

1. Generate → `preview_presentation_slides` → inspect screenshots
2. List issues found (if none found, look again more critically)
3. Fix with `update_slide_content`
4. Re-verify affected slides — one fix often creates another problem
5. Repeat until a full pass reveals no new issues

**Do not declare success until you've completed at least one fix-and-verify cycle.**

---

## Tool Reference

### get_slide_design_reference
Get design guidelines, color palettes, typography rules, and layout patterns.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `topic` | str | No (default "all") | `"colors"`, `"typography"`, `"layouts"`, `"pitfalls"`, `"all"` |

### create_presentation
Create a new presentation with custom-designed slides (16:9 widescreen).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Filename without extension (letters, numbers, hyphens only) |
| `slides` | list or null | Yes | List of `{"custom_code": "..."}` dicts, or null for blank |

Example tool_input:
```json
{
  "presentation_name": "my-deck",
  "slides": [
    {"custom_code": "let slide = pres.addSlide();\nslide.background = { color: '1E2761' };\nslide.addText('Welcome', { x: 0.6, y: 2.5, w: 10, h: 1.5, fontSize: 44, bold: true, color: 'FFFFFF', align: 'center' });"}
  ]
}
```

**IMPORTANT**: `custom_code` uses `pres` in scope. Create slides with `pres.addSlide()`. Colors are 6-digit hex WITHOUT '#'. Do NOT reuse option objects across multiple addText/addShape calls. See [pptxgenjs.md](pptxgenjs.md) for full API.

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

Supported actions per operation: `set_text`, `replace_text`, `replace_image`. See [editing-guide.md](editing-guide.md) for details.

### add_slide
Add a new blank slide at a specific position.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | Source presentation |
| `layout_name` | str | Yes | Layout name from `get_presentation_layouts` |
| `position` | int | Yes | 0-based index (-1 to append at end) |
| `output_name` | str | Yes | Output filename |

After adding, populate content with `update_slide_content`.

### delete_slides

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `slide_indices` | list[int] | Yes (0-based) |
| `output_name` | str | Yes |

### move_slide

| Parameter | Type | Required |
|-----------|------|----------|
| `presentation_name` | str | Yes |
| `from_index` | int | Yes (0-based) |
| `to_index` | int | Yes (0-based) |
| `output_name` | str | Yes |

### duplicate_slide

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `presentation_name` | str | Yes | |
| `source_index` | int | Yes (0-based) | Slide to duplicate |
| `output_name` | str | Yes | |
| `insert_position` | int | No (default -1) | Where to insert copy; -1 appends after source |

### update_slide_notes

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
