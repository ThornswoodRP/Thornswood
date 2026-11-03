"""
test-join-scripts.py

backfill.py and redraw.py give a member the number joins.json holds, and the
nightly backup takes joins.json.

Found by the join card fix (#318), 24 September: "backfill.py and redraw.py
are one-off scripts Install-Bot does not send. They still number by join
order among the members still here and do not read joins.json, so redraw.py
--all would redraw old cards with numbers that disagree with the record."
And: "vps-nightly-backup.ps1 takes only bot.env.json from the bot folder.
Backup-Server.ps1 takes the whole folder, so joins.json is only in that
backup."

Both scripts are imported for real, with discord.Client.run stood down while
they load so neither can connect even without its main guard, and their real
work() is run against a stand-in server: members with join dates, a welcome
channel holding the bot's cards, and card.render swapped for something that
writes down the number it was asked to draw. The record is put where bot.JOINS
points, in a temporary folder, and nowhere else, so a script only finds it by
going through bot.py; and its numbers are nothing like the join order, so a
card with the right number could only have read it.

The backup half runs the real vps-nightly-backup.ps1 under PowerShell 7
(pwsh), the shell the VPS runs it in (#5356), with every folder it reads or
writes pointed at a temporary one and -Plain, and opens the zip it makes.

Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import datetime
import io
import json
import shutil
import subprocess
import tempfile
import zipfile

# The scripts and bot.py refuse to load without one, and nothing here lets
# any of them use it.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import discord  # noqa: E402

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import card  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# ------------------------------------------------- loading the two scripts --
STARTED = []
keep_run = discord.Client.run
discord.Client.run = lambda self, *a, **k: STARTED.append(1)
try:
    import backfill  # noqa: E402
    by_backfill = len(STARTED)
    import redraw  # noqa: E402
    by_redraw = len(STARTED) - by_backfill
finally:
    discord.Client.run = keep_run
yes('S1 importing backfill.py reads it and does not start a client',
    by_backfill == 0)
yes('S1 importing redraw.py reads it and does not start a client',
    by_redraw == 0)


# ------------------------------------------------------------- the world --
UTC = datetime.timezone.utc
T0 = datetime.datetime(2026, 9, 20, 12, 0, tzinfo=UTC)
BOT_ID = 999
GID = 1001


def at(hours):
    return T0 + datetime.timedelta(hours=hours)


class Avatar(object):
    def replace(self, **_k):
        return self

    async def read(self):
        return b'an avatar'


class Someone(object):
    def __init__(self, uid):
        self.id = uid


class Member(object):
    def __init__(self, uid, name, joined, is_bot=False):
        self.id = uid
        self.name = name
        self.display_name = name
        self.joined_at = joined
        self.bot = is_bot
        self.mention = '<@%d>' % uid
        self.display_avatar = Avatar()

    def __str__(self):
        return self.name


class Message(object):
    def __init__(self, who, created):
        self.author = Someone(BOT_ID)
        self.content = '%s came up the road.' % who.mention
        self.mentions = [who]
        self.created_at = created
        self.jump_url = 'https://discord.com/channels/%d/1/%d' % (GID, who.id)
        self.edits = []

    async def edit(self, attachments=None, **_k):
        self.edits.append(attachments)


class Channel(object):
    def __init__(self, name, messages):
        self.name = name
        self.messages = messages
        self.sent = []

    async def history(self, limit=None):
        for m in sorted(self.messages, key=lambda m: m.created_at, reverse=True):
            yield m

    async def send(self, content=None, file=None, **_k):
        self.sent.append(content)


class Guild(object):
    def __init__(self, members, channels):
        self.id = GID
        self.name = 'Thornswood'
        self.member_count = len(members)
        self.me = Someone(BOT_ID)
        self.text_channels = channels
        self.members = members

    async def fetch_members(self, limit=None):
        for m in self.members:
            yield m


class Client(object):
    def __init__(self, guild):
        self.guilds = [guild]


# In join order, and each one's place in it is nothing like what the record
# holds, except where noted.
ASH = Member(10, 'Ash', at(0))          # 1st; numbered 3, but on another server
DAGG = Member(11, 'Daggerio', at(1))    # 2nd; the record says 28
VENUS = Member(12, 'VENUS', at(2))      # 3rd; the record says 29
ROOK = Member(13, 'Rook', at(3))        # 4th; the record says 5
WREN = Member(14, 'Wren', at(4))        # 5th; the record holds 0, which is none
HELPER = Member(15, 'Helper', at(5), is_bot=True)
GONE = Member(77, 'Gone', at(-5))       # has a card, is no longer here
PEOPLE = [ASH, DAGG, VENUS, ROOK, WREN, HELPER]

RECORD = {
    str(GID): {'last': 40, 'members': {'11': 28, '12': 29, '13': 5, '14': 0}},
    '2002': {'last': 3, 'members': {'10': 3}},
}

DRAWN = []


def fake_render(name, data, number=None, line=None, alt=None):
    DRAWN.append((alt, number))
    return io.BytesIO(b'a card')


async def no_sleep(*_a, **_k):
    return None


def run(mod, guild, go, **flags):
    """Run the script's real work() against this server. Returns what it asked
       card.render to draw, as {name: number}, and every line it said."""
    said = []
    del DRAWN[:]
    keep = dict(client=mod.client, GO=mod.GO, say=mod.say)
    for k in flags:
        keep[k] = getattr(mod, k)
    keep_render = card.render
    keep_sleep = asyncio.sleep
    mod.client = Client(guild)
    mod.GO = go
    mod.say = lambda *a: said.append(' '.join(str(x) for x in a))
    for k, v in flags.items():
        setattr(mod, k, v)
    card.render = fake_render
    # One and a half seconds between cards is for Discord's rate limit, and
    # there is no Discord here.
    asyncio.sleep = no_sleep
    try:
        asyncio.run(mod.work())
    finally:
        asyncio.sleep = keep_sleep
        card.render = keep_render
        for k, v in keep.items():
            setattr(mod, k, v)
    return dict(DRAWN), said


def said_about(said, name):
    return ' | '.join(s for s in said if name in s)


def text_of(path):
    try:
        with open(path, 'rb') as f:
            return f.read()
    except Exception:
        return None


def backfill_world():
    """Ash has a card; everybody who came after it has none."""
    ch = Channel(backfill.WELCOME, [Message(ASH, at(0.5))])
    return Guild(list(PEOPLE), [ch]), ch


def redraw_world():
    """Every person has a card, and so does somebody who has left."""
    msgs = [Message(GONE, at(-4))]
    for i, m in enumerate([ASH, DAGG, VENUS, ROOK, WREN]):
        msgs.append(Message(m, at(i + 0.5)))
    ch = Channel(redraw.WELCOME, msgs)
    return Guild(list(PEOPLE), [ch]), ch


TMP = tempfile.mkdtemp(prefix='ts-join-scripts-')
keep_joins = bot.JOINS
try:
    bot.JOINS = os.path.join(TMP, 'joins.json')
    with open(bot.JOINS, 'w', encoding='utf-8') as f:
        json.dump(RECORD, f)
    before = text_of(bot.JOINS)

    # ------------------------------------------------------------ backfill --
    g, ch = backfill_world()
    drawn, said = run(backfill, g, True)
    yes('B1 Daggerio, 28 in joins.json, gets a card saying 28 and not 2, his '
        'place in the join order (got %r)' % (drawn.get('Daggerio'),),
        drawn.get('Daggerio') == 28)
    yes('B1 VENUS gets the 29 the record holds (got %r)'
        % (drawn.get('VENUS'),), drawn.get('VENUS') == 29)
    yes('B1 Rook gets the 5 the record holds, not 4 (got %r)'
        % (drawn.get('Rook'),), drawn.get('Rook') == 5)
    wren = said_about(said, 'Wren')
    yes('B2 Wren, whom the record has no number for, gets the old rule, 5 '
        '(got %r)' % (drawn.get('Wren'),), drawn.get('Wren') == 5)
    yes('B2 and the lines about her say she is not in joins.json (%s)' % wren,
        'not in joins.json' in wren)
    yes('B2 and say that 5 repeats a number joins.json gave somebody else',
        'repeats a number joins.json gave somebody else' in wren)
    yes('B2 and nobody with a number in the record is said to be without one',
        'not in joins.json' not in said_about(said, 'Daggerio'))
    yes('B3 Ash, who has a card, and the bot are not given one (drew %r)'
        % (sorted(drawn),), sorted(drawn) == ['Daggerio', 'Rook', 'VENUS', 'Wren'])
    yes('B3 and four greetings went out',
        len(ch.sent) == 4 and all('came up the road' in s for s in ch.sent))
    yes('B4 joins.json is byte for byte what it was: backfill never writes it',
        text_of(bot.JOINS) == before and not os.path.exists(bot.JOINS + '.tmp'))

    g, ch = backfill_world()
    drawn, said = run(backfill, g, False)
    yes('B5 the dry run draws nothing and posts nothing',
        drawn == {} and ch.sent == [])
    yes('B5 and the list it prints has Daggerio as #28 (%s)'
        % said_about(said, 'Daggerio'),
        any(s.startswith('owed: #28 Daggerio') for s in said))

    # -------------------------------------------------------------- redraw --
    g, ch = redraw_world()
    drawn, said = run(redraw, g, True, ALL=True)
    yes('R1 Daggerio\'s card is redrawn with 28 and not 2 (got %r)'
        % (drawn.get('Daggerio'),), drawn.get('Daggerio') == 28)
    yes('R1 VENUS\'s with 29 (got %r)' % (drawn.get('VENUS'),),
        drawn.get('VENUS') == 29)
    yes('R1 Rook\'s with 5 (got %r)' % (drawn.get('Rook'),),
        drawn.get('Rook') == 5)
    ash = said_about(said, 'Ash')
    yes('R2 Ash, numbered on another server and not this one, gets the old '
        'rule, 1, and the line says so (got %r: %s)' % (drawn.get('Ash'), ash),
        drawn.get('Ash') == 1 and 'not in joins.json' in ash)
    wren = said_about(said, 'Wren')
    yes('R2 Wren gets 5 by the old rule, and the line says it repeats one the '
        'record gave (got %r: %s)' % (drawn.get('Wren'), wren),
        drawn.get('Wren') == 5
        and 'repeats a number joins.json gave somebody else' in wren)
    edited = [m for m in ch.messages if m.edits]
    yes('R3 five cards are redrawn in place and the one for somebody gone is '
        'left (edited %d)' % len(edited),
        len(edited) == 5 and GONE.id not in [m.mentions[0].id for m in edited])
    yes('R4 joins.json is byte for byte what it was: redraw never writes it',
        text_of(bot.JOINS) == before and not os.path.exists(bot.JOINS + '.tmp'))

    g, ch = redraw_world()
    drawn, said = run(redraw, g, False, ALL=True)
    yes('R5 the dry run changes nothing',
        drawn == {} and not [m for m in ch.messages if m.edits])
    yes('R5 and the list it prints gives Daggerio number 28 (%s)'
        % said_about(said, 'Daggerio'),
        any('Daggerio' in s and 'number 28' in s for s in said))

    # ------------------------------------------------------ no record here --
    bot.JOINS = os.path.join(TMP, 'none-here', 'joins.json')
    g, ch = redraw_world()
    drawn, said = run(redraw, g, True, ALL=True)
    yes('N1 with no record, redraw numbers every card by join order (got %r)'
        % (drawn,), drawn == {'Ash': 1, 'Daggerio': 2, 'VENUS': 3, 'Rook': 4,
                              'Wren': 5})
    yes('N1 and says there is no joins.json',
        any(s.startswith('no ') and 'joins.json' in s for s in said))
    g, ch = backfill_world()
    drawn, said = run(backfill, g, True)
    yes('N2 backfill does the same (got %r)' % (drawn,),
        drawn == {'Daggerio': 2, 'VENUS': 3, 'Rook': 4, 'Wren': 5})
    yes('N3 and neither of them makes one',
        not os.path.exists(bot.JOINS)
        and not os.path.exists(os.path.dirname(bot.JOINS)))

    # ---------------------------------------- a record that cannot be read --
    bot.JOINS = os.path.join(TMP, 'garbled.json')
    garbled = b'{"1001": {"last": 4'
    with open(bot.JOINS, 'wb') as f:
        f.write(garbled)
    g, ch = redraw_world()
    drawn, said = run(redraw, g, True, ALL=True)
    yes('U1 a record that is there and cannot be read stops redraw: nothing '
        'is drawn or changed (drew %r)' % (drawn,),
        drawn == {} and not [m for m in ch.messages if m.edits])
    yes('U1 and it says why', any('could not read' in s for s in said))
    g, ch = backfill_world()
    drawn, said = run(backfill, g, True)
    yes('U2 and stops backfill: nothing is posted (drew %r)' % (drawn,),
        drawn == {} and ch.sent == [])
    yes('U2 and it says why', any('could not read' in s for s in said))
    yes('U3 and the record is left as it was', text_of(bot.JOINS) == garbled)
finally:
    bot.JOINS = keep_joins
    shutil.rmtree(TMP, ignore_errors=True)


# ------------------------------------------------------ the nightly backup --
# On Windows only: the script reads the box's Windows folders and variables.
PS = shutil.which('pwsh') if os.name == 'nt' else None
NIGHTLY = os.path.join(os.path.dirname(HERE), 'scripts', 'vps', 'vps-nightly-backup.ps1')
if os.name != 'nt':
    print('SKIP  the nightly backup half: it runs in PowerShell 7 on Windows, as on the box, and this is not Windows')
elif not PS:
    yes('K0 PowerShell 7 (pwsh), which the box runs the nightly backup in, is on this Windows', False)
else:
    box = tempfile.mkdtemp(prefix='ts-nightly-')
    try:
        botroot = os.path.join(box, 'bot')
        out = os.path.join(box, 'out')
        # In the bot's data folder, where the bot keeps it since #1104.
        os.makedirs(os.path.join(botroot, 'data'))
        record = json.dumps(RECORD).encode('utf-8')
        with open(os.path.join(botroot, 'data', 'joins.json'), 'wb') as f:
            f.write(record)
        with open(os.path.join(botroot, 'bot.env.json'), 'w',
                  encoding='utf-8') as f:
            f.write('{ "DISCORD_TOKEN": "not-a-real-token" }')
        # Every folder it reads or writes is in the scratch box. The ones with
        # nothing in them are a "missing" line each, which is what the script
        # does with anything that is not there.
        args = [PS, '-NoProfile', '-NonInteractive', '-ExecutionPolicy',
                'Bypass', '-File', NIGHTLY,
                '-GameRoot', os.path.join(box, 'game'),
                # The dev server's root too, or the script reads the real
                # C:\Thornswood-Server-Dev on the runner (#2043).
                '-DevGameRoot', os.path.join(box, 'game-dev'),
                '-SiteRoot', os.path.join(box, 'site'),
                '-BotRoot', botroot,
                '-CaddyRoot', os.path.join(box, 'caddy'),
                '-VoiceRoot', os.path.join(box, 'voice'),
                # And the deletion record's, or it reads the real
                # C:\Thornswood-Deletions, which Delete-Person.ps1 locks to
                # the backup task, and fails on NO ACCESS (20 Oct nightly).
                '-DeletionRoot', os.path.join(box, 'deletions'),
                '-Out', out,
                '-KeyFile', os.path.join(box, 'no-key.txt'),
                '-Plain']
        # Windows PowerShell as the scheduled task starts it, with its own
        # module path. Run from the nightly's pwsh step, this process inherits
        # PSModulePath with PowerShell 7's module folders first, and 5.1 then
        # autoloads 7's Microsoft.PowerShell.Security for Set-Acl, cannot load
        # it, and stops (5 October nightly, K1). With no PSModulePath, 5.1
        # builds its own. Windows names are not case sensitive, and Python
        # keeps them in capitals there, so the name is matched the same way.
        env = {k: v for k, v in os.environ.items() if k.upper() != 'PSMODULEPATH'}
        r = subprocess.run(args, stdout=subprocess.PIPE,
                           stderr=subprocess.STDOUT, timeout=300, env=env)
        zips = []
        if os.path.isdir(out):
            zips = [n for n in os.listdir(out)
                    if n.startswith('thornswood-') and n.endswith('.zip')]
        yes('K1 vps-nightly-backup.ps1 runs and makes one zip (exit %d, %d '
            'zips)' % (r.returncode, len(zips)),
            r.returncode == 0 and len(zips) == 1)
        if r.returncode != 0 or len(zips) != 1:
            print(r.stdout.decode('utf-8', 'replace')[-2000:])
        names = {}
        if zips:
            with zipfile.ZipFile(os.path.join(out, zips[0])) as z:
                for n in z.namelist():
                    names[n.replace('\\', '/')] = z.read(n)
        yes('K2 the nightly backup takes the bot\'s joins.json (bot entries: %r)'
            % sorted(n for n in names if n.startswith('bot/')),
            'bot/joins.json' in names)
        yes('K2 and what it took is the record, byte for byte',
            names.get('bot/joins.json') == record)
        yes('K3 and still takes bot.env.json beside it',
            'bot/bot.env.json' in names)
    finally:
        shutil.rmtree(box, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
