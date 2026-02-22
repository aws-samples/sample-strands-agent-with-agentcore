# PowerPoint Design Guide

Visual patterns and detailed guidance for slide design. Load this when implementing slide visuals.

## Using Palettes in Code (PptxGenJS)

```javascript
// Example: Midnight Executive palette
// Colors are 6-digit hex WITHOUT '#'
const PRIMARY = "1E2761";
const ACCENT  = "FFFFFF";
const ICE     = "CADCFC";

let slide = pres.addSlide();

// Solid background
slide.background = { color: PRIMARY };

// Accent bar at bottom
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 7.1, w: 13.3, h: 0.4,
  fill: { color: ACCENT }, line: { color: ACCENT }
});

// Title text
slide.addText("Slide Title", {
  x: 0.6, y: 0.4, w: 10, h: 1.0,
  fontSize: 40, bold: true, color: ACCENT,
  fontFace: "Georgia", margin: 0
});
```

## Creating Lighter Tints

For data slides that need lighter backgrounds within the same palette:

```javascript
// Slightly lighter than Midnight Executive primary for data slide background
const LIGHT_BG = "2A3578";  // Tint of 1E2761

slide.background = { color: LIGHT_BG };
```

---

## Visual Element Patterns

### Accent bar (bottom)

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 7.1, w: 13.3, h: 0.4,
  fill: { color: ACCENT }, line: { color: ACCENT }
});
```

### Icon circle

```javascript
// ICE (secondary) fill + dark PRIMARY text = legible on any slide background
slide.addShape(pres.shapes.OVAL, {
  x: 1.0, y: 2.0, w: 1.2, h: 1.2,
  fill: { color: ICE }, line: { color: ICE }
});
slide.addText("★", {
  x: 1.0, y: 2.0, w: 1.2, h: 1.2,
  fontSize: 28, color: PRIMARY, align: "center", valign: "middle"
});
```

### Side stripe (left edge)

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 0, y: 0, w: 0.4, h: 7.5,
  fill: { color: ACCENT }, line: { color: ACCENT }
});
```

### Divider line

```javascript
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1, y: 3.0, w: 11.3, h: 0.02,
  fill: { color: ACCENT }, line: { color: ACCENT }
});
```

### Card with shadow

```javascript
const makeShadow = () => ({ type: "outer", color: "000000", blur: 8, offset: 3, angle: 135, opacity: 0.15 });
slide.addShape(pres.shapes.RECTANGLE, {
  x: 1.0, y: 1.5, w: 5.0, h: 2.5,
  fill: { color: "FFFFFF" },
  shadow: makeShadow()
});
```

> Always use a factory function for shadow objects — PptxGenJS mutates them in-place. See [pptxgenjs.md](pptxgenjs.md).

### Stat callout (large number)

```javascript
slide.addText("87%", {
  x: 1, y: 1.5, w: 4, h: 2,
  fontSize: 80, bold: true, color: ACCENT,
  align: "center", valign: "middle"
});
slide.addText("Customer Satisfaction", {
  x: 1, y: 3.5, w: 4, h: 0.5,
  fontSize: 14, color: ACCENT, align: "center"
});
```

