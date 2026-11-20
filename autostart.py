#!/usr/bin/env python3
"""Manage only Algo Practice's per-user macOS LaunchAgent; never opens a browser."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

LABEL = 'local.algo-practice'
ROOT = Path(__file__).resolve().parent
PLIST = Path.home() / 'Library' / 'LaunchAgents' / (LABEL + '.plist')
LOGS = Path.home() / 'Library' / 'Logs' / 'Algo Practice'
PYTHON = Path(sys.executable).resolve()
URL = 'http://127.0.0.1:8765'


def target():
    return f'gui/{os.getuid()}/{LABEL}'


def launchctl(*arguments, check=False):
    result = subprocess.run(['/bin/launchctl', *arguments], capture_output=True, text=True)
    if check and result.returncode:
        raise RuntimeError((result.stderr or result.stdout).strip() or 'launchctl не выполнил действие.')
    return result


def service_pid():
    result = launchctl('print', target())
    match = re.search(r'^\s*pid = (\d+)\s*$', result.stdout, re.M)
    return int(match.group(1)) if match else None


def owns_config(config):
    if not isinstance(config, dict) or config.get('Label') != LABEL:
        return False
    arguments = config.get('ProgramArguments', [])
    return (isinstance(arguments, list) and len(arguments) > 2
            and isinstance(arguments[2], str)
            and Path(arguments[2]).resolve() == (ROOT / 'server.py').resolve())


def health():
    try:
        with urllib.request.urlopen(URL + '/api/bootstrap', timeout=2) as response:
            data = json.load(response)
        return data if data.get('progress', {}).get('target') == 200 and 'topics' in data else None
    except (OSError, ValueError):
        return None


def wait_ready(timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if service_pid() and health():
            return True
        time.sleep(.25)
    return False


def ensure_started():
    """Restore the installed agent, without creating a second detached server."""
    if not PLIST.is_file():
        raise RuntimeError('Автозапуск ещё не установлен: python3 autostart.py install')
    stored = plistlib.loads(PLIST.read_bytes())
    if not owns_config(stored):
        raise RuntimeError('Конфигурация автозапуска не соответствует этому тренажёру.')
    launchctl('enable', target(), check=True)
    if launchctl('print', target()).returncode:
        launchctl('bootstrap', f'gui/{os.getuid()}', str(PLIST), check=True)
    if not wait_ready():
        raise RuntimeError(f'Тренажёр не ответил. Подробности: {LOGS / "server-error.log"}')


def install():
    if sys.platform != 'darwin':
        raise RuntimeError('Этот автозапуск предназначен для macOS.')
    if not PYTHON.is_file():
        raise RuntimeError('Не найден установленный Python: ' + str(PYTHON))
    if not (ROOT / 'server.py').is_file():
        raise RuntimeError('Не найден сервер тренажёра.')
    previous = plistlib.loads(PLIST.read_bytes()) if PLIST.exists() else None
    config = {
        'Label': LABEL,
        'ProgramArguments': [str(PYTHON), '-u', str(ROOT / 'server.py'), '--port', '8765'],
        'WorkingDirectory': str(ROOT),
        'RunAtLoad': True,
        'KeepAlive': True,
        'ThrottleInterval': 10,
        'ProcessType': 'Interactive',
        'StandardOutPath': str(LOGS / 'server.log'),
        'StandardErrorPath': str(LOGS / 'server-error.log'),
    }
    if previous and not owns_config(previous):
        raise RuntimeError('Одноимённый LaunchAgent принадлежит другой программе; он не изменён.')
    loaded = launchctl('print', target()).returncode == 0
    if previous != config and loaded:
        launchctl('bootout', target(), check=True)
        loaded = False
    if not loaded:
        with socket.socket() as probe:
            if probe.connect_ex(('127.0.0.1', 8765)) == 0:
                raise RuntimeError('Порт 8765 уже занят. Останови прежний экземпляр тренажёра перед установкой автозапуска.')
    PLIST.parent.mkdir(parents=True, exist_ok=True)
    LOGS.mkdir(parents=True, mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=PLIST.parent, prefix='.algo-practice-', delete=False) as handle:
        temporary = Path(handle.name)
        handle.write(plistlib.dumps(config))
    try:
        temporary.chmod(0o644)
        temporary.replace(PLIST)
    finally:
        temporary.unlink(missing_ok=True)
    ensure_started()
    return status()


def status():
    data = health()
    return {'label': LABEL, 'target': target(), 'installed': PLIST.is_file(),
            'pid': service_pid(), 'healthy': data is not None, 'url': URL,
            'solved': data.get('progress', {}).get('solved') if data else None,
            'plist': str(PLIST), 'logs': str(LOGS)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'start', 'status'])
    args = parser.parse_args()
    try:
        if args.action == 'install': result = install()
        elif args.action == 'start': ensure_started(); result = status()
        else: result = status()
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, ValueError, RuntimeError) as error:
        raise SystemExit(str(error))


if __name__ == '__main__':
    main()
