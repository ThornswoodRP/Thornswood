"""Where a builder puts a table the gamemode reads (#5191).

Until #5191 every builder in scripts/mods/content-tables.json pasted its table
into game/gamemode.js, so every content change rewrote the same lines of that
file and no two content pull requests could merge side by side. Now each table
is its own file, game/gamemode-tables/<NAME>.json, and the gamemode's
`const NAME = table('NAME')` reads it when it loads.

The file is laid out one entry to a line down to the second level and compact
below that, so two changes to different rows are two lines git merges. The
same rule is GamemodeTables.js and GamemodeTables.ps1;
tests/test-5191-gamemode-tables.js holds the three to each other.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'game', 'gamemode-tables'))
_NAME = re.compile(r'^[A-Z][A-Z0-9_]*$')
_DEPTH = 2


def layout(text):
    out = []
    depth = 0
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        c = text[i]
        if in_string:
            out.append(c)
            if c == '\\':
                i += 1
                out.append(text[i])
            elif c == '"':
                in_string = False
            i += 1
            continue
        if c in ' \t\r\n':
            i += 1
            continue
        if c == '"':
            in_string = True
            out.append(c)
        elif c in '{[':
            depth += 1
            out.append(c)
            j = i + 1
            while j < n and text[j] in ' \t\r\n':
                j += 1
            if depth <= _DEPTH and text[j:j + 1] not in ('}', ']'):
                out.append('\n')
        elif c in '}]':
            empty = out and out[-1] in ('{', '[')
            if depth <= _DEPTH and not empty:
                out.append('\n')
            depth -= 1
            out.append(c)
        elif c == ',' and depth <= _DEPTH:
            out.append(',\n')
        else:
            out.append(c)
        i += 1
    return ''.join(out) + '\n'


def table_file(name, folder=None):
    """The table's file; folder is game/gamemode-tables unless a harness or a --tables option names another."""
    if not _NAME.match(name):
        raise ValueError('a gamemode table is named like the constant that holds it, not ' + name)
    return os.path.join(folder or DIR, name + '.json')


def _body(value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, separators=(',', ':'))
    json.loads(text)
    return layout(text)


def is_current(name, value, folder=None):
    """Whether the table file NAME is already what write(name, value) would make: a builder's --check."""
    try:
        with open(table_file(name, folder), 'r', encoding='utf-8', newline='') as f:
            return f.read() == _body(value)
    except FileNotFoundError:
        return False


def write(name, value, folder=None):
    """Writes the table NAME from its JSON text or its value; True when the file changed."""
    body = _body(value)
    path = table_file(name, folder)
    if is_current(name, value, folder):
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(body)
    return True


def read(name, folder=None):
    with open(table_file(name, folder), 'r', encoding='utf-8') as f:
        return json.load(f)
