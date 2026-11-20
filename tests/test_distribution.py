"""Check the shared starter without changing the source seed or a user's state."""
from collections import Counter
from html.parser import HTMLParser
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location("distribution_practice_server", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
from testpack_registry import TestPackRegistry


class Images(HTMLParser):
    def __init__(self):
        super().__init__()
        self.sources = []

    def handle_starttag(self, tag, attributes):
        if tag == "img":
            self.sources.extend(value for key, value in attributes if key == "src" and value)


class DistributionSeedTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads((ROOT / "data" / "catalog.json").read_text(encoding="utf-8"))

    def test_shared_catalog_is_complete_and_starts_with_no_solved_tasks(self):
        problems = self.catalog["problems"]
        self.assertEqual(len(problems), 285)
        self.assertEqual(len({problem["id"] for problem in problems}), 285)
        self.assertEqual(Counter(problem["source"] for problem in problems), {"yandex": 211, "leetcode": 74})
        self.assertEqual(len(self.catalog["contests"]), 34)
        self.assertEqual(len(self.catalog["topics"]), 30)
        for problem in problems:
            with self.subTest(problem=problem["id"]):
                self.assertIs(problem.get("solved"), False)
                self.assertIs(problem.get("previously_solved"), False)
                self.assertIs(problem.get("assisted"), False)
                self.assertEqual(problem.get("status"), "todo")

    def test_seed_contains_no_personal_source_or_solution_receipts(self):
        private_keys = {
            "source_sheet", "sheet_row", "drafts", "jobs", "notes", "code",
            "accepted_run_id", "accepted_at", "solved_at", "updated_at",
            "bridge_last_seen", "interview_history", "extension_ids",
        }

        def walk(value):
            if isinstance(value, dict):
                self.assertFalse(private_keys.intersection(value), private_keys.intersection(value))
                for item in value.values():
                    walk(item)
            elif isinstance(value, list):
                for item in value:
                    walk(item)

        walk(self.catalog)
        text = json.dumps(self.catalog, ensure_ascii=False)
        self.assertNotIn("docs.google.com/spreadsheets/", text)
        self.assertNotRegex(text, r"/submissions/\d+")
        self.assertNotRegex(text, r"/Users/[^/]+/(?:Projects|Library|Documents)/")

    def test_connection_template_has_no_paired_extension_or_personal_folder(self):
        example = json.loads((ROOT / "data" / "bridge-extension.example.json").read_text(encoding="utf-8"))
        self.assertEqual(example, {"extension_ids": []})
        # Actual pairing is local, so check the distributed template and UI only.
        html = (ROOT / "static" / "index.html").read_text(encoding="utf-8")
        self.assertIsNone(re.search(r"/Users/[^/]+/", html), "The connection dialog contains a personal macOS folder.")
        self.assertIsNone(re.search(r"chrome-extension://[a-p]{32}", html), "The connection dialog contains a pre-paired extension ID.")

    def test_all_local_statement_images_and_theory_links_resolve(self):
        local_images = []
        for problem in self.catalog["problems"]:
            parser = Images()
            parser.feed(problem.get("statement_html", ""))
            for source in parser.sources:
                if source.startswith("/imported/statements/"):
                    image = ROOT / "static" / source.lstrip("/")
                    self.assertTrue(image.is_file(), (problem["id"], source))
                    self.assertGreater(image.stat().st_size, 0)
                    local_images.append(source)
        self.assertGreaterEqual(len(local_images), 40)
        for topic in self.catalog["topics"]:
            for source in topic.get("sources", []):
                url = source.get("url", "")
                if url.startswith("/"):
                    path = url.split("#", 1)[0].split("?", 1)[0]
                    self.assertTrue((ROOT / "static" / path.lstrip("/")).is_file(), (topic["id"], url))

    def test_all_43_ready_packs_have_100_valid_cases_and_known_problem_ids(self):
        directory = ROOT / "data" / "testpacks"
        packs = sorted(directory.glob("*.json"))
        self.assertEqual(len(packs), 43)
        known = {problem["id"] for problem in self.catalog["problems"]}
        registry = TestPackRegistry(directory)
        total = 0
        for path in packs:
            with self.subTest(pack=path.name):
                self.assertIn(path.stem, known)
                pack = registry.load(path.stem)
                self.assertEqual(len(pack["cases"]), 100)
                total += len(pack["cases"])
        self.assertEqual(total, 4300)

    def test_private_reference_material_is_not_in_the_distribution(self):
        for path in ("research", "anki", "static/reference/book.pdf", "data/sheet-import.json"):
            self.assertFalse((ROOT / path).exists(), path)
        self.assertTrue((ROOT / "static" / "vendor" / "monaco" / "LICENSE").is_file())


class FreshInstallTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="algo-distribution-test-")
        destination = Path(self.directory.name)
        shutil.copy2(ROOT / "data" / "catalog.json", destination / "catalog.json")
        shutil.copytree(ROOT / "data" / "testpacks", destination / "testpacks")
        self.app = server.PracticeApp(destination)

    def tearDown(self):
        self.app.close()
        self.directory.cleanup()

    def test_first_boot_has_no_user_progress_history_connection_or_active_timer(self):
        bootstrap = self.app.bootstrap()
        self.assertEqual(bootstrap["progress"]["solved"], 0)
        self.assertEqual(bootstrap["progress"]["remaining"], 200)
        self.assertEqual(bootstrap["drafts"], {})
        self.assertEqual(bootstrap["bridge"]["jobs"], [])
        self.assertFalse(bootstrap["bridge"]["connected"])
        self.assertIsNone(bootstrap["bridge"]["last_seen"])
        self.assertEqual(bootstrap["interview"]["status"], "idle")
        self.assertEqual(bootstrap["interview"]["remaining_seconds"], 3600)
        self.assertEqual(bootstrap["interview"]["problem_ids"], [])
        self.assertEqual(len(bootstrap["problems"]), 285)
        self.assertEqual(sum(problem.get("local_test_count", 0) == 100 for problem in bootstrap["problems"]), 43)
        self.assertFalse(self.app.state.get("interview_history"))

    def import_problems(self, problems):
        job = self.app.post("/api/bridge/queue", {"action": "import_contests"})
        return self.app.post("/api/bridge/result", {"job_id": job["job_id"], "status": "complete", "problems": problems})

    def test_importing_existing_and_new_platform_accepted_tasks_does_not_count_as_practice(self):
        existing_yandex = next(problem for problem in self.app.catalog()["problems"] if problem["source"] == "yandex")
        inputs = [
            {"id": existing_yandex["id"], "source": "yandex", "solved": True, "statement_html": "<p>Updated course statement.</p>"},
            {"id": "leetcode-1", "source": "leetcode", "url": "https://leetcode.com/problems/two-sum/", "solved": True, "statement_html": "<p>Updated statement.</p>"},
            {"id": "yandex-999999-A", "source": "yandex", "solved": True, "title": "Import fixture", "statement_html": "<p>New course statement.</p>"},
            {"id": "leetcode-distribution-fixture", "source": "leetcode", "url": "https://leetcode.com/problems/distribution-fixture/", "solved": True, "title": "Import fixture", "statement_html": "<p>New statement.</p>"},
        ]
        self.import_problems(inputs)
        self.assertEqual(self.app.progress()["solved"], 0)
        for item in inputs:
            with self.subTest(problem=item["id"]):
                self.assertFalse(self.app.problem(item["id"])["solved"])
                self.assertEqual(self.app.problem(item["id"])["status"], "todo")
        reopened = server.PracticeApp(self.directory.name)
        try:
            self.assertEqual(reopened.progress()["solved"], 0)
        finally:
            reopened.close()

    def test_reimport_preserves_solutions_earned_locally_and_user_drafts(self):
        identifier = "leetcode-1"
        self.app.post("/api/draft", {"problem_id": identifier, "code": "# my practice draft", "notes": "My notes"})
        self.app.post("/api/progress", {"problem_id": identifier, "status": "solved"})
        self.import_problems([{"id": identifier, "source": "leetcode", "url": "https://leetcode.com/problems/two-sum/", "solved": False, "statement_html": "<p>Updated source.</p>"}])
        self.assertEqual(self.app.progress()["solved"], 1)
        self.assertTrue(self.app.problem(identifier)["solved"])
        self.assertEqual(self.app.state["drafts"][identifier]["code"], "# my practice draft")
        self.assertEqual(self.app.state["drafts"][identifier]["notes"], "My notes")


if __name__ == "__main__":
    unittest.main()
