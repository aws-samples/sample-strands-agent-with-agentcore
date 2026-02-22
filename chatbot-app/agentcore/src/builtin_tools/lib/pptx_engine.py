"""PPTX XML Engine

Direct XML manipulation for PowerPoint files.
Ported from pptx skill: scripts/office/unpack.py, pack.py, clean.py, add_slide.py

Usage:
    from .lib.pptx_engine import PptxEngine

    pptx_bytes = ppt_manager.load_from_s3("deck.pptx")
    with PptxEngine(pptx_bytes) as engine:
        engine.delete_slides([0])
        engine.move_slide(1, 0)
        result_bytes = engine.pack()
    ppt_manager.save_to_s3("deck-v2.pptx", result_bytes)
"""

import io
import logging
import re
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import defusedxml.minidom

logger = logging.getLogger(__name__)

EMU_PER_INCH = 914400

SMART_QUOTE_REPLACEMENTS = {
    "\u201c": "&#x201C;",
    "\u201d": "&#x201D;",
    "\u2018": "&#x2018;",
    "\u2019": "&#x2019;",
}

SHAPE_TAGS = {"p:sp", "p:pic", "p:graphicFrame", "p:grpSp", "p:cxnSp"}


class PptxEngine:
    """Context manager for PPTX XML operations.

    Unpacks the PPTX on enter, provides edit methods, repacks on pack().
    Temp directory is cleaned up on exit regardless of exceptions.
    """

    def __init__(self, pptx_bytes: bytes):
        self._bytes = pptx_bytes
        self._tmpdir: Optional[Path] = None

    def __enter__(self) -> "PptxEngine":
        self._tmpdir = Path(tempfile.mkdtemp(prefix="pptx_engine_"))
        self._unpack()
        return self

    def __exit__(self, *args):
        if self._tmpdir and self._tmpdir.exists():
            shutil.rmtree(self._tmpdir, ignore_errors=True)

    @property
    def dir(self) -> Path:
        return self._tmpdir

    # ── Unpack / Pack ─────────────────────────────────────────────────────────

    def _unpack(self):
        """Extract PPTX zip, pretty-print XML, escape smart quotes."""
        with zipfile.ZipFile(io.BytesIO(self._bytes), "r") as zf:
            zf.extractall(self._tmpdir)

        xml_files = (
            list(self._tmpdir.rglob("*.xml"))
            + list(self._tmpdir.rglob("*.rels"))
        )
        for f in xml_files:
            _pretty_print_xml(f)
            _escape_smart_quotes(f)

    def pack(self) -> bytes:
        """Clean orphaned files, condense XML, repack to bytes."""
        self.clean()
        buf = io.BytesIO()
        tmp = Path(tempfile.mkdtemp())
        try:
            content_dir = tmp / "c"
            shutil.copytree(self._tmpdir, content_dir)
            for pattern in ("*.xml", "*.rels"):
                for f in content_dir.rglob(pattern):
                    _condense_xml(f)
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in content_dir.rglob("*"):
                    if f.is_file():
                        zf.write(f, f.relative_to(content_dir))
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return buf.getvalue()

    # ── Slide order ───────────────────────────────────────────────────────────

    def get_slide_order(self) -> List[Dict[str, str]]:
        """Return ordered slides: [{'sld_id': '256', 'rid': 'rId1', 'filename': 'slide1.xml'}]"""
        pres_path = self._tmpdir / "ppt" / "presentation.xml"
        pres_rels_path = self._tmpdir / "ppt" / "_rels" / "presentation.xml.rels"

        rels_dom = defusedxml.minidom.parse(str(pres_rels_path))
        rid_to_file: Dict[str, str] = {}
        for rel in rels_dom.getElementsByTagName("Relationship"):
            rid = rel.getAttribute("Id")
            target = rel.getAttribute("Target")
            rel_type = rel.getAttribute("Type")
            if "slide" in rel_type and "Layout" not in rel_type and target.startswith("slides/"):
                rid_to_file[rid] = target.replace("slides/", "")

        pres_content = pres_path.read_text(encoding="utf-8")
        slide_ids = re.findall(r'<p:sldId\s+id="(\d+)"\s+r:id="([^"]+)"', pres_content)
        return [
            {"sld_id": sld_id, "rid": rid, "filename": rid_to_file[rid]}
            for sld_id, rid in slide_ids
            if rid in rid_to_file
        ]

    def _set_slide_order(self, ordered: List[Dict[str, str]]):
        """Rewrite presentation.xml sldIdLst."""
        pres_path = self._tmpdir / "ppt" / "presentation.xml"
        content = pres_path.read_text(encoding="utf-8")
        new_list = "".join(
            f'<p:sldId id="{s["sld_id"]}" r:id="{s["rid"]}"/>'
            for s in ordered
        )
        content = re.sub(
            r"<p:sldIdLst>.*?</p:sldIdLst>",
            f"<p:sldIdLst>{new_list}</p:sldIdLst>",
            content,
            flags=re.DOTALL,
        )
        pres_path.write_text(content, encoding="utf-8")

    # ── Layouts ───────────────────────────────────────────────────────────────

    def get_layouts(self) -> List[Dict[str, Any]]:
        """Return available layouts: [{'index': 0, 'name': 'Title Slide', 'filename': 'slideLayout1.xml'}]"""
        layouts_dir = self._tmpdir / "ppt" / "slideLayouts"
        result = []
        layout_files = sorted(
            layouts_dir.glob("slideLayout*.xml"),
            key=lambda f: int(re.search(r"\d+", f.name).group()),
        )
        for idx, layout_file in enumerate(layout_files):
            try:
                dom = defusedxml.minidom.parse(str(layout_file))
                csld = dom.getElementsByTagName("p:cSld")
                name = csld[0].getAttribute("name") if csld else layout_file.stem
                ph_count = len(dom.getElementsByTagName("p:ph"))
                result.append({"index": idx, "name": name, "filename": layout_file.name, "placeholder_count": ph_count})
            except Exception:
                result.append({"index": idx, "name": layout_file.stem, "filename": layout_file.name, "placeholder_count": 0})
        return result

    # ── Analyze ───────────────────────────────────────────────────────────────

    def analyze_slide(self, slide_filename: str, include_notes: bool = False) -> Dict[str, Any]:
        """Parse slide XML and return structured element info."""
        slide_path = self._tmpdir / "ppt" / "slides" / slide_filename
        dom = defusedxml.minidom.parse(str(slide_path))

        sp_tree_list = dom.getElementsByTagName("p:spTree")
        if not sp_tree_list:
            return {"elements": [], "title": None}

        elements = []
        idx = 0
        for child in sp_tree_list[0].childNodes:
            if child.nodeType != child.ELEMENT_NODE or child.tagName not in SHAPE_TAGS:
                continue
            elements.append(_parse_shape(child, idx))
            idx += 1

        title = next(
            (e["text"] for e in elements if e.get("role") == "TITLE" and e.get("text")),
            None,
        )
        result: Dict[str, Any] = {"elements": elements, "title": title}
        if include_notes:
            result["notes"] = self._get_slide_notes(slide_filename)
        return result

    def _get_slide_notes(self, slide_filename: str) -> str:
        rels_path = (
            self._tmpdir / "ppt" / "slides" / "_rels" / f"{slide_filename}.rels"
        )
        if not rels_path.exists():
            return ""
        rels_dom = defusedxml.minidom.parse(str(rels_path))
        for rel in rels_dom.getElementsByTagName("Relationship"):
            if "notesSlide" in rel.getAttribute("Type"):
                target = rel.getAttribute("Target")
                notes_path = (self._tmpdir / "ppt" / "slides" / target).resolve()
                if notes_path.exists():
                    notes_dom = defusedxml.minidom.parse(str(notes_path))
                    return _extract_text(notes_dom)
        return ""

    # ── Edit text ─────────────────────────────────────────────────────────────

    def set_text(self, slide_filename: str, element_id: int, text: str):
        """Replace all text in a shape, preserving formatting from the first paragraph."""
        slide_path = self._tmpdir / "ppt" / "slides" / slide_filename
        dom = defusedxml.minidom.parseString(slide_path.read_bytes())
        shape = _get_shape_by_id(dom, element_id)
        if shape is None:
            raise ValueError(f"element_id {element_id} not found in {slide_filename}")

        tx_body_list = shape.getElementsByTagName("p:txBody")
        if not tx_body_list:
            raise ValueError(f"Shape {element_id} has no text body")
        tx_body = tx_body_list[0]

        # Capture formatting from first paragraph/run
        existing_paras = [
            c for c in tx_body.childNodes
            if c.nodeType == c.ELEMENT_NODE and c.tagName == "a:p"
        ]
        template_ppr_xml = ""
        template_rpr_xml = ""
        if existing_paras:
            ppr = [c for c in existing_paras[0].childNodes
                   if c.nodeType == c.ELEMENT_NODE and c.tagName == "a:pPr"]
            if ppr:
                template_ppr_xml = ppr[0].toxml()
            runs = existing_paras[0].getElementsByTagName("a:r")
            if runs:
                rpr = runs[0].getElementsByTagName("a:rPr")
                if rpr:
                    template_rpr_xml = rpr[0].toxml()

        # Remove all existing <a:p>
        for p in list(c for c in tx_body.childNodes
                      if c.nodeType == c.ELEMENT_NODE and c.tagName == "a:p"):
            tx_body.removeChild(p)

        # Build new paragraphs (one per line)
        a_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
        for line in text.split("\n"):
            para_xml = (
                f'<a:p xmlns:a="{a_ns}">'
                f"{template_ppr_xml}"
                f"<a:r>{template_rpr_xml}<a:t>{_escape_xml(line)}</a:t></a:r>"
                f"</a:p>"
            )
            frag = defusedxml.minidom.parseString(para_xml)
            imported = dom.importNode(frag.getElementsByTagName("a:p")[0], True)
            tx_body.appendChild(imported)

        slide_path.write_bytes(dom.toxml(encoding="utf-8"))

    def replace_text(self, slide_filename: str, element_id: int, find: str, replace: str):
        """Find and replace text within a shape."""
        slide_path = self._tmpdir / "ppt" / "slides" / slide_filename
        dom = defusedxml.minidom.parseString(slide_path.read_bytes())
        shape = _get_shape_by_id(dom, element_id)
        if shape is None:
            raise ValueError(f"element_id {element_id} not found in {slide_filename}")

        for t_node in shape.getElementsByTagName("a:t"):
            if t_node.firstChild and t_node.firstChild.nodeValue:
                t_node.firstChild.nodeValue = t_node.firstChild.nodeValue.replace(find, replace)

        slide_path.write_bytes(dom.toxml(encoding="utf-8"))

    # ── Replace image ─────────────────────────────────────────────────────────

    def replace_image(self, slide_filename: str, element_id: int, image_bytes: bytes, image_ext: str = "png"):
        """Replace image in a picture shape with new image bytes."""
        slide_path = self._tmpdir / "ppt" / "slides" / slide_filename
        dom = defusedxml.minidom.parseString(slide_path.read_bytes())
        shape = _get_shape_by_id(dom, element_id)
        if shape is None:
            raise ValueError(f"element_id {element_id} not found in {slide_filename}")

        blip_list = shape.getElementsByTagName("a:blip")
        if not blip_list:
            raise ValueError(f"Shape {element_id} has no image blip")
        r_embed = blip_list[0].getAttribute("r:embed")
        if not r_embed:
            raise ValueError(f"Shape {element_id} blip has no r:embed attribute")

        rels_path = (
            self._tmpdir / "ppt" / "slides" / "_rels" / f"{slide_filename}.rels"
        )
        rels_content = rels_path.read_text(encoding="utf-8")
        match = re.search(
            rf'Id="{re.escape(r_embed)}"[^>]+Target="([^"]+)"', rels_content
        )
        if not match:
            match = re.search(
                rf'Target="([^"]+)"[^>]+Id="{re.escape(r_embed)}"', rels_content
            )
        if not match:
            raise ValueError(f"Relationship {r_embed} not found in .rels")

        rel_target = match.group(1)
        media_path = (self._tmpdir / "ppt" / "slides" / rel_target).resolve()
        old_ext = media_path.suffix.lstrip(".")

        if old_ext.lower() != image_ext.lower():
            new_rel_target = rel_target.replace(f".{old_ext}", f".{image_ext}")
            rels_content = rels_content.replace(rel_target, new_rel_target)
            rels_path.write_text(rels_content, encoding="utf-8")
            media_path = (self._tmpdir / "ppt" / "slides" / new_rel_target).resolve()

        media_path.parent.mkdir(parents=True, exist_ok=True)
        media_path.write_bytes(image_bytes)

    # ── Add / duplicate / delete / move ───────────────────────────────────────

    def add_slide(self, layout_name: str, position: int = -1) -> str:
        """Add a new slide from layout name. Returns new slide filename."""
        layouts = self.get_layouts()
        match = next((l for l in layouts if l["name"] == layout_name), None)
        if not match:
            available = [l["name"] for l in layouts]
            raise ValueError(f"Layout '{layout_name}' not found. Available: {available}")
        new_filename = self._create_slide_from_layout(match["filename"])
        self._insert_into_order(new_filename, position)
        return new_filename

    def duplicate_slide(self, slide_index: int, position: int = -1) -> str:
        """Duplicate a slide by 0-based index. Returns new slide filename."""
        order = self.get_slide_order()
        if not (0 <= slide_index < len(order)):
            raise ValueError(f"slide_index {slide_index} out of range (0-{len(order)-1})")
        source = order[slide_index]["filename"]
        new_filename = self._duplicate_slide_file(source)
        self._insert_into_order(new_filename, position)
        return new_filename

    def delete_slides(self, indices: List[int]):
        """Remove slides at given 0-based indices from presentation order."""
        order = self.get_slide_order()
        new_order = [s for i, s in enumerate(order) if i not in indices]
        self._set_slide_order(new_order)

    def move_slide(self, from_index: int, to_index: int):
        """Move a slide from one position to another (0-based)."""
        order = self.get_slide_order()
        if not (0 <= from_index < len(order)):
            raise ValueError(f"from_index {from_index} out of range")
        slide = order.pop(from_index)
        insert_at = to_index if to_index >= 0 else len(order)
        order.insert(insert_at, slide)
        self._set_slide_order(order)

    def _create_slide_from_layout(self, layout_file: str) -> str:
        slides_dir = self._tmpdir / "ppt" / "slides"
        rels_dir = slides_dir / "_rels"
        rels_dir.mkdir(exist_ok=True)

        next_num = _get_next_slide_number(slides_dir)
        dest = f"slide{next_num}.xml"

        slide_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"'
            ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
            ' xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">'
            "<p:cSld><p:spTree>"
            '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>'
            "<p:grpSpPr><a:xfrm>"
            '<a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
            '<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'
            "</a:xfrm></p:grpSpPr>"
            "</p:spTree></p:cSld>"
            "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>"
            "</p:sld>"
        )
        (slides_dir / dest).write_text(slide_xml, encoding="utf-8")

        rels_xml = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1"'
            f' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout"'
            f' Target="../slideLayouts/{layout_file}"/>'
            "</Relationships>"
        )
        (rels_dir / f"{dest}.rels").write_text(rels_xml, encoding="utf-8")

        _add_to_content_types(self._tmpdir, dest)
        _add_to_presentation_rels(self._tmpdir, dest)
        return dest

    def _duplicate_slide_file(self, source: str) -> str:
        slides_dir = self._tmpdir / "ppt" / "slides"
        rels_dir = slides_dir / "_rels"

        next_num = _get_next_slide_number(slides_dir)
        dest = f"slide{next_num}.xml"
        shutil.copy2(slides_dir / source, slides_dir / dest)

        src_rels = rels_dir / f"{source}.rels"
        if src_rels.exists():
            rels_content = src_rels.read_text(encoding="utf-8")
            # Remove notes slide reference from duplicate
            rels_content = re.sub(
                r'\s*<Relationship[^>]*notesSlide[^>]*/>\s*', "\n", rels_content
            )
            (rels_dir / f"{dest}.rels").write_text(rels_content, encoding="utf-8")

        _add_to_content_types(self._tmpdir, dest)
        _add_to_presentation_rels(self._tmpdir, dest)
        return dest

    def _insert_into_order(self, new_filename: str, position: int):
        """Insert a newly created slide into sldIdLst at the given position."""
        pres_rels_path = self._tmpdir / "ppt" / "_rels" / "presentation.xml.rels"
        rels_content = pres_rels_path.read_text(encoding="utf-8")
        match = re.search(
            rf'Id="([^"]+)"[^>]*Target="slides/{re.escape(new_filename)}"', rels_content
        )
        if not match:
            match = re.search(
                rf'Target="slides/{re.escape(new_filename)}"[^>]*Id="([^"]+)"', rels_content
            )
        if not match:
            return

        rid = match.group(1)
        order = self.get_slide_order()
        next_id = max((int(s["sld_id"]) for s in order), default=255) + 1
        new_entry = {"sld_id": str(next_id), "rid": rid, "filename": new_filename}

        if position < 0:
            order.append(new_entry)
        else:
            order.insert(position, new_entry)
        self._set_slide_order(order)

    # ── Speaker notes ─────────────────────────────────────────────────────────

    def update_notes(self, slide_filename: str, notes_text: str):
        """Set speaker notes text for a slide."""
        rels_path = (
            self._tmpdir / "ppt" / "slides" / "_rels" / f"{slide_filename}.rels"
        )
        if not rels_path.exists():
            return
        rels_dom = defusedxml.minidom.parse(str(rels_path))
        for rel in rels_dom.getElementsByTagName("Relationship"):
            if "notesSlide" in rel.getAttribute("Type"):
                target = rel.getAttribute("Target")
                notes_path = (self._tmpdir / "ppt" / "slides" / target).resolve()
                if not notes_path.exists():
                    return
                notes_dom = defusedxml.minidom.parse(str(notes_path))
                # Find the body placeholder and replace its text
                a_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
                for sp in notes_dom.getElementsByTagName("p:sp"):
                    ph_list = sp.getElementsByTagName("p:ph")
                    ph_type = ph_list[0].getAttribute("type") if ph_list else ""
                    if ph_type in ("", "body", "obj"):
                        tx_body_list = sp.getElementsByTagName("p:txBody")
                        if not tx_body_list:
                            continue
                        tx_body = tx_body_list[0]
                        for p in list(
                            c for c in tx_body.childNodes
                            if c.nodeType == c.ELEMENT_NODE and c.tagName == "a:p"
                        ):
                            tx_body.removeChild(p)
                        para_xml = (
                            f'<a:p xmlns:a="{a_ns}">'
                            f"<a:r><a:t>{_escape_xml(notes_text)}</a:t></a:r>"
                            f"</a:p>"
                        )
                        frag = defusedxml.minidom.parseString(para_xml)
                        imported = notes_dom.importNode(
                            frag.getElementsByTagName("a:p")[0], True
                        )
                        tx_body.appendChild(imported)
                        break
                notes_path.write_bytes(notes_dom.toxml(encoding="utf-8"))
                return

    # ── Clean ─────────────────────────────────────────────────────────────────

    def clean(self):
        """Remove orphaned slides, media files, and update Content_Types."""
        referenced_slides = self._get_referenced_slides()
        self._remove_orphaned_slides(referenced_slides)
        self._remove_orphaned_media()

    def _get_referenced_slides(self) -> set:
        pres_path = self._tmpdir / "ppt" / "presentation.xml"
        pres_rels_path = self._tmpdir / "ppt" / "_rels" / "presentation.xml.rels"
        if not pres_path.exists() or not pres_rels_path.exists():
            return set()

        rels_dom = defusedxml.minidom.parse(str(pres_rels_path))
        rid_to_file: Dict[str, str] = {}
        for rel in rels_dom.getElementsByTagName("Relationship"):
            rid = rel.getAttribute("Id")
            target = rel.getAttribute("Target")
            rel_type = rel.getAttribute("Type")
            if "slide" in rel_type and "Layout" not in rel_type and target.startswith("slides/"):
                rid_to_file[rid] = target.replace("slides/", "")

        pres_content = pres_path.read_text(encoding="utf-8")
        referenced_rids = set(re.findall(r'<p:sldId[^>]*r:id="([^"]+)"', pres_content))
        return {rid_to_file[rid] for rid in referenced_rids if rid in rid_to_file}

    def _remove_orphaned_slides(self, referenced: set):
        slides_dir = self._tmpdir / "ppt" / "slides"
        rels_dir = slides_dir / "_rels"
        pres_rels_path = self._tmpdir / "ppt" / "_rels" / "presentation.xml.rels"
        removed = []

        for f in slides_dir.glob("slide*.xml"):
            if f.name not in referenced:
                f.unlink()
                removed.append(f.name)
                rels = rels_dir / f"{f.name}.rels"
                if rels.exists():
                    rels.unlink()

        if removed and pres_rels_path.exists():
            content = pres_rels_path.read_text(encoding="utf-8")
            for name in removed:
                content = re.sub(
                    rf'<Relationship[^>]*"slides/{re.escape(name)}"[^>]*/>', "", content
                )
            pres_rels_path.write_text(content, encoding="utf-8")
            _update_content_types(
                self._tmpdir, [f"ppt/slides/{n}" for n in removed]
            )

    def _remove_orphaned_media(self):
        """Remove unreferenced files from media/, charts/, diagrams/ directories."""
        referenced: set = set()
        for rels_file in self._tmpdir.rglob("*.rels"):
            try:
                dom = defusedxml.minidom.parse(str(rels_file))
                for rel in dom.getElementsByTagName("Relationship"):
                    target = rel.getAttribute("Target")
                    if not target:
                        continue
                    target_path = (rels_file.parent.parent / target).resolve()
                    try:
                        referenced.add(
                            target_path.relative_to(self._tmpdir.resolve())
                        )
                    except ValueError:
                        pass
            except Exception:
                pass

        removed = []
        for dir_name in ("media", "embeddings", "charts", "diagrams"):
            dir_path = self._tmpdir / "ppt" / dir_name
            if not dir_path.exists():
                continue
            for f in dir_path.glob("*"):
                if f.is_file():
                    rel_path = f.relative_to(self._tmpdir)
                    if rel_path not in referenced:
                        f.unlink()
                        removed.append(str(rel_path))

        if removed:
            _update_content_types(self._tmpdir, removed)


