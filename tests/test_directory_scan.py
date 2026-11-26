import io
import json
import tempfile
import time
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import pypdfium2 as pdfium
from PIL import Image

from codex_account import ConnectionErrorUI
from folder_cards import local_fact
from folder_materials import evidence_bytes, parts
from folder_scan import DirectoryScan, pending_clues, scoped


PERSON = {"name": "测试甲", "school": "示范大学"}


class Offline:
    def state(self):
        return {"mode": "local", "revision": 1}


class DirectoryTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.home = Path(temp.name)
        self.root = self.home / "材料"
        self.root.mkdir()
        self.scanner = DirectoryScan(self.home / "存储", Offline())
        self.key = self.scanner.register(self.root)["id"]

    def write(self, path, content):
        path = self.root / path
        path.parent.mkdir(exist_ok=True, parents=True)
        path.write_text(content, encoding="utf-8")
        return path

    def scan(self, **options):
        request = dict(root=self.key, person=PERSON, instruction="", workflow="auto", **self.scanner.ai.state())
        run = self.scanner.start({**request, **options})["run"]
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            report = self.scanner.status(self.key)
            if report["status"] != "running":
                self.assertEqual(report["run"], run)
                self.assertEqual(report["status"], "done", report)
                return report
            time.sleep(.02)
        self.fail("扫描超时")

    def artifact(self, report, src):
        return self.scanner.artifact(dict(root=self.key, run=report["run"], source=src["id"]))

    def test_mixed_directory_distinct_editions_and_precise_evidence(self):
        header = "赛事名称,年度,队号,奖项\n"
        self.write("比赛/获奖公示.csv", header + "青石赛,2025,Q17,二等奖\n青石赛,2025,Q22,一等奖\n青石赛,2024,Q17,三等奖")
        self.write("报名/报名名单.tsv", "赛事名称\t年度\t队号\t姓名\n青石赛\t2025\tQ17\t测试甲\n青石赛\t2025\tQ22\t测试乙")
        self.write("志愿/证明.txt", "活动名称：图书馆志愿服务\n姓名：测试甲\n角色：志愿者")
        self.write("other.txt", "比赛名称：橙石赛\n姓名：测试乙\n奖项：特等奖")
        self.write("bad.doc", "旧格式")
        report = self.scan()
        self.assertEqual(report["sent"], [])
        self.assertEqual(len(report["groups"]), 3)
        group = next(g for g in report["groups"] if g["year"] == "2025")
        self.assertEqual(group["reason"], "")
        self.assertEqual(group["record"]["result"], "二等奖")
        claims = [c for c in group["record"]["evidence"] if c["field"] == "result"]
        self.assertEqual(len(claims[0]["sources"]), 2)
        for src in group["sources"]:
            body = self.artifact(report, src).decode()
            self.assertIn("Q17", body)
            self.assertNotIn("Q22", body)
            self.assertIn("第 2 行", src["location"])
        self.assertTrue(next(g for g in report["groups"] if g["year"] == "2024")["reason"])
        self.assertTrue(any(e["status"] == "未读" and e["path"] == "bad.doc" for e in report["log"]))
        repeat = self.scan()
        self.assertEqual((repeat["read"], repeat["cached"]), (0, 4))
        self.assertEqual(repeat["groups"], report["groups"])
        later = self.write("新增/补充.txt", "赛事名称：青石赛\n年度：2024\n队号：Q17\n姓名：测试甲")
        updated = self.scan()
        self.assertEqual((updated["read"], updated["cached"]), (1, 4))
        old = next(g for g in updated["groups"] if g["year"] == "2024")
        self.assertEqual(old["reason"], "")
        src = next(s for s in old["sources"] if s["path"].startswith("新增/"))
        later.rename(self.home / "移出的原件.txt")
        with self.assertRaises(ConnectionErrorUI):
            self.artifact(updated, src)
        with self.assertRaises((ValueError, FileNotFoundError)):
            scoped(self.root, "../移出的原件.txt")
        self.assertTrue(any(e["status"] == "原件已移走" for e in self.scan()["log"]))

    def test_word_embedded_picture_sheet_rows_and_single_pdf_page(self):
        image = io.BytesIO()
        Image.new("RGB", (12, 9), "green").save(image, "PNG")
        doc = self.root / "材料.docx"
        with zipfile.ZipFile(doc, "w") as pack:
            pack.writestr("word/document.xml", '<w:d xmlns:w="w" xmlns:a="a" xmlns:r="r"><w:p><w:t>正文</w:t></w:p><a:blip r:embed="r2"/></w:d>')
            pack.writestr("word/_rels/document.xml.rels", '<rels><rel Id="r2" Target="media/pic.png"/></rels>')
            pack.writestr("word/media/pic.png", image.getvalue())
            pack.writestr("word/media/unused.png", b"unreferenced")
        units = list(parts(doc))
        self.assertEqual([p.label for p in units], ["Word 正文 · 第 1 段", "Word · 图 1"])
        self.assertEqual(evidence_bytes(doc, units[1].key), image.getvalue())
        pdf = self.root / "合订本.pdf"
        with pdfium.PdfDocument.new() as book:
            book.new_page(100, 200).close()
            book.new_page(210, 220).close()
            book.save(pdf)
        self.assertEqual([p.label for p in parts(pdf)], ["PDF 第 1 页", "PDF 第 2 页"])
        with pdfium.PdfDocument(evidence_bytes(pdf, "page2")) as proof:
            self.assertEqual(len(proof), 1)
            self.assertEqual(proof.get_page_size(0), (210, 220))
        sheet = self.root / "表.xlsx"
        with zipfile.ZipFile(sheet, "w") as pack:
            pack.writestr("xl/workbook.xml", '<wb xmlns:r="r"><sheet name="结果" r:id="s1"/></wb>')
            pack.writestr("xl/_rels/workbook.xml.rels", '<rels><rel Id="s1" Target="worksheets/s.xml"/></rels>')
            pack.writestr("xl/worksheets/s.xml", '<s><row r="3"><c r="A3" t="inlineStr"><is><t>姓名</t></is></c></row><row r="12"><c r="A12" t="inlineStr"><is><t>测试甲</t></is></c></row></s>')
        unit, = parts(sheet)
        self.assertEqual(unit.row_numbers, (12,))
        self.assertEqual(evidence_bytes(sheet, unit.key + "~row12").decode(), "姓名\n测试甲")

    def test_deferred_lookup_and_year_scoping(self):
        class Reader:
            def state(self):
                return {"mode": "api", "revision": 1, "model": "test"}

            def structured_reply(self, state, instructions, raw, images, schema):
                prompt = json.loads(raw)
                part, = prompt["材料"]
                if "新线索" in part["text"]:
                    fact = {"event": "青山赛", "year": "2025", "team": "Q17", "award": "银奖",
                            "names": [], "quote": "青山赛 Q17 银奖"}
                else:
                    assert "Q17" in prompt["待查队伍"]
                    fact = {"event": "青山赛", "year": "2025", "team": "Q17", "work": "灯塔", "names": [],
                            "quote": "Q17 灯塔"}
                return {"read": ["1"], "facts": [{**fact, "id": "1", "uncertain": False}]}

        self.scanner.ai = Reader()
        self.write("A.tsv", "青山赛 索引\t归属\nQ17\t灯塔")
        self.write("B.txt", "赛事名称：青山赛\n年度：2025\n姓名：测试甲\n作品：灯塔")
        self.write("Z.txt", "新线索 比赛 青山赛 Q17 银奖")
        # First sheet is locally indexed. The award is discovered later and triggers a second lookup.
        report = self.scan()
        self.assertEqual([e["path"] for e in report["sent"]], ["Z.txt", "A.tsv"])
        group, = report["groups"]
        self.assertFalse(group["reason"])
        self.assertEqual(len(next(c for c in group["record"]["evidence"] if c["field"] == "result")["sources"]), 3)
        self.assertEqual(self.scan()["sent"], [])
        current = local_fact({"event": "青山赛", "year": "2025", "team": "Q17", "names": "测试甲"}, "名册", PERSON)
        older = local_fact({"event": "青山赛", "year": "2024", "team": "Q17", "award": "银奖"}, "结果", PERSON)
        self.assertEqual(pending_clues([current, older]), {"Q17"})

    def test_no_usable_evidence_from_an_unread_file(self):
        self.write("坏证书.docx", "不完整的文档")
        self.write("复印.jpg", "坏图片")
        with patch("folder_scan.ocr", side_effect=ValueError("所选 OCR 不可用")):
            report = self.scan()
        self.assertFalse(report["groups"])
        self.assertTrue(all(e["status"] in ("未读", "有未读内容") for e in report["log"]))

    def test_same_name_at_two_schools_and_files_left_unopened(self):
        self.write("证书.csv", "赛事名称,年度,学校,姓名,作品,奖项\n丁香赛,2025,示范大学,测试甲,甲作,金奖\n丁香赛,2025,样本学院,测试甲,乙作,银奖")
        self.write("签名报名.csv", "赛事名称,学校,姓名\n云帆赛,示范大学,测试甲")
        self.write("报名须知.docx", "这份文件不需要打开")
        self.write("银行卡/正面.jpg", "这份文件不需要打开")
        report = self.scan(person={"name": "测试甲", "school": ""})
        conflict = next(g for g in report["groups"] if g["record"]["title"] == "丁香赛")
        self.assertIn("不同学校", conflict["reason"])
        self.assertEqual({e["path"] for e in report["log"] if e["status"] == "跳过"}, {"报名须知.docx", "银行卡"})
        matched = self.scan()
        target = next(g for g in matched["groups"] if g["record"]["title"] == "丁香赛")
        self.assertEqual((target["reason"], target["record"]["result"]), ("", "《甲作》获金奖"))
        self.assertIn("报名", next(g for g in matched["groups"] if g["record"]["title"] == "云帆赛")["reason"])
        with self.assertRaises(ConnectionErrorUI):
            self.scanner.artifact({"root": self.key, "run": matched["run"], "source": "../additional-file"})


if __name__ == "__main__":
    unittest.main()
