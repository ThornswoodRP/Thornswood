"""Both plugin source builders must check candidate bytes before writing (#4634)."""
import ast
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

MODS = Path(__file__).resolve().parents[1] / 'scripts' / 'mods'


def sub(tag, body):
    return tag + struct.pack('<H', len(body)) + body


def record(tag, fid, body):
    return struct.pack('<4s5I', tag, len(body), 0, fid, 0, 0) + body


def plugin(master=None, body=b''):
    header = sub(b'HEDR', struct.pack('<fiI', 1.71, 0, 0x1000))
    if master:
        header += sub(b'MAST', master.encode() + b'\0') + sub(b'DATA', bytes(8))
    return record(b'TES4', 0, header) + body


class BuildMasters(unittest.TestCase):
    def test_builders_refuse_before_writing(self):
        for tool, candidate in [('Add-ContentRecords.py', 'out'), ('Build-LastPlugin.py', 'plugin')]:
            with self.subTest(tool=tool):
                tree = ast.parse((MODS / tool).read_text(encoding='utf-8'))
                main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'main')
                gate = next((n for n in main.body if isinstance(n, ast.If)
                             and isinstance(n.test, ast.UnaryOp) and isinstance(n.test.op, ast.Not)
                             and isinstance(n.test.operand, ast.Call)
                             and isinstance(n.test.operand.func, ast.Attribute)
                             and n.test.operand.func.attr == 'check_build'), None)
                self.assertIsNotNone(gate, 'a masters finding must stop the builder')
                self.assertEqual(gate.test.operand.args[1].id, candidate)
                self.assertTrue(any(isinstance(n, ast.Return) and isinstance(n.value, ast.Constant)
                                    and n.value.value == 1 for n in gate.body))
                replacements = [n.lineno for n in ast.walk(main) if isinstance(n, ast.Call)
                                and isinstance(n.func, ast.Attribute) and n.func.attr == 'replace'
                                and isinstance(n.func.value, ast.Name) and n.func.value.id == 'os']
                self.assertTrue(replacements and gate.lineno < min(replacements))

    def test_checker_uses_candidate_and_actual_master(self):
        spec = importlib.util.spec_from_file_location('clean', MODS / 'Check-PluginClean.py')
        clean = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(clean)
        master = 'StandIn.esm'
        with tempfile.TemporaryDirectory() as temp:
            data = Path(temp)
            self.assertFalse(clean.check_build('Candidate.esp', plugin(master), temp, [master]))
            (data / master).write_bytes(plugin())
            self.assertTrue(clean.check_build('Candidate.esp', plugin(master), temp, [master]))
            # A well-formed override that only the masters check can reject.
            body = record(b'MISC', 0x800, sub(b'EDID', b'StandIn\0'))
            group = struct.pack('<4sI4s3I', b'GRUP', 24 + len(body), b'MISC', 0, 0, 0) + body
            self.assertFalse(clean.check_build('Candidate.esp', plugin(master, group), temp, [master]))
            self.assertFalse((data / 'Candidate.esp').exists())


if __name__ == '__main__':
    unittest.main()
