"""Every bot Python file compiles with no SyntaxWarning (#6992).

A Windows path in an ordinary string is read as escape sequences: a
backslash and T is not one, so Python 3.12 warns about it each time the file
compiles and a later Python refuses it, and a backslash and f is read as a
form feed, so the text does not say what it was written to say. ruff's E9 does not report it, so nothing caught
bot.py's docstring. Compiles each file with SyntaxWarning made an error, the
way a later Python will read it. Runs nothing it compiles.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard is found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import ast
import warnings

passed = failed = 0


def yes(name, okay):
    global passed, failed
    print(('PASS ' if okay else 'FAIL ') + name)
    if okay:
        passed += 1
    else:
        failed += 1


def warns(text, name):
    """What compiling text says, or '' when it compiles cleanly."""
    with warnings.catch_warnings():
        warnings.simplefilter('error', SyntaxWarning)
        try:
            compile(text, name, 'exec')
        except (SyntaxError, SyntaxWarning) as e:
            return '%s line %s: %s' % (name, getattr(e, 'lineno', '?'), getattr(e, 'msg', e))
    return ''


# The check itself bites: the line bot.py had, in an ordinary docstring.
yes('a Windows path in an ordinary string is caught',
    'invalid escape sequence' in warns('"""C:\\Thornswood-Admin\\for-bot\\github-token.json"""\n', 'planted'))
yes('the same path in a raw string is passed',
    warns('r"""C:\\Thornswood-Admin\\for-bot\\github-token.json"""\n', 'planted') == '')

files = []
for top, dirs, names in os.walk(HERE):
    dirs[:] = [d for d in dirs if d not in ('__pycache__', '.venv', 'venv', 'node_modules')]
    files += [os.path.join(top, n) for n in names if n.endswith('.py')]
files.sort()
bad = []
for path in files:
    with open(path, encoding='utf-8') as f:
        said = warns(f.read(), os.path.relpath(path, HERE))
    if said:
        bad.append(said)
for said in bad:
    print('  ' + said)
yes('every bot Python file compiles with no SyntaxWarning (%d files)' % len(files),
    len(files) > 0 and not bad)

with open(os.path.join(HERE, 'bot.py'), encoding='utf-8') as f:
    doc = ast.get_docstring(ast.parse(f.read())) or ''
yes("bot.py's docstring says the token's path as written",
    'C:\\Thornswood-Admin\\for-bot\\github-token.json' in doc)

print('%d passed, %d failed' % (passed, failed))
sys.exit(1 if failed else 0)
