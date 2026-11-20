#!/usr/bin/env python3
"""Start the local trainer and open the user's default browser."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = 'http://127.0.0.1:8765'

def ready():
    try:
        with urllib.request.urlopen(URL + '/api/bootstrap', timeout=1) as response:
            value = json.load(response)
        return value.get('progress', {}).get('target') == 200 and 'topics' in value
    except Exception:
        return False


def detached_options():
    if sys.platform == 'win32':
        # Use Windows' own background-process flags rather than a POSIX session.
        return {'creationflags': subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP}
    return {'start_new_session': True}


def start_server():
    if ready():
        return
    if sys.platform == 'darwin':
        from autostart import PLIST, ensure_started
        if PLIST.is_file():
            # An installed LaunchAgent owns this server; do not race it.
            try:
                ensure_started()
            except RuntimeError as error:
                raise SystemExit(str(error)) from error
            return

    log_path = ROOT / 'data' / 'server.log'
    log_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with log_path.open('ab') as log:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / 'server.py'), '--port', '8765'],
                cwd=ROOT, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                **detached_options())
    except OSError as error:
        raise SystemExit(f'Не удалось запустить тренажёр: {error}. Журнал: {log_path}') from error
    for _ in range(40):
        if ready():
            return
        if process.poll() is not None:
            raise SystemExit(f'Не удалось запустить тренажёр. Подробности: {log_path}')
        time.sleep(.15)
    raise SystemExit(f'Тренажёр не ответил. Проверь журнал: {log_path}')


def main():
    start_server()
    try:
        opened = webbrowser.open(URL)
    except (webbrowser.Error, OSError):
        opened = False
    print('Algo Practice: ' + URL)
    if not opened:
        print('Сервер работает. Открой этот адрес в браузере вручную.')


if __name__ == '__main__':
    main()
