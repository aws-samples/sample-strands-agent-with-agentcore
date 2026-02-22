---
name: word-documents
description: Create, modify, and manage Word documents.
---

# Word Documents

## When to Use

| Tool | Use When |
|------|----------|
| `create_word_document` | User asks to create/generate a NEW Word document |
| `modify_word_document` | User asks to edit/update an EXISTING document or add content |
| `list_my_word_documents` | User asks what documents are available |
| `read_word_document` | User wants to download a document |
| `preview_word_page` | Check actual page appearance (charts, images, complex layouts) |

## Workflow

1. Before modifying: call `preview_word_page` to check current layout.
2. After creation/modification: call `preview_word_page` to verify.
3. Run tools **sequentially** (never parallel) to prevent file race conditions.

## Page Setup

python-docx defaults to A4. For US Letter size:

```python
from docx.shared import Inches
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
# Set 1-inch margins
section.top_margin = Inches(1)
section.bottom_margin = Inches(1)
section.left_margin = Inches(1)
section.right_margin = Inches(1)
```

## Professional Formatting

- **Font**: Arial as default. Set via `style.font.name = 'Arial'`.
- **Headings**: Use proper heading styles for TOC compatibility: `doc.add_heading('Title', level=1)` or `doc.add_paragraph(style='Heading 1')`.
- **Bullet lists**: `doc.add_paragraph(style='List Bullet')`. NEVER insert unicode bullet characters.
- **Numbered lists**: `doc.add_paragraph(style='List Number')`.
- Always preserve existing styles, fonts, and colors when modifying.

## Images

```python
from docx.shared import Inches
paragraph = doc.add_paragraph()
run = paragraph.add_run()
run.add_picture('file.png', width=Inches(6))
```

## Code Rules

- The document is pre-initialized as `doc = Document()` (create) or loaded as `doc` (modify). Do NOT include `Document()` or `doc.save()`.
- Available libraries: python-docx, matplotlib, pandas, numpy (seaborn NOT available)
- Use `add_paragraph(style='List Bullet')` for bullet lists. NEVER insert unicode bullet characters.
- NEVER use `paragraph.text = 'new text'` (destroys formatting). Use runs instead.
- Filenames: letters, numbers, hyphens only.

---

## Tool Reference

### create_word_document
Create a new Word document using python-docx code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `python_code` | str | Yes | Python code using python-docx (see Code Rules above) |
| `document_name` | str | Yes | Filename without extension (letters, numbers, hyphens only) |

Example tool_input:
```json
{
  "python_code": "doc.add_heading('Quarterly Report', 0)\ndoc.add_paragraph('This report summarizes Q4 performance.')\ndoc.add_heading('Revenue', level=1)\ndoc.add_paragraph('Total revenue: $1.2M')",
  "document_name": "quarterly-report"
}
```

**WARNING**: Parameter is `document_name`, NOT `filename` or `name`.

### modify_word_document
Modify an existing Word document and save with a new name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_name` | str | Yes | Existing document name (without .docx) |
| `output_name` | str | Yes | New output name (MUST differ from source) |
| `python_code` | str | Yes | Python code to modify the document |

Example tool_input:
```json
{
  "source_name": "quarterly-report",
  "output_name": "quarterly-report-v2",
  "python_code": "doc.add_paragraph('Additional notes added.')"
}
```

### list_my_word_documents
List all Word documents in workspace. No parameters needed.

### read_word_document
Retrieve a specific document for download.

| Parameter | Type | Required |
|-----------|------|----------|
| `document_name` | str | Yes |

### preview_word_page
Get page screenshots for visual inspection before editing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `document_name` | str | Yes | Document name without extension |
| `page_numbers` | list[int] | Yes | **1-based** page numbers to preview |
