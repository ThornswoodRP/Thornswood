"""
test-5513-problems-record.py

  python .\bot\tests\test-5513-problems-record.py

#5513. A problems-filed.json that would not read wrote one line to bot.log
and returned, so the loop that files the problems sent from the game never
ran again until the bot restarted, and the next start stopped the same way.
Staff were never told: the staff channel line was used only when GitHub
refused. Rahul Ranjan's change in #5517 is what this checks.

Checked here, against the real watch_problems and problems_once: a record
that will not read is said once in the staff channel, naming the file and
telling staff to mend it rather than delete it; its error goes in bot.log
once, not every round; the record is read again each round while it stays
broken; and once it reads, the problems the game sent are filed, the ones
it already holds are not filed again, and a broken record is never taken
for an empty one.

Nothing leaves this machine. GitHub, the staff channel, the saved record,
the client and the clock are stand-ins. Read only.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import json
import shutil
import tempfile
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
os.environ.pop('GITHUB_TOKEN', None)
os.environ['GITHUB_TOKEN_FILE'] = ''  # nor the box admin service's (#5184)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# The game's inbox: one problem the record already holds (i1, filed as #5)
# and one it does not (i3).
scratch = tempfile.mkdtemp(prefix='thornswood-5513-')
inbox = os.path.join(scratch, 'inbox.json')
with open(inbox, 'w', encoding='utf-8') as f:
    json.dump([
        {'id': 'i3', 'kind': 'problem', 'by': 'Bjorn', 'server': 'main', 'title': 'the new one'},
        {'id': 'i1', 'kind': 'problem', 'by': 'Bjorn', 'server': 'main', 'title': 'the old one'},
    ], f)

# The record reads broken twice, then mended.
READS = [ValueError('Expecting value: line 1 column 1'), ValueError('still broken'), {'i1': 5}]
reads = []


def filed_read():
    reads.append(1)
    value = READS.pop(0) if READS else {'i1': 5}
    if isinstance(value, Exception):
        raise value
    return value


said = []
logged = []
filed_on_board = []
saved = []


async def report_say(text):
    said.append(text)


def log(*parts):
    logged.append(' '.join(str(p) for p in parts))


def github_file(title, body, labels):
    filed_on_board.append(title)
    return 40 + len(filed_on_board)


def filed_write(filed):
    saved.append(dict(filed))


class Client(object):
    def __init__(self):
        self.closed = False

    async def wait_until_ready(self):
        pass

    def is_closed(self):
        return self.closed


client = Client()
LOOKS = 4  # two with the record broken, the one that reads it, one more
sleeps = []


async def sleep(_seconds):
    sleeps.append(1)
    if len(sleeps) >= LOOKS:
        client.closed = True


real_asyncio = bot.asyncio
try:
    bot.client = client
    bot.REPORTS_FILE = inbox
    bot._filed_read = filed_read
    bot._filed_write = filed_write
    bot.github_file = github_file
    bot.report_say = report_say
    bot.log = log
    bot.asyncio = types.SimpleNamespace(get_running_loop=real_asyncio.get_running_loop, sleep=sleep)
    real_asyncio.run(bot.watch_problems())
finally:
    bot.asyncio = real_asyncio
    shutil.rmtree(scratch, ignore_errors=True)

unreadable = [s for s in said if 'cannot read' in s]
yes('a record that will not read is said in the staff channel exactly once, over two broken looks',
    len(unreadable) == 1)
yes('  the line names the file', len(unreadable) == 1 and str(bot.PROBLEMS_FILED) in unreadable[0])
yes('  it says nothing is filed until the file reads', len(unreadable) == 1 and 'filing nothing until the file reads again' in unreadable[0])
yes('  and to mend the file rather than delete it, which would file every problem again',
    len(unreadable) == 1 and 'rather than deleting' in unreadable[0])
traces = [l for l in logged if 'will not read' in l]
yes('bot.log has the error once, not once a round', len(traces) == 1 and 'still broken' not in traces[0])
yes('the record was read again each round until it read (3 reads in 4 looks)', len(reads) == 3)
yes('once it read, the problem it did not hold was filed', filed_on_board and 'the new one' in filed_on_board[0])
yes('  and the one it held was not filed again', len(filed_on_board) == 1)
yes('  and what was saved is the mended record plus the new one, never an empty record',
    bool(saved) and saved[-1] == {'i1': 5, 'i3': 41})
yes('the staff channel then says the new problem with its number',
    any('#41' in s for s in said))

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
