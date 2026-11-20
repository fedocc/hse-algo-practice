"""Validated local Python test packs; these never imply an official judge verdict.

Schema 1: problem_id, language='python3', comparison='tokens'|'exact'|'validator',
optional checker from CHECKERS, timeout_seconds (0.05..5), total_timeout_seconds
(0.1..35), provenance={kind:generated|published|mixed,title,...}, and cases of
{input:string,output:string}. Generated packs need at least 100 cases; published
or mixed packs can contain 1..1000, and their actual count is always exposed.
"""
from __future__ import annotations

from collections import deque
import json
from math import isqrt
from pathlib import Path
import re
import threading

MAX_PACK_BYTES = 32 * 1024 * 1024
CHECKERS = {"four_digit_shortest_path", "goldbach_pair", "shortest_containing_palindrome", "binary_matrix_square_root"}


class TestPackError(Exception):
    def __init__(self, message, status=422):
        super().__init__(message)
        self.status = status


def validate_pack(raw, identifier):
    if not isinstance(raw, dict) or raw.get("schema_version") != 1 or raw.get("problem_id") != identifier:
        raise TestPackError("Неверная схема или ID локального набора тестов.")
    if raw.get("language") != "python3":
        raise TestPackError("Локальная проверка поддерживает только Python 3.")
    comparison = raw.get("comparison", "tokens")
    if comparison not in {"tokens", "exact", "validator"}:
        raise TestPackError("Неизвестный способ сравнения локальных тестов.")
    if comparison == "validator" and raw.get("checker") not in CHECKERS:
        raise TestPackError("Проверяющая функция не входит в разрешённый список.")
    provenance = raw.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("kind") not in {"generated", "published", "mixed"} or not isinstance(provenance.get("title"), str) or not provenance["title"].strip():
        raise TestPackError("У локального набора должны быть указаны происхождение и название.")
    cases = raw.get("cases")
    minimum = 100 if provenance["kind"] == "generated" else 1
    if not isinstance(cases, list) or not minimum <= len(cases) <= 1000:
        raise TestPackError(f"Нужны полные {minimum}–1000 тестов; незавершённый набор не запускается.")
    for index, case in enumerate(cases, 1):
        if not isinstance(case, dict) or any(not isinstance(case.get(name), str) for name in ("input", "output")):
            raise TestPackError(f"В тесте {index} отсутствует текстовый input или output.")
        if len(case["input"].encode("utf-8")) > 2_000_000 or len(case["output"].encode("utf-8")) > 200_000:
            raise TestPackError(f"Тест {index} превышает ограничения локального ввода/вывода.")
    timeout, total = raw.get("timeout_seconds", 1.0), raw.get("total_timeout_seconds", 25.0)
    if type(timeout) not in {float, int} or not .05 <= timeout <= 5:
        raise TestPackError("Лимит одного теста должен быть от 0.05 до 5 секунд.")
    if type(total) not in {float, int} or not .1 <= total <= 35:
        raise TestPackError("Общий лимит набора должен быть от 0.1 до 35 секунд.")
    return dict(raw, comparison=comparison, timeout_seconds=float(timeout), total_timeout_seconds=float(total))


class TestPackRegistry:
    def __init__(self, directory):
        self.directory, self.cache, self.lock = Path(directory), {}, threading.RLock()

    def load(self, identifier):
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,160}", identifier):
            raise TestPackError("Недопустимый ID набора тестов.")
        path = self.directory / (identifier + ".json")
        if not path.resolve().is_relative_to(self.directory.resolve()):
            raise TestPackError("Путь тестов выходит за пределы локального каталога.")
        with self.lock:
            try:
                stat = path.stat()
            except FileNotFoundError:
                raise TestPackError("Для этой задачи ещё нет локального набора тестов. Обычный Run и отладка доступны.", 404)
            if stat.st_size > MAX_PACK_BYTES:
                raise TestPackError("Локальный набор тестов больше 32 МБ.")
            key = (stat.st_mtime_ns, stat.st_size)
            cached = self.cache.get(identifier)
            if cached and cached[0] == key:
                return cached[1]
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                pack = validate_pack(raw, identifier)
            except (OSError, ValueError, UnicodeError) as error:
                raise TestPackError("Не удалось прочитать локальные тесты: " + str(error)) from error
            self.cache[identifier] = (key, pack)
            return pack

    def metadata(self, identifier):
        try:
            pack = self.load(identifier)
        except TestPackError as error:
            result = {"local_test_count": 0}
            if error.status != 404:
                result["local_test_error"] = str(error)
            return result
        return {"local_test_count": len(pack["cases"]), "local_test_provenance": pack["provenance"], "local_test_comparison": pack["comparison"], "local_test_checker": pack.get("checker")}


