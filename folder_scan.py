"""Directory grants, incremental local discovery and evidence-only archiving."""

import base64
import json
import os
import re
import sqlite3
import stat
import subprocess
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from codex_account import ConnectionErrorUI
from folder_cards import READ_PROMPT, READ_SCHEMA, clean_remote, digest, event_name, labeled_only, local_facts, make_groups, norm, year
from folder_materials import MAX_PARTS, PICTURES, SUPPORTED, Part, evidence_bytes, locate, parts
from materials import picture


SKIP_DIRS = {".git", ".svn", ".venv", "node_modules", "__pycache__", "$recycle.bin", "system volume information"}
SUPPORT = re.compile(r"报名|登记|成员|名单|申报|分工|roster|registration", re.I)
PROOF = re.compile(r"证书|获奖|公示|证明|验收|成绩|certificate|award", re.I)
PRIVATE = re.compile(r"身份证|银行卡|银行流水|收款码|支付截图|密码|密钥|password|credential", re.I)
BACKGROUND = re.compile(r"空白模板|空表|填写示例|填表说明|报名须知|报销须知|交通指南|住宿指南|软件安装说明|blank.template|sample.form", re.I)
CLUE = re.compile(r"奖|公示|参赛|比赛|竞赛|大赛|团队|队伍|组别|项目|实践|实习|活动|志愿|证书|证明|署名|结项|验收|contest|award|internship|volunteer", re.I)


def stamp(path):
    info = path.stat()
    return f"{info.st_size}:{info.st_mtime_ns}:{info.st_ino}"


def reparse(path):
    info = path.lstat()
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, "st_file_attributes", 0) & stat.FILE_ATTRIBUTE_REPARSE_POINT)


def scoped(root, relative):
    path = root / relative
    if path.resolve(strict=True) != path or not path.is_relative_to(root) or not path.is_file():
        raise ValueError("原件已移走或不在所选目录中")
    return path


def ocr(image):
    if os.name != "nt":
        raise ValueError("当前系统没有 Windows 文字识别")
    small, _ = picture(image)
    script = Path(__file__).with_name("folder_ocr.ps1").read_text(encoding="utf-8")
    system = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    run = subprocess.run([str(system), "-NoProfile", "-NonInteractive", "-Command", script],
                         input=small.split(",", 1)[1].encode("ascii"), capture_output=True, timeout=30,
                         creationflags=subprocess.CREATE_NO_WINDOW)
    if run.returncode:
        raise ValueError("Windows 文字识别不可用，可连接支持读图的 AI 后重试")
    return re.sub(r"(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])", "", run.stdout.decode("utf-8-sig").strip())


def pending_clues(rows):
    named = {(event_name(r["event"]), year(r), k, norm(r[k])) for r in rows if r["names"]
             and not r["uncertain"] for k in ("team", "work") if r[k]}
    return {r[k] for r in rows if r["award"] and not r["names"] for k in ("team", "work")
            if len(norm(r[k])) >= 2 and (event_name(r["event"]), year(r), k, norm(r[k])) not in named}


def proof_source(root, relative, version, part):
    path = Path(relative)
    name = path.name if part.key == "original" else f"{path.stem} · {part.label}{part.ext}"
    return {"id": "proof-" + digest(root, relative, version, part.key)[:40], "name": name,
            "path": relative, "location": part.label, "part": part.key, "stamp": version,
            "originalSize": int(version.partition(":")[0])}


