"""Check a role derivation change against the retained Dev build's evidence.

The retained catalogue must pass its original generator's checks first.
Only a change to the derivation can use this mode. New source inputs or
plugin evidence require a fresh content build.
"""

import argparse
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
BUILDER = 'scripts/dev/Build-MerchantRoleTables.py'
CATALOGUE = 'game/data/merchant-role-tables.json'
# Files the role builder uses for plugin evidence, including the reader's imports.
PROVENANCE_SOURCES = (
    'game/content', 'scripts/mods/Build-LastPlugin.py', 'scripts/mods/last_recipe.py',
    'scripts/dev/bsa.py', 'scripts/dev/gamemode_tables.py', 'scripts/dev/own_plugins.py',
)


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def assert_unchanged(commit, paths):
    changed = git('diff', '--name-only', commit, '--', *paths).decode('utf-8').strip()
    if changed:
        raise ValueError('Role evidence inputs changed; require a new content build: ' + changed)


def held_digest(root, manifest, rel):
    expected = manifest['files'].get(rel)
    if not isinstance(expected, str) or not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('Retained build has no digest for ' + rel)
    data = (root / rel).read_bytes()
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('Retained build file does not match its digest: ' + rel)
    return data


def module_at(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def exact_check(roles, path):
    with mock.patch.object(roles, 'OUT', path), mock.patch.object(sys, 'argv', [BUILDER, '--check']):
        roles.main()


def candidate_check(current, manifest, commit, retained_code):
    assert_unchanged(commit, (*PROVENANCE_SOURCES, *current.INPUTS, 'game/data/npc-population.json'))
    inputs = [*current.INPUTS, 'game/data/npc-population.json']
    for rel in inputs:
        if rel in manifest['files']:
            held_digest(ROOT, manifest, rel)
        else:
            # A tracked input can be absent from the generated-files manifest.
            git('cat-file', '-e', commit + ':' + rel)
    catalogue = json.loads(held_digest(ROOT, manifest, CATALOGUE))
    for plugin in catalogue['loadOrder']:
        if plugin['repository']:
            name = plugin['name']
            if not isinstance(name, str) or not re.fullmatch(r'[^:/\\]+\.(?:esm|esp|esl)', name, re.I):
                raise ValueError('Invalid retained plugin name')
            held_digest(ROOT, manifest, 'game/content/' + name)

    with tempfile.TemporaryDirectory(prefix='tw-role-candidate-') as folder:
        scratch = Path(folder)
        original_builder = scratch / BUILDER
        original_builder.parent.mkdir(parents=True)
        original_builder.write_bytes(retained_code)
        original = module_at(original_builder, 'retained_roles')
        original.ROOT = ROOT
        if original.INPUTS != current.INPUTS:
            raise ValueError('Role evidence input list changed; require a new content build')
        exact_check(original, ROOT / CATALOGUE)

        data, source_hashes = current.input_bundle()
        if source_hashes != catalogue['sources']:
            raise ValueError('Role evidence inputs changed; require a new content build')
        tables, evidence = current.derive(*data, copy.deepcopy(catalogue['records']))
        counts = {role: {direction: len(ids) for direction, ids in table.items()} for role, table in tables.items()}
        candidate = dict(catalogue, tables=tables, evidence=evidence, counts=counts)
        path = scratch / 'merchant-role-tables.json'
        path.write_text(json.dumps(candidate), encoding='utf-8')
        exact_check(current, path)

        tests = module_at(ROOT / 'tests/test-merchant-role-data.py', 'candidate_role_tests')
        tests.roles.OUT = path
        result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromModule(tests))
        if not result.wasSuccessful():
            raise ValueError('Candidate role tests failed')
    print('PASS role candidate derived in scratch from verified retained evidence')


def check(allow_candidate):
    assert_unchanged('HEAD', (BUILDER,))
    roles = module_at(ROOT / BUILDER, 'candidate_roles')
    retained_code = None
    if allow_candidate:
        manifest = json.loads((ROOT / 'temp/content-laid.json').read_bytes())
        commit = manifest['commit']
        if manifest['server'] != 'dev' or not isinstance(commit, str) or not re.fullmatch(r'[0-9a-f]{40}', commit):
            raise ValueError('Expected a verified retained Dev content build')
        git('merge-base', '--is-ancestor', commit, 'HEAD')
        original_code = git('show', commit + ':' + BUILDER)
        if original_code != git('show', 'HEAD:' + BUILDER):
            held_digest(ROOT, manifest, CATALOGUE)
            retained_code = original_code

    try:
        exact_check(roles, ROOT / CATALOGUE)
    except ValueError as error:
        # Derive only after the existing exact check has accepted the sources
        # and provenance and found a change in the resulting tables.
        if retained_code is None or str(error) != 'Role tables differ from their measured sources':
            raise
        candidate_check(roles, manifest, commit, retained_code)
        return

    subprocess.run([sys.executable, str(ROOT / 'tests/test-merchant-role-data.py')], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--allow-candidate', action='store_true', help='Check a PR derivation against verified retained Dev evidence')
    check(parser.parse_args().allow_candidate)
