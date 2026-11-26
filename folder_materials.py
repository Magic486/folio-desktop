"""Read addressable pieces of a local document and copy only cited pieces."""

import csv
import io
import posixpath
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree as ET

from folder_cards import norm
from materials import pdf_lock


PICTURES = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"}
TEXT = {".txt", ".md", ".csv", ".tsv", ".json"}
SUPPORTED = PICTURES | TEXT | {".pdf", ".docx", ".pptx", ".xlsx"}
MAX_FILE = 80 * 1024 * 1024
MAX_XML = 20 * 1024 * 1024
MAX_PARTS = 200


@dataclass
class Part:
    key: str
    label: str
    text: str = ""
    image: bytes = b""
    ext: str = ".txt"
    row_numbers: tuple = ()


def chunks(lines, prefix, label):
    """Keep every line, including long lines, in order with reproducible references."""
    current, length, n = [], 0, 0
    for line in lines:
        for start in range(0, max(1, len(line)), 5200):
            section = line[start:start + 5200]
            if current and length + len(section) > 5200:
                n += 1
                yield Part(f"{prefix}-{n}", f"{label} · 第 {n} 段", "\n".join(current))
                current, length = [], 0
            current.append(section)
            length += len(section) + 1
    if current:
        yield Part(f"{prefix}-{n + 1}", f"{label} · 第 {n + 1} 段", "\n".join(current))


def table_parts(rows, prefix, label):
    first = next(rows, None)
    if first is None:
        return
    header = "\t".join(first[1])
    lines, numbers, length = [], [], len(header)
    def section():
        return Part(f"{prefix}-{numbers[0]}", f"{label} · 记录 {numbers[0]}–{numbers[-1]}",
                    "\n".join([header, *lines]), row_numbers=tuple(numbers))
    for number, row in rows:
        line = "\t".join(v.replace("\r", " ").replace("\n", " ") for v in row)
        if lines and length + len(line) > 5000:
            yield section()
            lines, numbers, length = [], [], len(header)
        lines.append(line)
        numbers.append(number)
        length += len(line) + 1
    if numbers:
        yield section()
    elif header.strip():
        yield Part(f"{prefix}-1", label, header)


def row_part(part, number):
    index = part.row_numbers.index(number)
    lines = part.text.split("\n")
    return Part(f"{part.key}~row{number}", f"{part.label.rsplit(' · 记录 ', 1)[0]} · 第 {number} 行",
                lines[0] + "\n" + lines[index + 1])


def locate(part, observation):
    if part.row_numbers and observation["quote"]:
        excerpt = norm(observation["quote"])
        lines = part.text.split("\n")[1:]
        hits = [n for n, line in zip(part.row_numbers, lines) if excerpt and excerpt in norm(line)]
        if len(hits) == 1:
            return row_part(part, hits[0])
    return part


def word_sections(root):
    paragraphs, index, table = [], 1, 0
    def blocks(node):
        kind = node.tag.rsplit("}", 1)[-1]
        if kind in ("p", "tbl"):
            yield kind, node
        else:
            for child in node:
                yield from blocks(child)
    for kind, block in blocks(root):
        if kind == "p":
            line = "".join(t.text or "" for t in block.iterfind(".//{*}t"))
            if line.strip():
                paragraphs.append(line)
        else:
            if paragraphs:
                yield from chunks(paragraphs, f"body{index}", "Word 正文")
                index += 1
                paragraphs = []
            table += 1
            rows = ([" ".join(t.text or "" for t in cell.iterfind(".//{*}t")) for cell in row.findall("{*}tc")]
                    for row in block.findall("{*}tr"))
            yield from table_parts(enumerate(rows, 1), f"wordtable{table}", f"Word 表 {table}")
    if paragraphs:
        yield from chunks(paragraphs, f"body{index}", "Word 正文")


def decode_text(raw):
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("gb18030")


def member(pack, name, limit=MAX_XML):
    if pack.getinfo(name).file_size > limit:
        raise ValueError("文档中的单项内容超过读取上限")
    return pack.read(name)


def relations(pack, part):
    directory, name = posixpath.split(part)
    rels = posixpath.join(directory, "_rels", name + ".rels")
    if rels not in pack.namelist():
        return {}
    root = ET.fromstring(member(pack, rels))
    return {r.get("Id"): posixpath.normpath(posixpath.join(directory, r.get("Target", ""))).lstrip("/")
            for r in root if r.get("TargetMode") != "External"}


