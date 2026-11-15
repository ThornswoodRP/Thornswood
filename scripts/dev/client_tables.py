"""client_tables.py: where a Python builder puts a table the front plugin reads (#5191, stage 4).

The same rule as ClientTables.js, which says why: each table is a plugin of
its own, game/plugins/thornswood-table-<name>.js, that puts its rows on
globalThis.Thornswood.clientTables on the first tick when the game is ours,
one compact row to a line.
game/tests/test-5191-client-tables.js holds the two alike.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
DIR = os.path.normpath(os.path.join(HERE, '..', '..', 'game', 'plugins'))
_NAME = re.compile(r'^[A-Z][A-Z0-9_]*$')
# The whose-game reader, character for character as ClientTables.js has it.
READER = '\n'.join([
    '// ------------------------------------------------------------ whose game ----',
    '// thornswood-front.js owns the whose-game check (issue #485): the client',
    "// settings must point at this server and the launcher's session note must be",
    '// fresh, or every Thornswood plugin stays idle. Front publishes the check as',
    '// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin',
    '// runs nothing until the first tick: Skyrim Platform runs every file in',
    '// Data/Platform/Plugins in one pass and sends that tick after the pass',
    "// (TickImpl in the fork's skyrim-platform SkyrimPlatform.cpp), so by then",
    '// front has published the check or did not load, whichever order the files',
    '// came in. Nothing published means idle; so does the check saying not ours.',
    '(function (start) {',
    "  skyrimPlatform.once('tick', function () {",
    '    const T = globalThis.Thornswood;',
    "    if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }",
    '    start();',
    '  });',
    '})(function () {',
    "'use strict';",
])
PREFIX = '((globalThis.Thornswood = globalThis.Thornswood || {}).clientTables = globalThis.Thornswood.clientTables || {}).'


def table_file(name, folder=None):
    if not _NAME.match(name):
        raise ValueError('a client table is named like the constant the front plugin used, not ' + name)
    return os.path.join(folder or DIR, 'thornswood-table-' + name.lower().replace('_', '-') + '.js')


def _js(value):
    # JSON.stringify writes a whole float as a whole number (1.0 is 1), and
    # json.dumps keeps the point, so it is made whole first: the same rows
    # give the same bytes from either builder.
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, list):
        return [_js(v) for v in value]
    if isinstance(value, dict):
        return {k: _js(v) for k, v in value.items()}
    return value


def _said(name):
    return ("skyrimPlatform.printConsole('[thornswood-table] " + name + ": ' + globalThis.Thornswood.clientTables."
            + name + ".length + ' rows');\n")


def _body(name, value, by):
    rows = json.loads(value) if isinstance(value, str) else value
    if not isinstance(rows, list):
        raise ValueError('the client table ' + name + ' is a list of rows')
    lines = ',\n'.join(json.dumps(_js(r), ensure_ascii=False, separators=(',', ':')) for r in rows)
    return ('// ' + name + ', a table the front plugin reads (#5191). Built by ' + by + ';\n'
            '// the content build writes it, so do not hand edit.\n' + READER + '\n'
            + PREFIX + name + ' = [' + ('\n' + lines + '\n' if rows else '') + '];\n' + _said(name) + '});\n')


def is_current(name, value, by, folder=None):
    try:
        with open(table_file(name, folder), 'r', encoding='utf-8', newline='') as f:
            return f.read() == _body(name, value, by)
    except FileNotFoundError:
        return False


def write(name, value, by, folder=None):
    """Writes the client table NAME; True when the file changed."""
    if is_current(name, value, by, folder):
        return False
    path = table_file(name, folder)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(_body(name, value, by))
    return True
