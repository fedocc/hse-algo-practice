"""Platform branches are simulated; these tests never launch a browser or service."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bind_extension
import launch
import server


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class PortabilityTests(unittest.TestCase):
    def test_importing_launch_has_no_side_effects(self):
        with patch('subprocess.Popen') as popen, patch('webbrowser.open') as browser, patch('urllib.request.urlopen') as request:
            load_module('launch_import_check', 'launch.py')
        popen.assert_not_called()
        browser.assert_not_called()
        request.assert_not_called()

    def test_launcher_uses_default_browser_and_manual_fallback(self):
        output = io.StringIO()
        with patch.object(launch, 'start_server') as start, patch.object(launch.webbrowser, 'open', return_value=False) as browser, contextlib.redirect_stdout(output):
            launch.main()
        start.assert_called_once_with()
        browser.assert_called_once_with(launch.URL)
        self.assertIn(launch.URL, output.getvalue())
        self.assertIn('вручную', output.getvalue())

    def test_launcher_reports_browser_failure_without_stopping_server(self):
        output = io.StringIO()
        with patch.object(launch, 'start_server'), patch.object(launch.webbrowser, 'open', side_effect=launch.webbrowser.Error('no browser')), contextlib.redirect_stdout(output):
            launch.main()
        self.assertIn('Сервер работает', output.getvalue())

    def test_detachment_options_follow_platform(self):
        with patch.object(launch.sys, 'platform', 'linux'):
            self.assertEqual(launch.detached_options(), {'start_new_session': True})
        with patch.object(launch.sys, 'platform', 'win32'), patch.object(launch.subprocess, 'DETACHED_PROCESS', 8, create=True), patch.object(launch.subprocess, 'CREATE_NEW_PROCESS_GROUP', 512, create=True):
            self.assertEqual(launch.detached_options(), {'creationflags': 520})

    def test_launcher_reuses_healthy_server(self):
        with patch.object(launch, 'ready', return_value=True), patch.object(launch.subprocess, 'Popen') as popen:
            launch.start_server()
        popen.assert_not_called()

    def test_background_server_uses_current_python_and_local_log(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            process = Mock()
            process.poll.return_value = None
            with patch.object(launch, 'ROOT', root), patch.object(launch.sys, 'platform', 'linux'), patch.object(launch, 'ready', side_effect=[False, False, True]), patch.object(launch.subprocess, 'Popen', return_value=process) as popen, patch.object(launch.time, 'sleep'):
                launch.start_server()
            arguments, options = popen.call_args
            self.assertEqual(arguments[0], [sys.executable, str(root / 'server.py'), '--port', '8765'])
            self.assertTrue(options['start_new_session'])
            self.assertEqual(Path(options['stdout'].name), root / 'data' / 'server.log')
            self.assertIs(options['stdout'], options['stderr'])

    def test_windows_kill_does_not_call_posix_killpg(self):
        process = Mock(pid=123)
        process.poll.return_value = None
        with patch.object(server.os, 'name', 'nt'), patch.object(server.os, 'killpg', create=True) as killpg:
            server.kill_process(process)
        killpg.assert_not_called()
        process.kill.assert_called_once_with()

    def test_posix_kill_retains_process_group_cleanup(self):
        process = Mock(pid=123)
        process.poll.return_value = None
        with patch.object(server.os, 'name', 'posix'), patch.object(server.os, 'killpg', create=True) as killpg:
            server.kill_process(process)
        killpg.assert_called_once_with(123, server.signal.SIGKILL)
        process.kill.assert_not_called()

    def test_moscow_timezone_works_without_iana_database(self):
        with patch.object(server, 'ZoneInfo', side_effect=server.ZoneInfoNotFoundError('no tz database')):
            zone = server.moscow_timezone()
        self.assertEqual(zone.utcoffset(None).total_seconds(), 3 * 3600)

    def test_worker_imports_without_resource_module(self):
        with patch.dict(sys.modules, {'resource': None}):
            worker = load_module('worker_without_resource', 'debugger_worker.py')
        self.assertIsNone(worker.resource)
        worker.limits()

    def test_extension_binding_merges_deduplicates_and_preserves_config(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'data' / 'bridge-extension.json'
            first, second = 'a' * 32, 'b' * 32
            bind_extension.bind_extension(first, path)
            data = json.loads(path.read_text())
            data['local_note'] = 'keep me'
            path.write_text(json.dumps(data))
            bind_extension.bind_extension(second, path)
            bind_extension.bind_extension(first, path)
            saved = json.loads(path.read_text())
            self.assertEqual(saved['extension_ids'], [first, second])
            self.assertEqual(saved['local_note'], 'keep me')
            previous = path.read_bytes()
            for invalid in ['', 'a' * 31, 'z' * 32, 'A' * 32, 'https://example.com']:
                with self.assertRaises(ValueError):
                    bind_extension.bind_extension(invalid, path)
                self.assertEqual(path.read_bytes(), previous)

    def test_bad_pairing_file_is_never_replaced(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'bridge-extension.json'
            for raw in ['{not json', '[]', '{"extension_ids": "bad"}', '{"extension_ids": ["bad"]}']:
                path.write_text(raw)
                with self.assertRaises(ValueError):
                    bind_extension.bind_extension('a' * 32, path)
                self.assertEqual(path.read_text(), raw)

    def test_autostart_uses_invoking_python_without_starting_service(self):
        with patch('subprocess.run') as run:
            autostart = load_module('autostart_import_check', 'autostart.py')
        run.assert_not_called()
        self.assertEqual(autostart.LABEL, 'local.algo-practice')
        self.assertEqual(autostart.PYTHON, Path(sys.executable).resolve())


if __name__ == '__main__':
    unittest.main()
