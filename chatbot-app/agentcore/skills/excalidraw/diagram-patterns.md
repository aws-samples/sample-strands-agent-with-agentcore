# Complex Diagram Patterns

Concrete element patterns for Swimlane, Class, Sequence, ER, and DFD diagrams.
All examples use the actual `create_excalidraw_diagram` tool API (`label`, `fixedPoint`, `cameraUpdate`).

---

## Swimlane (Business Flow)

Vertical lanes per actor. Process boxes live inside lanes. Arrows connect process boxes including cross-lane handoffs.

**Camera**: L (800 × 600) for 2 lanes; XL (1200 × 900) for 3+ lanes.
**Lane width**: 220px. **Lane gap**: 20px. **Lane starts**: x=60 for lane 1, +240 per lane.

### Structure
- Lane background: `rectangle` with zone fill color and `opacity: 35` (full lane height)
- Lane header: `rectangle` (top 50px) with actor name via `label`
- Process box: `rectangle` with `roundness: { type: 3 }` and `label`
- Within-lane arrow: vertical (`fixedPoint: [0.5, 1]` → `[0.5, 0]`)
- Cross-lane arrow: horizontal (`fixedPoint: [1, 0.5]` → `[0, 0.5]`)

### Lane Colors
| Lane | Background zone | Header fill |
|------|----------------|-------------|
| 1 | `#dbe4ff` | `#a5d8ff` |
| 2 | `#e5dbff` | `#d0bfff` |
| 3 | `#d3f9d8` | `#b2f2bb` |

### Skeleton (2 lanes, 2 processes)
```json
[
  { "type": "cameraUpdate", "width": 800, "height": 600, "x": 0, "y": 0 },
  { "type": "text", "id": "title", "x": 60, "y": 14,
    "text": "Process Name", "fontSize": 22, "textAlign": "left", "verticalAlign": "top" },

  // Lane 1 (x: 60–279)
  { "type": "rectangle", "id": "ln1-bg", "x": 60, "y": 50, "width": 220, "height": 490,
    "backgroundColor": "#dbe4ff", "fillStyle": "solid", "opacity": 35 },
  { "type": "rectangle", "id": "ln1-hdr", "x": 60, "y": 50, "width": 220, "height": 50,
    "strokeColor": "#4a9eed", "backgroundColor": "#a5d8ff", "fillStyle": "solid",
    "label": { "text": "Actor 1", "fontSize": 18 } },
  { "type": "rectangle", "id": "p1", "x": 90, "y": 150, "width": 160, "height": 60,
    "strokeColor": "#22c55e", "backgroundColor": "#b2f2bb", "fillStyle": "solid",
    "roundness": { "type": 3 }, "label": { "text": "Step 1", "fontSize": 16 } },

  // Lane 2 (x: 300–519)
  { "type": "rectangle", "id": "ln2-bg", "x": 300, "y": 50, "width": 220, "height": 490,
    "backgroundColor": "#e5dbff", "fillStyle": "solid", "opacity": 35 },
  { "type": "rectangle", "id": "ln2-hdr", "x": 300, "y": 50, "width": 220, "height": 50,
    "strokeColor": "#8b5cf6", "backgroundColor": "#d0bfff", "fillStyle": "solid",
    "label": { "text": "Actor 2", "fontSize": 18 } },
  { "type": "rectangle", "id": "p2", "x": 330, "y": 150, "width": 160, "height": 60,
    "strokeColor": "#f59e0b", "backgroundColor": "#ffd8a8", "fillStyle": "solid",
    "roundness": { "type": 3 }, "label": { "text": "Step 2", "fontSize": 16 } },

  // Cross-lane arrow: p1 → p2
  { "type": "arrow", "id": "a1", "x": 250, "y": 180, "width": 80, "height": 0,
    "points": [[0, 0], [80, 0]], "endArrowhead": "arrow",
    "startBinding": { "elementId": "p1", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "p2", "fixedPoint": [0, 0.5] } }
]
```

**Scaling**: each additional lane shifts x by 240px (220 width + 20 gap). Extend lane background height to fit all process boxes.

---

## Class Diagram

One rectangle per class containing a title text, separator lines, and text blocks for attributes and methods.

**Camera**: L (800 × 600) for 2–3 classes; XL (1200 × 900) for 4+.
**Class width**: 220px. **Spacing between classes**: 80–120px.

