"""
test-2353-join-keeping.py

    python tests/test-2353-join-keeping.py

Issue #2353: the bot kept which arrival each Discord account was in
joins.json for ever, after its person left too, and the privacy page did not
name it. Decided by Patrick on 12 Oct: a keeping time for each store,
enforced in code. A number is now kept while its person is in the Discord and
for JOIN_KEEP_DAYS (365) after they leave.

joins_age is lifted out of bot/bot_joins.py by its source and run on its own, so
this needs neither discord.py nor a token and runs on every pull request; the
nightly runs the bot's own tests against the whole module. It proves:
  - somebody numbered and not in the server is marked left now, once;
  - somebody marked and in the server again is unmarked;
  - a number whose person left more than 365 days ago goes, with its mark,
    and one that left 364 days ago stays;
  - 'last' is never touched, so no number is handed out twice;
  - a server whose member list is not whole is never marked, only aged;
  - a mark that is not a time is left, with its number;
and that the deletion request, the hourly watch and arrival_number all use
the marks. And (#3620) that age_restore_copies deletes a joins.json a restore
set aside 30 days after the time in its name, in a scratch folder, and the
hourly watch runs it. Synthetic ids only; nothing outside the scratch folder
is written.
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
# All of the bot's code, bot.py and its modules (#5357), read without
# importing it, so no discord.py is needed.
sys.path.insert(0, str(ROOT / 'bot'))
import harness_bot  # noqa: E402
SRC = harness_bot.source()
TREE = ast.parse(SRC)

PASS, FAIL = [], []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


def lift(name):
    for node in TREE.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == name:
            return ast.get_source_segment(SRC, node)
    return ''


def constant(name):
    for node in TREE.body:
        if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == name for t in node.targets):
            # Arithmetic on numbers only (60 * 60), nothing named.
            return eval(compile(ast.Expression(node.value), name, 'eval'), {'__builtins__': {}})
    return None


DAYS = constant('JOIN_KEEP_DAYS')
yes('a number is kept 365 days after its person leaves', DAYS == 365)
yes('and the record is looked at every hour', constant('JOIN_KEEP_EVERY') == 3600)

code = lift('joins_age')
yes('bot.py has joins_age', bool(code))
space = {'JOIN_KEEP_DAYS': DAYS}
exec(code, space)
joins_age = space['joins_age']

DAY = 86400000
NOW = 1_800_000_000_000
rec = {
    '900': {'last': 40, 'members': {'1': 29, '2': 30, '3': 31, '4': 32, '5': 33, '6': 34},
            'left': {'3': NOW - 366 * DAY, '4': NOW - 364 * DAY, '5': NOW - 10 * DAY, '6': 'yesterday'}},
    '901': {'last': 5, 'members': {'7': 1, '8': 2}, 'left': {'8': NOW - 400 * DAY}},
    'junk': 'not a server',
}
here = {'900': {'1', '5'}}
marked, dropped = joins_age(rec, NOW, here)
g = rec['900']
yes('somebody numbered and not in the server is marked left now',
    g['left'].get('2') == NOW)
yes('somebody in the server with no mark stays unmarked', '1' not in g['left'])
yes('somebody marked and back in the server is unmarked, and keeps their number',
    '5' not in g['left'] and g['members'].get('5') == 33)
yes('a number whose person left 366 days ago goes, with its mark',
    '3' not in g['members'] and '3' not in g['left'])
yes('one whose person left 364 days ago stays', g['members'].get('4') == 32 and '4' in g['left'])
yes('a mark that is not a time is left, with its number', g['left'].get('6') == 'yesterday' and '6' in g['members'])
yes('the last number given out is never touched', g['last'] == 40 and rec['901']['last'] == 5)
yes('a server whose list is not whole is never marked', '7' not in rec['901'].get('left', {}))
yes('but it is still aged', '8' not in rec['901']['members'] and 'left' not in rec['901'])
yes('a part of the record that is not a server is left alone', rec['junk'] == 'not a server')
yes('the counts say what happened: one marked, one unmarked, two dropped', (marked, dropped) == (2, 2))

again = joins_age(rec, NOW, here)
yes('a second pass with nothing new changes nothing', again == (0, 0))

empty = {'902': {'last': 3, 'members': {'9': 3}}}
joins_age(empty, NOW, {'902': {'9'}})
yes('a server with nobody gone gets no left field at all', 'left' not in empty['902'])

watch = lift('watch_join_numbers')
yes('the hourly watch marks only servers whose member list is whole',
    'gd.chunked' in watch and 'joins_age(rec,' in watch and '_joins_write(rec)' in watch)
yes('and sleeps JOIN_KEEP_EVERY between passes', 'asyncio.sleep(JOIN_KEEP_EVERY)' in watch)
yes('the bot starts the watch when it is ready', 'asyncio.create_task(watch_join_numbers())' in lift('on_ready'))
arrive = lift('arrival_number')
yes('somebody who comes back is unmarked at once', "left = g.get('left')" in arrive and 'del left[str(member.id)]' in arrive)
dele = lift('apply_deletion_requests')
yes('a deletion request takes their mark as well as their number',
    "g.get('left')" in dele and 'del left[i]' in dele and 'if numbers or marks:' in dele)

# The joins.json a restore set aside (#3620, Patrick's B): gone 30 days after
# the time in its name, by the hourly watch.
import datetime
import os
import re
import tempfile
import time
aside = {'os': os, 're': re, 'datetime': datetime}
exec(compile(ast.Module(body=[n for n in TREE.body
                              if isinstance(n, ast.Assign) and any(getattr(t, 'id', '') in ('RESTORE_ASIDE_DAYS', 'RESTORE_ASIDE') for t in n.targets)],
                        type_ignores=[]), 'bot.py', 'exec'), aside)
code = lift('age_restore_copies')
yes('bot.py has age_restore_copies, and keeps the copies 30 days', bool(code) and aside.get('RESTORE_ASIDE_DAYS') == 30)
exec(code, aside)
with tempfile.TemporaryDirectory() as d:
    t = time.time()
    st = lambda days: datetime.datetime.fromtimestamp(t - days * 86400).strftime('%Y%m%d-%H%M%S')
    old_name, old2, young = ('joins.json-before-restore-' + st(31), 'joins.json-before-restore-' + st(40) + '-2',
                             'joins.json-before-restore-' + st(29))
    others = ['joins.json', 'joins.json-before-restore-notastamp', 'open-tickets.json-before-restore-' + st(400)]
    for n in [old_name, old2, young] + others:
        with open(os.path.join(d, n), 'w') as f:
            f.write('{}')
    os.mkdir(os.path.join(d, 'joins.json-before-restore-' + st(50)))
    gone, stuck = aside['age_restore_copies'](d, t)
    left = set(os.listdir(d))
    yes('a copy a restore set aside 31 days ago goes, and a second one that second too', sorted(gone) == sorted([old_name, old2]) and not stuck)
    yes('one set aside 29 days ago stays', young in left)
    yes('the live joins.json and names the rule does not fit are never touched', all(n in left for n in others))
    yes('a folder where a copy should be a file is left', ('joins.json-before-restore-' + st(50)) in left)
    yes('a folder that cannot be listed is said, not raised', aside['age_restore_copies'](os.path.join(d, 'nowhere'), t)[1] != [])
yes('the hourly watch ages them, in a try of its own, and says each one',
    'age_restore_copies(DATA_DIR, time.time())' in watch and 'COULD NOT DELETE' in watch)

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
