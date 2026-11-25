"""A role derivation PR must prove its retained measurements before using them."""

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('role_candidate', ROOT / 'scripts/dev/Check-MerchantRoleCandidate.py')
candidate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(candidate)


class CandidateTrustTests(unittest.TestCase):
    def test_unmodified_builder_stays_on_exact_path(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / 'temp').mkdir()
            (root / 'temp/content-laid.json').write_text(json.dumps({'server': 'dev', 'commit': 'a' * 40}))
            with mock.patch.object(candidate, 'ROOT', root), \
                    mock.patch.object(candidate, 'assert_unchanged'), \
                    mock.patch.object(candidate, 'git', return_value=b'unchanged'), \
                    mock.patch.object(candidate, 'module_at'), \
                    mock.patch.object(candidate, 'candidate_check') as derive, \
                    mock.patch.object(candidate.subprocess, 'run') as test, \
                    mock.patch.object(candidate, 'exact_check') as check:
                candidate.check(allow_candidate=True)
            derive.assert_not_called()
            test.assert_called_once()
            self.assertEqual(check.call_args.args[1], root / candidate.CATALOGUE)

    def test_changed_builder_only_derives_when_the_verified_exact_tables_differ(self):
        for error, expected_derive in (
            (None, False),
            (ValueError('Role tables differ from their measured sources'), True),
            (ValueError('Role-table source evidence is stale'), False),
        ):
            with self.subTest(error=error), tempfile.TemporaryDirectory() as folder:
                root = Path(folder)
                (root / 'temp').mkdir()
                manifest = {'server': 'dev', 'commit': 'a' * 40}
                (root / 'temp/content-laid.json').write_text(json.dumps(manifest))
                with (
                    mock.patch.object(candidate, 'ROOT', root),
                    mock.patch.object(candidate, 'assert_unchanged'),
                    mock.patch.object(candidate, 'git', side_effect=[b'', b'old', b'new']),
                    mock.patch.object(candidate, 'module_at') as module,
                    mock.patch.object(candidate, 'held_digest') as held,
                    mock.patch.object(candidate, 'candidate_check') as derive,
                    mock.patch.object(candidate.subprocess, 'run') as test,
                    mock.patch.object(candidate, 'exact_check', side_effect=error) as exact,
                ):
                    if error is None or expected_derive:
                        candidate.check(allow_candidate=True)
                    else:
                        with self.assertRaisesRegex(ValueError, 'source evidence is stale'):
                            candidate.check(allow_candidate=True)
                held.assert_called_once_with(root, manifest, candidate.CATALOGUE)
                exact.assert_called_once_with(module.return_value, root / candidate.CATALOGUE)
                self.assertEqual(derive.called, expected_derive)
                self.assertEqual(test.called, error is None)

    def test_changed_input_and_reader_are_refused(self):
        for path in ('game/data/items.json', 'scripts/mods/Build-LastPlugin.py'):
            with self.subTest(path=path), mock.patch.object(candidate, 'git', return_value=path.encode()) as git:
                with self.assertRaisesRegex(ValueError, 'require a new content build'):
                    candidate.assert_unchanged('a' * 40, (path,))
                git.assert_called_once_with('diff', '--name-only', 'a' * 40, '--', path)

    def test_retained_bytes_must_match_manifest(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            path = root / 'input.json'
            data = b'{"first":true}'
            path.write_bytes(data)
            manifest = {'files': {'input.json': hashlib.sha256(data).hexdigest()}}
            self.assertEqual(candidate.held_digest(root, manifest, 'input.json'), data)
            path.write_bytes(b'{"first":false}')
            with self.assertRaisesRegex(ValueError, 'does not match its digest'):
                candidate.held_digest(root, manifest, 'input.json')
            with self.assertRaisesRegex(ValueError, 'no digest'):
                candidate.held_digest(root, manifest, 'unknown.json')

    def test_matching_digest_cannot_bypass_the_original_catalogue_check(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            catalogue = root / candidate.CATALOGUE
            catalogue.parent.mkdir(parents=True)
            data = b'{"loadOrder":[],"counts":{"Woodworker":{"supply":0}}}'
            catalogue.write_bytes(data)
            manifest = {'files': {candidate.CATALOGUE: hashlib.sha256(data).hexdigest()}}
            current = SimpleNamespace(INPUTS=(), derive=mock.Mock())
            retained = SimpleNamespace(INPUTS=(), ROOT=root)
            with mock.patch.object(candidate, 'ROOT', root), \
                    mock.patch.object(candidate, 'assert_unchanged'), \
                    mock.patch.object(candidate, 'git'), \
                    mock.patch.object(candidate, 'module_at', return_value=retained), \
                    mock.patch.object(candidate, 'exact_check', side_effect=ValueError('bad original counts')) as exact:
                with self.assertRaisesRegex(ValueError, 'bad original counts'):
                    candidate.candidate_check(current, manifest, 'a' * 40, b'# retained code')
            exact.assert_called_once_with(retained, catalogue)
            current.derive.assert_not_called()
            self.assertEqual(catalogue.read_bytes(), data)


if __name__ == '__main__':
    unittest.main()