class DirectoryScan:
    def __init__(self, storage, ai):
        storage.mkdir(parents=True, exist_ok=True)
        self.db = storage / "folders.sqlite3"
        self.ai = ai
        self.pick = None
        self.jobs = {}
        self.lock = threading.RLock()
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS roots(id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL);
                CREATE TABLE IF NOT EXISTS readings(root TEXT, path TEXT, context TEXT, stamp TEXT, body TEXT,
                    PRIMARY KEY(root,path,context));
                CREATE TABLE IF NOT EXISTS reports(root TEXT PRIMARY KEY, run TEXT, body TEXT);
            """)

    @contextmanager
    def connection(self):
        db = sqlite3.connect(self.db, timeout=15)
        try:
            with db:
                yield db
        finally:
            db.close()

    def select(self):
        if not self.pick:
            raise ConnectionErrorUI("请在拾页桌面窗口选择本地文件夹。")
        selected = self.pick()
        return self.register(Path(selected[0])) if selected else None

    def register(self, root):
        root = root.resolve(strict=True)
        if not root.is_dir():
            raise ValueError("请选择文件夹")
        with self.connection() as db:
            key = os.path.normcase(str(root))
            db.execute("INSERT OR IGNORE INTO roots VALUES(?,?)", (uuid.uuid4().hex, key))
            token = db.execute("SELECT id FROM roots WHERE path=?", (key,)).fetchone()[0]
        return {"id": token, "name": root.name or str(root)}

    def root(self, token):
        with self.connection() as db:
            row = db.execute("SELECT path FROM roots WHERE id=?", (token,)).fetchone()
        if not row:
            raise ConnectionErrorUI("请重新选择这个文件夹。")
        return Path(row[0])

    def start(self, data):
        token = data["root"]
        root = self.root(token)
        if not root.is_dir() or root.resolve() != root:
            raise ConnectionErrorUI("找不到原来的目录，请重新选择。已归档的证据仍可在卡片中查看。")
        person = data.get("person", {})
        person = {k: str(person.get(k, ""))[:120].strip() for k in ("name", "school")}
        state = self.ai.state()
        if data.get("mode") != state["mode"] or data.get("revision") != state["revision"]:
            raise ConnectionErrorUI("AI 连接已变化，请重新发送。")
        with self.lock:
            old = self.jobs.get(token)
            if old and old["status"] == "running":
                if (old["person"] != person or old["instruction"] != str(data.get("instruction", ""))[:2000] or
                        old["workflow"] != data.get("workflow") or old["mode"] != state["mode"]):
                    raise ConnectionErrorUI("这个文件夹正在执行前一次任务，请在完成后开始新的整理。")
                return {"run": old["run"], "status": "running"}
            status = {"root": token, "run": uuid.uuid4().hex, "status": "running", "stage": "正在浏览目录",
                      "current": "", "total": 0, "done": 0, "cached": 0, "read": 0, "sent": [],
                      "mode": state["mode"], "provider": state.get("model") if state["mode"] == "api" else state["mode"],
                      "workflow": "auto" if data.get("workflow") == "auto" else "manual",
                      "instruction": str(data.get("instruction", ""))[:2000], "person": person,
                      "started": datetime.now(timezone.utc).isoformat()}
            self.jobs[token] = status
            threading.Thread(target=self.scan, args=(root, status, state), daemon=True).start()
        return {"run": status["run"], "status": "running"}

    def status(self, token):
        with self.lock:
            job = self.jobs.get(token)
            if job:
                return {**job, "sent": list(job["sent"])}
        with self.connection() as db:
            row = db.execute("SELECT body FROM reports WHERE root=?", (token,)).fetchone()
        return json.loads(row[0]) if row else {"status": "idle", "root": token}

    def change(self, job, **updates):
        with self.lock:
            job.update(updates)

    def inventory(self, root, issues):
        paths = []
        def failed(error):
            name = os.path.relpath(error.filename, root) if error.filename else "."
            issues.append({"path": name, "status": "未读", "detail": "目录无法访问"})
        for parent, dirs, files in os.walk(root, onerror=failed):
            directory = Path(parent)
            kept = []
            for name in sorted(dirs):
                try:
                    if PRIVATE.search(name):
                        issues.append({"path": (directory / name).relative_to(root).as_posix(),
                                       "status": "跳过", "detail": "与经历无关的私密目录"})
                    elif name.casefold() not in SKIP_DIRS and not reparse(directory / name):
                        kept.append(name)
                except OSError as exc:
                    failed(exc)
            dirs[:] = kept
            for name in sorted(files):
                path = directory / name
                rel = path.relative_to(root).as_posix()
                try:
                    if reparse(path) or not path.is_file():
                        issues.append({"path": rel, "status": "跳过", "detail": "链接或特殊文件"})
                    elif name.startswith(("~$", ".")) or name.lower() in {"thumbs.db", "desktop.ini"}:
                        continue
                    elif PRIVATE.search(name):
                        issues.append({"path": rel, "status": "跳过", "detail": "与经历无关的私密材料"})
                    elif path.suffix.lower() not in SUPPORTED:
                        issues.append({"path": rel, "status": "未读", "detail": "暂不支持此格式"})
                    else:
                        paths.append(rel)
                except OSError as exc:
                    failed(exc)
        def priority(rel):
            name = Path(rel).name
            if PROOF.search(name):
                return 0
            if SUPPORT.search(name):
                return 3
            return 1 if Path(rel).suffix.lower() in PICTURES else 2
        return sorted(paths, key=lambda rel: (priority(rel), rel.casefold()))

    def scan(self, root, job, state):
        token, person = job["root"], job["person"]
        context = digest("directory-reading-2", person, state["mode"], state.get("baseUrl"), state.get("model"),
                         job["instruction"])
        log, rows, sources, deferred = [], [], {}, []
        try:
            paths = self.inventory(root, log)
            self.change(job, total=len(paths))
            with self.connection() as db:
                cached = {p: (s, body) for p, s, body in db.execute(
                    "SELECT path,stamp,body FROM readings WHERE root=? AND context=?", (token, context))}
            for index, relative in enumerate(paths, 1):
                unresolved = pending_clues(rows)
                follow = bool(unresolved and SUPPORT.search(Path(relative).name))
                stage = "正在查找报名或队伍依据" if follow else "正在读取材料"
                self.change(job, stage=stage, current=relative)
                try:
                    background = BACKGROUND.search(Path(relative).stem)
                    if background and background[0] not in job["instruction"] and not any(
                            norm(term) in norm(Path(relative).stem) for term in unresolved | {person["name"]} if term):
                        log.append({"path": relative, "status": "跳过", "detail": "目录显示为模板或办事说明，本次未打开"})
                        self.change(job, done=index)
                        continue
                    path = scoped(root, relative)
                    version = stamp(path)
                    if relative in cached and cached[relative][0] == version:
                        outcome = json.loads(cached[relative][1])
                        self.change(job, cached=job["cached"] + 1)
                        desc = "复用上次判读"
                    else:
                        outcome = self.read_file(job, state, path, relative, version, unresolved)
                        if stamp(path) != version:
                            raise ValueError("文件在读取期间被修改，请重新扫描")
                        self.cache(token, relative, context, version, outcome)
                        self.change(job, read=job["read"] + 1)
                        desc = "已查找关联队伍" if follow else "已读取"
                    rows.extend(outcome["facts"])
                    sources.update(outcome["sources"])
                    desc += " · " + str(len(outcome["facts"])) + " 条证据线索" if outcome["facts"] else " · 无可归档证据"
                    notes = outcome["issues"]
                    if outcome.get("lookup"):
                        deferred.append((relative, version, outcome))
                    log.append({"path": relative, "status": "有未读内容" if notes else "已检查",
                                "detail": "；".join(notes) if notes else desc})
                except (OSError, ValueError, KeyError, RuntimeError, IndexError, ConnectionErrorUI,
                        subprocess.SubprocessError) as exc:
                    log.append({"path": relative, "status": "未读", "detail": str(exc)[:240]})
                except Exception as exc:
                    log.append({"path": relative, "status": "未读", "detail": "无法解析文件（" + type(exc).__name__ + "）"})
                self.change(job, done=index)
            # An award may be discovered after a neutral roster. Search its local
            # index again using the new team/work IDs, without re-opening the file.
            for relative, version, outcome in deferred:
                terms = pending_clues(rows)
                for section in outcome["lookup"]:
                    hits = {t for t in terms if norm(t) in norm(section["text"])}
                    if not hits or hits.issubset(section.get("searched", [])):
                        continue
                    self.change(job, stage="正在按队名查找关联证据", current=relative)
                    try:
                        part = Part(section["key"], section["label"], section["text"], ext=section["ext"],
                                    row_numbers=tuple(section.get("rows", [])))
                        found = self.model_rows(job, state, relative, [part], hits)
                        for part, observations in found:
                            for row in observations:
                                source = proof_source(token, relative, version, locate(part, row))
                                sid = source["id"]
                                sources[sid] = outcome["sources"][sid] = source
                                fact = {**row, "source": sid}
                                if fact not in outcome["facts"]:
                                    outcome["facts"].append(fact)
                                    rows.append(fact)
                        section["searched"] = sorted(set(section.get("searched", [])) | hits)
                        self.cache(token, relative, context, version, outcome)
                        log.append({"path": relative, "status": "补充检索", "detail": "按线索核对：" + "、".join(sorted(hits))})
                    except Exception as exc:
                        log.append({"path": relative, "status": "有未读内容", "detail": "关联线索核对失败：" + str(exc)[:160]})
            for path in sorted(set(cached) - set(paths)):
                if not (root / path).exists():
                    log.append({"path": path, "status": "原件已移走", "detail": "已有卡片使用归档副本"})
            self.change(job, stage="正在核对归属并归组", current="")
            groups = make_groups(rows, sources, person, job["instruction"])
            self.finish(job, status="done", stage="已完成", groups=groups, log=log)
        except Exception as exc:
            self.finish(job, status="error", stage="整理中断", error=str(exc)[:240], log=log, groups=[])

    def finish(self, job, **changes):
        result = {**job, **changes}
        with self.lock, self.connection() as db:
            db.execute("INSERT OR REPLACE INTO reports VALUES(?,?,?)",
                       (job["root"], job["run"], json.dumps(result, ensure_ascii=False)))
            job.update(changes)

    def cache(self, token, relative, context, version, outcome):
        if outcome.get("retry"):
            return
        with self.connection() as db:
            db.execute("INSERT OR REPLACE INTO readings VALUES(?,?,?,?,?)",
                       (token, relative, context, version, json.dumps(outcome, ensure_ascii=False)))

    def model_rows(self, job, state, relative, batch, clues):
        inputs, images, expected = [], [], {}
        for n, part in enumerate(batch, 1):
            key = str(n)
            expected[key] = part
            item = {"id": key, "location": part.label, "text": part.text[:15000]}
            if part.image:
                image, _ = picture(part.image)
                images.append(image)
                item["image"] = len(images)
            inputs.append(item)
        self.change(job, sent=job["sent"] + [{"path": relative, "parts": [p.label for p in batch]}])
        prompt = json.dumps({"任务": job["instruction"], "本人": job["person"], "待查队伍": sorted(clues)[:30],
                             "材料": inputs}, ensure_ascii=False)
        answer = self.ai.structured_reply(state, READ_PROMPT + "\n输出格式：" +
                                          json.dumps(READ_SCHEMA, ensure_ascii=False), prompt, images, READ_SCHEMA)
        if not isinstance(answer.get("facts"), list) or not isinstance(answer.get("read"), list):
            raise ConnectionErrorUI("模型未返回逐项读取结果")
        read = {str(i) for i in answer["read"]}
        for key, part in expected.items():
            if key not in read:
                raise ConnectionErrorUI(part.label + "：模型未确认读到内容")
            observations = [clean_remote(row, part) for row in answer["facts"]
                            if isinstance(row, dict) and str(row.get("id")) == key]
            yield part, [r for r in observations if r]

    def read_file(self, job, state, path, relative, version, unresolved):
        facts, sources, issues, batch = [], {}, [], []
        lookup = []
        retry = False
        def save_rows(part, observations):
            for row in observations:
                desc = proof_source(job["root"], relative, version, locate(part, row))
                sid = desc["id"]
                sources[sid] = desc
                facts.append({**row, "source": sid})

        def read_batch():
            nonlocal retry
            if not batch:
                return
            for p in batch:
                if len(p.text) > 15000:
                    issues.append(p.label + "：模型读取了前 15000 字")
            try:
                for p, found in self.model_rows(job, state, relative, batch, unresolved):
                    save_rows(p, found)
            except (ConnectionErrorUI, ValueError, OSError) as exc:
                retry = True
                issues.append("、".join(p.label for p in batch) + "：" + str(exc)[:180])
            batch.clear()

        for index, part in enumerate(parts(path)):
            if index >= MAX_PARTS:
                issues.append(f"已读取前 {MAX_PARTS} 个片段")
                break
            if not part.image and not part.text.strip():
                if part.key.startswith("unsupported"):
                    issues.append(part.label)
                continue
            if state["mode"] == "local" and part.image:
                try:
                    recognized = ocr(part.image)
                    if not recognized and not part.text:
                        issues.append(part.label + "：未识别到文字")
                    part.text += "\n" + recognized
                except (ValueError, OSError, subprocess.SubprocessError) as exc:
                    retry = True
                    issues.append(part.label + "：" + str(exc)[:140])
            observed = local_facts(part.text, job["person"])
            if observed:
                save_rows(part, observed)
            if state["mode"] == "local":
                if not observed and part.text.strip() and (part.image or PROOF.search(path.name) or
                        re.search(r"奖|证书|证明|获奖|比赛|项目|志愿|参赛", part.text)):
                    issues.append(part.label + "：本地已提取文字，尚需 AI 或人工判读")
                continue
            if observed and not part.image and labeled_only(part.text) and (all(r["event"] and (r["names"] or r["team"]) for r in observed)
                                                and not re.search(r"(?:另见|详见附件)", part.text)):
                continue
            # Search supporting paperwork locally for the current person or an unresolved team.
            # Unlabelled images and documents with fresh event clues remain discovery candidates.
            if not part.image and not observed:
                needles = {n for n in (job["person"]["name"], *unresolved) if n}
                match = any(norm(n) in norm(part.text) for n in needles)
                support = SUPPORT.search(path.name)
                likely = PROOF.search(path.name) or CLUE.search(part.text)
                if not match and ((support and not PROOF.search(part.text)) or not likely):
                    if support or "\t" in part.text:
                        lookup.append({"key": part.key, "label": part.label, "text": part.text[:6800], "ext": part.ext,
                                       "rows": part.row_numbers})
                    continue
            batch.append(part)
            if len(batch) >= 3:
                read_batch()
        read_batch()
        return {"facts": facts, "sources": sources, "issues": list(dict.fromkeys(issues)), "lookup": lookup, "retry": retry}

    def artifact(self, data):
        report = self.status(data["root"])
        if report.get("run") != data["run"] or report["status"] != "done":
            raise ConnectionErrorUI("目录整理记录已更新，请重新打开结果。")
        source = next((s for g in report["groups"] for s in g["sources"] if s["id"] == data["source"]), None)
        if not source:
            raise ConnectionErrorUI("没有找到本次选中的证据。")
        try:
            path = scoped(self.root(data["root"]), source["path"])
            if stamp(path) != source["stamp"]:
                raise ValueError("原件已修改")
            content = evidence_bytes(path, source["part"])
            if stamp(path) != source["stamp"]:
                raise ValueError("读取期间原件已修改")
            return content
        except (OSError, ValueError, KeyError) as exc:
            raise ConnectionErrorUI("原件已移动或发生变化，请重新扫描后归档。") from exc
