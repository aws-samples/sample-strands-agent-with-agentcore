# Canvas Design Guide

Reference for `create_visual_design` tool. Follow this process for posters, infographics, artwork, and flow diagrams.

## Design Philosophy Approach

Every visual design follows a 2-step process:

### Step 1: Establish a Design Philosophy
Before writing any code, define the visual intent in 4-6 internal sentences covering:
- **Space & Form**: How will negative space interact with shapes? Dense or sparse?
- **Color & Texture**: What emotional tone? What palette from SKILL.md?
- **Scale & Rhythm**: Are elements uniform or varied? Is there visual rhythm?
- **Composition & Balance**: Symmetric or asymmetric? Where does the eye travel?

### Step 2: Name the Movement
Give the design a 1-2 word movement name that captures its aesthetic:
- Examples: "Brutalist Joy", "Chromatic Silence", "Grid Meditation", "Neon Geometry"
- This name guides every decision — when in doubt, ask "does this serve the movement?"

## Craftsmanship Standards

Build as if a meticulous expert craftsperson is creating a gallery-quality piece:
- Every pixel/point placement is intentional
- Alignments are exact, not approximate
- Colors are chosen with purpose, not randomly
- Spacing is consistent and mathematically grounded

## Text Principles

Text in visual design is a visual element, not content:
- **Minimal**: Use as few words as possible
- **Visual accent**: Text serves composition, not information delivery
- **Typographic hierarchy**: Size and weight create visual rhythm
- **Never dominant**: Text should not compete with visual elements for attention
- **Proportional to canvas**: Text must be sized relative to the overall canvas and surrounding elements. A common failure is text that looks fine in code but renders far too small on the actual canvas. When in doubt, scale up. If you mentally shrink the output to 50%, every text element should still be legible.

## Subtle Reference

When the design has a subject (e.g., "AI poster", "data science infographic"):
- Reflect the theme through metaphor, not literal depiction
- Use abstract forms that evoke the subject
- Let the viewer discover meaning rather than stating it
- Geometric patterns, color relationships, and spatial arrangements carry meaning

## Canvas Production Principles

### Repetition & Pattern
- Systematic repetition creates visual rhythm
- Grids, arrays, and regular intervals provide structure
- Variation within repetition adds interest without chaos

### Perfect Geometry
- Circles are perfect circles, lines are crisp
- Use mathematical relationships for positioning (golden ratio, rule of thirds)
- Consistent border radii, stroke widths, and corner treatments

### Systematic Observation
- Every element relates to at least one other element
- Alignment guides connect disparate parts
- Color echoes across the composition create unity

## Refinement Process

**Two-pass minimum:**

### First Pass: Structure
- Establish the composition grid
- Place primary elements
- Set color palette application
- Define the visual hierarchy

### Second Pass: Polish
- Refine spacing (adjust by 1-2px/pt for perfection)
- Check all alignments
- Verify color contrast and readability
- Ensure nothing bleeds off canvas
- **Priority: refine existing composition over adding new elements**

## Library Save Patterns

### ReportLab (PDF)
```python
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

c = canvas.Canvas(output_filename, pagesize=A4)
width, height = A4
# ... drawing commands ...
c.save()
```

### Pillow (PNG)
```python
from PIL import Image, ImageDraw, ImageFont

img = Image.new('RGB', (3000, 2000), color='#0D1B2A')
draw = ImageDraw.Draw(img)
# ... drawing commands ...
img.save(output_filename, dpi=(300, 300))
```

### SVGWrite → PDF (works)
```python
import svgwrite
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPDF

dwg = svgwrite.Drawing('temp.svg', size=('800px', '600px'))
# ... drawing commands ...
dwg.save()

drawing = svg2rlg('temp.svg')
renderPDF.drawToFile(drawing, output_filename)
```

### SVGWrite → PNG (caution)
`renderPM` (rlPyCairo) is NOT available. For PNG output, prefer Pillow or matplotlib
directly instead of SVG conversion. See library-reference.md for fallback chains.

### matplotlib (non-chart graphics)
```python
import matplotlib.pyplot as plt
import matplotlib.patches as patches

fig, ax = plt.subplots(figsize=(20, 14))
ax.set_xlim(0, 100)
ax.set_ylim(0, 70)
ax.axis('off')
# ... patches, artists, text ...
plt.savefig(output_filename, dpi=300, bbox_inches='tight',
            facecolor=fig.get_facecolor(), edgecolor='none')
```

## Canvas Sizes

| Format | Recommended Size | Use Case |
|--------|-----------------|----------|
| Poster (PNG) | 3000x4200px | Print-ready A3 portrait |
| Infographic (PNG) | 2400x4800px | Tall-scroll infographic |
| Landscape (PNG) | 3840x2160px | 4K presentation/wallpaper |
| Document (PDF) | A4 (595x842pt) | Standard document |
| Slide (PNG) | 1920x1080px | Presentation slide |
