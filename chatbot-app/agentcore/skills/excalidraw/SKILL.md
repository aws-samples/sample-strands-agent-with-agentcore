---
name: excalidraw
description: Create hand-drawn style diagrams and flowcharts using Excalidraw
type: tool
---

# Excalidraw Diagrams

Create hand-drawn style diagrams, flowcharts, architecture diagrams, and mind maps using the Excalidraw format. Diagrams are rendered interactively in the Canvas panel.

## When to Use This Skill

Use `create_excalidraw_diagram` when the user wants to visualize **structure, flow, or relationships** — not raw numbers.

| Use this skill for... | Use visualization skill for... |
|-----------------------|--------------------------------|
| System architecture diagram | Sales figures by quarter |
| Flowchart or decision tree | Survey response percentages |
| Sequence / interaction diagram | Stock price over time |
| Mind map or concept map | Market share breakdown |
| Shapes, boxes, arrows, labels | Any x/y or segment/value data |

## Available Tools

- **create_excalidraw_diagram(elements, title, background_color)**: Generate a diagram from Excalidraw element JSON

## Color Palette

Use these colors consistently across all diagrams.

### Primary Colors (strokes, arrows, text)
| Name | Hex | Use |
|------|-----|-----|
| Blue | `#4a9eed` | Primary actions, links |
| Amber | `#f59e0b` | Warnings, highlights |
| Green | `#22c55e` | Success, positive |
| Red | `#ef4444` | Errors, negative |
| Purple | `#8b5cf6` | Accents, special items |
| Cyan | `#06b6d4` | Info, secondary |

### Fill Colors (shape backgrounds)
| Color | Hex | Good For |
|-------|-----|----------|
| Light Blue | `#a5d8ff` | Input, sources, primary nodes |
| Light Green | `#b2f2bb` | Success, output, completed |
| Light Orange | `#ffd8a8` | Warning, pending, external |
| Light Purple | `#d0bfff` | Processing, middleware |
| Light Red | `#ffc9c9` | Error, critical |
| Light Yellow | `#fff3bf` | Notes, decisions |
| Light Teal | `#c3fae8` | Storage, data |

### Background Zone Colors (use with `opacity: 35` for layer grouping)
| Color | Hex | Good For |
|-------|-----|----------|
| Blue zone | `#dbe4ff` | UI / frontend layer |
| Purple zone | `#e5dbff` | Logic / agent layer |
| Green zone | `#d3f9d8` | Data / tool layer |

## Element Format

### Required Fields (all elements)
`type`, `id` (unique string), `x`, `y`, `width`, `height`

### Defaults (skip if using these values)
`strokeColor="#1e1e1e"`, `backgroundColor="transparent"`, `fillStyle="solid"`, `strokeWidth=2`, `roughness=1`, `opacity=100`

### Shape Types

**Rectangle**
```json
{ "type": "rectangle", "id": "r1", "x": 100, "y": 100, "width": 200, "height": 80,
  "roundness": { "type": 3 }, "backgroundColor": "#a5d8ff", "fillStyle": "solid" }
```
- `roundness: { type: 3 }` for rounded corners

**Ellipse**
```json
{ "type": "ellipse", "id": "e1", "x": 100, "y": 100, "width": 150, "height": 150 }
```

**Diamond**
```json
{ "type": "diamond", "id": "d1", "x": 100, "y": 100, "width": 150, "height": 150 }
```

**Label on shape (PREFERRED — no separate text element needed)**
```json
{ "type": "rectangle", "id": "r1", "x": 100, "y": 100, "width": 200, "height": 80,
  "label": { "text": "My Label", "fontSize": 20 } }
```
- Works on rectangle, ellipse, diamond
- Text auto-centers; container auto-resizes to fit
- Also works on arrows: `"label": { "text": "connects" }`

**Standalone Text** (titles, annotations only)
```json
{ "type": "text", "id": "t1", "x": 150, "y": 50, "text": "Title", "fontSize": 24 }
```
- `x` is the LEFT edge. To center at position `cx`: set `x = cx - text.length × fontSize × 0.25`

**Arrow**
```json
{ "type": "arrow", "id": "a1", "x": 300, "y": 150, "width": 150, "height": 0,
  "points": [[0,0],[150,0]], "endArrowhead": "arrow",
  "startBinding": { "elementId": "r1", "fixedPoint": [1, 0.5] },
  "endBinding": { "elementId": "r2", "fixedPoint": [0, 0.5] } }
```
- `points`: `[dx, dy]` offsets from element `x, y`
- `endArrowhead`: `null` | `"arrow"` | `"bar"` | `"dot"` | `"triangle"`
- `strokeStyle`: `"solid"` | `"dashed"` | `"dotted"`
- `fixedPoint` for bindings: top `[0.5,0]`, bottom `[0.5,1]`, left `[0,0.5]`, right `[1,0.5]`

