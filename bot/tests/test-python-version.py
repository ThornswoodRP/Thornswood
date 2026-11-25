"""
test-python-version.py

#2276 and #4502: the bot and its tests support Python 3.11 and 3.12.
The check is one shared module, _pyguard.py.

  1. unsupported_python() accepts patch releases of 3.11 and 3.12 and
     names the supported versions, executable path and py -3.12 otherwise.
  2. bot.py imports _pyguard as its first import, before anything else, and
     every bot/tests/test-*.py does too once its two lines that find bot\
     from bot\tests are done (import os and sys, HERE, sys.path), #5341.
  3. bot.py and every bot/tests/test-*.py, run with faked unsupported
     versions in child processes, stop with that message: non-zero, no
     traceback, never reaching discord.
  4. Install-Bot.ps1 sends _pyguard.py with bot.py.

Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import ast
import glob
import subprocess

PASS, FAIL = [], []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


check_python = _pyguard.unsupported_python
yes('3.12 is fine', check_python((3, 12, 10)) is None)
yes('3.11 is fine', check_python((3, 11, 0)) is None)
for version in ((3, 13, 0), (3, 14, 5), (4, 0, 0)):
    said = check_python(version, r'C:\PythonNew\python.exe') or ''
    number = '.'.join(str(part) for part in version)
    yes('%s is refused, naming the supported range, path and py -3.12' % number,
        number in said and 'PythonNew' in said and 'py -3.12' in said
        and '3.11 or 3.12' in said)
said = check_python((3, 9, 13), r'C:\Python39\python.exe') or ''
yes('3.9 is refused, naming the version, the path and py -3.12',
    '3.9.13' in said and 'Python39' in said and 'py -3.12' in said
    and '3.11 or 3.12' in said)
said = check_python((3, 10, 14), r'C:\Python310\python.exe') or ''
yes('3.10 is refused too: Pillow 13 needs 3.11 (#1401)',
    '3.10.14' in said and '3.11 or 3.12' in said)


def finds_bot(node):
    # The lines a test in bot\tests starts with so it can import _pyguard
    # and the bot from bot\: import os, import sys, HERE = ..., and
    # sys.path.insert(0, HERE). Nothing else may come before _pyguard.
    if isinstance(node, ast.Import):
        return [a.name for a in node.names] in (['os'], ['sys'])
    if isinstance(node, ast.Assign):
        return [getattr(t, 'id', None) for t in node.targets] == ['HERE']
    if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call):
        return ast.unparse(node.value) == 'sys.path.insert(0, HERE)'
    return False


def first_import(path, prelude=False):
    tree = ast.parse(open(path, encoding='utf-8').read(), path)
    for node in tree.body:
        if prelude and finds_bot(node):
            continue
        if isinstance(node, ast.Import):
            return node.names[0].name
        if isinstance(node, ast.ImportFrom):
            return node.module
        if not (isinstance(node, ast.Expr)
                and isinstance(getattr(node, 'value', None), ast.Constant)):
            return '(code before any import: %s)' % type(node).__name__
    return None


tests = sorted(glob.glob(os.path.join(HERE, 'tests', 'test-*.py')))
files = [os.path.join(HERE, 'bot.py')] + tests
wrong = [os.path.basename(f) for f in files
         if first_import(f, prelude=f in tests) != '_pyguard']
yes('bot.py and all %d bot tests import _pyguard first (wrong: %s)'
    % (len(files) - 1, wrong), not wrong and len(files) > 20)

CHILD = (
    'import sys, runpy\n'
    'sys.version_info = %r\n'
    'class Stop(object):\n'
    '    def find_module(self, n, p=None):\n'
    '        return None\n'
    '    def find_spec(self, n, p=None, t=None):\n'
    '        if n.split(".")[0] in ("discord", "PIL", "bot", "card"):\n'
    '            raise ImportError("reached " + n)\n'
    '        return None\n'
    'sys.meta_path.insert(0, Stop())\n'
    'sys.path.insert(0, %r)\n'
    'sys.argv = [sys.argv[1]]\n'
    'runpy.run_path(sys.argv[0], run_name="__main__")\n')
env = dict(os.environ, DISCORD_TOKEN='not-a-real-token')
for version in ((3, 10, 14, 'final', 0), (3, 13, 0, 'final', 0)):
    child = CHILD % (version, HERE)
    number = '.'.join(str(part) for part in version[:3])
    bad = []
    for f in files:
        p = subprocess.run([sys.executable, '-c', child, f], capture_output=True,
                           text=True, env=env, timeout=60)
        out = (p.stdout or '') + (p.stderr or '')
        if not (p.returncode != 0 and 'needs Python 3.11 or 3.12' in out
                and 'this is Python ' + number in out
                and 'reached ' not in out and 'Traceback' not in out):
            bad.append('%s (exit %s: %s)' % (os.path.basename(f), p.returncode,
                                             out.strip()[-160:]))
    yes('on a faked %s, bot.py and every bot test stop with the plain message '
        'and nothing else (%d run; bad: %s)' % (number, len(files), bad), not bad)

install = open(os.path.join(HERE, '..', 'scripts', 'deploy', 'Install-Bot.ps1'),
               encoding='utf-8').read()
code = open(os.path.join(HERE, '..', 'scripts', 'deploy', 'Bot-Code.ps1'),
            encoding='utf-8').read()
yes('Install-Bot.ps1 sends and checks _pyguard.py with bot.py',
    "return @('bot.py', '_pyguard.py', 'trust.py', 'card.py') + @(Get-ThornswoodBotParts $Repo)" in code
    and "-Paths (@(Get-ThornswoodBotCode $Repo | ForEach-Object { 'bot/' + $_ })" in install
    and "foreach ($f in @(Get-ThornswoodBotCode $Repo) + @(" in install
    and "$hashes @(Get-ThornswoodBotCode $Repo))" in install)

print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