### Structure
- Outer container: `rectangle` (no label — background only)
- Class name: standalone `text`, centered, `fontSize: 20`
- Horizontal separator: `line` element spanning full class width
- Attributes block: `text` with `\n`, `fontSize: 15`, left-aligned, 8px left padding
- Methods block: `text` with `\n`, `fontSize: 15`, left-aligned, 8px left padding

### Height Calculation
```
box height = 32 (name) + 2 (sep) + attr_count × 22 + 2 (sep) + method_count × 22 + 16 (padding)
```

### Relationship Types
| Relationship | Arrow style |
|---|---|
| Inheritance (extends) | `endArrowhead: "triangle"`, solid, pointing to parent |
| Implementation | `endArrowhead: "triangle"`, `strokeStyle: "dashed"` |
| Association | `endArrowhead: "arrow"`, solid |
| Dependency | `endArrowhead: "arrow"`, `strokeStyle: "dashed"` |
| Aggregation | `endArrowhead: "dot"`, pointing to the whole |

### Skeleton (2 classes with inheritance)
```json
[
  { "type": "cameraUpdate", "width": 800, "height": 450, "x": 0, "y": 0 },

  // Parent class
  { "type": "rectangle", "id": "cls1", "x": 60, "y": 80, "width": 220, "height": 198,
    "strokeColor": "#1e1e1e", "backgroundColor": "#fff3bf", "fillStyle": "solid" },
  { "type": "text", "id": "cls1-nm", "x": 60, "y": 90, "width": 220, "height": 28,
    "text": "Animal", "fontSize": 20, "textAlign": "center", "verticalAlign": "top" },
  { "type": "line", "id": "cls1-s1", "x": 60, "y": 122, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "cls1-at", "x": 68, "y": 130, "width": 205, "height": 66,
    "text": "- name: string\n- age: number\n- species: string", "fontSize": 15,
    "textAlign": "left", "verticalAlign": "top" },
  { "type": "line", "id": "cls1-s2", "x": 60, "y": 200, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "cls1-mt", "x": 68, "y": 208, "width": 205, "height": 66,
    "text": "+ speak(): void\n+ move(): void\n+ eat(): void", "fontSize": 15,
    "textAlign": "left", "verticalAlign": "top" },

  // Child class
  { "type": "rectangle", "id": "cls2", "x": 400, "y": 80, "width": 220, "height": 154,
    "strokeColor": "#1e1e1e", "backgroundColor": "#d0bfff", "fillStyle": "solid" },
  { "type": "text", "id": "cls2-nm", "x": 400, "y": 90, "width": 220, "height": 28,
    "text": "Dog", "fontSize": 20, "textAlign": "center", "verticalAlign": "top" },
  { "type": "line", "id": "cls2-s1", "x": 400, "y": 122, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "cls2-at", "x": 408, "y": 130, "width": 205, "height": 44,
    "text": "- breed: string\n- isVaccinated: bool", "fontSize": 15,
    "textAlign": "left", "verticalAlign": "top" },
  { "type": "line", "id": "cls2-s2", "x": 400, "y": 178, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "cls2-mt", "x": 408, "y": 186, "width": 205, "height": 44,
    "text": "+ bark(): void\n+ fetch(): void", "fontSize": 15,
    "textAlign": "left", "verticalAlign": "top" },

  // Inheritance arrow: Dog → Animal (triangle at parent end)
  { "type": "arrow", "id": "inh1", "x": 280, "y": 179, "width": 120, "height": 0,
    "points": [[0, 0], [120, 0]], "endArrowhead": "triangle",
    "startBinding": { "elementId": "cls2", "fixedPoint": [0, 0.5] },
    "endBinding": { "elementId": "cls1", "fixedPoint": [1, 0.5] } }
]
```

---

## Sequence Diagram

Objects across the top, vertical dashed lifelines below each, horizontal arrows for messages.

**Camera**: L (800 × 600) for 3 objects + 4 messages; XL (1200 × 900) for more.
**Object spacing**: 250px center-to-center. **Message interval**: 70–80px vertically.

### Structure
- Object: `rectangle` at top (y=50), width=160. Lifeline x = object x + width/2
- Lifeline: `line` (vertical, dashed, `strokeColor: "#999999"`) from object bottom to diagram bottom
- Message: `arrow` (horizontal) with `label` for the call name — use `startBinding: null, endBinding: null`
- Return: `arrow` reversed (`points: [[width, 0], [0, 0]]`), `strokeStyle: "dashed"`
- Activation box: narrow `rectangle` (width=10) centered on lifeline during active period (optional)

