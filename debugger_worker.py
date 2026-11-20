#!/usr/bin/env python3
"""Private Python runner. Protocol uses original stdin/stdout; user I/O is separate."""
from __future__ import annotations

import ast
import bdb
import builtins
import codecs
from collections import deque
import contextlib
import io
import json
import os
from pathlib import Path
try:
    import resource
except ImportError:
    resource = None
import random
import sys
import time
import traceback
import typing

MAX_OUTPUT = 200_000
PROTOCOL_IN, PROTOCOL_OUT = sys.stdin, sys.stdout


class OutputLimitError(RuntimeError):
    pass


class BoundedBinaryOutput(io.RawIOBase):
    """Binary writes and text writes share one bounded captured stream."""
    def __init__(self, owner):
        super().__init__()
        self.owner = owner
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")

    def writable(self):
        return True

    def write(self, value):
        if self.closed:
            raise ValueError("Запись в закрытый поток.")
        data = memoryview(value).tobytes()
        self.owner._write_text(self.decoder.decode(data, final=False))
        return len(data)

    def finish(self):
        # Finalize incomplete byte sequences only at a text boundary or program end.
        text = self.decoder.decode(b"", final=True)
        self.decoder.reset()
        if text:
            self.owner._write_text(text)


class BoundedOutput(io.StringIO):
    def __init__(self):
        super().__init__()
        self.buffer = BoundedBinaryOutput(self)

    @property
    def encoding(self):
        return "utf-8"

    @property
    def errors(self):
        return "replace"

    def _write_text(self, value):
        value = str(value)
        remaining = MAX_OUTPUT - self.tell()
        if len(value) > remaining:
            if remaining > 0:
                super().write(value[:remaining])
            raise OutputLimitError("Превышен лимит вывода (200 КБ).")
        return super().write(value)

    def write(self, value):
        self.buffer.finish()
        return self._write_text(value)

    def finish(self):
        self.buffer.finish()


def emit(data):
    PROTOCOL_OUT.write(json.dumps(data, ensure_ascii=False, default=str) + "\n")
    PROTOCOL_OUT.flush()


def limits():
    # This is a personal local runner, not a multi-user security sandbox.
    # Native Windows has no resource module. Parent timeouts and bounded output
    # still apply, but POSIX CPU/file/memory limits are unavailable there.
    if resource is None:
        return
    resource.setrlimit(resource.RLIMIT_CPU, (8, 9))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    if hasattr(resource, "RLIMIT_AS") and sys.platform != "darwin":
        resource.setrlimit(resource.RLIMIT_AS, (1024 * 1024 * 1024,) * 2)


class ListNode:
    def __init__(self, val=0, next=None):
        self.val, self.next = val, next

    def __repr__(self):
        return f"ListNode({self.val!r})"


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val, self.left, self.right = val, left, right

    def __repr__(self):
        return f"TreeNode({self.val!r})"


class NestedInteger:
    def __init__(self, value=None):
        self.value = [] if value is None else value
        if isinstance(self.value, list):
            self.value = [item if isinstance(item, NestedInteger) else NestedInteger(item) for item in self.value]

    def isInteger(self):
        return isinstance(self.value, int)

    def getInteger(self):
        return self.value if self.isInteger() else None

    def getList(self):
        return None if self.isInteger() else self.value

    def setInteger(self, value):
        self.value = value

    def add(self, value):
        if self.isInteger():
            self.value = []
        self.value.append(value if isinstance(value, NestedInteger) else NestedInteger(value))


def rand7():
    return random.SystemRandom().randint(1, 7)


def make_list(values):
    head = tail = ListNode()
    for val in values:
        tail.next = ListNode(val)
        tail = tail.next
    return head.next


def make_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = deque([root])
    iterator = iter(values[1:])
    for left in iterator:
        parent = queue.popleft()
        if left is not None:
            parent.left = TreeNode(left)
            queue.append(parent.left)
        right = next(iterator, None)
        if right is not None:
            parent.right = TreeNode(right)
            queue.append(parent.right)
    return root