# ── Module-level helpers ──────────────────────────────────────────────────────

def _pretty_print_xml(xml_file: Path):
    try:
        dom = defusedxml.minidom.parseString(xml_file.read_bytes())
        xml_file.write_bytes(dom.toprettyxml(indent="  ", encoding="utf-8"))
    except Exception:
        pass


def _escape_smart_quotes(xml_file: Path):
    try:
        content = xml_file.read_text(encoding="utf-8")
        for char, entity in SMART_QUOTE_REPLACEMENTS.items():
            content = content.replace(char, entity)
        xml_file.write_text(content, encoding="utf-8")
    except Exception:
        pass


def _condense_xml(xml_file: Path):
    """Remove whitespace-only text nodes (except inside <a:t>), condense for ZIP."""
    try:
        with open(xml_file, encoding="utf-8") as f:
            dom = defusedxml.minidom.parse(f)
        for element in dom.getElementsByTagName("*"):
            if element.tagName.endswith(":t"):
                continue
            for child in list(element.childNodes):
                if (
                    child.nodeType == child.TEXT_NODE
                    and child.nodeValue
                    and child.nodeValue.strip() == ""
                ) or child.nodeType == child.COMMENT_NODE:
                    element.removeChild(child)
        xml_file.write_bytes(dom.toxml(encoding="UTF-8"))
    except Exception as e:
        logger.warning(f"condense_xml failed for {xml_file.name}: {e}")
        raise


