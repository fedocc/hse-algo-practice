#!/usr/bin/env python3
"""Loopback-only personal algorithm practice app, using Python's standard library."""
from __future__ import annotations

import argparse
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from html import escape
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
import re
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse, unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from testpack_registry import TestPackError, TestPackRegistry, check_case

ROOT = Path(__file__).resolve().parent
MAX_REQUEST = 8 * 1024 * 1024
MAX_OUTPUT = 200_000
RUN_TIMEOUT = 5.0


def moscow_timezone():
    try:
        return ZoneInfo("Europe/Moscow")
    except ZoneInfoNotFoundError:
        # Some Python installations, especially Windows, ship no IANA database.
        # Moscow uses UTC+03 for this training schedule; no pip dependency needed.
        return timezone(timedelta(hours=3), name="Europe/Moscow (UTC+03)")


class APIError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class Sanitizer(HTMLParser):
    math_tags = {"msubsup", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mlabeledtr", "mstyle", "mspace", "mmultiscripts", "mprescripts", "none", "mpadded", "mphantom", "mfenced", "menclose"}
    tags = {"p", "div", "span", "pre", "code", "strong", "b", "em", "i", "ul", "ol", "li", "br", "table", "tbody", "thead", "tr", "td", "th", "h1", "h2", "h3", "h4", "sup", "sub", "blockquote", "hr", "a", "img", "math", "mrow", "mi", "mo", "mn", "msup", "msub", "mfrac", "msqrt", "mtext", "annotation", "semantics"}
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.result, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "iframe", "object", "svg", "form"}:
            self.hidden += 1
        if self.hidden or tag not in self.tags | self.math_tags:
            return
        safe = []
        for key, value in attrs:
            if key in {"colspan", "rowspan", "alt", "title", "mathvariant", "stretchy", "fence", "accent", "columnalign", "rowalign", "columnspacing", "rowspacing", "display", "notation"}:
                safe.append((key, value or ""))
            elif tag == "img" and key == "src" and value and re.fullmatch(r"/imported/statements/[A-Za-z0-9_.-]+\.(?:png|jpg|jpeg|gif|webp)", value):
                safe.append((key, value))
            elif key in {"href", "src"} and value and urlparse(value).scheme in {"http", "https"}:
                safe.append((key, value))
        if tag == "a":
            safe.extend([("target", "_blank"), ("rel", "noopener noreferrer")])
        self.result.append("<" + tag + "".join(' ' + key + '=\"' + escape(value, quote=True) + '\"' for key, value in safe) + ">")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "iframe", "object", "svg", "form"}:
            self.hidden = max(0, self.hidden - 1)
            return
        if not self.hidden and tag in self.tags | self.math_tags and tag not in {"br", "img", "hr"}:
            self.result.append("</" + tag + ">")

    def handle_data(self, data):
        if not self.hidden:
            self.result.append(escape(data))


def sanitize_html(value):
    parser = Sanitizer()
    parser.feed(str(value or "")[:2_000_000])
    return "".join(parser.result)


def statement_ready(problem):
    statement = problem.get("statement_html")
    return isinstance(statement, str) and bool(statement.strip()) and not problem.get("statement_incomplete")


def normalized_output(value):
    return "\n".join(line.rstrip() for line in str(value).strip().splitlines())


def kill_process(process):
    if process.poll() is None:
        try:
            if os.name == "nt":
                process.kill()
            else:
                os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        except PermissionError:
            # A process can disappear/change state between poll() and killpg().
            try:
                process.kill()
            except (ProcessLookupError, PermissionError):
                pass


def worker_command():
    return [sys.executable, "-I", "-u", str(ROOT / "debugger_worker.py")]


