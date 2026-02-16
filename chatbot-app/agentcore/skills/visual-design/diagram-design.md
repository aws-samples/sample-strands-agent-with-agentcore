# Diagram Design Guide

Technical diagrams (architecture, flow, system structure) reference.
Supplements canvas-design.md with practical patterns from real iterations.

## Rendering Engine: SVG First

matplotlib is for charts. For box-arrow diagrams, use **svgwrite + cairosvg/wand**.

```python
import svgwrite, os
try:
    import cairosvg; HC = True
except: HC = False
try:
    from wand.image import Image as WI; HW = True
except: HW = False

dwg = svgwrite.Drawing('temp.svg', size=(f'{W}px', f'{H}px'),
                        viewBox=f'0 0 {W} {H}')
# ... draw ...
dwg.save()

if HC:
    cairosvg.svg2png(url='temp.svg', write_to=output_filename,
                     output_width=W*2, output_height=H*2)  # 2x for Retina
elif HW:
    with WI(filename='temp.svg', resolution=300) as img:
        img.save(filename=output_filename)

os.remove('temp.svg')  # Clean up
```

## Text Vertical Centering

SVG `dominant_baseline` is inconsistent across renderers. Use manual offset:

```python
def tx(x, y, text, fs=14, fw='normal', fl='#333', a='middle'):
    """y = visual center. Add fs*0.35 for baseline correction."""
    dwg.add(dwg.text(text, insert=(x, y + fs * 0.35),
                     font_size=f'{fs}px', font_weight=fw, fill=fl,
                     text_anchor=a, font_family='Helvetica, Arial, sans-serif'))

def tx_box(bx, by, bw, bh, text, **kwargs):
    """Center text inside a box."""
    tx(bx + bw/2, by + bh/2, text, **kwargs)
```

Why 0.35: SVG text y = baseline. Cap height ≈ 70% of font_size. Half of that = 35%.
Adjust 0.3–0.4 for different fonts.

## Canvas Size: Derive from Content

Do NOT pick canvas size first. Calculate from content bounds:

```python
sk_xs = [RX_START + i * SK_GAP for i in range(num_cols)]
RIGHT_EDGE = sk_xs[-1] + BOX_W + PADDING
CANVAS_PAD = 18
W = RIGHT_EDGE + CANVAS_PAD
# Same for height: last element bottom + CANVAS_PAD
```

## Alignment: Shared Coordinate Variables

```python
# Row coordinates — all boxes on same row share same y
ROW_L2_Y = 27
ROW_L3_Y = 140
BOX_H = 42  # Uniform height

# Column coordinates — array-driven
sk_xs = [RX_START + i * SK_GAP for i in range(4)]

for i in range(4):
    rr(sk_xs[i], ROW_L2_Y, SK_W, BOX_H, ...)
```

Never hardcode repeated coordinates. One variable per row/column.

## Arrow Patterns

### Straight horizontal
```python
def arrow_h(x1, y, x2, color, label=None, label_offset=-12):
    ln(x1, y, x2-4, y, color, sw=2.5)
    tri(x2-4, y, color, 10, 'right')
    if label:
        tx((x1+x2)/2, y + label_offset, label, fs=14, fw='bold', fl=color)
```

### L-shaped (bend)
```python
bend_x = start_x + 22
ln(start_x, start_y, bend_x, start_y, color)  # horizontal
ln(bend_x, start_y, bend_x, target_y, color)   # vertical
ln(bend_x, target_y, target_x, target_y, color) # horizontal
tri(target_x, target_y, color, 10)               # arrowhead
```

### Label placement
- Horizontal arrow: above (y - 12)
- Vertical arrow: right side (x + 12)
- L-shaped: above last horizontal segment
- Match label color to arrow color

### Line styles
- **Solid arrow**: active call/access (Agent → Service)
- **Dashed line**: containment/belongs-to (Parent ⊃ Child)

```python
dwg.add(dwg.line((x1, y1), (x2, y2),
                  stroke='#AAA', stroke_width=1.5, stroke_dasharray='5,4'))
```

## Systematic Repeated Elements

Separate data from layout:

```python
skills = ['web-search', 'visual-design', 'word-docs', 'code-interp']
skill_resources = [['scripts.py'], ['design.md', 'eval.py'], ['tmpl.js'], ['config.json']]

sk_xs = [RX_START + i * SK_GAP for i in range(len(skills))]

for i, (name, resources) in enumerate(zip(skills, skill_resources)):
    sx = sk_xs[i]
    rr(sx, ROW_Y, SK_W, BOX_H, bg, bd)
    tx_box(sx, ROW_Y, SK_W, BOX_H, name, fs=13)
    for j, rname in enumerate(resources):
        ry = res_start_y + j * (res_h + res_gap)
        rr(sx, ry, SK_W, res_h, rbg, rbd)
```

## Color Tone Matching

When matching a reference style, check these dimensions:

| Dimension | Typical range | Example |
|-----------|--------------|---------|
| Saturation | 20-35% (pastel) | Muted, not vivid |
| Lightness | BG 90%+, Box 80-90%, Text 25-40% | |
| Temperature | Warm (beige/olive) or Cool (blue-gray) | |
| Border contrast | Fill color darkened 15-25% | |

Rules:
- Same role = same color (e.g., all SKILL.md boxes are pink)
- Regions use semi-transparent backgrounds for grouping (opacity 0.6–0.85)
- Text color = darkened version of box fill

## Margin Checklist

After each version, verify:

- Canvas edges: 15-20px padding all sides
- Region internal padding: 12-16px top/bottom, 14-20px left/right
- Box spacing: uniform within rows (use SK_GAP variable)
- Canvas bottom: last element + 15-20px = canvas height

## Canvas Size Guide

| Complexity | Size | Example |
|-----------|------|---------|
| Simple (3-5 boxes) | 600-800 × 200-300 | Single flow |
| Medium (6-15 boxes) | 800-1200 × 300-500 | Architecture overview |
| Complex (15+ boxes) | 1200-1600 × 500-800 | Detailed system structure |

Use these as starting estimates, then derive final size from content (see above).