def digit_neighbors(number):
    if number // 1000 < 9: yield number + 1000
    if number % 10 > 1: yield number - 1
    yield number % 1000 * 10 + number // 1000
    yield number % 10 * 1000 + number // 10


def four_digit_path(stdin, actual):
    start, goal = map(int, stdin.split())
    path = list(map(int, actual.split()))
    if not path or path[0] != start or path[-1] != goal or any(not 1111 <= n <= 9999 or "0" in str(n) for n in path):
        return False
    if any(right not in digit_neighbors(left) for left, right in zip(path, path[1:])):
        return False
    queue, distances = deque([start]), {start: 0}
    while queue:
        value = queue.popleft()
        if value == goal:
            return len(path) == distances[value] + 1
        for nxt in digit_neighbors(value):
            if nxt not in distances:
                distances[nxt] = distances[value] + 1
                queue.append(nxt)
    return False


def prime(value):
    if value < 2: return False
    if value % 2 == 0: return value == 2
    return all(value % divisor for divisor in range(3, isqrt(value) + 1, 2))


def read_matrix(tokens, position, size):
    rows = []
    for _ in range(size):
        first = tokens[position]
        if len(first) == size and size > 1 and set(first) <= {"0", "1"}:
            bits = first
            position += 1
        else:
            bits = tokens[position:position + size]
            position += size
            if len(bits) != size or any(bit not in {"0", "1"} for bit in bits):
                raise ValueError("Матрица должна состоять из нулей и единиц.")
        rows.append(sum(int(bit) << col for col, bit in enumerate(bits)))
    return rows, position


def binary_square_root(stdin, actual):
    tokens, output = stdin.split(), actual.split()
    total, position, output_position = int(tokens[0]), 1, 0
    if not 1 <= total <= 1000: return False
    for _ in range(total):
        size = int(tokens[position])
        position += 1
        if not 1 <= size <= 64: return False
        target, position = read_matrix(tokens, position, size)
        matrix, output_position = read_matrix(output, output_position, size)
        for row, expected in zip(matrix, target):
            product, remaining = 0, row
            while remaining:
                bit = remaining & -remaining
                product ^= matrix[bit.bit_length() - 1]
                remaining ^= bit
            if product != expected:
                return False
    return position == len(tokens) and output_position == len(output)


def check_case(pack, case, actual):
    comparison = pack["comparison"]
    if comparison == "tokens":
        return actual.split() == case["output"].split()
    if comparison == "exact":
        normalize = lambda text: text.replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")
        return normalize(actual) == normalize(case["output"])
    try:
        checker = pack["checker"]
        if checker == "four_digit_shortest_path":
            return four_digit_path(case["input"], actual)
        if checker == "goldbach_pair":
            pair = list(map(int, actual.split()))
            return len(pair) == 2 and sum(pair) == int(case["input"].strip()) and all(map(prime, pair))
        if checker == "shortest_containing_palindrome":
            tokens = actual.split()
            if len(tokens) != 1:
                return False
            source, result, oracle = case["input"].strip(), tokens[0], case["output"].strip()
            return source in result and result == result[::-1] and len(result) == len(oracle)
        if checker == "binary_matrix_square_root":
            return binary_square_root(case["input"], actual)
    except (ValueError, IndexError, TypeError, OverflowError):
        return False
    return False
