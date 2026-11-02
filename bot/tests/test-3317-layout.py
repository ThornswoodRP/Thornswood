"""
test-3317-layout.py

docs/systems/discord.md is the Discord layout in words, and it is the plan
(#3317).

Patrick, 22 Oct 2026: "we also need to document the discord layout somewhere
that will include the roles, channels, categories, permissions, etc so that we
dont accidentally drift using the script and we can quickly ask an agent a
question about it". He picked a page made from the plan and checked (page card
q-3317-layout-doc, A). This proves:

  D1 the page in the repository is exactly what
     `python3.12 bot/Build-Discord.py --layout` writes from the plan today, so
     a change to the plan without the page, or to the page by hand, fails here
  D2 every role and every channel of the plan is on the page
  D3 every written channel says whether it is a draft or keeps a changelog,
     and every live doc has its change line (check_docs is empty)

Build-Discord.py is imported for real, under another name, so its __main__
block never runs. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import importlib.util


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: F401
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord_layout', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

page_path = os.path.normpath(B.LAYOUT_FILE)
try:
    with open(page_path, encoding='utf-8') as f:
        page = f.read()
except OSError:
    page = ''
want = B.layout()

yes('D1 docs/systems/discord.md is there', bool(page))
same = page == want
if not same:
    a, b = page.split('\n'), want.split('\n')
    at = next((i for i, (x, y) in enumerate(zip(a, b)) if x != y), min(len(a), len(b)))
    print('      first difference at line %d:' % (at + 1))
    print('        page: %r' % (a[at] if at < len(a) else '(end)'))
    print('        plan: %r' % (b[at] if at < len(b) else '(end)'))
    print('      run: python3.12 bot/Build-Discord.py --layout')
yes('D1 it is exactly what --layout writes from the plan today', same)

missing = [n for n, _, _, _ in B.ROLES if '| %s |' % n not in want]
yes('D2 every role of the plan is on the page (missing %r)' % missing, not missing)
chans = [B._spec_name(s) for _, specs in B.PLAN for s in specs]
missing = [n for n in chans if '| %s |' % n not in want]
yes('D2 every channel of the plan is on the page (missing %r)' % missing, not missing)

docs = [s for _, specs in B.PLAN for s in specs if s.get('post')]
yes('D3 every written channel says draft or changelog',
    all(('content.py %s, a draft' % s['key']) in want or
        ('content.py %s, with its Changelog thread' % s['key']) in want for s in docs))
yes('D3 every live doc has its change line (check_docs is empty)', B.check_docs() == [])

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
