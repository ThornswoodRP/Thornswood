"""test-4262-unused-names.py

    python bot/tests/test-4262-unused-names.py

#4262: names in the bot's code that nothing in the bot reads. A name only a
test reads is still unused: the test holds up a copy the bot never runs.
_hold_ids_wanted (bot_holds.py) built the same hold button ids that
_hold_rows_wanted builds by row, which is what the hold panel's check uses,
and only test-ping-buttons.py read it.

For each name the issue named, this checks that it is either gone from bot/,
or read somewhere in bot/ outside its own definition and outside bot/tests/.
It also checks the bot's code still says each hold button id once.

Read only. No discord.py needed.
"""
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
BOT = os.path.dirname(HERE)

passed = failed = 0


def yes(what, ok):
    global passed, failed
    if ok:
        passed += 1
        print('PASS  ' + what)
    else:
        failed += 1
        print('FAIL  ' + what)


def code_files():
    for f in sorted(os.listdir(BOT)):
        if f.endswith('.py'):
            with open(os.path.join(BOT, f), encoding='utf-8') as fh:
                yield f, fh.read()


CODE = dict(code_files())

for name in ('_guild_roles', '_hold_ids_wanted', 'CHANNEL_NAMES'):
    word = re.compile(r'\b' + re.escape(name) + r'\b')
    defined = [f for f, t in CODE.items()
               if re.search(r'^(?:def ' + re.escape(name) + r'\b|' + re.escape(name) + r'\s*=)', t, re.M)]
    readers = []
    for f, t in CODE.items():
        for line in t.splitlines():
            s = line.strip()
            if not word.search(s) or s.startswith('#'):
                continue
            if re.match(r'(?:def ' + re.escape(name) + r'\b|' + re.escape(name) + r'\s*=)', s):
                continue
            readers.append(f)
    yes('%s is gone from the bot, or the bot reads it (defined in %s; read in %s)'
        % (name, ', '.join(defined) or 'nothing', ', '.join(sorted(set(readers))) or 'nothing'),
        not defined or bool(readers))

holds = CODE.get('bot_holds.py', '')
yes("bot_holds.py builds the hold button ids in one place",
    len(re.findall(r"'thornswood:hold:' \+ h\.lower\(\) for h in HOLDS", holds)) == 1)

print()
print('%d passed, %d failed' % (passed, failed))
raise SystemExit(1 if failed else 0)
