#!/usr/bin/env python3
"""Cache official statement images after an authorized import has finished.

Requires --all or repeated --problem-id. --dry-run only reads local API and
prints eligible URLs; it never downloads or writes. Publishing reuses an
existing terminal import job (complete or error) and preserves its actual
status and message/progress metadata. A partial import stays marked error.
No browser, cookies, credentials, proxies or new import jobs are used.
"""
from __future__ import annotations

import argparse
from hashlib import sha256
from html import escape
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlparse
from urllib.request import build_opener, HTTPRedirectHandler, ProxyHandler, Request

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 10 * 1024 * 1024
OFFICIAL_HOSTS = {"official.contest.yandex.ru", "assets.contest.yandex.net", "assets.leetcode.com"}
REDIRECT_HOSTS = OFFICIAL_HOSTS | {"contest-problem-files.s3-private.mds.yandex.net"}
MIME_EXTENSIONS = {"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp"}
SRC_ATTRIBUTE = re.compile(r"(\bsrc\s*=\s*)(?:\"[^\"]*\"|'[^']*'|[^\s>]+)", re.I)


def safe_image_url(url, hosts):
    try:
        parsed = urlparse(url)
        return (parsed.scheme == "https" and parsed.hostname in hosts
                and parsed.username is None and parsed.password is None
                and parsed.port in {None, 443}
                and not re.search(r"[\x00-\x20\x7f]", url)
                and not parsed.path.lower().endswith(".svg"))
    except (TypeError, ValueError):
        return False


def official_image_url(url):
    return safe_image_url(url, OFFICIAL_HOSTS)


def redirected_image_url(url):
    return safe_image_url(url, REDIRECT_HOSTS)


class OfficialRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        if not redirected_image_url(newurl):
            raise ValueError("Перенаправление изображения ведёт за пределы разрешённых учебных доменов.")
        return super().redirect_request(request, fp, code, msg, headers, newurl)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        raise ValueError("Локальный API не должен перенаправлять запросы.")


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            url = dict(attrs).get("src", "")
            if official_image_url(url) and url not in self.urls:
                self.urls.append(url)

    handle_startendtag = handle_starttag


class ImageRewriter(HTMLParser):
    def __init__(self, replacements):
        super().__init__(convert_charrefs=False)
        self.replacements, self.parts = replacements, []

    def handle_starttag(self, tag, attrs):
        raw = self.get_starttag_text()
        if tag == "img":
            src = dict(attrs).get("src", "")
            if src in self.replacements:
                raw = SRC_ATTRIBUTE.sub(lambda match: match[1] + '"' + escape(self.replacements[src], quote=True) + '"', raw, count=1)
        self.parts.append(raw)

    handle_startendtag = handle_starttag

    def handle_endtag(self, tag): self.parts.append("</" + tag + ">")
    def handle_data(self, data): self.parts.append(data)
    def handle_entityref(self, name): self.parts.append("&" + name + ";")
    def handle_charref(self, name): self.parts.append("&#" + name + ";")
    def handle_comment(self, data): self.parts.append("<!--" + data + "-->")


def image_type(body):
    if body.startswith(b"\x89PNG\r\n\x1a\n"): return "image/png"
    if body.startswith(b"\xff\xd8\xff"): return "image/jpeg"
    if body.startswith((b"GIF87a", b"GIF89a")): return "image/gif"
    if len(body) >= 12 and body[:4] == b"RIFF" and body[8:12] == b"WEBP": return "image/webp"
    raise ValueError("Файл не является PNG, JPEG, GIF или WebP; SVG не кэшируется.")


def download_image(url):
    if not official_image_url(url):
        raise ValueError("Адрес изображения не входит в разрешённый список.")
    opener = build_opener(ProxyHandler({}), OfficialRedirects())
    request = Request(url, headers={"User-Agent": "LocalAlgoPractice-StatementCache/1.0", "Accept": ", ".join(MIME_EXTENSIONS)})
    with opener.open(request, timeout=25) as response:
        if not redirected_image_url(response.url):
            raise ValueError("Недопустимый конечный адрес изображения.")
        mime = response.headers.get_content_type().lower()
        if mime not in MIME_EXTENSIONS:
            raise ValueError("Недопустимый MIME: " + mime)
        length = response.headers.get("Content-Length")
        if length and int(length) > MAX_BYTES:
            raise ValueError("Изображение больше 10 МБ.")
        chunks, size = [], 0
        while True:
            chunk = response.read(min(65536, MAX_BYTES + 1 - size))
            if not chunk: break
            chunks.append(chunk)
            size += len(chunk)
            if size > MAX_BYTES: raise ValueError("Изображение больше 10 МБ.")
        body = b"".join(chunks)
        if image_type(body) != mime:
            raise ValueError("MIME изображения не совпадает с форматом файла.")
        return body, MIME_EXTENSIONS[mime]