### Skeleton (2 objects, 1 request + 1 return)
```json
[
  { "type": "cameraUpdate", "width": 800, "height": 500, "x": 0, "y": 0 },

  // Objects
  { "type": "rectangle", "id": "obj1", "x": 60, "y": 50, "width": 160, "height": 50,
    "strokeColor": "#4a9eed", "backgroundColor": "#a5d8ff", "fillStyle": "solid",
    "roundness": { "type": 3 }, "label": { "text": "Client", "fontSize": 18 } },
  { "type": "rectangle", "id": "obj2", "x": 360, "y": 50, "width": 160, "height": 50,
    "strokeColor": "#8b5cf6", "backgroundColor": "#d0bfff", "fillStyle": "solid",
    "roundness": { "type": 3 }, "label": { "text": "Server", "fontSize": 18 } },

  // Lifelines (x = obj_x + 80)
  { "type": "line", "id": "lf1", "x": 140, "y": 100, "width": 0, "height": 360,
    "points": [[0, 0], [0, 360]], "strokeStyle": "dashed", "strokeColor": "#999999" },
  { "type": "line", "id": "lf2", "x": 440, "y": 100, "width": 0, "height": 360,
    "points": [[0, 0], [0, 360]], "strokeStyle": "dashed", "strokeColor": "#999999" },

  // Message 1: Client → Server (synchronous)
  { "type": "arrow", "id": "msg1", "x": 140, "y": 180, "width": 300, "height": 0,
    "points": [[0, 0], [300, 0]], "endArrowhead": "arrow",
    "startBinding": null, "endBinding": null,
    "label": { "text": "1: request(data)", "fontSize": 14 } },

  // Return: Server → Client (dashed, reversed direction)
  { "type": "arrow", "id": "ret1", "x": 140, "y": 280, "width": 300, "height": 0,
    "points": [[300, 0], [0, 0]], "endArrowhead": "arrow", "strokeStyle": "dashed",
    "startBinding": null, "endBinding": null,
    "label": { "text": "2: response(result)", "fontSize": 14 } }
]
```

**Return arrows**: set `points: [[width, 0], [0, 0]]` — the bounding box x stays at the leftmost point, but points start from the right end.

---

## ER Diagram

Entity boxes with separator lines and attribute text. Relationship lines with cardinality labels.

**Camera**: L (800 × 600) for 3 entities; XL (1200 × 900) for 4+.
**Entity width**: 220px. **Horizontal spacing**: 140–180px between entities.

### Structure
- Entity: `rectangle` (no label) + `text` for entity name + `line` separator + `text` for attributes
- Relationship: `line` (not arrow) connecting entity boxes
- Cardinality: small `text` elements (`"1"`, `"N"`, `"M"`) placed 10–15px from entity edge
- Relationship label: `text` near the line midpoint

### Attribute Notation
```
PK  field_name: type    ← primary key
FK  field_name: type    ← foreign key
    field_name: type    ← regular attribute
```

### Skeleton (2 entities, 1:N relationship)
```json
[
  { "type": "cameraUpdate", "width": 800, "height": 420, "x": 0, "y": 0 },

  // Entity 1: User
  { "type": "rectangle", "id": "ent1", "x": 60, "y": 80, "width": 220, "height": 164,
    "strokeColor": "#1e1e1e", "backgroundColor": "#c3fae8", "fillStyle": "solid" },
  { "type": "text", "id": "ent1-nm", "x": 60, "y": 90, "width": 220, "height": 28,
    "text": "User", "fontSize": 20, "textAlign": "center", "verticalAlign": "top" },
  { "type": "line", "id": "ent1-sep", "x": 60, "y": 122, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "ent1-at", "x": 68, "y": 130, "width": 205, "height": 110,
    "text": "PK  user_id: int\n     name: string\n     email: string\n     created_at: datetime",
    "fontSize": 15, "textAlign": "left", "verticalAlign": "top" },

  // Entity 2: Order
  { "type": "rectangle", "id": "ent2", "x": 440, "y": 80, "width": 220, "height": 164,
    "strokeColor": "#1e1e1e", "backgroundColor": "#c3fae8", "fillStyle": "solid" },
  { "type": "text", "id": "ent2-nm", "x": 440, "y": 90, "width": 220, "height": 28,
    "text": "Order", "fontSize": 20, "textAlign": "center", "verticalAlign": "top" },
  { "type": "line", "id": "ent2-sep", "x": 440, "y": 122, "width": 220, "height": 0,
    "points": [[0, 0], [220, 0]] },
  { "type": "text", "id": "ent2-at", "x": 448, "y": 130, "width": 205, "height": 110,
    "text": "PK  order_id: int\nFK  user_id: int\n     total: decimal\n     status: string",
    "fontSize": 15, "textAlign": "left", "verticalAlign": "top" },

  // Relationship line (ent1 right edge → ent2 left edge, at vertical midpoint)
  { "type": "line", "id": "rel1", "x": 280, "y": 162, "width": 160, "height": 0,
    "points": [[0, 0], [160, 0]] },

  // Cardinality labels
  { "type": "text", "id": "card1", "x": 288, "y": 144, "width": 20, "height": 20,
    "text": "1", "fontSize": 16, "textAlign": "left", "verticalAlign": "top" },
  { "type": "text", "id": "card2", "x": 418, "y": 144, "width": 20, "height": 20,
    "text": "N", "fontSize": 16, "textAlign": "left", "verticalAlign": "top" },

  // Relationship label
  { "type": "text", "id": "rel1-lbl", "x": 326, "y": 170, "width": 68, "height": 20,
    "text": "places", "fontSize": 14, "textAlign": "center", "verticalAlign": "top" }
]
```

