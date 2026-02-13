# PowerPoint Design Guide

Code patterns and detailed guidance for visual slide design. Load this when implementing slide visuals.

## Using Palettes in Code

```python
# Example: Midnight Executive palette
PRIMARY = RGBColor(0x1E, 0x27, 0x61)
ACCENT  = RGBColor(0x40, 0x8E, 0xC6)
WHITE   = RGBColor(0xFF, 0xFF, 0xFF)

# Background fill
slide.background.fill.solid()
slide.background.fill.fore_color.rgb = PRIMARY

# Accent shape
shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(6.5), Inches(13.33), Inches(1))
shape.fill.solid()
shape.fill.fore_color.rgb = ACCENT
shape.line.fill.background()

# Title text
tf = title.text_frame
p = tf.paragraphs[0]
p.font.color.rgb = WHITE
p.font.size = Pt(44)
p.font.bold = True
```

## Creating Lighter Tints

For data slides, lighten the palette's primary color:

```python
# Lighter tint of Midnight Executive primary for data slide background
LIGHT_BG = RGBColor(0x2A, 0x35, 0x78)  # Slightly lighter than #1E2761
```

## Visual Element Patterns

### Accent bar (bottom)
```python
bar = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(7), Inches(13.33), Inches(0.5))
bar.fill.solid()
bar.fill.fore_color.rgb = ACCENT
bar.line.fill.background()
```

### Icon circle
```python
circle = slide.shapes.add_shape(MSO_SHAPE.OVAL, Inches(1), Inches(2), Inches(1.2), Inches(1.2))
circle.fill.solid()
circle.fill.fore_color.rgb = ACCENT
circle.line.fill.background()
```

### Side stripe
```python
stripe = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(0), Inches(0.4), Inches(7.5))
stripe.fill.solid()
stripe.fill.fore_color.rgb = ACCENT
stripe.line.fill.background()
```

### Divider line
```python
from pptx.util import Emu
line = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(3), Inches(11.33), Emu(18000))
line.fill.solid()
line.fill.fore_color.rgb = ACCENT
line.line.fill.background()
```

## Anti-Patterns — Detailed

### Plain bullets on white background
White backgrounds look unprofessional and undesigned. Always fill the slide background with a palette color.

### Default PowerPoint blue (#4472C4)
This signals "auto-generated." Always use your chosen palette instead.

### Accent lines directly under titles
A colored bar touching the bottom of the title looks dated. Use breathing room (0.5″+) and place accent elements in the margins or as side bars.

### Text-only slides
Every slide needs at least one non-text visual element — a shape, divider bar, icon circle, or background gradient. Use accent-colored rectangles, circles, or rounded rectangles as visual anchors.

### Overcrowded slides
- Maximum 4 bullet points per slide
- If more content is needed, split across multiple slides
- Use grid layouts (2x2 or 3-column) to organize dense information