def compare_leetcode(config, result):
    """Explicit task-specific sample checkers, never an official acceptance verdict."""
    identifier, expected_text = config.get("problem_id"), config["expected"]
    if result.get("exit_code") != 0:
        return {"passed": False, "comparison": "execution_error"}
    try:
        actual = result["return_value"] if "return_value" in result else json.loads(result.get("stdout", "").strip().splitlines()[-1])
    except (ValueError, IndexError):
        return {"passed": False, "comparison": "invalid_json", "comparison_message": "Метод не вернул JSON-совместимый результат."}
    if identifier == "leetcode-470":
        if not isinstance(actual, list) or any(type(value) is not int or not 1 <= value <= 10 for value in actual):
            return {"passed": False, "comparison": "rand10_range", "comparison_message": "rand10 должен возвращать целые числа от 1 до 10."}
        return {"comparison": "manual", "comparison_message": "Вывод случайный: точное совпадение с примером не требуется. Проверен диапазон 1–10; равномерность распределения проверяйте на LeetCode."}
    if identifier in {"leetcode-26", "leetcode-443"}:
        match = re.fullmatch(r"\s*(\d+)\s*,\s*(?:nums|chars)\s*=\s*(\[.*\])\s*", expected_text, re.S)
        if match:
            try:
                size = int(match[1])
                prefix = json.loads(re.sub(r"\b_\b", "null", match[2]))[:size]
                return {"passed": type(actual) is int and actual == size and result.get("mutated_prefix") == prefix, "comparison": "inplace_prefix"}
            except (ValueError, TypeError):
                pass
        try:
            if actual != json.loads(expected_text):
                return {"passed": False, "comparison": "inplace_length"}
        except ValueError:
            pass
        return {"comparison": "manual", "comparison_message": "Нужна проверка и возвращённой длины, и изменённого префикса массива. Префикс показан отдельно; окончательный вердикт даёт LeetCode."}
    try:
        expected = json.loads(expected_text)
    except ValueError:
        return {"comparison": "manual", "comparison_message": "Формат эталона не является JSON. Сравните результат с условием или отправьте на LeetCode."}
    freeze = lambda value: json.dumps(value, sort_keys=True, ensure_ascii=False)
    if identifier in {"leetcode-1", "leetcode-350", "leetcode-22", "leetcode-438"}:
        valid = isinstance(actual, list) and isinstance(expected, list) and Counter(map(freeze, actual)) == Counter(map(freeze, expected))
        return {"passed": valid, "comparison": "unordered"}
    if identifier == "leetcode-49":
        try:
            canonical = lambda groups: Counter(freeze(sorted(map(freeze, group))) for group in groups)
            valid = isinstance(actual, list) and all(isinstance(group, list) for group in actual) and canonical(actual) == canonical(expected)
        except (TypeError, ValueError):
            valid = False
        return {"passed": valid, "comparison": "unordered_groups"}
    if identifier == "leetcode-5":
        from debugger_worker import parse_arguments
        original = parse_arguments(config.get("stdin", ""), ["s"])[0]
        valid = isinstance(original, str) and isinstance(actual, str) and isinstance(expected, str) and actual in original and actual == actual[::-1] and len(actual) == len(expected)
        return {"passed": valid, "comparison": "longest_palindrome"}
    return {"passed": actual == expected, "comparison": "exact_json"}