---

## Data Flow Diagram (DFD)

Shows data movement between external entities, processes, and data stores. Does not show process order — only data flow direction.

**Camera**: L (800 × 600) for simple DFD; XL (1200 × 900) for complex.

### Structure
- External entity: `rectangle` — data source or destination outside the system
- Process: `ellipse` — data transformation inside the system
- Data store: `rectangle` + bottom `line` (open-bottom notation, or use distinct color)
- Data flow: `arrow` with `label` describing the data being transferred

### Color Conventions
| Element | Fill |
|---------|------|
| External entity | `#ffd8a8` (light orange) |
| Process | `#d0bfff` (light purple) |
| Data store | `#c3fae8` (light teal) |

### Layout Guidelines
- External entities at the outer edges (left/right or top/bottom)
- Processes in the center of the diagram
- Data stores close to the processes that use them
- Arrows flow left-to-right or top-to-bottom where possible

### Skeleton (entity → process → store, with return flow)
```json
[
  { "type": "cameraUpdate", "width": 1000, "height": 400, "x": 0, "y": 0 },

  // External entity (left)
  { "type": "rectangle", "id": "ext1", "x": 60, "y": 155, "width": 140, "height": 60,
    "strokeColor": "#f59e0b", "backgroundColor": "#ffd8a8", "fillStyle": "solid",
    "label": { "text": "User", "fontSize": 18 } },

  // Process (center)
  { "type": "ellipse", "id": "proc1", "x": 310, "y": 140, "width": 180, "height": 80,
    "strokeColor": "#8b5cf6", "backgroundColor": "#d0bfff", "fillStyle": "solid",
    "label": { "text": "Process\nRequest", "fontSize": 16 } },

  // Data store (right)
  { "type": "rectangle", "id": "store1", "x": 620, "y": 155, "width": 160, "height": 60,
    "strokeColor": "#06b6d4", "backgroundColor": "#c3fae8", "fillStyle": "solid",
    "label": { "text": "Database", "fontSize": 18 } },
  { "type": "line", "id": "store1-line", "x": 620, "y": 215, "width": 160, "height": 0,
    "points": [[0, 0], [160, 0]], "strokeColor": "#06b6d4" },

  // Data flows
  { "type": "arrow", "id": "df1", "x": 200, "y": 185, "width": 110, "height": 0,
    "points": [[0, 0], [110, 0]], "endArrowhead": "arrow",
    "startBinding": { "elementId": "ext1", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "proc1", "fixedPoint": [0, 0.5] },
    "label": { "text": "input data", "fontSize": 13 } },
  { "type": "arrow", "id": "df2", "x": 490, "y": 185, "width": 130, "height": 0,
    "points": [[0, 0], [130, 0]], "endArrowhead": "arrow",
    "startBinding": { "elementId": "proc1", "fixedPoint": [1, 0.5] },
    "endBinding": { "elementId": "store1", "fixedPoint": [0, 0.5] },
    "label": { "text": "save record", "fontSize": 13 } },

  // Return flow: store → process (below, to avoid overlap)
  { "type": "arrow", "id": "df3", "x": 490, "y": 230, "width": 130, "height": 0,
    "points": [[130, 0], [0, 0]], "endArrowhead": "arrow", "strokeStyle": "dashed",
    "startBinding": { "elementId": "store1", "fixedPoint": [0, 0.8] },
    "endBinding": { "elementId": "proc1", "fixedPoint": [1, 0.8] },
    "label": { "text": "query result", "fontSize": 13 } }
]
```
