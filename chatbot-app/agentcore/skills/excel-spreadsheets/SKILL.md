---
name: excel-spreadsheets
description: Create, modify, and manage Excel spreadsheets with openpyxl via Bedrock Code Interpreter.
---

# Excel Spreadsheets

## When to Use

| Tool | Use When |
|------|----------|
| `create_excel_spreadsheet` | User asks to create/generate a NEW spreadsheet |
| `modify_excel_spreadsheet` | User asks to edit/update an EXISTING spreadsheet |
| `list_my_excel_spreadsheets` | User asks what spreadsheets are available |
| `read_excel_spreadsheet` | User wants to download or read spreadsheet contents |
| `preview_excel_sheets` | Check actual sheet appearance when editing |

## Workflow

1. Before modifying: call `preview_excel_sheets` to check current layout.
2. After creation/modification: call `preview_excel_sheets` to verify.
3. Run tools **sequentially** (never parallel) to prevent file race conditions.

## Professional Formatting

- **Font**: Arial for all cells unless an existing template specifies otherwise.
- **Negative numbers**: parentheses format `(1,234)` — not minus `-1,234`.
- **Currency**: `$#,##0` format. Specify units in headers (e.g., "Revenue ($mm)").
- **Percentages**: `0.0%` (one decimal place).
- **Years**: format as text (`"2024"` not `"2,024"`).
- **Zeros**: display as `"-"` using a custom number format.

```python
# Example: professional number formatting
from openpyxl.styles import numbers
ws['B2'].number_format = '$#,##0'          # Currency
ws['C2'].number_format = '0.0%'            # Percentage
ws['D2'].number_format = '#,##0;(#,##0)'   # Negative in parentheses
ws['E2'].number_format = '@'               # Year as text
ws['F2'].number_format = '#,##0;(#,##0);"-"'  # Zeros as dash
```

## Financial Model Color Coding

When building financial models, apply these conventions:

| Color | Hex | Usage |
|-------|-----|-------|
| Blue text | `0000FF` | Hardcoded inputs and assumptions |
| Black text | `000000` | All formulas and calculations |
| Green text | `008000` | Links pulling from other worksheets |
| Yellow background | `FFFF00` | Key assumptions needing attention |

```python
from openpyxl.styles import Font, PatternFill
ws['B2'].font = Font(name='Arial', color='0000FF')       # Blue: input
ws['B3'].font = Font(name='Arial', color='000000')       # Black: formula
ws['B4'].font = Font(name='Arial', color='008000')       # Green: cross-sheet link
ws['B5'].fill = PatternFill('solid', fgColor='FFFF00')   # Yellow bg: key assumption
```

## Images

```python
from openpyxl.drawing.image import Image
ws.add_image(Image('file.png'), 'E1')
```

## Code Rules

- Workbook is pre-initialized as `wb = Workbook()`, active sheet as `ws = wb.active` (create), or loaded as `wb` (modify). Do NOT include `Workbook()` or `wb.save()`.
- Available libraries: openpyxl, matplotlib, pandas, numpy (seaborn NOT available)
- ALWAYS use Excel formulas, NEVER hardcode calculated values.
  - Wrong: `ws['B10'] = total`
  - Right: `ws['B10'] = '=SUM(B2:B9)'`
- Place assumptions in separate cells, reference them in formulas (e.g., `=B5*(1+$B$6)` not `=B5*1.05`).
- Avoid circular references.
- Filenames: letters, numbers, hyphens only.

---

## Tool Reference

### create_excel_spreadsheet
Create a new Excel spreadsheet using openpyxl code.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `python_code` | str | Yes | Python code using openpyxl (see Code Rules above) |
| `spreadsheet_name` | str | Yes | Filename without extension (letters, numbers, hyphens only) |

Example tool_input:
```json
{
  "python_code": "ws.title = 'Sales'\nws['A1'] = 'Quarter'\nws['B1'] = 'Revenue'\nfor i, (q, r) in enumerate(zip(['Q1','Q2','Q3','Q4'], [100,150,130,180]), start=2):\n    ws[f'A{i}'] = q\n    ws[f'B{i}'] = r",
  "spreadsheet_name": "quarterly-sales"
}
```

**WARNING**: Parameter is `spreadsheet_name`, NOT `filename` or `name`.

### modify_excel_spreadsheet
Modify an existing spreadsheet and save with a new name.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `source_name` | str | Yes | Existing spreadsheet name (without .xlsx) |
| `output_name` | str | Yes | New output name (MUST differ from source) |
| `python_code` | str | Yes | Python code to modify the spreadsheet |

Example tool_input:
```json
{
  "source_name": "quarterly-sales",
  "output_name": "quarterly-sales-v2",
  "python_code": "ws = wb.active\nws['B6'] = '=SUM(B2:B5)'"
}
```

### list_my_excel_spreadsheets
List all spreadsheets in workspace. No parameters needed.

### read_excel_spreadsheet
Retrieve a specific spreadsheet for download.

| Parameter | Type | Required |
|-----------|------|----------|
| `spreadsheet_name` | str | Yes |

### preview_excel_sheets
Get sheet screenshots for visual inspection before editing.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `spreadsheet_name` | str | Yes | Spreadsheet name without extension |
| `sheet_names` | list[str] | Yes | Sheet names to preview (empty list `[]` for all sheets) |
