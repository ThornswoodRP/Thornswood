"""
test-2353-ticket-keeping.py

    python tests/test-2353-ticket-keeping.py

Issue #2353: closing a ticket archived and locked its Discord thread and
nothing ever deleted it, so it was the one store with no keeping time.
Decided by Patrick on 19 Oct: the bot deletes a ticket thread
TICKET_KEEP_DAYS (365) after it closes, checked every hour like the join
numbers.

ticket_past_keeping and age_closed_tickets are lifted out of bot/bot_tickets.py by
their source and run on their own against made-up servers, channels and
threads, so this needs neither discord.py nor a token and runs on every pull
request. It proves:
  - a ticket the bot opened and that closed 366 days ago is deleted, with a
    line in the log, and one that closed 364 days ago stays;
  - a ticket off one of the five desk channels (#3317) is aged the same way;
  - a thread still open, one a Gamemaster opened by hand, and one in a
    channel that is not a ticket channel are never touched;
  - a thread whose close time cannot be read is kept, not guessed at;
  - Discord is asked for the private closed threads closed before the cut;
  - a delete Discord refuses is said with its reason, and the rest still go;
  - a channel whose list cannot be read is said with its reason, and the
    next channel is still aged;
  - the bot's own messages in the staff ticket log (#3634), a whole ticket
    put there because its thread would not open and the Closed lines, go
    365 days after they were posted; anybody else's, a channel tickets open
    off and a channel that is not a log are never touched;
and that the bot starts the hourly watch when it is ready, the close message
and the privacy page say the year, and the bot is still allowed to delete
threads. Synthetic ids only. Read only.
"""
import ast
import asyncio
import datetime
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


DAYS = constant('TICKET_KEEP_DAYS')
yes('a closed ticket is kept 365 days', DAYS == 365)
yes('and the tickets are looked at every hour', constant('TICKET_KEEP_EVERY') == 3600)

# Since the ticket split (#3317) a ticket is off one of five channels, a desk
# each, or off the old ones a server not built again still has: TICKET_NAMES,
# made here the way bot.py makes it, from bot.py's own TICKET_DESKS.
DESKS = constant('TICKET_DESKS') or []
yes('bot.py names the five ticket channels', [d for d, _k in DESKS] == [
    'get-help', 'report-someone', 'apply-to-playtest', 'apply-for-a-seat', 'apply-for-staff'])
OLD = ['tickets-and-applications', 'applications']
LOGGED = []
space = {'datetime': datetime, 'TICKET_KEEP_DAYS': DAYS,
         'TICKETS': OLD,
         'TICKET_NAMES': [d for d, _k in DESKS] + [n for n in OLD if n not in dict(DESKS)],
         'log': lambda *a: LOGGED.append(' '.join(str(x) for x in a))}
for name in ('ticket_past_keeping', 'age_closed_tickets'):
    code = lift(name)
    yes('bot.py has ' + name, bool(code))
    exec(code, space)
past = space['ticket_past_keeping']
age = space['age_closed_tickets']

BOT = 5000
UTC = datetime.timezone.utc
NOW = datetime.datetime(2027, 11, 1, 12, 0, tzinfo=UTC)
DAY = datetime.timedelta(days=1)


class Refused(Exception):
    pass


class Thread:
    def __init__(self, tid, closed, owner=BOT, archived=True, refuse=False):
        self.id = tid
        self.archive_timestamp = closed
        self.owner_id = owner
        self.archived = archived
        self.refuse = refuse
        self.deleted = False

    async def delete(self):
        if self.refuse:
            raise Refused('Missing Permissions')
        self.deleted = True


class Channel:
    def __init__(self, name, threads, refuse=False):
        self.name = name
        self.threads = threads
        self.refuse = refuse
        self.asked = []

    async def archived_threads(self, private=False, joined=False, limit=100, before=None):
        self.asked.append({'private': private, 'joined': joined, 'limit': limit, 'before': before})
        if self.refuse:
            raise Refused('Forbidden (status code: 403)')
        # The whole channel, so the function's own check is what is tested,
        # not Discord's before.
        for t in self.threads:
            yield t


class Guild:
    def __init__(self, channels):
        self.name = 'Test server'
        self.text_channels = channels


