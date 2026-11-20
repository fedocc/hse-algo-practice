#!/usr/bin/env python3
"""Allow only a browser extension ID chosen by this computer's owner."""
import argparse
import json
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parent
CONFIG = ROOT / 'data' / 'bridge-extension.json'


def bind_extension(identifier, config_path=CONFIG):
    if not isinstance(identifier, str) or not re.fullmatch(r'[a-p]{32}', identifier):
        raise ValueError('ID расширения должен содержать ровно 32 буквы a–p. Скопируй ID из chrome://extensions.')
    config_path = Path(config_path)
    if config_path.exists():
        data = json.loads(config_path.read_text(encoding='utf-8'))
        if not isinstance(data, dict) or not isinstance(data.get('extension_ids', []), list):
            raise ValueError('Некорректный формат bridge-extension.json. Существующий файл не изменён.')
        identifiers = data.get('extension_ids', [])
        if any(not isinstance(value, str) or not re.fullmatch(r'[a-p]{32}', value) for value in identifiers):
            raise ValueError('Некорректный ID в bridge-extension.json. Существующий файл не изменён.')
    else:
        data, identifiers = {}, []
    data['extension_ids'] = list(dict.fromkeys([*identifiers, identifier]))
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=config_path.parent,
                                     prefix='.bridge-extension-', suffix='.tmp', delete=False) as handle:
        temporary = Path(handle.name)
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write('\n')
    try:
        temporary.replace(config_path)
    finally:
        temporary.unlink(missing_ok=True)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('extension_id', help='32-letter ID from chrome://extensions')
    args = parser.parse_args()
    try:
        bind_extension(args.extension_id)
    except (ValueError, OSError) as error:
        raise SystemExit(str(error)) from error
    print(f'Расширение подключено к локальному серверу. Файл: {CONFIG}')
    print('Обнови вкладку тренажёра и нажми «Подключить» в расширении. Перезапуск сервера не нужен.')


if __name__ == '__main__':
    main()