def cache_file(problem_id, body, extension):
    safe_id = re.sub(r"[^A-Za-z0-9_.-]", "_", problem_id)[:100] or "problem"
    name = safe_id + "-" + sha256(body).hexdigest()[:24] + "." + extension
    directory = ROOT / "static" / "imported" / "statements"
    if not directory.resolve().is_relative_to((ROOT / "static").resolve()):
        raise ValueError("Каталог изображений выходит за пределы static.")
    directory.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=directory, prefix=".image-", delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(body)
        os.replace(temporary, directory / name)
    finally:
        if temporary is not None: temporary.unlink(missing_ok=True)
    return "/imported/statements/" + name


def api_request(base_url, path, payload=None):
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {"Content-Type": "application/json"} if payload is not None else {}
    opener = build_opener(ProxyHandler({}), NoRedirects())
    with opener.open(Request(base_url + path, data=body, headers=headers), timeout=30) as response:
        return json.load(response)


def completed_job(jobs, problem, requested=None):
    action = "import_contests" if problem.get("source") == "yandex" else "import_leetcode"
    matches = [job for job in jobs if job.get("status") in {"complete", "error"} and job.get("action") == action and (not requested or job.get("job_id") == requested)]
    if not matches:
        raise ValueError("Не найден завершённый импорт для " + problem["id"] + ". Дождитесь импорта или укажите --job-id.")
    completed = [job for job in matches if job["status"] == "complete"]
    return (completed or matches)[-1]


def result_payload(job, problem):
    if job.get("status") not in {"complete", "error"}:
        raise ValueError("Результат кэширования требует завершённого задания импорта.")
    payload = {"job_id": job["job_id"], "status": job["status"], "problems": [problem]}
    for key in ("message", "progress", "completed", "total"):
        if key in job: payload[key] = job[key]
    return payload


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--all", action="store_true")
    selection.add_argument("--problem-id", action="append")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--job-id")
    parser.add_argument("--base-url", default="http://127.0.0.1:8765")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.path or parsed.username or parsed.password or parsed.query or parsed.fragment:
        parser.error("--base-url должен быть адресом локального HTTP-приложения.")
    snapshot = api_request(base, "/api/bootstrap")
    selected = [problem for problem in snapshot["problems"] if args.all or problem["id"] in args.problem_id]
    if args.problem_id and set(args.problem_id) - {problem["id"] for problem in selected}:
        parser.error("Некоторые --problem-id не найдены в каталоге.")
    plans = []
    for problem in selected:
        images = Images()
        images.feed(problem.get("statement_html", ""))
        if images.urls: plans.append((problem, images.urls))
    if args.dry_run:
        print(json.dumps({"dry_run": True, "problems": [{"id": problem["id"], "images": urls} for problem, urls in plans]}, ensure_ascii=False, indent=2))
        return
    jobs = snapshot.get("bridge", {}).get("jobs", [])
    jobs_by_problem = {problem["id"]: completed_job(jobs, problem, args.job_id) for problem, _ in plans}
    report, errors = [], []
    for problem, urls in plans:
        replacements = {}
        for url in urls:
            try:
                body, extension = download_image(url)
                replacements[url] = cache_file(problem["id"], body, extension)
            except Exception as error:
                errors.append({"id": problem["id"], "error": str(error)[:500]})
        if not replacements:
            continue
        rewriter = ImageRewriter(replacements)
        rewriter.feed(problem.get("statement_html", ""))
        updated = dict(problem, statement_html="".join(rewriter.parts))
        try:
            api_request(base, "/api/bridge/result", result_payload(jobs_by_problem[problem["id"]], updated))
        except Exception as error:
            errors.append({"id": problem["id"], "error": "Не удалось обновить локальное условие: " + str(error)[:500]})
            continue
        report.append({"id": problem["id"], "cached_images": len(replacements), "eligible_images": len(urls)})
    print(json.dumps({"updated": report, "problems": len(report), "errors": errors}, ensure_ascii=False, indent=2))


if __name__ == "__main__": main()