### Pseudo-Elements (not drawn — control behavior)

**cameraUpdate** — sets the viewport
```json
{ "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 }
```
- `x, y`: top-left corner of visible area (scene coordinates)
- **Must be 4:3 ratio**: 400×300, 600×450, 800×600, 1200×900, 1600×1200
- ALWAYS place a `cameraUpdate` as the **first element** to frame the diagram
- No `id` needed

**delete** — removes elements by ID
```json
{ "type": "delete", "ids": "r1,a1,t2" }
```
- Comma-separated element IDs to remove
- Use when updating an existing diagram to remove elements before adding replacements
- Never reuse a deleted ID — assign new IDs to replacements

## Camera Sizing Guide

The diagram displays at ~700px width. Use these standard sizes:

| Size | Width × Height | Use When |
|------|---------------|----------|
| S | 400 × 300 | 2–3 elements, close-up |
| M | 600 × 450 | Small diagram section |
| **L** | **800 × 600** | **Standard (default)** |
| XL | 1200 × 900 | Large overview |
| XXL | 1600 × 1200 | Very complex diagrams |

**Font size rules:**
- Body text / labels: **minimum 16**
- Titles / headings: **minimum 20**
- Annotations: minimum 14 (use sparingly)
- At XL/XXL camera: increase minimums by ~4px

**Element sizing rules:**
- Labeled rectangles/ellipses: minimum 120 × 60
- Leave 20–30px gaps between elements

## Updating an Existing Diagram

When the user asks to modify a diagram, you will receive the current elements in context. Respond with the complete updated elements array:
- Keep the same `id` for unchanged elements
- Modify fields on elements you want to change
- Omit elements you want to remove
- Add new elements with unique IDs not used before

## Example: Flowchart

```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },
  { "type": "rectangle", "id": "el-1",
    "x": 300, "y": 60, "width": 160, "height": 60,
    "strokeColor": "#4a9eed", "backgroundColor": "#a5d8ff",
    "fillStyle": "solid", "roundness": { "type": 3 },
    "label": { "text": "Start", "fontSize": 18 } },
  { "type": "diamond", "id": "el-2",
    "x": 280, "y": 170, "width": 200, "height": 90,
    "strokeColor": "#f59e0b", "backgroundColor": "#fff3bf",
    "fillStyle": "solid",
    "label": { "text": "Decision?", "fontSize": 16 } },
  { "type": "arrow", "id": "el-3",
    "x": 380, "y": 120, "width": 0, "height": 50,
    "points": [[0,0],[0,50]], "endArrowhead": "arrow",
    "startBinding": { "elementId": "el-1", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "el-2", "fixedPoint": [0.5, 0] } },
  { "type": "rectangle", "id": "el-4",
    "x": 300, "y": 320, "width": 160, "height": 60,
    "strokeColor": "#22c55e", "backgroundColor": "#b2f2bb",
    "fillStyle": "solid", "roundness": { "type": 3 },
    "label": { "text": "End", "fontSize": 18 } },
  { "type": "arrow", "id": "el-5",
    "x": 380, "y": 260, "width": 0, "height": 60,
    "points": [[0,0],[0,60]], "endArrowhead": "arrow",
    "startBinding": { "elementId": "el-2", "fixedPoint": [0.5, 1] },
    "endBinding": { "elementId": "el-4", "fixedPoint": [0.5, 0] } }
]
```

## Common Mistakes to Avoid

- **Camera must use exact 4:3 ratios** — non-4:3 viewports cause distortion
- **Always start with cameraUpdate** — without it the viewport is unpredictable
- **No comments in element arrays** — `elements` must be valid JSON. Never add `//` or `/* */` comments inside the array; they break JSON parsing
- **Text contrast** — never use light gray on white. Minimum text color on white: `#757575`. For text on light fills use dark variants (`#15803d` not `#22c55e`)
- **Arrow labels need space** — long labels overflow short arrows; keep labels short or widen arrows
- **No emoji** — Excalidraw's font does not render emoji
- **Element overlap** — check that labels, boxes, and zone overlays don't stack on each other (minimum 20px gap)
- **Camera padding** — leave padding inside the camera frame; don't match camera size exactly to content size
