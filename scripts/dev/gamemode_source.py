"""The gamemode's source for the Python table builders (#2181 option D).

The gamemode is written as TypeScript parts in game/gamemode, joined into
game/gamemode.js by scripts/dev/Build-Gamemode.js; gamemode-source.js beside
this file says how. A builder that rewrites a block between its markers reads
the parts as one joined text, edits it as it edited the single file, and
writes it back, which writes the parts and builds game/gamemode.js.

read(target) and write(target, text) take the path the builder was given
(its --gamemode). A source folder, one holding order.json, is the joined
source, through Build-Gamemode.js --read and --write, so the join and the
split live in one place. Any other path is one plain gamemode file, read and
written as it is, which is what a harness hands a builder.

Node is found on PATH; every machine that runs these builders has it (the
build machines, the cloud and the box, scripts/vps/Bootstrap-VPS.ps1).
"""
import io
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
SOURCE = os.path.join(ROOT, 'game', 'gamemode')
BUILD = os.path.join(HERE, 'Build-Gamemode.js')


def is_source(target):
    return os.path.isdir(target) and os.path.isfile(os.path.join(target, 'order.json'))


def _node(args):
    node = shutil.which('node')
    if not node:
        raise SystemExit('STOP. node is not on PATH, and the gamemode source is built with it (scripts/dev/Build-Gamemode.js).')
    r = subprocess.run([node, BUILD] + args, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit('STOP. Build-Gamemode.js %s failed: %s' % (args[0], (r.stderr or r.stdout).strip()))


def _scratch():
    fd, name = tempfile.mkstemp(prefix='gamemode-source-', suffix='.ts')
    os.close(fd)
    return name


def read(target):
    if not is_source(target):
        return io.open(target, encoding='utf-8', newline='').read()
    name = _scratch()
    try:
        _node(['--read', name, '--source', target])
        return io.open(name, encoding='utf-8', newline='').read()
    finally:
        os.remove(name)


def write(target, text):
    if not is_source(target):
        io.open(target, 'w', encoding='utf-8', newline='').write(text)
        return
    name = _scratch()
    try:
        io.open(name, 'w', encoding='utf-8', newline='').write(text)
        _node(['--write', name, '--source', target])
    finally:
        os.remove(name)
