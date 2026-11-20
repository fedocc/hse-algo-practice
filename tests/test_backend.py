import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("practice_server", ROOT / "server.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class BackendTests(unittest.TestCase):
    def test_binary_stdout_stderr_and_split_utf8_are_captured(self):
        code = r'''import sys
sys.stdout.buffer.write(b'\xd0')
sys.stdout.buffer.flush()
sys.stdout.buffer.write(b'\x90')
sys.stdout.write('!')
sys.stderr.buffer.write('ошибка'.encode(sys.stderr.encoding))
sys.stdout.buffer.write(b'\xd0')
'''
        result = server.run_python({'code': code, 'stdin': '', 'source': 'yandex'})
        self.assertEqual(result['status'], 'ok')
        self.assertEqual(result['stdout'], 'А!�')
        self.assertEqual(result['stderr'], 'ошибка')

    def test_binary_and_text_output_share_the_same_cap(self):
        result = server.run_python({'code': "import sys\nsys.stdout.write('x' * 199999)\nsys.stdout.buffer.write(b'yz')", 'stdin': '', 'source': 'yandex'})
        self.assertEqual(result['status'], 'error')
        self.assertEqual(len(result['stdout']), server.MAX_OUTPUT)
        self.assertIn('OutputLimitError', result['error'])
        result = server.run_python({'code': "import sys\nsys.stderr.buffer.write(b'x' * 200001)", 'stdin': '', 'source': 'yandex'})
        self.assertEqual(result['status'], 'error')
        self.assertEqual(len(result['stderr']), server.MAX_OUTPUT)

    def test_undo_solve_updates_running_and_paused_interview_results(self):
        for paused in (False, True):
            with self.subTest(paused=paused):
                self.app.post('/api/interview', {'action': 'start', 'problem_ids': ['yandex-42-A', 'leetcode-2']})
                self.app.post('/api/progress', {'problem_id': 'yandex-42-A', 'status': 'solved'})
                self.assertTrue(self.app.interview()['results'][0]['solved'])
                if paused:self.app.post('/api/interview', {'action': 'pause'})
                self.app.post('/api/progress', {'problem_id': 'yandex-42-A', 'status': 'todo'})
                self.assertFalse(self.app.interview()['results'][0]['solved'])
                self.assertFalse(server.PracticeApp(self.directory.name).interview()['results'][0]['solved'])

    def test_undo_solve_keeps_completed_interview_history(self):
        self.app.post('/api/interview', {'action': 'start', 'problem_ids': ['yandex-42-A', 'leetcode-2']})
        self.app.post('/api/progress', {'problem_id': 'yandex-42-A', 'status': 'solved'})
        self.app.post('/api/interview', {'action': 'finish'})
        self.app.post('/api/progress', {'problem_id': 'yandex-42-A', 'status': 'todo'})
        self.assertFalse(self.app.problem('yandex-42-A')['solved'])
        self.assertTrue(self.app.interview()['results'][0]['solved'])
        self.assertTrue(self.app.state['interview_history'][-1]['results'][0]['solved'])

    def test_palindrome_checker_ignores_trailing_output_whitespace(self):
        from testpack_registry import check_case
        pack = {'comparison': 'validator', 'checker': 'shortest_containing_palindrome'}
        case = {'input': 'ab\n', 'output': 'aba\n'}
        self.assertTrue(check_case(pack, case, 'bab \n'))
        self.assertFalse(check_case(pack, case, 'aba extra\n'))
    def test_million_character_statement_input_keeps_header(self):
        from testpack_registry import validate_pack, TestPackError
        value = '1000000\n' + 'a' * 1000000 + '\n'
        self.assertEqual(self.app.execution_config({'code': 'print(0)', 'stdin': value})['stdin'], value)
        pack = {'schema_version': 1, 'problem_id': 'yandex-42-A', 'language': 'python3', 'provenance': {'kind': 'published', 'title': 'Published limit test'}, 'cases': [{'input': value, 'output': '0'}]}
        self.assertEqual(len(validate_pack(pack, 'yandex-42-A')['cases']), 1)
        pack['cases'][0]['input'] = 'x' * 2000001
        with self.assertRaises(TestPackError): validate_pack(pack, 'yandex-42-A')

    def test_sample_parser_ignores_compiler_limit_table(self):
        from repair_samples import extract
        markup = '<table><tr><th>Язык</th><th>Ввод</th><th>Вывод</th></tr><tr><td>Все языки</td><td>2 секунды</td><td>64 МБ</td></tr></table><table><tr><th>Ввод</th><th>Вывод</th></tr><tr><td><pre>2\n1 2</pre></td><td><pre>3</pre></td></tr></table>'
        self.assertEqual(extract(markup), [{'input': '2\n1 2', 'output': '3'}])

    def test_reimport_keeps_reviewed_topic_assignment(self):
        self.app.state['imports']['yandex-42-A'] = {'id': 'yandex-42-A', 'source': 'yandex', 'topicIds': ['graphs'], 'topic_assignment': 'Reviewed graph connectivity', 'interview_priority': True}
        job = self.app.post('/api/bridge/queue', {'action': 'import_contests'})
        self.app.post('/api/bridge/result', {'job_id': job['job_id'], 'status': 'complete', 'problems': [{'id': 'yandex-42-A', 'source': 'yandex', 'statement_html': '<p>Updated statement.</p>', 'topicIds': ['mixed'], 'interview_priority': False}]})
        self.assertEqual(self.app.problem('yandex-42-A')['topicIds'], ['graphs'])
        self.assertTrue(self.app.problem('yandex-42-A')['interview_priority'])

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        catalog = {
            "topics": [{"id": "arrays", "title": "Массивы"}, {"id": "graphs", "title": "Графы"}],
            "contests": [{"id": "42", "title": "DFS", "import_status": "pending"}],
            "problems": [
                {"id": "yandex-42-A", "source": "yandex", "title": "A", "topicIds": ["graphs"], "difficulty": "Medium", "solved": False, "imported": True, "statement_html": "<p>Graph problem</p>"},
                {"id": "leetcode-1", "source": "leetcode", "title": "Two Sum", "url": "https://leetcode.com/problems/two-sum/", "topicIds": ["arrays"], "difficulty": "Easy", "solved": True, "imported": False},
                {"id": "leetcode-2", "source": "leetcode", "title": "Two Sum 2", "url": "https://leetcode.com/problems/two-sum-2/", "topicIds": ["arrays"], "difficulty": "Easy", "solved": False, "imported": True, "statement_html": "<p>Array problem</p>"},
            ],
        }
        Path(self.directory.name, "catalog.json").write_text(json.dumps(catalog))
        self.app = server.PracticeApp(self.directory.name)

    def tearDown(self):
        self.app.close()
        for session in self.app.sessions.values():
            try:
                session.process.wait(timeout=2)
            except Exception:
                pass
        self.directory.cleanup()

    def test_run_stdin_expected_and_no_code_offset(self):
        result = self.app.post("/api/run", {"code": "n = int(input())\nprint(n + 3)\n", "stdin": "7\n", "expected": "10"})
        self.assertEqual(result["stdout"], "10\n")
        self.assertTrue(result["passed"])
        error = self.app.post("/api/run", {"code": "x = 1\nraise ValueError('oops')\n"})
        self.assertEqual(error["status"], "error")
        self.assertIn('solution.py", line 2', error["stderr"])

    def test_run_timeout_and_output_limit(self):
        result = server.run_python({"code": "while True: pass", "stdin": ""}, timeout=.3)
        self.assertEqual(result["status"], "timeout")
        result = self.app.post("/api/run", {"code": "print('x' * 500000)"})
        self.assertEqual(result["status"], "error")
        self.assertLessEqual(len(result["stdout"]), server.MAX_OUTPUT)
        self.assertIn("лимит вывода", result["stderr"])

    def test_breakpoint_next_variables_and_stdin(self):
        state = self.app.post("/api/debug/start", {"code": "x = int(input())\ny = x + 1\nprint(y)\n", "stdin": "7\n", "breakpoints": [2]})
        self.assertEqual(state["status"], "paused", state)
        self.assertEqual(state["line"], 2)
        self.assertEqual(next(x["value"] for x in state["locals"] if x["name"] == "x"), "7")
        route = "/api/debug/" + state["session_id"] + "/command"
        state = self.app.post(route, {"command": "next"})
        self.assertEqual(state["line"], 3)
        self.assertEqual(next(x["value"] for x in state["locals"] if x["name"] == "y"), "8")
        state = self.app.post(route, {"command": "continue"})
        self.assertEqual(state["status"], "finished")
        self.assertEqual(state["stdout"], "8\n")

    def test_step_into_function_and_stop(self):
        state = self.app.post("/api/debug/start", {"code": "def add(x):\n    y = x + 1\n    return y\nz = add(2)\nprint(z)\n", "breakpoints": [4]})
        route = "/api/debug/" + state["session_id"] + "/command"
        state = self.app.post(route, {"command": "step"})
        self.assertEqual(state["line"], 2, state)
        self.assertEqual(state["stack"][0]["name"], "add")
        self.assertEqual(self.app.post(route, {"command": "stop"})["status"], "finished")

    def test_leetcode_wrapper_infers_method(self):
        result = self.app.post("/api/run", {"problem_id": "leetcode-1", "code": "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        return [nums.index(2), nums.index(target - 2)]\n", "stdin": '{"nums":[2,7,11,15],"target":9}', "expected": "[0,1]"})
        self.assertEqual(result["status"], "ok", result)
        self.assertTrue(result["passed"])
        displayed = self.app.post("/api/run", {"problem_id": "leetcode-1", "code": "class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]\n", "stdin": "nums = [2,7,11,15], target = 9", "expected": "[0,1]"})
        self.assertTrue(displayed["passed"], displayed)

    def test_progress_persistence_and_review(self):
        self.assertEqual(self.app.progress()["solved"], 1)
        self.app.post("/api/draft", {"problem_id": "yandex-42-A", "code": "print(1)", "notes": "remember"})
        self.app.post("/api/progress", {"problem_id": "yandex-42-A", "status": "solved"})
        self.app.post("/api/progress", {"problem_id": "yandex-42-A", "status": "review"})
        loaded = server.PracticeApp(self.directory.name)
        self.assertEqual(loaded.progress()["solved"], 2)
        self.assertEqual(loaded.bootstrap()["drafts"]["yandex-42-A"]["code"], "print(1)")

    def test_import_idempotence_preserves_progress_and_sanitizes(self):
        self.app.post("/api/progress", {"problem_id": "yandex-42-A", "status": "solved"})
        job_id = self.app.post("/api/bridge/queue", {"action": "import_contests"})["job_id"]
        payload = {"job_id": job_id, "status": "progress", "contest_id": "42", "problems": [{"id": "yandex-42-A", "title": "Imported A", "solved": False, "statement_html": '<p onclick="bad()">Hello<script>alert(1)</script><a href="javascript:bad()">link</a></p>'}]}
        self.app.post("/api/bridge/result", payload)
        self.app.post("/api/bridge/result", payload)
        self.assertEqual(len(self.app.catalog()["problems"]), 3)
        problem = self.app.problem("yandex-42-A")
        self.assertTrue(problem["solved"])
        self.assertIn("Hello", problem["statement_html"])
        self.assertNotIn("script", problem["statement_html"])
        self.assertNotIn("onclick", problem["statement_html"])

    def test_leetcode_import_matches_url(self):
        # Personal progress belongs in drafts, never in the shared seed catalog.
        self.app.post("/api/progress", {"problem_id": "leetcode-1", "status": "solved"})
        job_id = self.app.post("/api/bridge/queue", {"action": "import_leetcode"})["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "problems": [{"id": "leetcode-two-sum", "source": "leetcode", "url": "https://leetcode.com/problems/two-sum/", "title": "Two Sum", "statement_html": "<p>Imported</p>"}]})
        self.assertEqual(len(self.app.catalog()["problems"]), 3)
        self.assertTrue(self.app.problem("leetcode-1")["solved"])
        self.assertTrue(self.app.problem("leetcode-1")["imported"])

    def test_bridge_claim_once_duplicate_submit_and_dry_run(self):
        payload = {"action": "submit", "problem_id": "yandex-42-A", "code": "print(1)", "dry_run": True}
        job_id = self.app.post("/api/bridge/queue", payload)["job_id"]
        with self.assertRaises(server.APIError):
            self.app.post("/api/bridge/queue", payload)
        self.assertEqual(len(self.app.get("/api/bridge/jobs")["jobs"]), 1)
        self.assertEqual(self.app.get("/api/bridge/jobs")["jobs"], [])
        self.assertTrue(self.app.bridge()["connected"])
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "verdict": "Accepted"})
        self.assertFalse(self.app.problem("yandex-42-A")["solved"])
        payload["dry_run"] = False
        job_id = self.app.post("/api/bridge/queue", payload)["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "verdict": "OK", "run_id": "123"})
        self.assertTrue(self.app.problem("yandex-42-A")["solved"])

    def test_official_wrong_answer_then_accepted_updates_bootstrap_and_timer(self):
        identifier = "yandex-42-A"
        self.app.post("/api/interview", {"action": "start", "problem_ids": [identifier, "leetcode-2"]})
        payload = {"action": "submit", "problem_id": identifier, "code": "print(1)"}
        rejected = self.app.post("/api/bridge/queue", payload)["job_id"]
        self.app.post("/api/bridge/result", {"job_id": rejected, "status": "complete", "verdict": "Wrong Answer", "run_id": "rejected-1"})
        snapshot = self.app.bootstrap()
        self.assertEqual(snapshot["progress"]["solved"], 1)
        problem = next(p for p in snapshot["problems"] if p["id"] == identifier)
        self.assertEqual(problem["status"], "todo")
        self.assertFalse(snapshot["interview"]["results"][0]["solved"])
        self.assertEqual(snapshot["bridge"]["jobs"][-1]["verdict"], "Wrong Answer")
        accepted = self.app.post("/api/bridge/queue", payload)["job_id"]
        self.app.post("/api/bridge/result", {"job_id": accepted, "status": "complete", "verdict": "Accepted", "run_id": "accepted-2"})
        # A fresh bootstrap is exactly what the UI reloads after the official verdict.
        persisted = server.PracticeApp(self.directory.name).bootstrap()
        problem = next(p for p in persisted["problems"] if p["id"] == identifier)
        self.assertEqual(persisted["progress"]["solved"], 2)
        self.assertEqual(problem["status"], "solved")
        self.assertEqual(persisted["drafts"][identifier]["accepted_run_id"], "accepted-2")
        self.assertTrue(persisted["interview"]["results"][0]["solved"])
        self.assertEqual([j["verdict"] for j in persisted["bridge"]["jobs"]], ["Wrong Answer", "Accepted"])

    def test_official_rejection_keeps_previously_accepted_task_solved(self):
        identifier = "yandex-42-A"
        payload = {"action": "submit", "problem_id": identifier, "code": "print(1)"}
        accepted = self.app.post("/api/bridge/queue", payload)["job_id"]
        self.app.post("/api/bridge/result", {"job_id": accepted, "status": "complete", "verdict": "Accepted", "run_id": "accepted-1"})
        rejected = self.app.post("/api/bridge/queue", payload)["job_id"]
        self.app.post("/api/bridge/result", {"job_id": rejected, "status": "complete", "verdict": "Runtime Error", "run_id": "rejected-2"})
        snapshot = self.app.bootstrap()
        self.assertEqual(snapshot["progress"]["solved"], 2)
        self.assertEqual(snapshot["drafts"][identifier]["accepted_run_id"], "accepted-1")
        self.assertEqual(next(p for p in snapshot["problems"] if p["id"] == identifier)["status"], "solved")
        self.assertEqual(snapshot["bridge"]["jobs"][-1]["verdict"], "Runtime Error")

    def test_duplicate_official_receipt_cannot_complete_a_later_training(self):
        identifier = "yandex-42-A"
        job_id = self.app.post("/api/bridge/queue", {"action": "submit", "problem_id": identifier, "code": "print(1)"})["job_id"]
        receipt = {"job_id": job_id, "status": "complete", "verdict": "Accepted", "run_id": "old-accepted"}
        self.app.post("/api/bridge/result", receipt)
        accepted_at = self.app.state["drafts"][identifier]["accepted_at"]
        self.app.post("/api/progress", {"problem_id": identifier, "status": "todo"})
        self.app.post("/api/interview", {"action": "start", "problem_ids": [identifier, "leetcode-2"]})
        self.app.post("/api/bridge/result", receipt)
        snapshot = self.app.bootstrap()
        self.assertFalse(next(p for p in snapshot["problems"] if p["id"] == identifier)["solved"])
        self.assertEqual(snapshot["progress"]["solved"], 1)
        self.assertFalse(snapshot["interview"]["results"][0]["solved"])
        self.assertEqual(snapshot["drafts"][identifier]["accepted_at"], accepted_at)

    def test_nonterminal_official_message_does_not_accept_solution(self):
        identifier = "yandex-42-A"
        job_id = self.app.post("/api/bridge/queue", {"action": "submit", "problem_id": identifier, "code": "print(1)"})["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "progress", "verdict": "Accepted", "run_id": "pending"})
        self.assertFalse(self.app.problem(identifier)["solved"])
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "verdict": "Accepted", "run_id": "pending"})
        self.assertTrue(self.app.problem(identifier)["solved"])

    def test_terminal_official_receipt_cannot_change_verdict_or_return_to_progress(self):
        identifier = "yandex-42-A"
        for terminal in ("complete", "error"):
            with self.subTest(terminal=terminal):
                job_id = self.app.post("/api/bridge/queue", {"action": "submit", "problem_id": identifier, "code": "print(1)"})["job_id"]
                result = {"job_id": job_id, "status": terminal, "verdict": "Wrong Answer", "run_id": "original", "message": "Original verdict"}
                self.app.post("/api/bridge/result", result)
                saved_job = dict(self.app.state["jobs"][-1])
                for later_status in ("progress", "complete"):
                    self.app.post("/api/bridge/result", {"job_id": job_id, "status": later_status, "verdict": "Accepted", "run_id": "different"})
                    self.assertEqual(self.app.state["jobs"][-1], saved_job)
                    self.assertFalse(self.app.problem(identifier)["solved"])

    def test_timer_and_pair(self):
        pair = self.app.get("/api/pair")["problem_ids"]
        self.assertEqual(len(pair), 2)
        self.assertEqual(len(set(pair)), 2)
        timer = self.app.post("/api/interview", {"action": "start", "problem_ids": pair})
        self.assertGreaterEqual(timer["remaining_seconds"], 3598)
        self.app.state["interview"]["expires_at"] = time.time() + 1200
        timer = self.app.post("/api/interview", {"action": "pause"})
        self.assertLessEqual(timer["remaining_seconds"], 1200)
        self.assertEqual(timer["status"], "paused")
        timer = self.app.post("/api/interview", {"action": "resume"})
        self.assertEqual(timer["status"], "running")
        self.assertEqual(self.app.post("/api/interview", {"action": "finish"})["status"], "finished")

    def test_interview_excludes_optional_topics(self):
        self.app.state["imports"]["yandex-42-A"] = {"id": "yandex-42-A", "interview_priority": False}
        self.assertNotIn("yandex-42-A", self.app.pair())

    def test_interview_excludes_incomplete_statement(self):
        self.app.state["imports"]["yandex-42-A"] = {"id": "yandex-42-A", "statement_incomplete": True}
        self.assertNotIn("yandex-42-A", self.app.pair())

    def test_interview_excludes_empty_statements_but_accepts_cached_image(self):
        for statement in (None, "", " \n\t"):
            with self.subTest(statement=statement):
                self.app.state["imports"]["yandex-42-A"] = {"id": "yandex-42-A", "statement_html": statement, "premium": False, "statement_incomplete": False}
                self.assertNotIn("yandex-42-A", self.app.pair())
        self.app.state["imports"]["yandex-42-A"]["statement_html"] = '<p><img src="/imported/statements/task.png"></p>'
        self.assertIn("yandex-42-A", self.app.pair())

    def test_imported_optional_yandex_inherits_contest_priority_and_course(self):
        catalog_path = Path(self.directory.name, "catalog.json")
        catalog = json.loads(catalog_path.read_text())
        catalog["contests"][0].update(interview_priority=False, course="АиСД-2")
        catalog_path.write_text(json.dumps(catalog))
        job_id = self.app.post("/api/bridge/queue", {"action": "import_contests"})["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "problems": [{"id": "yandex-42-B", "source": "yandex", "contestId": "42", "title": "B", "statement_html": "<p>Task</p>"}]})
        problem = self.app.problem("yandex-42-B")
        self.assertFalse(problem["interview_priority"])
        self.assertEqual(problem["course"], "АиСД-2")
        self.assertNotIn(problem["id"], self.app.pair())

    def test_archived_yandex_acceptance_is_not_training_progress(self):
        job_id = self.app.post("/api/bridge/queue", {"action": "import_contests"})["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "problems": [{"id": "yandex-42-A", "source": "yandex", "solved": True, "statement_html": "<p>Archived</p>"}]})
        problem = self.app.problem("yandex-42-A")
        self.assertTrue(problem["previously_solved"])
        self.assertFalse(problem["solved"])
        self.assertEqual(self.app.progress()["solved"], 1)
        self.app.state["imports"]["yandex-42-A"]["solved"] = True
        self.app.save()
        repaired = server.PracticeApp(self.directory.name)
        self.assertFalse(repaired.state["imports"]["yandex-42-A"]["solved"])
        self.assertTrue(repaired.state["imports"]["yandex-42-A"]["previously_solved"])
        self.app.post("/api/progress", {"problem_id": "yandex-42-A", "status": "solved"})
        self.app.save()
        self.assertTrue(server.PracticeApp(self.directory.name).problem("yandex-42-A")["solved"])

    def test_bridge_heartbeat_handles_30_second_alarm(self):
        self.app.state["bridge_last_seen"] = time.time() - 65
        self.assertTrue(self.app.bridge()["connected"])
        self.app.state["bridge_last_seen"] = time.time() - 76
        self.assertFalse(self.app.bridge()["connected"])

    def test_bridge_pause_persists_and_blocks_claims_queue_and_heartbeat(self):
        job_id = self.app.post("/api/bridge/queue", {"action": "import_contests"})["job_id"]
        self.app.state["bridge_last_seen"] = time.time()
        last_seen = self.app.state["bridge_last_seen"]
        paused = self.app.post("/api/bridge/pause", {"paused": True})
        self.assertTrue(paused["paused"])
        self.assertFalse(paused["connected"])
        loaded = server.PracticeApp(self.directory.name)
        self.assertTrue(loaded.bridge()["paused"])
        for operation in (
            lambda: loaded.get("/api/bridge/jobs"),
            lambda: loaded.post("/api/bridge/heartbeat", {}),
            lambda: loaded.post("/api/bridge/queue", {"action": "import_leetcode"}),
        ):
            with self.assertRaises(server.APIError) as caught:
                operation()
            self.assertEqual(caught.exception.status, 423)
        self.assertEqual(loaded.state["jobs"][0]["status"], "queued")
        self.assertEqual(len(loaded.state["jobs"]), 1)
        self.assertEqual(loaded.state["bridge_last_seen"], last_seen)
        # Already running work can safely report results without resuming the bridge.
        self.assertTrue(loaded.post("/api/bridge/result", {"job_id": job_id, "status": "progress", "message": "Saved pending result"})["ok"])
        self.assertTrue(loaded.bridge()["paused"])
        self.assertFalse(loaded.bridge()["connected"])
        resumed = loaded.post("/api/bridge/pause", {"paused": False})
        self.assertFalse(resumed["paused"])
        self.assertFalse(server.PracticeApp(self.directory.name).bridge()["paused"])
        self.assertEqual(len(loaded.get("/api/bridge/jobs")["jobs"]), 1)
        self.assertEqual(loaded.state["jobs"][0]["status"], "running")
        self.assertTrue(loaded.post("/api/bridge/heartbeat", {})["ok"])
        self.assertIn("job_id", loaded.post("/api/bridge/queue", {"action": "import_leetcode"}))

    def test_bridge_pause_requires_boolean(self):
        for value in (None, 0, 1, "true", [], {}):
            with self.assertRaises(server.APIError) as caught:
                self.app.post("/api/bridge/pause", {"paused": value})
            self.assertEqual(caught.exception.status, 400)
        self.assertFalse(self.app.bridge()["paused"])

    def write_testpack(self, cases=None, **overrides):
        directory = Path(self.directory.name, "testpacks")
        directory.mkdir(exist_ok=True)
        pack = {"schema_version": 1, "problem_id": "yandex-42-A", "language": "python3", "comparison": "tokens", "timeout_seconds": .5, "total_timeout_seconds": 15, "provenance": {"kind": "generated", "title": "Generated test fixture", "oracle": "n+1"}, "cases": cases if cases is not None else [{"input": str(i) + "\n", "output": str(i + 1) + "\n"} for i in range(100)]}
        pack.update(overrides)
        Path(directory, "yandex-42-A.json").write_text(json.dumps(pack), encoding="utf-8")
        return pack

    def test_local_judge_runs_100_independent_cases_without_marking_solved(self):
        self.write_testpack()
        problem = next(p for p in self.app.bootstrap()["problems"] if p["id"] == "yandex-42-A")
        self.assertEqual(problem["local_test_count"], 100)
        self.assertEqual(problem["local_test_provenance"]["kind"], "generated")
        result = self.app.post("/api/judge", {"problem_id": "yandex-42-A", "code": "import sys\nn = int(sys.stdin.buffer.read())\nprint(n + 1)\n"})
        self.assertEqual(result["verdict"], "LOCAL_OK", result)
        self.assertEqual(result["passed_count"], 100)
        self.assertEqual(result["attempted_count"], 100)
        self.assertFalse(result["official"])
        self.assertIsNone(result["first_failure"])
        self.assertFalse(self.app.problem("yandex-42-A")["solved"])
        self.assertFalse(self.app.state_path.exists())

    def test_local_judge_failure_details_and_published_case_count(self):
        self.write_testpack(cases=[{"input": "4\n", "output": "5\n"}], provenance={"kind": "published", "title": "Published sample"})
        result = self.app.post("/api/judge", {"problem_id": "yandex-42-A", "code": "print(4)"})
        self.assertEqual(result["verdict"], "WRONG_ANSWER")
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["passed_count"], 0)
        self.assertEqual(result["first_failure"]["input"], "4\n")
        self.assertEqual(result["first_failure"]["expected"], "5\n")
        self.assertEqual(result["first_failure"]["actual"], "4\n")
        self.assertEqual(self.app.problem("yandex-42-A")["local_test_count"], 1)
        result = self.app.post("/api/judge", {"problem_id": "yandex-42-A", "code": "raise ValueError('broken')"})
        self.assertEqual(result["verdict"], "RUNTIME_ERROR")
        self.assertIn("broken", result["first_failure"]["stderr"])

    def test_local_judge_timeouts_do_not_report_complete_pass(self):
        self.write_testpack(cases=[{"input": "1", "output": "1"}], timeout_seconds=.05, total_timeout_seconds=1, provenance={"kind": "published", "title": "Published sample"})
        result = self.app.post("/api/judge", {"problem_id": "yandex-42-A", "code": "while True: pass"})
        self.assertEqual(result["verdict"], "TIME_LIMIT", result)
        self.write_testpack(timeout_seconds=.05, total_timeout_seconds=.1)
        result = self.app.post("/api/judge", {"problem_id": "yandex-42-A", "code": "while True: pass"})
        self.assertEqual(result["verdict"], "TOTAL_TIME_LIMIT", result)
        self.assertLess(result["attempted_count"], result["total"])
        self.assertEqual(result["passed_count"], 0)

    def test_local_judge_missing_and_incomplete_packs_are_explicit_errors(self):
        payload = {"problem_id": "yandex-42-A", "code": "print(1)"}
        with self.assertRaises(server.APIError) as caught:
            self.app.post("/api/judge", payload)
        self.assertEqual(caught.exception.status, 404)
        self.write_testpack(cases=[{"input": "1", "output": "1"}] * 99)
        self.assertEqual(self.app.problem("yandex-42-A")["local_test_count"], 0)
        with self.assertRaises(server.APIError) as caught:
            self.app.post("/api/judge", payload)
        self.assertEqual(caught.exception.status, 422)
        self.write_testpack(cases=[{"input": "1", "output": "1"}] * 99 + [{"input": "1"}])
        with self.assertRaises(server.APIError): self.app.post("/api/judge", payload)

    def test_local_judge_allowlisted_validators_accept_alternate_answers(self):
        from testpack_registry import check_case
        pack = {"comparison": "validator", "checker": "goldbach_pair"}
        case = {"input": "10\n", "output": "3 7\n"}
        self.assertTrue(check_case(pack, case, "5 5\n"))
        self.assertFalse(check_case(pack, case, "1 9\n"))
        pack["checker"] = "shortest_containing_palindrome"
        case = {"input": "ab\n", "output": "bab\n"}
        self.assertTrue(check_case(pack, case, "aba\n"))
        self.assertFalse(check_case(pack, case, "baab\n"))
        pack["checker"] = "four_digit_shortest_path"
        case = {"input": "1111\n2111\n", "output": "1111\n2111\n"}
        self.assertTrue(check_case(pack, case, "1111 2111"))
        self.assertFalse(check_case(pack, case, "1111 1111 2111"))
        pack["checker"] = "binary_matrix_square_root"
        case = {"input": "1\n2\n0 0\n0 0\n", "output": "0 0\n0 0\n"}
        self.assertTrue(check_case(pack, case, "0 1\n0 0\n"))
        self.assertFalse(check_case(pack, case, "1 0\n0 1\n"))
        self.assertFalse(check_case(pack, case, "0 1\n0 0\nextra"))

    def test_interview_does_not_count_old_solves_or_late_marks(self):
        old, new = "leetcode-1", "yandex-42-A"
        self.app.post("/api/interview", {"action": "start", "problem_ids": [old, new]})
        self.assertFalse(any(item["solved"] for item in self.app.interview()["results"]))
        self.app.post("/api/progress", {"problem_id": old, "status": "solved"})
        self.assertFalse(self.app.interview()["results"][0]["solved"])
        self.app.post("/api/progress", {"problem_id": new, "status": "solved"})
        self.assertTrue(self.app.interview()["results"][1]["solved"])
        self.assertTrue(self.app.interview()["results"][0]["was_solved"])
        self.app.post("/api/interview", {"action": "start", "problem_ids": [old, "leetcode-2"]})
        self.app.state["interview"]["expires_at"] = time.time() - 1
        self.app.post("/api/progress", {"problem_id": "leetcode-2", "status": "solved"})
        self.assertFalse(any(item["solved"] for item in self.app.interview()["results"]))

    def test_interview_counts_new_accepted_and_freezes_finished_results(self):
        identifier = "yandex-42-A"
        self.app.post("/api/interview", {"action": "start", "problem_ids": [identifier, "leetcode-2"]})
        job_id = self.app.post("/api/bridge/queue", {"action": "submit", "problem_id": identifier, "code": "print(1)"})["job_id"]
        self.app.post("/api/bridge/result", {"job_id": job_id, "status": "complete", "verdict": "Accepted", "run_id": "new"})
        self.assertTrue(self.app.interview()["results"][0]["solved"])
        self.app.post("/api/interview", {"action": "finish"})
        self.app.post("/api/progress", {"problem_id": "leetcode-2", "status": "solved"})
        self.assertFalse(self.app.interview()["results"][1]["solved"])

    def test_http_origin_and_json_guard(self):
        handler = type("TestHandler", (server.Handler,), {"app": self.app})
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        url = f"http://127.0.0.1:{httpd.server_port}/api/bootstrap"
        try:
            with urlopen(url) as response:
                self.assertEqual(json.load(response)["progress"]["solved"], 1)
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url, headers={"Origin": "https://evil.example"}))
            self.assertEqual(caught.exception.code, 403)
            caught.exception.close()
            with self.assertRaises(HTTPError) as caught:
                urlopen(Request(url.replace("bootstrap", "run"), data=b"{}", headers={"Content-Type": "text/plain"}))
            self.assertEqual(caught.exception.code, 415)
            caught.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()

    def lc_run(self, identifier, code, stdin, expected, signature=None):
        return server.run_python({"problem_id": identifier, "source": "leetcode", "code": code, "stdin": stdin, "expected": expected, "signature": signature})

    def test_statement_sanitizer_only_safe_local_cached_images(self):
        for extension in ("png", "jpg", "jpeg", "gif", "webp"):
            path = "/imported/statements/yandex-83810-A-012abc." + extension
            cleaned = server.sanitize_html('<img src="' + path + '" onerror="bad()">')
            self.assertIn('src="' + path + '"', cleaned)
            self.assertNotIn("onerror", cleaned)
        for path in ("/imported/statements/../state.json", "/imported/statements/../../data/state.png", "/imported/statements/%2e%2e%2fstate.png", "/imported/statements/a.png?x=1", "/imported/statements/a.svg", "/other/a.png", "//evil.example/a.png", "data:image/png;base64,AA", "javascript:bad()"):
            self.assertNotIn("src=", server.sanitize_html('<img src="' + path + '">'), path)
        self.assertIn("https://assets.contest.yandex.net/a.png", server.sanitize_html('<img src="https://assets.contest.yandex.net/a.png">'))

    def test_image_cache_validation_rewrite_and_metadata_without_network(self):
        helper_spec = importlib.util.spec_from_file_location("cache_images", ROOT / "cache_statement_images.py")
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        for url in ("https://assets.contest.yandex.net/a.png", "https://official.contest.yandex.ru/a.jpg", "https://assets.leetcode.com/a.webp"):
            self.assertTrue(helper.official_image_url(url))
        for url in ("https://assets.contest.yandex.net.evil.test/a.png", "http://assets.contest.yandex.net/a.png", "https://user:pass@assets.contest.yandex.net/a.png", "https://assets.contest.yandex.net:444/a.png", "https://assets.contest.yandex.net/a.svg"):
            self.assertFalse(helper.official_image_url(url), url)
        self.assertEqual(helper.image_type(b"\x89PNG\r\n\x1a\nmore"), "image/png")
        with self.assertRaises(ValueError): helper.image_type(b"<svg></svg>")
        with self.assertRaises(ValueError):
            helper.OfficialRedirects().redirect_request(None, None, 302, "Found", {}, "https://evil.example/a.png")
        remote = "https://assets.contest.yandex.net/a.png?x=1&y=2"
        rewritten = helper.ImageRewriter({remote: "/imported/statements/a.png"})
        rewritten.feed('<p>Keep &amp; text</p><img alt="A" src="https://assets.contest.yandex.net/a.png?x=1&amp;y=2">')
        self.assertEqual("".join(rewritten.parts), '<p>Keep &amp; text</p><img alt="A" src="/imported/statements/a.png">')
        problem = {"id": "yandex-42-A", "statement_html": "<img>", "topicIds": ["graphs"], "statement_incomplete": True}
        job = {"job_id": "saved", "status": "complete", "message": "Original progress", "progress": 24, "total": 24, "completed": 24}
        payload = helper.result_payload(job, problem)
        self.assertEqual(payload["problems"][0], problem)
        for key in ("message", "progress", "total", "completed"):
            self.assertEqual(payload[key], job[key])

    def test_image_cache_preserves_partial_import_error_and_prefers_complete(self):
        helper_spec = importlib.util.spec_from_file_location("cache_images", ROOT / "cache_statement_images.py")
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        problem = {"id": "leetcode-1", "source": "leetcode", "statement_html": "<img>"}
        partial = {"job_id": "partial", "action": "import_leetcode", "status": "error", "message": "Some premium tasks unavailable", "completed": 64, "total": 74}
        selected = helper.completed_job([partial], problem)
        payload = helper.result_payload(selected, problem)
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["message"], partial["message"])
        self.assertEqual(payload["completed"], 64)
        complete = {"job_id": "complete", "action": "import_leetcode", "status": "complete"}
        self.assertEqual(helper.completed_job([complete, partial], problem)["job_id"], "complete")
        self.assertEqual(helper.completed_job([complete, partial], problem, requested="partial")["job_id"], "partial")
        with self.assertRaises(ValueError):
            helper.result_payload(dict(partial, status="running"), problem)

    def test_image_cache_redirect_only_host_allowlist(self):
        helper_spec = importlib.util.spec_from_file_location("cache_images", ROOT / "cache_statement_images.py")
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        storage = "https://contest-problem-files.s3-private.mds.yandex.net/problems/1234-abcd"
        self.assertFalse(helper.official_image_url(storage))
        self.assertTrue(helper.redirected_image_url(storage))
        redirected = helper.OfficialRedirects().redirect_request(helper.Request("https://assets.contest.yandex.net/a.png"), None, 307, "Temporary Redirect", {}, storage)
        self.assertEqual(redirected.full_url, storage)
        self.assertFalse(helper.redirected_image_url(storage.replace(".yandex.net", ".yandex.net.evil.test")))
        self.assertFalse(helper.redirected_image_url(storage.replace("https:", "http:")))

    def test_image_cache_continues_failures_and_publishes_only_successes(self):
        import contextlib
        helper_spec = importlib.util.spec_from_file_location("cache_images", ROOT / "cache_statement_images.py")
        helper = importlib.util.module_from_spec(helper_spec)
        helper_spec.loader.exec_module(helper)
        first = "https://assets.contest.yandex.net/fail.png"
        second = "https://assets.contest.yandex.net/good.png"
        source = '<p>Original</p><img src="' + first + '"><img src="' + second + '">'
        problem = {"id": "yandex-42-A", "source": "yandex", "statement_html": source, "statement_incomplete": True}
        snapshot = {"problems": [problem], "bridge": {"jobs": [{"job_id": "existing", "status": "complete", "action": "import_contests", "message": "Preserve message", "completed": 24}]}}
        published = []
        def local_api(base, path, payload=None):
            if path == "/api/bootstrap": return snapshot
            published.append(payload)
            return {"ok": True}
        def downloaded(url):
            if url == first: raise ValueError("Unavailable image")
            return b"safe image", "png"
        output = io.StringIO()
        with patch.object(sys, "argv", ["cache_statement_images.py", "--all"]), patch.object(helper, "api_request", side_effect=local_api), patch.object(helper, "download_image", side_effect=downloaded), patch.object(helper, "cache_file", return_value="/imported/statements/good.png"), contextlib.redirect_stdout(output):
            helper.main()
        report = json.loads(output.getvalue())
        self.assertEqual(report["errors"], [{"id": problem["id"], "error": "Unavailable image"}])
        self.assertEqual(report["updated"][0]["cached_images"], 1)
        self.assertEqual(report["updated"][0]["eligible_images"], 2)
        self.assertEqual(len(published), 1)
        updated = published[0]["problems"][0]
        self.assertIn(first, updated["statement_html"])
        self.assertNotIn(second, updated["statement_html"])
        self.assertIn("/imported/statements/good.png", updated["statement_html"])
        self.assertTrue(updated["statement_incomplete"])
        self.assertEqual(published[0]["message"], "Preserve message")

    def test_extension_origin_allowlist_and_preflight(self):
        allowed = "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
        unknown = "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        Path(self.directory.name, "bridge-extension.json").write_text(json.dumps({"extension_ids": [allowed.split("//")[1]]}))
        handler = type("PairedHandler", (server.Handler,), {"app": self.app})
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        url = f"http://127.0.0.1:{httpd.server_port}/api/bootstrap"
        try:
            with urlopen(Request(url, headers={"Origin": allowed})) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], allowed)
            with urlopen(Request(url, method="OPTIONS", headers={"Origin": allowed, "Access-Control-Request-Method": "POST"})) as response:
                self.assertEqual(response.status, 204)
                self.assertEqual(response.headers["Access-Control-Allow-Origin"], allowed)
            for method in ("GET", "OPTIONS"):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(Request(url, method=method, headers={"Origin": unknown}))
                self.assertEqual(caught.exception.code, 403)
                self.assertIsNone(caught.exception.headers.get("Access-Control-Allow-Origin"))
                caught.exception.close()
            with urlopen(Request(url, headers={"Origin": f"http://127.0.0.1:{httpd.server_port}"})) as response:
                self.assertEqual(response.status, 200)
            with urlopen(url) as response:
                self.assertEqual(response.status, 200)
            Path(self.directory.name, "bridge-extension.json").unlink()
            self.assertFalse(self.app.allowed_extension_origin(allowed))
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_static_paths_cannot_serve_private_state(self):
        self.app.state["private_test_marker"] = "private-state-not-for-static-serving"
        self.app.save()
        handler = type("StaticGuardHandler", (server.Handler,), {"app": self.app})
        httpd = server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{httpd.server_port}"
        try:
            for path in ("/../data/state.json", "/%2e%2e/data/state.json", "/..%2fdata/state.json", "/%2e%2e%2fdata/state.json"):
                with self.assertRaises(HTTPError) as caught:
                    urlopen(base + path)
                self.assertEqual(caught.exception.code, 404)
                self.assertNotIn(b"private-state-not-for-static-serving", caught.exception.read())
                caught.exception.close()
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_leetcode_unordered_checkers_and_ordered_167(self):
        cases = [
            ("leetcode-1", "[1,0]", "[0,1]"),
            ("leetcode-350", "[9,4,4]", "[4,9,4]"),
            ("leetcode-22", '["()()","(())"]', '["(())","()()"]'),
            ("leetcode-438", "[6,0]", "[0,6]"),
        ]
        for identifier, actual, expected in cases:
            result = self.lc_run(identifier, f"class Solution:\n    def solve(self):\n        return {actual}\n", "", expected)
            self.assertTrue(result["passed"], result)
        result = self.lc_run("leetcode-167", "class Solution:\n    def solve(self): return [2,1]\n", "", "[1,2]")
        self.assertFalse(result["passed"])
        result = self.lc_run("leetcode-350", "class Solution:\n    def solve(self): return [4,9]\n", "", "[4,9,4]")
        self.assertFalse(result["passed"])

    def test_leetcode_group_anagrams_and_palindrome_alternatives(self):
        result = self.lc_run("leetcode-49", "class Solution:\n    def groupAnagrams(self, strs):\n        return [['tea','eat'],['bat']]\n", 'strs = ["eat","tea","bat"]', '[["bat"],["eat","tea"]]')
        self.assertTrue(result["passed"], result)
        result = self.lc_run("leetcode-5", "class Solution:\n    def longestPalindrome(self, s): return 'aba'\n", 's = "babad"', '"bab"')
        self.assertTrue(result["passed"], result)
        result = self.lc_run("leetcode-5", "class Solution:\n    def longestPalindrome(self, s): return 'aca'\n", 's = "babad"', '"bab"')
        self.assertFalse(result["passed"])

    def test_leetcode_design_accepts_native_two_array_input(self):
        code = "class Box:\n    def __init__(self, n): self.n = n\n    def get(self): return self.n\n    def set(self, n): self.n = n\n"
        stdin = '["Box","get","set","get"]\n[[2],[],[4],[]]'
        result = self.lc_run("leetcode-146", code, stdin, "[null,2,null,4]")
        self.assertTrue(result["passed"], result)

    def test_leetcode_nested_integer_iterator(self):
        code = "class NestedIterator:\n    def __init__(self, nestedList: [NestedInteger]):\n        self.items = []\n        def visit(items):\n            for item in items:\n                if item.isInteger(): self.items.append(item.getInteger())\n                else: visit(item.getList())\n        visit(nestedList)\n    def next(self): return self.items.pop(0)\n    def hasNext(self): return bool(self.items)\n"
        result = self.lc_run("leetcode-341", code, "nestedList = [1,[4,[6]]]", "[1,4,6]")
        self.assertTrue(result["passed"], result)

    def test_leetcode_rand7_harness_does_not_compare_random_sample(self):
        result = self.lc_run("leetcode-470", "class Solution:\n    def rand10(self): return rand7()\n", "n = 4", "[2,8,3,5]", {"method": "rand10", "params": ["n"]})
        self.assertEqual(result["status"], "ok", result)
        self.assertEqual(len(result["return_value"]), 4)
        self.assertEqual(result["comparison"], "manual")
        self.assertNotIn("passed", result)
        bad = self.lc_run("leetcode-470", "class Solution:\n    def rand10(self): return 11\n", "n = 1", "[2]")
        self.assertFalse(bad["passed"])

    def test_leetcode_lca_nodes_are_references_into_root(self):
        code = "class Solution:\n    def lowestCommonAncestor(self, root: TreeNode, p: TreeNode, q: TreeNode) -> TreeNode:\n        if p is root.left and q is root.right: return root\n        raise ValueError('p and q are not root references')\n"
        result = self.lc_run("leetcode-236", code, "root = [3,5,1], p = 5, q = 1", "3", {"method": "lowestCommonAncestor", "params": ["root", "p", "q"]})
        self.assertTrue(result["passed"], result)

    def test_leetcode_inplace_prefix_and_manual_length_only(self):
        code = "class Solution:\n    def removeDuplicates(self, nums):\n        nums[:2] = [1,2]\n        return 2\n"
        result = self.lc_run("leetcode-26", code, "nums = [1,1,2]", "2, nums = [1,2,_]")
        self.assertTrue(result["passed"], result)
        result = self.lc_run("leetcode-26", "class Solution:\n    def removeDuplicates(self, nums): return 2\n", "nums = [1,1,2]", "2, nums = [1,2,_]")
        self.assertFalse(result["passed"])
        result = self.lc_run("leetcode-443", "class Solution:\n    def compress(self, chars):\n        chars[:2] = ['a','2']\n        return 2\n", 'chars = ["a","a"]', "2")
        self.assertEqual(result["mutated_prefix"], ["a", "2"])
        self.assertEqual(result["comparison"], "manual")
        self.assertNotIn("passed", result)

    def test_leetcode_empty_listnode_and_separate_debug_prints(self):
        result = self.lc_run("leetcode-19", "class Solution:\n    def removeNthFromEnd(self, head: Optional[ListNode], n: int) -> Optional[ListNode]:\n        return None\n", "head = [1], n = 1", "[]")
        self.assertTrue(result["passed"], result)
        result = self.lc_run("leetcode-1", "class Solution:\n    def twoSum(self, nums, target):\n        print('debugging')\n        return [1,0]\n", "nums = [2,7], target = 9", "[0,1]")
        self.assertTrue(result["passed"], result)
        self.assertIn("debugging", result["stdout"])


if __name__ == "__main__":
    unittest.main()