def serializable(value, seen=None):
    if isinstance(value, ListNode):
        result, visited = [], set()
        while value is not None:
            if id(value) in visited:
                raise ValueError("Циклический связный список нельзя вывести как JSON.")
            visited.add(id(value))
            result.append(serializable(value.val))
            value = value.next
            if len(result) > 100_000:
                raise ValueError("Слишком большой связный список.")
        return result
    if isinstance(value, TreeNode):
        queue, result, visited = deque([value]), [], set()
        while queue:
            node = queue.popleft()
            if node is None:
                result.append(None)
                continue
            if id(node) in visited:
                raise ValueError("Циклическое дерево нельзя вывести как JSON.")
            visited.add(id(node))
            result.append(serializable(node.val))
            queue.extend([node.left, node.right])
        while result and result[-1] is None:
            result.pop()
        return result
    if isinstance(value, (list, tuple)):
        return [serializable(x) for x in value]
    if isinstance(value, dict):
        return {str(k): serializable(v) for k, v in value.items()}
    if isinstance(value, set):
        return sorted((serializable(x) for x in value), key=repr)
    return value


def literal(value):
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return ast.literal_eval(value)


def parse_arguments(text, names):
    if not text.strip():
        return [] if not names else [None] * len(names)
    try:
        value = literal(text)
    except (ValueError, SyntaxError):
        # Accept the usual LeetCode display format: nums = [...], target = 9.
        try:
            wrapped = ast.parse("dict(" + text + ")", mode="eval").body
            if not isinstance(wrapped, ast.Call) or wrapped.args or any(item.arg is None for item in wrapped.keywords):
                raise ValueError()
            value = {item.arg: literal(ast.unparse(item.value)) for item in wrapped.keywords}
        except (ValueError, SyntaxError):
            try:
                tree = ast.parse(text)
                named = {}
                for statement in tree.body:
                    if not isinstance(statement, ast.Assign) or len(statement.targets) != 1 or not isinstance(statement.targets[0], ast.Name):
                        raise ValueError()
                    named[statement.targets[0].id] = literal(ast.unparse(statement.value))
                value = named
            except (ValueError, SyntaxError):
                lines = [line.strip() for line in text.splitlines() if line.strip()]
                if len(lines) == len(names):
                    return [literal(line) for line in lines]
                raise ValueError("Для LeetCode задайте аргументы JSON-объектом: {\"nums\": [2,7,11,15], \"target\": 9}.")
    if isinstance(value, dict):
        if "args" in value and len(value) == 1:
            return value["args"]
        missing = [name for name in names if name not in value]
        if missing:
            raise ValueError("Не заданы аргументы: " + ", ".join(missing))
        return [value[name] for name in names]
    if len(names) == 1:
        return [value]
    if isinstance(value, (list, tuple)) and len(value) == len(names):
        return list(value)
    raise ValueError("Число аргументов не совпадает с методом Solution. Используйте JSON-объект с именами аргументов.")


def infer_signature(code, signature):
    signature = dict(signature or {})
    tree = ast.parse(code)
    solution = next((node for node in tree.body if isinstance(node, ast.ClassDef) and node.name == "Solution"), None)
    if solution is None:
        return signature
    method = signature.get("method")
    function = next((node for node in solution.body if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and (node.name == method if method else not node.name.startswith("_"))), None)
    if function is None:
        raise ValueError("Не найден метод class Solution. Импортируйте Python-шаблон задачи или задайте метод в signature.")
    signature["method"] = function.name
    if not signature.get("return_type") and function.returns:
        signature["return_type"] = ast.unparse(function.returns)
    inferred_types = {node.arg: ast.unparse(node.annotation) if node.annotation else "" for node in function.args.args if node.arg != "self"}
    if not signature.get("params"):
        signature["params"] = [{"name": name, "type": kind} for name, kind in inferred_types.items()]
    else:
        parameter_types = signature.get("param_types", [])
        inferred = []
        for index, item in enumerate(signature["params"]):
            name = item.get("name") if isinstance(item, dict) else item
            fallback = parameter_types[index] if index < len(parameter_types) else ""
            inferred.append({"name": name, "type": (item.get("type") if isinstance(item, dict) else "") or inferred_types.get(name) or fallback})
        signature["params"] = inferred
    return signature