old = Thread(101, NOW - 366 * DAY)
young = Thread(102, NOW - 364 * DAY)
still_open = Thread(103, NOW - 400 * DAY, archived=False)
by_hand = Thread(104, NOW - 400 * DAY, owner=7)
no_time = Thread(105, None)
naive = Thread(106, (NOW - 400 * DAY).replace(tzinfo=None))
refused = Thread(107, NOW - 500 * DAY, refuse=True)
old2 = Thread(108, NOW - 700 * DAY)
tickets = Channel('Tickets-and-Applications',
                  [old, young, still_open, by_hand, no_time, naive, refused, old2])
other_old = Thread(201, NOW - 400 * DAY)
general = Channel('general-chat', [other_old])
locked_out = Channel('applications', [Thread(301, NOW - 400 * DAY)], refuse=True)
help_old = Thread(401, NOW - 400 * DAY)
desk = Channel('get-help', [help_old])
guild = Guild([locked_out, general, tickets, desk])

deleted, failed = asyncio.run(age(guild, BOT, NOW))

yes('a ticket closed 366 days ago is deleted', old.deleted and old2.deleted)
yes('one closed 364 days ago stays', not young.deleted)
yes('a thread still open is never touched', not still_open.deleted)
yes('a thread a Gamemaster opened by hand is never touched', not by_hand.deleted)
yes('a thread whose close time is missing is kept', not no_time.deleted)
yes('and one whose close time has no time zone is kept', not naive.deleted)
yes('a thread off a channel that is not a ticket channel is never touched',
    not other_old.deleted and not general.asked)
yes('Discord is asked for the private closed threads closed before the cut, all of them',
    tickets.asked == [{'private': True, 'joined': False, 'limit': None,
                       'before': NOW - DAYS * DAY}])
yes('a ticket off a desk channel (#get-help) is aged the same way', help_old.deleted)
yes('the counts say what happened: three deleted, one refused, one list unread',
    (deleted, failed) == (3, 2))
yes('each deletion is a line with its id and the day it closed',
    any('deleted thread 101' in s and (NOW - 366 * DAY).date().isoformat() in s for s in LOGGED))
yes('a refused delete is said with Discord\'s reason, and the rest still went',
    any('could not delete thread 107' in s and 'Missing Permissions' in s for s in LOGGED)
    and old2.deleted)
yes('a list that cannot be read is said with its reason, and the next channel is still aged',
    any('could not list' in s and '#applications' in s and '403' in s for s in LOGGED)
    and old.deleted)
yes('nothing is said for what was kept',
    not any(('thread 102' in s or 'thread 104' in s or 'thread 105' in s) for s in LOGGED))

LOGGED[:] = []
again = asyncio.run(age(Guild([Channel('tickets-and-applications', [young])]), BOT, NOW))
yes('a pass with nothing past its time deletes nothing and says nothing', again == (0, 0) and not LOGGED)
yes('with no bot id nothing is deleted',
    not past(Thread(402, NOW - 400 * DAY), None, NOW - DAYS * DAY))

# ---- the staff ticket log (#3634)
LOG_NAMES = ['ticket-log', 'tickets']
space['TICKET_LOG'] = LOG_NAMES
code = lift('age_ticket_log')
yes('bot.py has age_ticket_log', bool(code))
exec(code, space)
age_log = space['age_ticket_log']


class Author:
    def __init__(self, uid):
        self.id = uid


class Message:
    def __init__(self, mid, posted, author=BOT, refuse=False):
        self.id = mid
        self.created_at = posted
        self.author = Author(author)
        self.refuse = refuse
        self.deleted = False

    async def delete(self):
        if self.refuse:
            raise Refused('Missing Permissions')
        self.deleted = True


class LogChannel:
    def __init__(self, name, messages, refuse=False):
        self.name = name
        self.messages = messages
        self.refuse = refuse
        self.asked = []

    async def history(self, limit=100, before=None):
        self.asked.append({'limit': limit, 'before': before})
        if self.refuse:
            raise Refused('Forbidden (status code: 403)')
        # Every message, so the function's own check is what is tested.
        for m in self.messages:
            yield m