def office_parts(path):
    with zipfile.ZipFile(path) as pack:
        if sum(info.file_size for info in pack.infolist()) > 300 * 1024 * 1024:
            raise ValueError("文档解压后过大")
        if path.suffix.lower() == ".xlsx":
            shared = []
            if "xl/sharedStrings.xml" in pack.namelist():
                shared = ["".join(t.text or "" for t in item.iterfind(".//{*}t"))
                          for item in ET.fromstring(member(pack, "xl/sharedStrings.xml"))]
            workbook = ET.fromstring(member(pack, "xl/workbook.xml"))
            refs = relations(pack, "xl/workbook.xml")
            for index, sheet in enumerate(workbook.iterfind(".//{*}sheet"), 1):
                dest = refs.get(next((v for k, v in sheet.attrib.items() if k.endswith("}id")), ""))
                if not dest:
                    continue
                data = ET.fromstring(member(pack, dest))
                def sheet_rows():
                    for index, row in enumerate(data.iterfind(".//{*}row"), 1):
                        values = []
                        for cell in row.iterfind("{*}c"):
                            col = 0
                            for c in re.match(r"[A-Z]*", cell.get("r", ""))[0]:
                                col = col * 26 + ord(c) - 64
                            if col > 512:
                                raise ValueError("工作表列数超过读取范围")
                            values.extend([""] * max(0, col - 1 - len(values)))
                            value = cell.findtext("{*}v", "")
                            if cell.get("t") == "s" and value:
                                value = shared[int(value)]
                            elif cell.get("t") == "inlineStr":
                                value = "".join(t.text or "" for t in cell.iterfind(".//{*}t"))
                            values.append(value)
                        if any(values):
                            yield int(row.get("r", index)), values
                yield from table_parts(sheet_rows(), f"sheet{index}", sheet.get("name", "工作表"))
            return
        word = path.suffix.lower() == ".docx"
        docs = ["word/document.xml"] if word else sorted(
            (name for name in pack.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda name: int(re.search(r"(\d+)\.xml$", name)[1]))
        for n, doc in enumerate(docs, 1):
            root = ET.fromstring(member(pack, doc))
            label = "Word 正文" if word else f"幻灯片 {n}"
            if word:
                yield from word_sections(root)
            else:
                lines = ("".join(node.text or "" for node in p.iterfind(".//{*}t")) for p in root.iterfind(".//{*}p"))
                yield from chunks((line for line in lines if line.strip()), f"body{n}", label)
            refs = relations(pack, doc)
            images = []
            for node in root.iter():
                if node.tag.rsplit("}", 1)[-1] not in ("blip", "imagedata"):
                    continue
                for key, value in node.attrib.items():
                    if key.endswith(("}embed", "}id")) and value in refs and refs[value] not in images:
                        images.append(refs[value])
            for index, name in enumerate(images, 1):
                ext = Path(name).suffix.lower()
                if ext not in PICTURES:
                    yield Part(f"unsupported{n}-{index}", f"{label} · 图 {index}（不支持 {ext}）")
                    continue
                yield Part(f"img{n}-{index}", f"{'Word' if word else label} · 图 {index}",
                           image=member(pack, name, 36 * 1024 * 1024), ext=ext)


def pdf_parts(path, target=None):
    import pypdfium2 as pdfium
    from pypdfium2 import raw
    with pdf_lock, pdfium.PdfDocument(path) as pdf:
        count = len(pdf)
    pages = [int(target[4:]) - 1] if target and re.fullmatch(r"page\d+", target) else range(count)
    for i in pages:
        # Release PDFium's process-wide lock before the caller does model I/O.
        with pdf_lock, pdfium.PdfDocument(path) as pdf:
            page = pdf[i]
            txt = page.get_textpage()
            try:
                body = txt.get_text_bounded().strip()
            finally:
                txt.close()
            data = b""
            if len(body) < 35 or next(page.get_objects(filter=[raw.FPDF_PAGEOBJ_IMAGE]), None) is not None:
                pix = page.render(scale=min(2.2, 1800 / max(1, *page.get_size())))
                try:
                    stream = io.BytesIO()
                    pix.to_pil().convert("RGB").save(stream, "JPEG", quality=86)
                    data = stream.getvalue()
                finally:
                    pix.close()
            page.close()
        yield Part(f"page{i+1}", f"PDF 第 {i+1} 页", body, data, ".pdf")


def parts(path, target=None):
    ext = path.suffix.lower()
    if path.stat().st_size > MAX_FILE:
        raise ValueError("文件超过 80 MB，请按需拆分")
    if ext in PICTURES:
        yield Part("original", "图片原件", image=path.read_bytes(), ext=ext)
    elif ext == ".pdf":
        yield from pdf_parts(path, target)
    elif ext in {".docx", ".pptx", ".xlsx"}:
        yield from office_parts(path)
    elif ext in TEXT:
        if path.stat().st_size > MAX_XML:
            raise ValueError("文本过大，请拆分后读取")
        text = decode_text(path.read_bytes())
        if ext in {".csv", ".tsv"}:
            rows = csv.reader(io.StringIO(text), delimiter="," if ext == ".csv" else "\t")
            yield from table_parts(enumerate(rows, 1), "rows", "表格")
        else:
            yield from chunks(text.splitlines(), "text", "正文")
    else:
        raise ValueError("暂不支持此文件格式")


def evidence_bytes(path, key):
    if path.stat().st_size > MAX_FILE:
        raise ValueError("文件大小已变化")
    if path.suffix.lower() == ".pdf" and re.fullmatch(r"page[1-9]\d*", key):
        import pypdfium2 as pdfium
        with pdf_lock, pdfium.PdfDocument(path) as source, pdfium.PdfDocument.new() as copy:
            copy.import_pages(source, [int(key[4:])-1])
            stream = io.BytesIO()
            copy.save(stream)
            return stream.getvalue()
    base, suffix, row = key.partition("~row")
    for part in parts(path, base):
        if part.key == base:
            if suffix:
                part = row_part(part, int(row))
            return part.image or part.text.encode("utf-8")
    raise ValueError("原件中的证据位置已变化")
