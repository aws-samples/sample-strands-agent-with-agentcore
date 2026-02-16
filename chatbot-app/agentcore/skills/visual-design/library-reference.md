# Library Reference

Technical API patterns for visual design tools. Code examples for each library available in Code Interpreter.

## ReportLab

### Canvas Basics
```python
from reportlab.lib.pagesizes import A4, letter
from reportlab.lib.units import inch, cm, mm
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color

c = canvas.Canvas(output_filename, pagesize=A4)
w, h = A4  # 595.27, 841.89 points
```

### Shapes
```python
# Rectangle
c.setFillColor(HexColor('#1E2761'))
c.rect(x, y, width, height, fill=1, stroke=0)

# Rounded rectangle
c.roundRect(x, y, width, height, radius=10, fill=1, stroke=0)

# Circle
c.circle(cx, cy, radius, fill=1, stroke=0)

# Line
c.setStrokeColor(HexColor('#408EC6'))
c.setLineWidth(2)
c.line(x1, y1, x2, y2)

# Bezier curve
c.bezier(x1, y1, cx1, cy1, cx2, cy2, x2, y2)
```

### Text
```python
# Simple text
c.setFont("Helvetica-Bold", 36)
c.setFillColor(HexColor('#FFFFFF'))
c.drawString(x, y, "Title Text")

# Centered text
c.drawCentredString(w/2, y, "Centered Title")

# Right-aligned text
c.drawRightString(w - 50, y, "Right Text")
```

### Font Registration
```python
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

pdfmetrics.registerFont(TTFont('CustomFont', '/path/to/font.ttf'))
c.setFont('CustomFont', 24)
```

### Gradients
```python
from reportlab.lib.colors import linearlyInterpolatedColor

# Manual gradient via thin rectangles
steps = 100
for i in range(steps):
    ratio = i / steps
    color = linearlyInterpolatedColor(
        HexColor('#065A82'), HexColor('#1B9AAA'),
        0, 1, ratio
    )
    c.setFillColor(color)
    c.rect(0, h * ratio, w, h / steps + 1, fill=1, stroke=0)
```

### Transparency
```python
c.saveState()
c.setFillAlpha(0.5)
c.setFillColor(HexColor('#408EC6'))
c.circle(200, 400, 80, fill=1, stroke=0)
c.restoreState()
```

### Clipping
```python
p = c.beginPath()
p.circle(200, 400, 100)
c.clipPath(p, stroke=0)
# Everything drawn after this is clipped to the circle
```

---

## Pillow

### Image Creation
```python
from PIL import Image, ImageDraw, ImageFont, ImageFilter

img = Image.new('RGBA', (3000, 2000), (13, 27, 42, 255))
draw = ImageDraw.Draw(img)
```

### Shapes
```python
# Rectangle
draw.rectangle([x1, y1, x2, y2], fill='#1E2761', outline='#408EC6', width=2)

# Rounded rectangle
draw.rounded_rectangle([x1, y1, x2, y2], radius=20, fill='#1E2761')

# Circle / ellipse
draw.ellipse([x-r, y-r, x+r, y+r], fill='#408EC6')

# Line
draw.line([(x1, y1), (x2, y2)], fill='#E8E8E8', width=3)

# Polygon
draw.polygon([(x1, y1), (x2, y2), (x3, y3)], fill='#97BC62')
```

### Text
```python
# Load font (check available fonts first)
try:
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 72)
except:
    font = ImageFont.load_default()

draw.text((x, y), "Title", fill='#FFFFFF', font=font)

# Centered text
bbox = draw.textbbox((0, 0), "Title", font=font)
text_w = bbox[2] - bbox[0]
draw.text(((img.width - text_w) / 2, y), "Title", fill='#FFFFFF', font=font)
```

### Alpha Compositing
```python
# Create overlay with transparency
overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
overlay_draw = ImageDraw.Draw(overlay)
overlay_draw.rectangle([0, 0, 800, 600], fill=(30, 39, 97, 128))  # 50% alpha

img = Image.alpha_composite(img, overlay)
```

### Filters
```python
blurred = img.filter(ImageFilter.GaussianBlur(radius=5))
sharpened = img.filter(ImageFilter.SHARPEN)
```

### Save
```python
# For RGBA images, convert to RGB before saving as PNG
if img.mode == 'RGBA':
    bg = Image.new('RGB', img.size, (255, 255, 255))
    bg.paste(img, mask=img.split()[3])
    bg.save(output_filename, dpi=(300, 300))
else:
    img.save(output_filename, dpi=(300, 300))
```

---

## SVGWrite

### Drawing Creation
```python
import svgwrite

dwg = svgwrite.Drawing('temp.svg', size=('800px', '600px'),
                        viewBox='0 0 800 600')
```

### Basic Shapes
```python
# Rectangle
dwg.add(dwg.rect(insert=(10, 10), size=(200, 100),
                  fill='#1E2761', stroke='#408EC6', stroke_width=2))

# Circle
dwg.add(dwg.circle(center=(400, 300), r=80, fill='#408EC6'))

# Line
dwg.add(dwg.line(start=(0, 0), end=(800, 600),
                  stroke='#E8E8E8', stroke_width=2))

# Polygon
dwg.add(dwg.polygon(points=[(100, 100), (200, 50), (300, 100)],
                     fill='#97BC62'))
```