def run_python(config, timeout=RUN_TIMEOUT):
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix="algo-run-") as directory:
        process = subprocess.Popen(worker_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", cwd=directory, start_new_session=True)
        try:
            output, errors = process.communicate(json.dumps(dict(config, mode="run")) + "\n", timeout=timeout)
        except subprocess.TimeoutExpired:
            kill_process(process)
            output, errors = process.communicate()
            return {"status": "timeout", "stdout": "", "stderr": f"Превышено время выполнения ({timeout:g} секунд).", "exit_code": -1, "duration": round(time.monotonic() - started, 4)}
        if len(output) > MAX_OUTPUT * 3:
            return {"status": "error", "stdout": "", "stderr": "Превышен лимит вывода.", "exit_code": -1, "duration": round(time.monotonic() - started, 4)}
        try:
            result = json.loads(output.strip().splitlines()[-1])
        except (ValueError, IndexError):
            result = {"status": "error", "stdout": "", "stderr": errors[:MAX_OUTPUT] or "Процесс завершился без результата.", "exit_code": process.returncode or -1}
        result["duration"] = round(time.monotonic() - started, 4)
        result["status"] = "ok" if result.get("status") == "finished" else "error"
        if "expected" in config:
            passed = normalized_output(result.get("stdout", "")) == normalized_output(config["expected"])
            if config.get("source") == "leetcode":
                result.update(compare_leetcode(config, result))
            else:
                result["passed"] = passed and result.get("exit_code") == 0
        return result


class DebugSession:
    def __init__(self, config):
        self.id = secrets.token_hex(12)
        self.directory = tempfile.TemporaryDirectory(prefix="algo-debug-")
        self.process = subprocess.Popen(worker_command(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", cwd=self.directory.name, start_new_session=True, bufsize=1)
        self.condition = threading.Condition()
        self.version = 0
        self.state = {"session_id": self.id, "status": "running", "line": None, "locals": [], "stack": [], "stdout": "", "stderr": ""}
        self.deadline = time.monotonic() + RUN_TIMEOUT
        self.created = time.monotonic()
        self.process.stdin.write(json.dumps(dict(config, mode="debug")) + "\n")
        self.process.stdin.flush()
        threading.Thread(target=self.read_events, daemon=True).start()
        threading.Thread(target=self.watchdog, daemon=True).start()

    def read_events(self):
        try:
            for line in self.process.stdout:
                event = json.loads(line)
                with self.condition:
                    self.state = dict(event, session_id=self.id)
                    self.deadline = None if event["status"] != "running" else time.monotonic() + RUN_TIMEOUT
                    self.version += 1
                    self.condition.notify_all()
        except (ValueError, OSError) as error:
            self.fail(str(error))
        finally:
            self.process.wait()
            with self.condition:
                if self.state["status"] in {"paused", "running"}:
                    self.state.update(status="error", error="Процесс отладки завершился неожиданно.", stderr=self.process.stderr.read()[:MAX_OUTPUT])
                self.version += 1
                self.condition.notify_all()
            for stream in (self.process.stdin, self.process.stdout, self.process.stderr):
                if stream:
                    stream.close()
            self.directory.cleanup()

    def fail(self, message):
        kill_process(self.process)
        with self.condition:
            self.state.update(status="error", line=None, error=message)
            self.version += 1
            self.condition.notify_all()

    def watchdog(self):
        while self.process.poll() is None:
            time.sleep(.1)
            deadline = self.deadline
            if deadline and time.monotonic() > deadline:
                self.fail("Превышено время выполнения между остановками (5 секунд).")
                return
            if time.monotonic() - self.created > 3600:
                self.fail("Сессия отладки завершена через час. Запустите её заново.")
                return

    def snapshot(self):
        with self.condition:
            return dict(self.state)

    def wait(self, version, timeout=1.8):
        with self.condition:
            self.condition.wait_for(lambda: self.version > version or self.state["status"] in {"finished", "error"}, timeout)
            return dict(self.state)

    def command(self, payload):
        command = payload.get("command")
        if command not in {"step", "next", "continue", "return", "stop"}:
            raise APIError("Неизвестная команда отладки.")
        with self.condition:
            if command == "stop":
                kill_process(self.process)
                self.state.update(status="finished", line=None)
                self.version += 1
                self.condition.notify_all()
                return dict(self.state)
            if self.state["status"] != "paused":
                raise APIError("Программа сейчас не остановлена.", 409)
            version = self.version
            self.state["status"] = "running"
            self.deadline = time.monotonic() + RUN_TIMEOUT
            try:
                self.process.stdin.write(json.dumps(payload) + "\n")
                self.process.stdin.flush()
            except BrokenPipeError:
                raise APIError("Процесс отладки уже завершился.", 409)
        return self.wait(version)


class PracticeApp:
    def __init__(self, data_dir=None):
        self.data_dir = Path(data_dir or ROOT / "data")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.data_dir / "state.json"
        self.lock = threading.RLock()
        self.sessions = {}
        self.testpacks = TestPackRegistry(self.data_dir / "testpacks")
        self.state = self.load(self.state_path, {"drafts": {}, "imports": {}, "contest_status": {}, "interview": {"status": "idle", "remaining_seconds": 3600, "problem_ids": []}, "jobs": [], "bridge_last_seen": 0})
        self.state.setdefault("drafts", {})
        self.state.setdefault("imports", {})
        self.state.setdefault("contest_status", {})
        self.state.setdefault("jobs", [])
        repaired = False
        for identifier, problem in self.state["imports"].items():
            if identifier.startswith("yandex-") and problem.get("solved"):
                problem.update(previously_solved=True, solved=False)
                repaired = True
        if repaired:
            self.save()

    @staticmethod
    def load(path, default):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return default
        except (json.JSONDecodeError, OSError) as error:
            raise RuntimeError(f"Не удалось прочитать {path.name}: {error}. Файл сохранён без изменений.") from error

    def save(self):
        with self.lock:
            destination = self.state_path.with_suffix(".tmp")
            destination.write_text(json.dumps(self.state, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(destination, self.state_path)

    def catalog(self):
        catalog = self.load(self.data_dir / "catalog.json", {"topics": [], "contests": [], "problems": []})
        problems = {problem["id"]: dict(problem) for problem in catalog.get("problems", [])}
        for identifier, problem in self.state["imports"].items():
            problems[identifier] = dict(problems.get(identifier, {}), **problem)
        contest_by_id = {str(contest["id"]): contest for contest in catalog.get("contests", [])}
        for identifier, problem in problems.items():
            if problem.get("source") == "yandex" or identifier.startswith("yandex-"):
                contest_id = str(problem.get("contestId") or problem.get("contest_id") or identifier.split("-")[1])
                contest = contest_by_id.get(contest_id, {})
                for name in ("course", "interview_priority"):
                    if problem.get(name) is None and name in contest:
                        problem[name] = contest[name]
            draft = self.state["drafts"].get(identifier, {})
            if identifier.startswith("yandex-"):
                problem["previously_solved"] = bool(problem.get("previously_solved") or problem.get("solved"))
                problem["solved"] = draft.get("solved", False)
            else:
                problem["solved"] = draft.get("solved", problem.get("solved", False))
            problem["status"] = draft.get("status", "solved" if problem["solved"] else "todo")
            problem["assisted"] = draft.get("assisted", False)
            problem.update(self.testpacks.metadata(identifier) if identifier.startswith("yandex-") else {"local_test_count": 0})
        contests = [dict(item, **self.state["contest_status"].get(str(item["id"]), {})) for item in catalog.get("contests", [])]
        return dict(catalog, problems=list(problems.values()), contests=contests)

    def problem(self, identifier):
        return next((p for p in self.catalog()["problems"] if p["id"] == identifier), None)

    def progress(self):
        problems = self.catalog()["problems"]
        solved = sum(bool(p.get("solved")) for p in problems)
        today = datetime.now(moscow_timezone()).date()
        # Deadline is the start of March 16, so today's full day is included.
        days = max(0, (date(2027, 3, 16) - today).days)
        return {"solved": solved, "target": 200, "deadline": "2027-03-16", "today": today.isoformat(), "remaining": max(0, 200 - solved), "days_left": days, "per_day": round(max(0, 200 - solved) / max(1, days), 2), "catalog_total": len(problems)}

    def interview(self):
        result = dict(self.state.get("interview", {"status": "idle", "remaining_seconds": 3600, "problem_ids": []}))
        if result["status"] == "running":
            result["remaining_seconds"] = max(0, int(result.get("expires_at", time.time()) - time.time()))
            if not result["remaining_seconds"]:
                result["status"] = "finished"
        completions, baseline = result.get("completions", {}), result.get("baseline_solved", {})
        result["results"] = [{"problem_id": identifier, "solved": bool(completions.get(identifier)) and not baseline.get(identifier, False), "was_solved": bool(baseline.get(identifier)), "completed_at": completions.get(identifier, {}).get("at"), "assisted": completions.get(identifier, {}).get("assisted", False)} for identifier in result.get("problem_ids", [])]
        return result

    def record_completion(self, identifier, timestamp):
        interview = self.state.get("interview", {})
        if interview.get("status") != "running" or identifier not in interview.get("problem_ids", []):
            return
        if not interview.get("started_at", float("inf")) <= timestamp <= interview.get("expires_at", 0):
            return
        if interview.get("baseline_solved", {}).get(identifier, True):
            return
        interview.setdefault("completions", {}).setdefault(identifier, {"at": timestamp, "assisted": bool(self.state["drafts"].get(identifier, {}).get("assisted"))})

    def pair(self):
        candidates = [p for p in self.catalog()["problems"] if not p.get("solved") and not p.get("premium") and statement_ready(p) and p.get("interview_priority", True)]
        candidates.sort(key=lambda p: (not p.get("imported"), {"Easy": 0, "Medium": 1, "Unknown": 2, "Hard": 3}.get(p.get("difficulty"), 2), p["id"]))
        if not candidates:
            return []
        known = [p for p in candidates if p.get("imported") and p.get("difficulty") in {"Easy", "Medium"}]
        easy = [p for p in known if p.get("difficulty") == "Easy"]
        medium = [p for p in known if p.get("difficulty") == "Medium"]
        first = secrets.choice(easy) if easy and medium else candidates[0]
        others = [p for p in candidates[1:] if p["id"] != first["id"]]
        if easy and medium:
            others = medium
            # Generic Array is shared by most questions; compare the more specific topics.
            def topic_overlap(problem):
                return len((set(problem.get("topicIds", [])) - {"arrays"}) & (set(first.get("topicIds", [])) - {"arrays"}))
            best = min(map(topic_overlap, others))
            others = [secrets.choice([p for p in others if topic_overlap(p) == best])]
        else:
            others.sort(key=lambda p: (bool(set(p.get("topicIds", [])) & set(first.get("topicIds", []))), p.get("difficulty") == first.get("difficulty"), not p.get("imported")))
        return [first["id"]] + ([others[0]["id"]] if others else [])

    def bridge(self):
        last = self.state.get("bridge_last_seen", 0)
        paused = bool(self.state.get("bridge_paused", False))
        jobs = [{key: value for key, value in job.items() if key not in {"code", "problems"}} for job in self.state["jobs"][-30:]]
        return {"connected": not paused and time.time() - last < 75, "paused": paused, "last_seen": last or None, "jobs": jobs}

    def require_bridge_active(self):
        if self.state.get("bridge_paused", False):
            raise APIError("Связь с Dia приостановлена.", 423)

    def allowed_extension_origin(self, origin):
        """Local, non-secret pairing allowlist; a different extension ID needs explicit pairing."""
        parsed = urlparse(origin)
        if parsed.scheme != "chrome-extension" or origin != "chrome-extension://" + parsed.netloc:
            return False
        try:
            config = self.load(self.data_dir / "bridge-extension.json", {})
        except RuntimeError:
            return False
        identifiers = config.get("extension_ids", []) if isinstance(config, dict) else []
        return isinstance(identifiers, list) and parsed.netloc in identifiers

    def bootstrap(self):
        with self.lock:
            return dict(self.catalog(), progress=self.progress(), drafts=self.state["drafts"], interview=self.interview(), bridge=self.bridge())

    def execution_config(self, payload):
        code = payload.get("code")
        if not isinstance(code, str) or len(code.encode("utf-8")) > 300_000:
            raise APIError("Исходник должен быть текстом до 300 КБ.")
        stdin = payload.get("stdin", "")
        if not isinstance(stdin, str) or len(stdin.encode("utf-8")) > 2_000_000:
            raise APIError("Ввод должен быть текстом до 2 МБ.")
        problem = self.problem(payload.get("problem_id")) or {}
        config = {"code": code, "stdin": stdin, "source": problem.get("source", "yandex"), "signature": problem.get("signature"), "problem_id": problem.get("id", payload.get("problem_id"))}
        if "expected" in payload:
            config["expected"] = str(payload["expected"])
        breakpoints = payload.get("breakpoints", [])
        if not isinstance(breakpoints, list) or any(not isinstance(x, int) or x <= 0 for x in breakpoints):
            raise APIError("Точки остановки должны быть номерами строк.")
        config["breakpoints"] = breakpoints[:300]
        return config

    def get(self, path, extension=False):
        if path == "/api/bootstrap":
            return self.bootstrap()
        if path == "/api/pair":
            return {"problem_ids": self.pair()}
        if path == "/api/bridge/status":
            with self.lock:
                if extension:
                    self.state["bridge_last_seen"] = time.time()
                return self.bridge()
        if path == "/api/bridge/jobs":
            with self.lock:
                self.require_bridge_active()
                self.state["bridge_last_seen"] = time.time()
                jobs = []
                for job in self.state["jobs"]:
                    if job["status"] != "queued":
                        continue
                    job["status"] = "running"
                    jobs.append(dict(job))
                self.save()
                return {"jobs": jobs}
        if path.startswith("/api/debug/"):
            identifier = path.rsplit("/", 1)[-1]
            if identifier not in self.sessions:
                raise APIError("Сессия отладки не найдена.", 404)
            return self.sessions[identifier].snapshot()
        raise APIError("API не найден.", 404)

    def post(self, path, payload):
        if path == "/api/judge":
            return self.judge(payload)
        if path == "/api/run":
            return run_python(self.execution_config(payload))
        if path == "/api/debug/start":
            config = self.execution_config(payload)
            active = [s for s in self.sessions.values() if s.process.poll() is None]
            if len(active) >= 8:
                raise APIError("Уже открыто 8 сессий отладки. Завершите одну из них.", 409)
            session = DebugSession(config)
            self.sessions[session.id] = session
            return session.wait(0)
        if path.startswith("/api/debug/") and path.endswith("/command"):
            identifier = path.split("/")[-2]
            if identifier not in self.sessions:
                raise APIError("Сессия отладки не найдена.", 404)
            return self.sessions[identifier].command(payload)
        with self.lock:
            if path == "/api/draft":
                identifier = payload.get("problem_id")
                if not self.problem(identifier):
                    raise APIError("Задача не найдена.", 404)
                draft = self.state["drafts"].setdefault(identifier, {})
                for name in ("code", "notes"):
                    if name in payload:
                        if not isinstance(payload[name], str) or len(payload[name]) > 500_000:
                            raise APIError("Слишком большой текст.")
                        draft[name] = payload[name]
                draft["updated_at"] = time.time()
                self.save()
                return dict(draft)
            if path == "/api/progress":
                identifier = payload.get("problem_id")
                problem = self.problem(identifier)
                if not problem:
                    raise APIError("Задача не найдена.", 404)
                status = payload.get("status")
                if status not in {"todo", "solved", "review"}:
                    raise APIError("Неизвестный статус.")
                draft = self.state["drafts"].setdefault(identifier, {})
                draft.update(status=status, solved=status == "solved" or (status == "review" and problem.get("solved", False)))
                if "assisted" in payload:
                    draft["assisted"] = bool(payload["assisted"])
                draft["updated_at"] = time.time()
                if status == "solved":
                    draft["solved_at"] = draft["updated_at"]
                    self.record_completion(identifier, draft["solved_at"])
                elif status == "todo" and self.interview().get("status") in {"running", "paused"}:
                    self.state["interview"].setdefault("completions", {}).pop(identifier, None)
                self.save()
                return self.progress()
            if path == "/api/interview":
                current, action = self.interview(), payload.get("action")
                if action == "start":
                    identifiers = payload.get("problem_ids") or self.pair()
                    if len(identifiers) != 2 or len(set(identifiers)) != 2 or any(not self.problem(x) for x in identifiers):
                        raise APIError("Выберите две разные задачи.")
                    current = {"status": "running", "problem_ids": identifiers, "remaining_seconds": 3600, "started_at": time.time(), "expires_at": time.time() + 3600, "baseline_solved": {identifier: bool(self.problem(identifier).get("solved")) for identifier in identifiers}, "completions": {}}
                elif action == "pause" and current["status"] == "running":
                    current.update(status="paused", expires_at=None)
                elif action == "resume" and current["status"] == "paused":
                    current.update(status="running", expires_at=time.time() + current["remaining_seconds"])
                elif action == "finish":
                    current.update(status="finished", finished_at=time.time())
                    self.state.setdefault("interview_history", []).append(dict(current))
                else:
                    raise APIError("Это действие недоступно для текущего таймера.", 409)
                self.state["interview"] = current
                self.save()
                return self.interview()
            if path == "/api/bridge/queue":
                return self.queue_bridge(payload)
            if path == "/api/bridge/pause":
                paused = payload.get("paused")
                if type(paused) is not bool:
                    raise APIError("Поле paused должно быть true или false.")
                self.state["bridge_paused"] = paused
                self.save()
                return self.bridge()
            if path == "/api/bridge/heartbeat":
                self.require_bridge_active()
                self.state["bridge_last_seen"] = time.time()
                return {"ok": True}
            if path == "/api/bridge/result":
                return self.bridge_result(payload)
        raise APIError("API не найден.", 404)

    def judge(self, payload):
        identifier = payload.get("problem_id")
        problem = self.problem(identifier)
        if not problem:
            raise APIError("Задача не найдена.", 404)
        if not identifier.startswith("yandex-"):
            raise APIError("Наборы локальной проверки пока поддерживают задачи Яндекс Контеста с stdin/stdout на Python.", 422)
        config = self.execution_config(payload)
        config.pop("expected", None)
        try:
            pack = self.testpacks.load(identifier)
        except TestPackError as error:
            raise APIError(str(error), error.status)
        started = time.monotonic()
        deadline = started + pack["total_timeout_seconds"]
        passed, attempted, failure, verdict = 0, 0, None, "LOCAL_OK"
        for index, case in enumerate(pack["cases"], 1):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                verdict = "TOTAL_TIME_LIMIT"
                if failure is None:
                    failure = {"case_index": index, "input": case["input"], "expected": case["output"], "actual": "", "stderr": "Общий лимит локального набора истёк.", "status": "total_timeout", "duration_ms": 0}
                break
            limit = min(pack["timeout_seconds"], remaining)
            result = run_python(dict(config, stdin=case["input"]), timeout=limit)
            attempted += 1
            if result.get("status") == "timeout":
                failed_verdict = "TOTAL_TIME_LIMIT" if remaining <= pack["timeout_seconds"] else "TIME_LIMIT"
            elif result.get("status") != "ok" or result.get("exit_code") != 0:
                failed_verdict = "RUNTIME_ERROR"
            elif not check_case(pack, case, result.get("stdout", "")):
                failed_verdict = "WRONG_ANSWER"
            else:
                passed += 1
                continue
            if failure is None:
                verdict = failed_verdict
                failure = {"case_index": index, "input": case["input"], "expected": case["output"], "actual": result.get("stdout", ""), "stderr": result.get("stderr", ""), "error": result.get("error"), "status": failed_verdict.lower(), "duration_ms": round(result.get("duration", 0) * 1000)}
            if failed_verdict == "TOTAL_TIME_LIMIT":
                verdict = failed_verdict
                break
        duration = time.monotonic() - started
        if duration > pack["total_timeout_seconds"]:
            verdict = "TOTAL_TIME_LIMIT"
        return {"source": "local", "official": False, "verdict": verdict, "passed_count": passed, "total": len(pack["cases"]), "attempted_count": attempted, "duration_ms": round(duration * 1000), "first_failure": failure, "provenance": pack["provenance"], "comparison": pack["comparison"], "checker": pack.get("checker")}

    def queue_bridge(self, payload):
        self.require_bridge_active()
        action = payload.get("action")
        if action not in {"submit", "import_contests", "import_leetcode"}:
            raise APIError("Неизвестное действие Dia.")
        job = {"job_id": secrets.token_hex(12), "action": action, "status": "queued", "created_at": time.time()}
        if action == "submit":
            problem = self.problem(payload.get("problem_id"))
            if not problem:
                raise APIError("Задача не найдена.", 404)
            code = payload.get("code", "")
            if not isinstance(code, str) or not code.strip() or len(code) > 300_000:
                raise APIError("Перед отправкой нужен непустой исходник.")
            if any(x.get("action") == "submit" and x.get("problem_id") == problem["id"] and x.get("status") in {"queued", "running"} for x in self.state["jobs"]):
                raise APIError("Эта задача уже ожидает отправки или вердикта.", 409)
            job.update(problem_id=problem["id"], problem=problem, code=code, dry_run=bool(payload.get("dry_run", False)))
        elif action == "import_contests":
            job["contests"] = self.catalog()["contests"]
            if payload.get("urls"):
                wanted = set(payload["urls"])
                job["contests"] = [x for x in job["contests"] if x.get("url") in wanted]
        else:
            job["problems"] = [p for p in self.catalog()["problems"] if p.get("source") == "leetcode"]
            job["urls"] = payload.get("urls") or [p["url"] for p in job["problems"]]
        self.state["jobs"].append(job)
        self.state["jobs"] = self.state["jobs"][-300:]
        self.save()
        return {"job_id": job["job_id"]}

    def bridge_result(self, payload):
        job = next((x for x in self.state["jobs"] if x["job_id"] == payload.get("job_id")), None)
        if not job:
            raise APIError("Задание расширения не найдено.", 404)
        status = payload.get("status")
        if status not in {"complete", "error", "progress"}:
            raise APIError("Неизвестный результат расширения.")
        self.state["bridge_last_seen"] = time.time()
        # A service-worker retry must not change a finished submission or count
        # its old acceptance in a later interview session.
        if job["action"] == "submit" and job.get("status") in {"complete", "error"}:
            return {"ok": True, "ignored": True}
        if "problems" in payload:
            known_urls = {urlparse(p.get("url", "")).path.rstrip("/"): p["id"] for p in self.catalog()["problems"] if p.get("source") == "leetcode"}
            for raw in payload["problems"]:
                identifier = raw.get("id", "")
                if not isinstance(identifier, str) or not identifier.startswith(("yandex-", "leetcode-")):
                    raise APIError("Некорректный ID импортируемой задачи.")
                safe = dict(raw)
                previous = self.state["imports"].get(identifier, {})
                if previous.get("topic_assignment") and "topic_assignment" not in raw:
                    for field in ("topicIds", "interview_priority"):
                        if field in previous:
                            safe[field] = previous[field]
                if identifier.startswith(("yandex-", "leetcode-")):
                    safe["previously_solved"] = bool(raw.get("solved") or raw.get("previously_solved") or self.state["imports"].get(identifier, {}).get("previously_solved"))
                    safe["solved"] = False
                if raw.get("source") == "leetcode":
                    identifier = known_urls.get(urlparse(raw.get("url", "")).path.rstrip("/"), identifier)
                    safe["id"] = identifier
                safe["statement_html"] = sanitize_html(raw.get("statement_html"))
                safe["imported"] = bool(raw.get("statement_html"))
                self.state["imports"][identifier] = dict(self.state["imports"].get(identifier, {}), **safe)
        contest = str(payload.get("contest_id", ""))
        if contest:
            import_status = payload.get("import_status")
            if import_status in {"complete", "error"} or status != "progress":
                self.state["contest_status"][contest] = {"import_status": import_status or ("error" if status == "error" else "complete"), "import_message": payload.get("message", ""), "imported_at": time.time()}
        job.update({k: payload[k] for k in ("verdict", "run_id", "message", "progress", "completed", "total") if k in payload})
        job["updated_at"] = time.time()
        if status != "progress":
            job["status"] = status
        if job["action"] == "submit" and status == "complete" and not job.get("dry_run") and not payload.get("dry_run") and str(payload.get("verdict", "")).strip().lower() in {"ok", "accepted"}:
            identifier = job["problem_id"]
            accepted_at = time.time()
            self.state["drafts"].setdefault(identifier, {}).update(status="solved", solved=True, accepted_run_id=payload.get("run_id"), accepted_at=accepted_at)
            self.record_completion(identifier, accepted_at)
        self.save()
        return {"ok": True}

    def close(self):
        for session in self.sessions.values():
            kill_process(session.process)


class Handler(SimpleHTTPRequestHandler):
    app: PracticeApp
    protocol_version = "HTTP/1.1"

    def log_message(self, format, *args):
        if args and str(args[0]).startswith("GET /api/bridge"):
            return
        if len(args) > 1 and str(args[0]).startswith("POST /api/bridge/heartbeat ") and str(args[1]) == "200":
            return
        super().log_message(format, *args)

    def permitted(self):
        self.cors_origin = None
        hostname = urlparse("http://" + self.headers.get("Host", "")).hostname
        if hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise APIError("Разрешён только локальный адрес.", 403)
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlparse(origin)
            if parsed.scheme == "chrome-extension":
                if not self.app.allowed_extension_origin(origin):
                    raise APIError("Это расширение не подключено к локальному приложению.", 403)
                self.cors_origin = origin
                return origin
            if parsed.scheme != "http" or parsed.netloc != self.headers.get("Host"):
                raise APIError("Этот источник не может обращаться к локальному приложению.", 403)
        elif self.headers.get("Sec-Fetch-Site") == "cross-site":
            raise APIError("Межсайтовый запрос запрещён.", 403)
        return origin

    def respond(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if getattr(self, "cors_origin", None):
            self.send_header("Access-Control-Allow-Origin", self.cors_origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        try:
            self.permitted()
            self.send_response(204)
            origin = self.headers.get("Origin", "")
            if origin:
                self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Content-Length", "0")
            self.end_headers()
        except APIError as error:
            self.respond({"error": str(error)}, error.status)

    def do_GET(self):
        try:
            self.permitted()
            path = urlparse(self.path).path
            if path.startswith("/api/"):
                return self.respond(self.app.get(path, extension=self.headers.get("Origin", "").startswith("chrome-extension://")))
            relative = unquote(path).lstrip("/") or "index.html"
            destination = (ROOT / "static" / relative).resolve()
            static_root = (ROOT / "static").resolve()
            if not destination.is_relative_to(static_root) or not destination.is_file():
                return self.respond({"error": "Файл не найден."}, 404)
            body = destination.read_bytes()
            self.send_response(200)
            kind = mimetypes.guess_type(str(destination))[0] or "application/octet-stream"
            self.send_header("Content-Type", kind + ("; charset=utf-8" if kind.startswith("text/") or kind == "application/javascript" else ""))
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(body)
        except APIError as error:
            self.respond({"error": str(error)}, error.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.respond({"error": str(error)}, 500)

    def do_POST(self):
        try:
            self.permitted()
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                raise APIError("Требуется JSON.", 415)
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= MAX_REQUEST:
                raise APIError("Недопустимый размер запроса.", 413)
            payload = json.loads(self.rfile.read(size))
            if not isinstance(payload, dict):
                raise APIError("Требуется JSON-объект.")
            self.respond(self.app.post(urlparse(self.path).path, payload))
        except APIError as error:
            self.respond({"error": str(error)}, error.status)
        except (ValueError, TypeError) as error:
            self.respond({"error": str(error)}, 400)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as error:
            self.respond({"error": str(error)}, 500)


def main():
    parser = argparse.ArgumentParser(description="Local algorithm practice")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    app = PracticeApp(args.data_dir)
    Handler.app = app
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"Algo Practice: http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.close()
        server.server_close()


if __name__ == "__main__":
    main()
