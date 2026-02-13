# Notion Block Types Reference

JSON examples for each block type used with `notion_append_blocks`.

## paragraph

```json
{
  "type": "paragraph",
  "paragraph": {
    "rich_text": [{"type": "text", "text": {"content": "Regular paragraph text."}}]
  }
}
```

## heading_1 / heading_2 / heading_3

```json
{
  "type": "heading_1",
  "heading_1": {
    "rich_text": [{"type": "text", "text": {"content": "Section Title"}}]
  }
}
```

Replace `heading_1` with `heading_2` or `heading_3` for smaller headings.

## bulleted_list_item

```json
{
  "type": "bulleted_list_item",
  "bulleted_list_item": {
    "rich_text": [{"type": "text", "text": {"content": "Bullet point text"}}]
  }
}
```

## numbered_list_item

```json
{
  "type": "numbered_list_item",
  "numbered_list_item": {
    "rich_text": [{"type": "text", "text": {"content": "Numbered item text"}}]
  }
}
```

## to_do

```json
{
  "type": "to_do",
  "to_do": {
    "rich_text": [{"type": "text", "text": {"content": "Task description"}}],
    "checked": false
  }
}
```

## toggle

```json
{
  "type": "toggle",
  "toggle": {
    "rich_text": [{"type": "text", "text": {"content": "Toggle header (click to expand)"}}]
  }
}
```

## code

```json
{
  "type": "code",
  "code": {
    "rich_text": [{"type": "text", "text": {"content": "print('hello world')"}}],
    "language": "python"
  }
}
```

Supported languages include: `python`, `javascript`, `java`, `go`, `rust`, `sql`, `bash`, `json`, `yaml`, `markdown`, and many more.

## quote

```json
{
  "type": "quote",
  "quote": {
    "rich_text": [{"type": "text", "text": {"content": "Quoted text goes here."}}]
  }
}
```

## divider

```json
{
  "type": "divider",
  "divider": {}
}
```

## Rich Text with Formatting

Add annotations for bold, italic, strikethrough, underline, code, and color:

```json
{
  "type": "text",
  "text": {"content": "Bold and italic text"},
  "annotations": {
    "bold": true,
    "italic": true,
    "strikethrough": false,
    "underline": false,
    "code": false,
    "color": "default"
  }
}
```

## Rich Text with Link

```json
{
  "type": "text",
  "text": {
    "content": "Click here",
    "link": {"url": "https://example.com"}
  }
}
```