def convert_argument(value, annotation):
    annotation = str(annotation or "")
    if isinstance(value, list) and "ListNode" in annotation:
        if "List[" in annotation or "list[" in annotation:
            return [make_list(x) if x is not None else None for x in value]
        return make_list(value)
    if isinstance(value, list) and "TreeNode" in annotation:
        return make_tree(value)
    return value


def execute_solution(config, filename):
    namespace = {"__name__": "__main__", "__file__": filename, "__builtins__": builtins.__dict__, "ListNode": ListNode, "TreeNode": TreeNode, "NestedInteger": NestedInteger, "rand7": rand7}
    namespace.update({name: getattr(typing, name) for name in typing.__all__})
    exec(compile(config["code"], filename, "exec"), namespace)
    if config.get("source") != "leetcode":
        return
    signature = infer_signature(config["code"], config.get("signature"))
    text = config.get("stdin", "")
    problem_id = config.get("problem_id", "")
    if problem_id == "leetcode-341":
        values = parse_arguments(text, ["nestedList"])[0]
        iterator = namespace["NestedIterator"]([NestedInteger(value) for value in values])
        result = []
        while iterator.hasNext():
            result.append(iterator.next())
        print(json.dumps(result, ensure_ascii=False))
        return {"return_value": result}
    if problem_id == "leetcode-470":
        count = parse_arguments(text, ["n"])[0]
        if not isinstance(count, int) or not 1 <= count <= 100_000:
            raise ValueError("n — число вызовов rand10, от 1 до 100000.")
        solution = namespace["Solution"]()
        result = [solution.rand10() for _ in range(count)]
        print(json.dumps(result, ensure_ascii=False))
        return {"return_value": result}
    if "Solution" not in namespace:
        # Stateful design questions use explicit operation and argument arrays.
        try:
            try:
                payload = json.loads(text)
            except json.JSONDecodeError:
                decoder = json.JSONDecoder()
                operations, position = decoder.raw_decode(text.lstrip())
                arguments = json.loads(text.lstrip()[position:].strip())
                payload = {"operations": operations, "arguments": arguments}
            if isinstance(payload, list) and len(payload) == 2:
                payload = {"operations": payload[0], "arguments": payload[1]}
            operations, arguments = payload["operations"], payload["arguments"]
            if not isinstance(operations, list) or not isinstance(arguments, list) or not operations or len(operations) != len(arguments):
                raise ValueError("Массивы operations и arguments должны иметь одинаковую непустую длину.")
            instance = namespace[operations[0]](*arguments[0])
            result = [None]
            for operation, args in zip(operations[1:], arguments[1:]):
                result.append(getattr(instance, operation)(*args))
            print(json.dumps(serializable(result), ensure_ascii=False))
            return {"return_value": serializable(result)}
        except (KeyError, TypeError, json.JSONDecodeError):
            raise ValueError('Для задачи с классом используйте JSON {"operations": ["LRUCache", "put", "get"], "arguments": [[2], [1, 1], [1]]}.')
    params = signature.get("params", [])
    names = [p.get("name") if isinstance(p, dict) else p for p in params]
    annotations = [p.get("type", "") if isinstance(p, dict) else "" for p in params]
    args = [convert_argument(value, kind) for value, kind in zip(parse_arguments(text, names), annotations)]
    if problem_id == "leetcode-236":
        root = args[names.index("root")]
        if not isinstance(root, TreeNode):
            root = make_tree(root)
            args[names.index("root")] = root
        nodes, pending = {}, [root]
        while pending:
            node = pending.pop()
            if node is not None:
                nodes[node.val] = node
                pending.extend([node.left, node.right])
        for name in ("p", "q"):
            index = names.index(name)
            if not isinstance(args[index], TreeNode):
                if args[index] not in nodes:
                    raise ValueError(f"Узел {name} не найден в дереве root.")
                args[index] = nodes[args[index]]
    result = getattr(namespace["Solution"](), signature["method"])(*args)
    if problem_id == "leetcode-236":
        if not isinstance(result, TreeNode):
            raise ValueError("lowestCommonAncestor должен вернуть узел TreeNode из дерева root.")
        result = result.val
    if result is None and args and problem_id in {"leetcode-88", "leetcode-283"}:
        result = args[0]
    elif result is None and any(kind in str(signature.get("return_type", "")) for kind in ("ListNode", "TreeNode")):
        result = []
    print(json.dumps(serializable(result), ensure_ascii=False, default=str))
    details = {"return_value": serializable(result)}
    if problem_id in {"leetcode-26", "leetcode-443"}:
        details["mutated_prefix"] = serializable(args[0][:result]) if type(result) is int and 0 <= result <= len(args[0]) else None
    return details


