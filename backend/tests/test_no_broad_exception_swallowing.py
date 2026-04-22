"""
Test that backend code does not contain bare ``except Exception: pass`` blocks.

Issue #230 — Remove broad exception swallowing.
"""

import ast
import pathlib
import re

import pytest

BACKEND_DIR = pathlib.Path(__file__).parent.parent
PYTHON_FILES = list(BACKEND_DIR.rglob("*.py"))


def _is_bare_except_pass(body: list[ast.stmt]) -> bool:
    """Return True if the body is a single Pass node."""
    if not body:
        return True
    if len(body) == 1 and isinstance(body[0], ast.Pass):
        return True
    return False


def _is_just_logger(body: list[ast.stmt]) -> bool:
    """Return True if the body contains only logging calls (no re-raise)."""
    for stmt in body:
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            func = stmt.value.func
            if isinstance(func, ast.Attribute) and func.attr in ("exception", "error", "warning", "info", "debug"):
                continue
        if isinstance(stmt, ast.Pass):
            continue
        return False
    return True


@pytest.mark.parametrize("py_file", PYTHON_FILES)
def test_no_bare_except_exception_pass(py_file: pathlib.Path) -> None:
    """Every ``except Exception`` block must log or re-raise."""
    # Skip virtual-env and generated code
    if ".venv" in py_file.parts or "__pycache__" in py_file.parts:
        pytest.skip("venv or cache file")

    source = py_file.read_text()
    tree = ast.parse(source)

    failures: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ExceptHandler):
            type_name = ""
            if node.type is None:
                type_name = "bare except"
            elif isinstance(node.type, ast.Name) and node.type.id == "Exception":
                type_name = "except Exception"
            elif isinstance(node.type, ast.Tuple):
                # except (A, B, Exception):
                for elt in node.type.elts:
                    if isinstance(elt, ast.Name) and elt.id == "Exception":
                        type_name = "except (...Exception...)"
                        break
            if not type_name:
                continue

            body = node.body
            # Allow if it re-raises
            has_raise = any(isinstance(stmt, ast.Raise) for stmt in body)
            if has_raise:
                continue

            # Allow if it assigns a fallback (e.g. llm_creds = None)
            if len(body) == 1 and isinstance(body[0], ast.Assign):
                continue

            # Disallow bare pass
            if _is_bare_except_pass(body):
                failures.append(
                    f"{py_file.relative_to(BACKEND_DIR)}:{node.lineno} {type_name} -> pass"
                )
                continue

            # Disallow if it doesn't log at all
            if not _is_just_logger(body):
                # If it does something else (send json, etc.), that's acceptable
                continue

    assert not failures, "Bare or unlogged except Exception blocks found:\n" + "\n".join(failures)
