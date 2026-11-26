"""
test-4339-open-tickets-file.py

One bad write to the open ticket list wiped it (#4339). open-tickets.json is
what holds a person to one open ticket at a time across restarts. The bot
read a file that was there but would not parse as an empty list and wrote a
fresh one over it, so every open ticket was forgotten and nothing was
logged; and every write opened the live file for writing, which empties it
first, so a write cut off half way left half a file behind.

This runs the real remember_ticket and forget_ticket on a scratch file:

  A. a file that is there and will not parse is left exactly as it is, by
     both, and the log names the file;
  B. a write that fails half way leaves the live file whole, because the
     write goes to a file beside it that is swapped in;
  C. with a good file both still do their job, and a missing file is an
     empty list, so the first ticket ever is written down.

The real bot module is imported. Only what touches Discord is replaced.
Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import json
import shutil
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
tickets_module = sys.modules['bot_tickets']
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


LOGGED = []
bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))
d = tempfile.mkdtemp(prefix='thornswood-4339-')
bot.OPEN_TICKETS = os.path.join(d, 'open-tickets.json')


class Thread(object):
    def __init__(self, tid):
        self.id = tid
        self.archived = False


class Guild(object):
    """Every thread the file names is still open, so nothing is dropped as
       closed on the way and the file's own rows are what is checked."""
    id = 900

    def get_thread(self, tid):
        return Thread(tid)


class Person(object):
    def __init__(self, uid):
        self.id = uid

    def __str__(self):
        return 'person %d' % self.id


G = Guild()
ME = Person(111)
YOU = Person(222)


def put(text):
    with open(bot.OPEN_TICKETS, 'w', encoding='utf-8') as f:
        f.write(text)


def text():
    with open(bot.OPEN_TICKETS, encoding='utf-8') as f:
        return f.read()


# ------------------------------------------- A. a file that will not read --
CUT = '{"900:222": 456, "900:3'
put(CUT)
del LOGGED[:]
bot.remember_ticket(G, ME, Thread(123))
yes('A1 remember_ticket leaves a cut-off file exactly as it is, not written over as a fresh list',
    text() == CUT)
yes('A2 and says so in the log, naming the file',
    any('open-tickets.json' in line for line in LOGGED))

put(CUT)
del LOGGED[:]
bot.forget_ticket(G, YOU, Thread(456))
yes('A3 forget_ticket leaves it exactly as it is too', text() == CUT)
yes('A4 and says so in the log, naming the file',
    any('open-tickets.json' in line for line in LOGGED))

put('[1, 2, 3]')
bot.remember_ticket(G, ME, Thread(123))
yes('A5 a file that parses but is not a list of tickets is left as it is as well',
    text() == '[1, 2, 3]')


# --------------------------------------- B. a write cut off half way --
class HalfJson(object):
    """json as the ticket module uses it, except that dump writes the first
       few characters and then fails, as a full disk or a killed process
       would leave it."""
    loads = staticmethod(json.loads)
    load = staticmethod(json.load)
    dumps = staticmethod(json.dumps)

    @staticmethod
    def dump(obj, f, **k):
        f.write(json.dumps(obj)[:5])
        raise OSError('no space left on the device')


WHOLE = json.dumps({'900:222': 456})
put(WHOLE)
real_json = tickets_module.json
tickets_module.json = HalfJson
try:
    bot.remember_ticket(G, ME, Thread(123))
finally:
    tickets_module.json = real_json
yes('B1 a write that fails half way leaves the live file whole', text() == WHOLE)

put(json.dumps({'900:111': 123, '900:222': 456}))
WHOLE = text()
tickets_module.json = HalfJson
try:
    bot.forget_ticket(G, ME, Thread(123))
finally:
    tickets_module.json = real_json
yes('B2 and so does a forget that fails half way', text() == WHOLE)


# ------------------------------------------------- C. the job still done --
os.remove(bot.OPEN_TICKETS)
bot.remember_ticket(G, ME, Thread(123))
yes('C1 with no file yet, the first ticket is written down',
    json.loads(text()) == {'900:111': 123})
bot.remember_ticket(G, YOU, Thread(456))
yes('C2 and the next is added beside it', json.loads(text()) == {'900:111': 123, '900:222': 456})
bot.forget_ticket(G, ME, Thread(123))
yes('C3 forget_ticket takes out that one and keeps the other', json.loads(text()) == {'900:222': 456})
yes('C4 and no temporary file is left beside it',
    [n for n in os.listdir(d) if n != 'open-tickets.json'] == [])

shutil.rmtree(d, ignore_errors=True)
print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
