---
name: visual-design
description: "Use this skill any time the user needs a visual output as an image
  or PDF — charts, diagrams, posters, infographics, abstract artwork, or any
  visual design. Trigger for: data visualization requests, poster/flyer creation,
  infographic design, abstract or artistic visuals, architecture/flow diagrams,
  or any request mentioning 'chart', 'graph', 'poster', 'infographic', 'design',
  'visual', or referencing .png/.pdf image output."
---

# Visual Design

## Quick Reference

| Task                        | Tool                   | Guide                                      |
|-----------------------------|------------------------|--------------------------------------------|
| Data chart or graph         | `generate_chart`       | Read SKILL.md Design Ideas                 |
| Poster / infographic / art  | `create_visual_design` | Read [canvas-design.md](canvas-design.md)  |
| Architecture / flow diagram | `create_visual_design` | Read [diagram-design.md](diagram-design.md)|

## Available Tools

### generate_chart
Data visualization. Executes matplotlib/plotly code to produce chart PNGs.
- `python_code` (str, required): Chart generation Python code
- `output_filename` (str, required): `.png` filename

### create_visual_design
Visual design creation: posters, infographics, artwork, diagrams.
Uses reportlab, Pillow, svgwrite, or any available library.
- `python_code` (str, required): Design generation Python code
- `output_filename` (str, required): `.png` or `.pdf` filename

## Available Libraries

| Purpose | Libraries | Output | Notes |
|---------|-----------|--------|-------|
| Data charts | matplotlib, plotly, bokeh | PNG | Best for charts |
| PDF design | reportlab, fpdf | PDF | Full control |
| Image design | Pillow + fonttools | PNG | Best for PNG designs |
| Vector graphics | svgwrite → svglib + renderPDF | SVG → PDF | SVG→PNG NOT supported (no renderPM) |
| Image processing | Wand (ImageMagick), opencv-python | PNG | Check availability first |

**IMPORTANT**: For PNG output, use Pillow or matplotlib. Do NOT use svgwrite→renderPM (rlPyCairo is unavailable).

## Design Workflow

### Data Charts (`generate_chart`)
1. Identify data structure and choose appropriate chart type
2. Select color palette (see Design Ideas below)
3. Write code with `plt.savefig(filename, dpi=300, bbox_inches='tight')`
4. Review the generated chart

### Visual Design (`create_visual_design`)
1. Establish design concept/philosophy (internally)
2. Follow the process in [canvas-design.md](canvas-design.md)
3. Select appropriate library and write code
4. Save: reportlab `canvas.save()`, Pillow `image.save()`, matplotlib `plt.savefig()`
5. Review output and refine

## Design Ideas

### Color Palettes
| Theme | Primary | Accent | Background |
|-------|---------|--------|------------|
| Midnight Executive | `1E2761` | `408EC6` | `0D1B2A` |
| Forest & Moss | `2C5F2D` | `97BC62` | `1A1A1A` |
| Coral Energy | `F96167` | `F9E795` | `2F3C7E` |
| Ocean Gradient | `065A82` | `1B9AAA` | `021B29` |
| Charcoal Minimal | `36454F` | `E8E8E8` | `1C1C1E` |
| Cherry Bold | `990011` | `FCF6F5` | `150E11` |
| Sage Calm | `84B59F` | `69A297` | `2D3A2D` |
| Warm Terracotta | `B85042` | `E7E8D1` | `2A1F1C` |

### Typography
Prefer thin/light fonts. Minimize text in designs.
| Element | Size | Style |
|---------|------|-------|
| Main title | 48-72pt | Bold or Thin |
| Subtext | 14-18pt | Light |
| Labels/captions | 8-12pt | Regular, muted |

**Text-to-Canvas Balance (IMPORTANT):**
- Text size must be proportional to the overall canvas and surrounding design elements
- Common mistake: text that is too small relative to the canvas, making it unreadable at normal viewing distance
- Rule of thumb: if you need to zoom in to read it, it's too small
- Titles should command attention — when in doubt, go larger
- Labels/captions should be clearly legible, not decorative afterthoughts
- Test: mentally shrink the output to 50% — all text should still be readable

### Spacing & Composition
- Generous margins (minimum 10% of canvas)
- Consistent spacing between elements
- No overlapping; all elements within canvas bounds
- Visual hierarchy: convey importance via size, color, position

### Avoid
- Elements flush to canvas edges (insufficient margins)
- Overlapping elements
- Too many colors (stick to 3-4)
- Excessive text — visual elements are the focus
- Default matplotlib styles without customization

## Code Requirements
- Code must save a file to disk
- Use the exact `output_filename` provided
- PNG: `dpi=300` or higher recommended
- PDF: A4 or Letter size recommended
- For Korean text: configure appropriate fonts

## QA

**Assume there are problems and look for them.**

1. Review the generated image/PDF
2. Check for overlapping elements, clipped text, insufficient margins
3. Verify sufficient color contrast
4. If issues found, fix the code and regenerate
5. Complete at least one fix-verify cycle before finishing