fallback = [Message(501, NOW - 366 * DAY), Message(502, NOW - 366 * DAY)]
closed_line = Message(503, NOW - 400 * DAY)
young_line = Message(504, NOW - 364 * DAY)
staff_said = Message(505, NOW - 400 * DAY, author=7)
no_when = Message(506, None)
naive_when = Message(507, (NOW - 400 * DAY).replace(tzinfo=None))
stuck = Message(508, NOW - 500 * DAY, refuse=True)
book = LogChannel('Ticket-Log', fallback + [closed_line, young_line, staff_said, no_when, naive_when, stuck])
old_book = Message(601, NOW - 800 * DAY)
legacy = LogChannel('tickets', [old_book])
panel = Message(701, NOW - 800 * DAY)
desk_named = LogChannel('get-help', [panel])
chat_old = Message(801, NOW - 800 * DAY)
chat = LogChannel('general-chat', [chat_old])
unread = LogChannel('tickets', [Message(901, NOW - 800 * DAY)], refuse=True)
LOGGED[:] = []
got = asyncio.run(age_log(Guild([unread, chat, desk_named, book, legacy]), BOT, NOW))
yes('a whole ticket the bot put in the log 366 days ago is deleted, every part of it',
    all(m.deleted for m in fallback))
yes('a Closed line 400 days old is deleted', closed_line.deleted)
yes('one 364 days old stays', not young_line.deleted)
yes('a message somebody else wrote there is never touched', not staff_said.deleted)
yes('a message whose time is missing, or has no time zone, is kept',
    not no_when.deleted and not naive_when.deleted)
yes('the old #tickets log is aged too', old_book.deleted)
yes('a channel tickets open off is never touched, even if TICKET_LOG named it',
    not panel.deleted and not desk_named.asked)
yes('nor a channel that is not a log', not chat_old.deleted and not chat.asked)
yes('Discord is asked for every message posted before the cut',
    book.asked == [{'limit': None, 'before': NOW - DAYS * DAY}])
yes('the counts say what happened: four deleted, one refused, one history unread', got == (4, 2))
yes('a refused delete is said with its id and Discord\'s reason',
    any('could not delete message 508' in s and 'Missing Permissions' in s for s in LOGGED))
yes('a history that cannot be read is said with its reason, and the next channel is still aged',
    any('could not read #tickets' in s and '403' in s for s in LOGGED) and old_book.deleted)
yes('what went is said as a count a channel, never what a message said',
    any('deleted 3 of the bot' in s and '#Ticket-Log' in s for s in LOGGED) and
    not any('501' in s or '503' in s for s in LOGGED))
yes('with no bot id nothing is deleted',
    asyncio.run(age_log(Guild([LogChannel('ticket-log', [Message(902, NOW - 800 * DAY)])]), None, NOW)) == (0, 0))

watch = lift('watch_closed_tickets')
yes('the hourly watch ages every server and sleeps TICKET_KEEP_EVERY between passes',
    'age_closed_tickets, age_ticket_log' in watch and 'await age(gd, bot_id, now)' in watch
    and 'asyncio.sleep(TICKET_KEEP_EVERY)' in watch)
yes('the bot starts the watch when it is ready',
    'asyncio.create_task(watch_closed_tickets())' in lift('on_ready'))
yes('a ticket is opened with the week Discord closes an idle one after',
    'auto_archive_duration=10080' in SRC)
close = lift('close_here')
yes('the close message says when it is deleted, and no longer that nothing is',
    'deleted %d days after it was last closed' in close and 'TICKET_KEEP_DAYS' in close
    and 'Nothing is deleted' not in close)

build = (ROOT / 'bot' / 'Build-Discord.py').read_text(encoding='utf-8')
yes('the bot is still given Manage Threads, which deleting a thread needs',
    "('Manage Threads',           34)" in build)

page = (ROOT / 'site' / 'data' / 'site' / 'privacy.md').read_text(encoding='utf-8')
page = ' '.join(page.split())
yes('the privacy page says a closed ticket goes after 365 days',
    'closed, for 365 days, then the bot deletes it' in page)
yes('and when one nobody closed goes', 'A ticket nobody closes is closed by Discord after a week' in page)
yes('and no longer that it stays until staff delete it', 'until staff delete it' not in page)
yes('and that a deletion request leaves a ticket and its log lines until their 365 days are up (#3634, B)',
    'are not deleted by a request: each stays until its 365 days above are up' in page)
yes('the privacy page names the staff ticket log and its 365 days (#3634)',
    'a line in a staff only ticket log naming the ticket' in page and
    'goes into that log whole instead. Each of those goes 365 days after it was written' in page)

print('\n%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