### Text
```python
dwg.add(dwg.text('Title', insert=(400, 50),
                  font_size='36px', font_family='Helvetica',
                  fill='#FFFFFF', text_anchor='middle'))
```

### Patterns & Repetition
```python
# Create a pattern
pattern = dwg.defs.add(dwg.pattern(id='dots', size=(20, 20),
                                     patternUnits='userSpaceOnUse'))
pattern.add(dwg.circle(center=(10, 10), r=3, fill='#408EC6'))

dwg.add(dwg.rect(insert=(0, 0), size=('100%', '100%'),
                  fill='url(#dots)'))
```

### SVG Output & Conversion

**IMPORTANT**: `renderPM` (rlPyCairo) is NOT available in Code Interpreter.
Do NOT use `renderPM.drawToPIL()` or `renderPM.drawToFile()` for PNG conversion.

**SVG → PDF** (works):
```python
dwg.save()

from svglib.svglib import svg2rlg
from reportlab.graphics import renderPDF

drawing = svg2rlg('temp.svg')
renderPDF.drawToFile(drawing, output_filename)
```

**SVG → PNG** — use one of these fallback chains:
```python
dwg.save()

# Option 1: cairosvg (preferred if available)
try:
    import cairosvg
    cairosvg.svg2png(url='temp.svg', write_to=output_filename,
                     output_width=3000)  # Scale up for high DPI
    print("Converted with cairosvg")
except ImportError:
    pass

# Option 2: Wand (ImageMagick binding)
try:
    from wand.image import Image as WandImage
    with WandImage(filename='temp.svg') as img:
        img.format = 'png'
        img.save(filename=output_filename)
    print("Converted with Wand")
except ImportError:
    pass

# Option 3: SVG → PDF → PNG via Pillow (always works)
from svglib.svglib import svg2rlg
from reportlab.graphics import renderPDF
from pdf2image import convert_from_path  # or use Pillow + fitz

drawing = svg2rlg('temp.svg')
renderPDF.drawToFile(drawing, 'temp.pdf')

from PIL import Image
# If pdf2image is available:
try:
    from pdf2image import convert_from_path
    images = convert_from_path('temp.pdf', dpi=300)
    images[0].save(output_filename)
    print("Converted via SVG→PDF→PNG")
except ImportError:
    print("pdf2image not available")
```

**Recommended approach**: If you need PNG output, prefer Pillow or matplotlib directly
instead of the SVG→PNG conversion chain. SVGWrite is best when PDF is the final format.

---

## matplotlib (Advanced Graphics)

### Non-Chart Graphics with Patches
```python
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.collections import PatchCollection

fig, ax = plt.subplots(figsize=(20, 14))
fig.set_facecolor('#0D1B2A')
ax.set_facecolor('#0D1B2A')
ax.set_xlim(0, 100)
ax.set_ylim(0, 70)
ax.axis('off')

# Rectangle
rect = patches.FancyBboxPatch((10, 10), 30, 20,
                               boxstyle='round,pad=0.5',
                               facecolor='#1E2761', edgecolor='#408EC6')
ax.add_patch(rect)

# Circle
circle = patches.Circle((60, 40), 10, facecolor='#408EC6', alpha=0.7)
ax.add_patch(circle)

# Arrow
ax.annotate('', xy=(70, 40), xytext=(45, 25),
            arrowprops=dict(arrowstyle='->', color='#E8E8E8', lw=2))

# Text
ax.text(50, 65, 'Title', fontsize=28, color='white',
        ha='center', va='center', fontweight='bold')
```

### Custom Styles
```python
plt.rcParams.update({
    'figure.facecolor': '#0D1B2A',
    'axes.facecolor': '#0D1B2A',
    'text.color': '#E8E8E8',
    'axes.labelcolor': '#E8E8E8',
    'xtick.color': '#E8E8E8',
    'ytick.color': '#E8E8E8',
})
```

### Save with Background
```python
plt.savefig(output_filename, dpi=300, bbox_inches='tight',
            facecolor=fig.get_facecolor(), edgecolor='none',
            pad_inches=0.1)
```

---

## fonttools — Font Discovery

### List Available Fonts
```python
import os
import glob

font_dirs = [
    '/usr/share/fonts',
    '/usr/local/share/fonts',
    os.path.expanduser('~/.fonts'),
]

fonts = []
for d in font_dirs:
    fonts.extend(glob.glob(os.path.join(d, '**/*.ttf'), recursive=True))
    fonts.extend(glob.glob(os.path.join(d, '**/*.otf'), recursive=True))

for f in sorted(fonts):
    print(os.path.basename(f))
```

### Inspect Font Properties
```python
from fontTools.ttLib import TTFont

font = TTFont('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')
name_table = font['name']
for record in name_table.names:
    if record.nameID in (1, 2, 4):  # Family, Style, Full Name
        print(f"{record.nameID}: {record.toUnicode()}")
```

### Common Code Interpreter Fonts
Typically available in Bedrock Code Interpreter:
- DejaVu Sans / DejaVu Serif / DejaVu Sans Mono
- Liberation Sans / Liberation Serif / Liberation Mono
- Noto Sans (may include CJK variants)

Always verify with the font discovery code above before assuming availability.
