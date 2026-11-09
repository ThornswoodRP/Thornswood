"""
test-4348-refusal-said.py

A refusal is remembered as said only once GitHub took the comment (#4348).
bot_post_rules.refuse() comments on the issue why the bot did not post it,
and remembers the rules it named so it does not say them twice. It used to
remember them when the comment failed as well, so a comment GitHub refused
was never tried again and nobody learned the post was refused.

  A. a comment that fails: nothing is posted, the failure is logged, and the
     refusal is not remembered;
  B. the next pass says it again, and once GitHub takes it, it is
     remembered;
  C. a pass after that says nothing more, and a different rule broken is
     said again, as before.

The real bot module is imported. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
FAIL = []


def yes(what, cond):
    if not cond:
        FAIL.append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))

RULES = ['Format: the steps are not numbered (1. 2. 3.).']
tried = []


def refused_by_github(num, text):
    tried.append(num)
    raise OSError('HTTP Error 403: Resource not accessible by integration')


def taken_by_github(num, text):
    tried.append(num)
    return {'id': 1}


st = {}

# A
kept = bot.refuse(st, 'dev', 7, RULES, say=refused_by_github)
yes('A1 the post is still held back', kept is True)
yes('A2 the comment was tried', tried == [7])
yes('A3 the failure is in the log, naming the issue',
    any('#7' in l and 'could not comment' in l for l in LOGGED))
yes('A4 a comment GitHub refused is not remembered as said',
    'dev:7' not in st.get('refused', {}))

# B
kept = bot.refuse(st, 'dev', 7, RULES, say=taken_by_github)
yes('B1 the next pass says it again', tried == [7, 7] and kept is True)
yes('B2 and once GitHub took it, it is remembered',
    st.get('refused', {}).get('dev:7') == '\n'.join(RULES) and st.get('_dirty') is True)

# C
kept = bot.refuse(st, 'dev', 7, RULES, say=taken_by_github)
yes('C1 a pass after that says nothing more', tried == [7, 7] and kept is True)
kept = bot.refuse(st, 'dev', 7, RULES + ['Format: x'], say=taken_by_github)
yes('C2 a different rule broken is said again', tried == [7, 7, 7] and kept is True)

print('\n%d failed' % len(FAIL) if FAIL else '\nall passed')
sys.exit(1 if FAIL else 0)
