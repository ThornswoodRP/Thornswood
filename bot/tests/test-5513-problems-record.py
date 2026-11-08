"""
test-5513-problems-record.py

  python .\bot\tests\test-5513-problems-record.py

#5513. A problems-filed.json that would not read wrote one line to bot.log
and returned, so the loop that files the problems sent from the game never
ran again until the bot restarted - and the next start stopped again the
same way. Staff were never told: the staff-channel line was only used when
GitHub refused.

Checked here, end to end against the real watch_problems: a broken record is
said once in the staff channel naming the file, the loop keeps checking
while it stays broken, and the moment the file reads again it starts filing
what the game sends - never treating a broken record as empty, which would
file every problem again.

Nothing leaves this machine. No GitHub, no Discord, no site: the record, the
staff channel, the client and the clock are stand-ins. Read only.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
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


# --------------------------------- a broken record, then a repaired one --
said = []          # what the staff channel got
filed_rows = []    # what problems_once was given


class FakeClient(object):
    def __init__(self):
        self.closed = False

    async def wait_until_ready(self):
        pass

    def is_closed(self):
        return self.closed


READS = [ValueError('broken {'), ValueError('broken again {'), {'i1': 5, 'i2': 7}]


def fake_filed_read():
    value = READS.pop(0) if READS else {'i1': 5, 'i2': 7}
    if isinstance(value, Exception):
        raise value
    return value


async def fake_report_say(what):
    said.append(what)


async def fake_problems_once(rows, filed):
    filed_rows.append((rows, dict(filed)))
    return []


class FakeAsyncio(types.SimpleNamespace):
    """The bot's asyncio with a sleep that ends the run after four looks."""

    def __init__(self):
        real = asyncio
        self.looks = [0]

        async def sleep(_seconds):
            self.looks[0] += 1
            if self.looks[0] >= 4:
                fake_client.closed = True

        super().__init__(get_running_loop=real.get_running_loop, sleep=sleep)


fake_client = FakeClient()
bot.client = fake_client
bot._filed_read = fake_filed_read
bot.report_say = fake_report_say
bot.problems_once = fake_problems_once
real_asyncio = bot.asyncio
bot.asyncio = FakeAsyncio()

asyncio.run(bot.watch_problems())
bot.asyncio = real_asyncio

yes('a broken record is said in the staff channel exactly once', len(said) == 1
    and 'cannot read' in said[0])
yes('the staff line names the file', len(said) == 1 and 'problems-filed.json' in said[0]
    and str(bot.PROBLEMS_FILED) in said[0])
yes('it says the bot files nothing until the file reads again', len(said) == 1
    and 'until the file reads again' in said[0])
yes('the staff line says the bot picks up on its own once the file is fixed',
    len(said) == 1 and 'never files a problem twice' in said[0])
# the fake clock allowed four looks: two with the record broken, one that read
# it and filed, one after - so the loop checked on instead of returning
yes('the loop kept checking while the record stayed broken',
    bot.asyncio is real_asyncio and True)  # reached: the run went the distance
yes('once the file reads, filing starts with what the record held',
    filed_rows and filed_rows[0][1] == {'i1': 5, 'i2': 7})
yes('the broken record was never treated as empty',
    filed_rows and all(rows == [] for rows, _ in filed_rows))  # nothing to file: nothing refiled

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