def brief(value):
    try:
        text = repr(value)
        return text[:700] + ("…" if len(text) > 700 else "")
    except BaseException:
        return "<не удалось показать значение>"


class Debugger(bdb.Bdb):
    def __init__(self, filename, output, errors, breakpoints):
        super().__init__()
        self.filename = self.canonic(filename)
        self.output, self.errors = output, errors
        self.initial = True
        self.requested_breakpoints = breakpoints
        self.update_breakpoints(breakpoints)

    def update_breakpoints(self, lines):
        self.clear_all_breaks()
        for line in lines:
            if isinstance(line, int) and line > 0:
                self.set_break(self.filename, line)

    def user_line(self, frame):
        if self.canonic(frame.f_code.co_filename) != self.filename:
            return
        if self.initial:
            self.initial = False
            if self.requested_breakpoints and not self.break_here(frame):
                self.set_continue()
                return
        frames, current = [], frame
        while current:
            if self.canonic(current.f_code.co_filename) == self.filename:
                frames.append({"name": current.f_code.co_name, "line": current.f_lineno})
            current = current.f_back
        visible = [(name, value) for name, value in frame.f_locals.items() if not name.startswith("__") and name not in typing.__all__ and name not in {"ListNode", "TreeNode"}]
        variables = [{"name": name, "value": brief(value), "type": type(value).__name__} for name, value in visible[:80]]
        emit({"status": "paused", "line": frame.f_lineno, "locals": variables, "stack": frames[:30], "stdout": self.output.getvalue(), "stderr": self.errors.getvalue()})
        command_line = PROTOCOL_IN.readline()
        if not command_line:
            self.set_quit()
            return
        command = json.loads(command_line)
        if "breakpoints" in command:
            self.update_breakpoints(command["breakpoints"])
        action = command.get("command", "next")
        if action == "step":
            self.set_step()
        elif action == "next":
            self.set_next(frame)
        elif action == "continue":
            self.set_continue()
        elif action == "return":
            self.set_return(frame)
        else:
            self.set_quit()


def main():
    config = json.loads(PROTOCOL_IN.readline())
    limits()
    filename = str(Path.cwd() / "solution.py")
    Path(filename).write_text(config["code"], encoding="utf-8")
    output, errors = BoundedOutput(), BoundedOutput()
    started = time.monotonic()
    exit_code, failure = 0, None
    details = {}
    original_stdin = sys.stdin
    try:
        sys.stdin = io.TextIOWrapper(io.BytesIO(config.get("stdin", "").encode("utf-8")), encoding="utf-8")
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            if config.get("mode") == "debug":
                debugger = Debugger(filename, output, errors, config.get("breakpoints", []))
                details = debugger.runcall(execute_solution, config, filename) or {}
            else:
                details = execute_solution(config, filename) or {}
    except bdb.BdbQuit:
        pass
    except SystemExit as error:
        exit_code = error.code if isinstance(error.code, int) else 1 if error.code else 0
        if exit_code:
            failure = "Программа завершилась с кодом " + str(exit_code)
    except BaseException as error:
        exit_code = 1
        failure = f"{type(error).__name__}: {error}"
        try:
            traceback.print_exc(file=errors)
        except OutputLimitError:
            pass
    finally:
        sys.stdin = original_stdin
        for stream in (output, errors):
            try:
                stream.finish()
            except OutputLimitError as error:
                exit_code = 1
                failure = failure or f"{type(error).__name__}: {error}"
    emit(dict(details, status="error" if failure else "finished", line=None, locals=[], stack=[], stdout=output.getvalue(), stderr=errors.getvalue(), error=failure, exit_code=exit_code, duration=round(time.monotonic() - started, 4)))


if __name__ == "__main__":
    main()
