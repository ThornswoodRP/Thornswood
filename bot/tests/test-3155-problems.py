"""
test-3155-problems.py

Report a problem (#3155): the bot's half. Patrick, 21 Oct: testers get a
Discord button and an in-game button that file an issue on the board with
their log and where they are.

The game's problems come in through the site's inbox.json, kind 'problem';
problems_once files each one on the board once, oldest first, and says it in
the staff channel with its number. The Discord panel in #test-findings opens
a form and files the issue itself. Checked here: the issue each makes (its
title, the words exactly as typed and unable to ping or format anything, the
session link, the labels that keep it off the public #known-issues), filing
once and never twice across a stop, what a GitHub refusal does, who may use
the panel and how often, and that the panel is wired in.

The real bot module is imported. GitHub, the staff channel and the saved
record are stand-ins. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


SRC = open(os.path.join(HERE, 'bot.py'), encoding='utf-8').read()
PLAYER = 'pla' + 'yer'
EM = chr(0x2014)


def clean(s):
    return PLAYER not in s.lower() and EM not in s


# ------------------------------------------------------------ the issue --
row = {'id': 'i1', 'kind': 'problem', 'by': 'Bjorn', 'profileId': 4242,
       'discordId': '123456789012345678', 'server': 'main',
       'session': 's-abc_123', 'cell': 'Whiterun, The Bannered Mare',
       'pos': [1.5, -20, 300.2], 'at': 1793014800000,
       'title': 'The door to the <b>inn</b> & cellar @everyone will not open after a /stuck ``` x'}
title, body = bot.problem_issue(row)
yes('the title is what they said', title.startswith('The door to the <b>inn</b>'))
yes('what they said is in the body exactly once, inside a <pre> where GitHub links no mention',
    '<pre>The door to the &lt;b&gt;inn&lt;/b&gt; &amp; cellar @everyone will not open after a /stuck ``` x</pre>' in body)
yes('nothing they typed can close the block or become markup', body.count('<pre>') == 1 and body.count('</pre>') == 1 and '<b>' not in body)
yes('it says who: the character, the profile and the Discord account',
    '**Who:** Bjorn, profile 4242, Discord account 123456789012345678' in body)
yes('where the game server had the character', '**Where:** Whiterun, The Bannered Mare, at 1.5, -20, 300.2' in body)
yes('when, on the twelve hour clock in UTC', '**When:** 26 Oct 2026, 11:40 AM UTC' in body)
yes('the logs are a link to that game\'s session on the hub, never a copy',
    '(https://thornswood.net/sessions?find=s-abc_123)' in body and 'More details' in body)
yes('and which server', 'in game on the main server' in body)
yes('no issue number in the body, so a report does not link itself on another issue',
    '#3155' not in body and '#' not in body.replace('**', ''))
dev = dict(row, server='dev', session='')
_t, dbody = bot.problem_issue(dev)
yes('a dev report says dev, and with no open session says where to look instead',
    'on the dev server' in dbody and 'none tied to it' in dbody and 'sessions?find=' not in dbody)
yes('the issue gets Tester report and area: triage, never Main or Dev Findings, which go public',
    bot.PROBLEM_LABELS == ['Tester report', 'area: triage'])
yes('the words of both bodies carry no em dash and never the word nobody uses',
    clean(body) and clean(dbody) and clean(bot.PROBLEM_PANEL))

long_said = 'word ' * 60
lt = bot._issue_title(long_said)
yes('a long report is cut at a word for the title, with an ellipsis', len(lt) <= 93 and lt.endswith('...') and 'wor...' not in lt)
yes('an empty one still has a title', bot._issue_title('  ') == 'A problem with nothing said')
yes('noon and midnight read 12', bot._when_text(1793016000000).endswith('12:00 PM UTC') and
    bot._when_text(1792972800000).endswith('12:00 AM UTC'))

dt, db = bot.problem_issue_discord('Lydia', 99, 'Crash at the gate', '', 'dev', 1793012400000)
yes('from Discord: the title, what went wrong, who and their sessions on the hub',
    dt == 'Crash at the gate' and '<pre>Crash at the gate</pre>' in db and
    '**Who:** Lydia, Discord account 99' in db and 'sessions?find=99' in db and
    '**Server:** dev' in db and 'nothing said' in db)


# ------------------------------------------------------------ filing --
def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


calls, said, saves = [], [], []


def fake_file(t, b, labels):
    calls.append((t, labels))
    return 900 + len(calls)


async def fake_say(text):
    said.append(text)


def fake_save(filed):
    saves.append(dict(filed))


rows = [  # newest first, as the site writes it
    dict(row, id='i3', title='third'),
    {'id': 't1', 'kind': 'ticket', 'title': 'a ticket'},
    dict(row, id='i2', title='second', server='dev'),
    {'id': 'h1', 'kind': 'help', 'title': 'help me'},
    dict(row, id='i1', title='first'),
]
filed = {}
failed = run(bot.problems_once(rows, filed, fake_file, fake_say, fake_save))
yes('every problem is filed, oldest first, and nothing else is',
    [c[0] for c in calls] == ['first', 'second', 'third'] and not failed)
yes('each one is written down with its issue number', filed == {'i1': 901, 'i2': 902, 'i3': 903})
yes('and saved after each, so a stop half way never files one twice', len(saves) == 3 and saves[0] == {'i1': 901})
yes('each is said in the staff channel with its number',
    len(said) == 3 and '**Bjorn reported a problem in game**, on the board as #901.' in said[0] and
    'on the dev server' in said[1])
again = run(bot.problems_once(rows, filed, fake_file, fake_say, fake_save))
yes('the next look files nothing again', len(calls) == 3 and not again)

calls[:] = []


def refuses(t, b, labels):
    calls.append(t)
    raise RuntimeError('HTTP Error 403: Forbidden')


fresh = {}
why = run(bot.problems_once(rows, fresh, refuses, fake_say, fake_save))
yes('a GitHub refusal stops the look at the first, files nothing and says why',
    calls == ['first'] and fresh == {} and why and '403' in why[0])
yes('watch_problems says a refusal once, not every look', "if why and why != said_why:" in SRC)
yes('a record that will not read files nothing, rather than everything again',
    "Not read is not empty: empty would file every problem again." in SRC)


# ------------------------------------------------------------ the panel --
class Role(object):
    def __init__(self, name, rid=1):
        self.name = name
        self.id = rid


class Member(object):
    def __init__(self, mid, roles):
        self.id = mid
        self.roles = [Role(r) for r in roles]


yes('somebody who is neither a tester nor staff is turned away',
    'playtesters and staff' in bot.problem_refusal(Member(1, ['Member']), 1000.0))
tester = Member(2, ['Playtester'])
yes('a Playtester may', bot.problem_refusal(tester, 1000.0) == '')
yes('staff may', bot.problem_refusal(Member(3, ['Dev']), 1000.0) == '')
bot._problems_by[2] = [1000.0 + i for i in range(5)]
no = bot.problem_refusal(tester, 1100.0)
yes('a sixth in an hour is refused, with how long to wait', 'last hour' in no and 'minutes' in no)
yes('and an hour later they may again', bot.problem_refusal(tester, 1000.0 + 3700) == '')
yes('the form asks what went wrong (required), what they were doing and where, and which server',
    "label='What went wrong'" in SRC and 'required=True, max_length=1000' in SRC and
    "label='What you were doing, and where'" in SRC and "label='Which server, main or dev'" in SRC)
yes('it is counted before the first await, so two forms at once cannot both pass',
    SRC.index('_problems_by.setdefault(interaction.user.id, []).append(now)') <
    SRC.index('await interaction.response.defer(ephemeral=True, thinking=True)\n        who = interaction.user\n        title, body = problem_issue_discord'))
yes('the button outlives a restart and the panel is put up at start',
    'self.add_view(ProblemPanel())' in SRC and 'await ensure_problem_panel(g)' in SRC and
    'asyncio.create_task(watch_problems())' in SRC)
yes('in #test-findings by default, a forum, as a pinned post of its own',
    bot.PROBLEM_CHANNEL == 'test-findings' and "await th.edit(pinned=True)" in SRC and
    "create_thread(name='Report a problem'" in SRC)
yes('the report watcher leaves problems to the filer, so none is said twice',
    "row.get('kind') not in ('ticket', 'problem')" in SRC)

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