def _escape_xml(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


def _get_next_slide_number(slides_dir: Path) -> int:
    existing = [
        int(m.group(1))
        for f in slides_dir.glob("slide*.xml")
        if (m := re.match(r"slide(\d+)\.xml", f.name))
    ]
    return max(existing) + 1 if existing else 1


def _add_to_content_types(unpacked_dir: Path, dest: str):
    ct_path = unpacked_dir / "[Content_Types].xml"
    content = ct_path.read_text(encoding="utf-8")
    override = (
        f'<Override PartName="/ppt/slides/{dest}"'
        f' ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>'
    )
    if f"/ppt/slides/{dest}" not in content:
        content = content.replace("</Types>", f"  {override}\n</Types>")
        ct_path.write_text(content, encoding="utf-8")


def _add_to_presentation_rels(unpacked_dir: Path, dest: str) -> str:
    pres_rels_path = unpacked_dir / "ppt" / "_rels" / "presentation.xml.rels"
    content = pres_rels_path.read_text(encoding="utf-8")
    rids = [int(m) for m in re.findall(r'Id="rId(\d+)"', content)]
    next_rid = max(rids) + 1 if rids else 1
    rid = f"rId{next_rid}"
    new_rel = (
        f'<Relationship Id="{rid}"'
        f' Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide"'
        f' Target="slides/{dest}"/>'
    )
    if f"slides/{dest}" not in content:
        content = content.replace("</Relationships>", f"  {new_rel}\n</Relationships>")
        pres_rels_path.write_text(content, encoding="utf-8")
    return rid


def _update_content_types(unpacked_dir: Path, removed_paths: List[str]):
    ct_path = unpacked_dir / "[Content_Types].xml"
    if not ct_path.exists():
        return
    content = ct_path.read_text(encoding="utf-8")
    for path in removed_paths:
        part_name = "/" + path.replace("\\", "/").lstrip("/")
        content = re.sub(
            rf'<Override\s+PartName="{re.escape(part_name)}"[^/]*/>', "", content
        )
    ct_path.write_text(content, encoding="utf-8")


def _get_shape_by_id(dom, element_id: int):
    """Return the element_id-th shape node in p:spTree (0-based)."""
    sp_tree_list = dom.getElementsByTagName("p:spTree")
    if not sp_tree_list:
        return None
    idx = 0
    for child in sp_tree_list[0].childNodes:
        if child.nodeType != child.ELEMENT_NODE or child.tagName not in SHAPE_TAGS:
            continue
        if idx == element_id:
            return child
        idx += 1
    return None


def _parse_shape(node, element_id: int) -> Dict[str, Any]:
    tag = node.tagName
    elem: Dict[str, Any] = {"id": element_id}

    if tag == "p:sp":
        elem["type"] = "text"
        elem["role"] = _get_placeholder_role(node)
        elem["text"] = _extract_text(node)
        elem["position"] = _get_position(node)
    elif tag == "p:pic":
        elem["type"] = "picture"
        elem["role"] = ""
        elem["text"] = ""
        elem["position"] = _get_position(node)
    elif tag == "p:graphicFrame":
        uri_nodes = node.getElementsByTagName("a:graphicData")
        uri = uri_nodes[0].getAttribute("uri") if uri_nodes else ""
        elem["type"] = "table" if "table" in uri else "chart"
        elem["text"] = _extract_table_text(node) if "table" in uri else ""
        elem["role"] = ""
        elem["position"] = _get_position(node)
    elif tag == "p:grpSp":
        elem["type"] = "group"
        elem["role"] = ""
        elem["text"] = ""
        elem["position"] = _get_position(node)
    else:
        elem["type"] = "unknown"
        elem["role"] = ""
        elem["text"] = ""
        elem["position"] = {"left": 0, "top": 0}

    return elem


def _get_placeholder_role(sp_node) -> str:
    ph_list = sp_node.getElementsByTagName("p:ph")
    if not ph_list:
        return ""
    ph_type = ph_list[0].getAttribute("type")
    return {
        "title": "TITLE",
        "ctrTitle": "TITLE",
        "subTitle": "SUBTITLE",
        "body": "BODY",
        "obj": "BODY",
        "dt": "FOOTER",
        "ftr": "FOOTER",
        "sldNum": "FOOTER",
    }.get(ph_type, "BODY")


def _extract_text(node) -> str:
    texts = []
    for p in node.getElementsByTagName("a:p"):
        runs = p.getElementsByTagName("a:t")
        line = "".join(
            t.firstChild.nodeValue for t in runs if t.firstChild and t.firstChild.nodeValue
        )
        if line:
            texts.append(line)
    return "\n".join(texts)


def _extract_table_text(node) -> str:
    rows = []
    for tr in node.getElementsByTagName("a:tr"):
        cells = []
        for tc in tr.getElementsByTagName("a:tc"):
            t_nodes = tc.getElementsByTagName("a:t")
            cell_text = "".join(
                t.firstChild.nodeValue for t in t_nodes if t.firstChild and t.firstChild.nodeValue
            )
            cells.append(cell_text)
        rows.append(" | ".join(cells))
    return "\n".join(rows)


def _get_position(node) -> Dict[str, float]:
    off_list = node.getElementsByTagName("a:off")
    if off_list:
        x = int(off_list[0].getAttribute("x") or 0)
        y = int(off_list[0].getAttribute("y") or 0)
        return {"left": round(x / EMU_PER_INCH, 2), "top": round(y / EMU_PER_INCH, 2)}
    return {"left": 0, "top": 0}
