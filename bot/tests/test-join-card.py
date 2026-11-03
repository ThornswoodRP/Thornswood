"""
test-join-card.py

The join card counts arrivals properly, and it is drawn on the Thornswood
banner.

Patrick, 24 September, with a screenshot of #welcome-travelers and a tester's
note "make it a Thornswood banner": "#28 twice plus the banner backgound needs
changed to the thornswood". Daggerio came up the road at 19:41 and VENUS at
22:45, and both cards said "The 28th to walk in", because the number was the
server's member count at that moment and somebody had left in between.

The real bot module is imported and the real on_member_join is run, with a
stand-in server whose member count is set by hand, a stand-in welcome channel
that keeps what is sent to it, and card.render swapped for something that
writes down the number it was asked to draw. The record is pointed at a
temporary folder so this cannot touch one beside the code.

The background half runs the real card.render and the real make-join-card.py.

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import io
import json
import re
import shutil
import subprocess
import tempfile

ROOT = os.path.dirname(HERE)
# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
import card  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


# ------------------------------------------------------------- the world --
class Avatar(object):
    def replace(self, **_k):
        return self

    async def read(self):
        return b'an avatar'


class Channel(object):
    def __init__(self, name):
        self.name = name
        self.sent = []

    async def send(self, content=None, **_k):
        self.sent.append(content)


class Guild(object):
    def __init__(self, gid, count):
        self.id = gid
        self.name = 'Thornswood'
        self.member_count = count
        self.text_channels = [Channel(bot.WELCOME)]
        self.voice_channels = []


class Member(object):
    def __init__(self, uid, name, guild):
        self.id = uid
        self.name = name
        self.display_name = name
        self.mention = '<@%d>' % uid
        self.guild = guild
        self.display_avatar = Avatar()

    def __str__(self):
        return self.name


DRAWN = []
SAID = []


def fake_render(name, data, number=None, line=None, alt=None):
    DRAWN.append(number)
    return io.BytesIO(b'a card')


def join(member):
    """Run the real on_member_join and return the number the card was asked
       to draw, and whether the greeting went out."""
    before = len(DRAWN)
    ch = member.guild.text_channels[0]
    sent = len(ch.sent)
    keep_render = card.render
    card.render = fake_render
    try:
        asyncio.run(bot.on_member_join(member))
    finally:
        card.render = keep_render
    number = DRAWN[before] if len(DRAWN) > before else 'no card'
    greeted = (len(ch.sent) == sent + 1
               and 'came up the road' in (ch.sent[-1] or '')
               and member.mention in (ch.sent[-1] or ''))
    return number, greeted


def on_disk():
    try:
        with open(bot.JOINS, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def text_of(path):
    try:
        with open(path, encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ''


FLOOR_AT_IMPORT = getattr(bot, 'JOIN_FLOOR', None)
TMP = tempfile.mkdtemp(prefix='ts-joins-')
keep = dict(joins=getattr(bot, 'JOINS', None), floor=FLOOR_AT_IMPORT,
            log=bot.log, json=bot.json)
bot.log = lambda *a: SAID.append(' '.join(str(x) for x in a))

try:
    # ----------------------------------------------------- the screenshot --
    # The rule by itself first, with no floor under it.
    bot.JOINS = os.path.join(TMP, 'joins.json')
    bot.JOIN_FLOOR = 0
    g = Guild(1001, 27)
    dagg = Member(11, 'Daggerio (Deceased)', g)
    venus = Member(12, 'VENUS', g)

    g.member_count = 28
    n1, ok1 = join(dagg)
    g.member_count = 27                # somebody leaves
    g.member_count = 28
    n2, ok2 = join(venus)
    yes('J1 Daggerio, arriving as the 28th member, is the 28th to walk in',
        n1 == 28)
    yes('J1 VENUS, arriving after one departure, is the 29th and not the '
        '28th again (got %r)' % (n2,), n2 == 29)
    yes('J1 both were greeted', ok1 and ok2)

    # ------------------------------------------------- leave and come back --
    g.member_count = 27                # Daggerio leaves
    g.member_count = 28                # and comes back
    n3, ok3 = join(dagg)
    yes('J2 Daggerio leaves and comes back and is still the 28th (got %r)'
        % (n3,), n3 == 28)
    yes('J2 and is greeted again', ok3)
    g.member_count = 29
    n4, _ = join(Member(13, 'Ash', g))
    yes('J2 the next newcomer is the 30th: a return does not use a number up '
        '(got %r)' % (n4,), n4 == 30)

    # ------------------------------------------------ a revolving door --
    got = []
    for i in range(8):
        g.member_count = 30            # one in, one out, the count never moves
        got.append(join(Member(100 + i, 'Traveller %d' % i, g))[0])
    yes('J3 eight arrivals with a departure between each get eight different '
        'numbers, each one up (got %r)' % (got,),
        got == list(range(31, 39)))

    # --------------------------------------- joins nobody saw, bot was down --
    g.member_count = 60
    n5, _ = join(Member(200, 'Late', g))
    yes('J4 a member count above the record wins, so nobody who joined while '
        'the bot was down is given a number again (got %r)' % (n5,), n5 == 60)
    g.member_count = 58
    n6, _ = join(Member(201, 'Later', g))
    yes('J4 and the next one is 61 even with the count fallen to 58 (got %r)'
        % (n6,), n6 == 61)

    # --------------------------------------------------- what is on disk --
    rec = on_disk() or {}
    mine = rec.get('1001') or {}
    yes('J5 the record is on disk, keyed by server, with the last number',
        mine.get('last') == 61)
    yes('J5 and each member id against their number',
        (mine.get('members') or {}).get('11') == 28
        and (mine.get('members') or {}).get('12') == 29)
    yes('J5 and no half written .tmp left beside it',
        not os.path.exists(bot.JOINS + '.tmp'))

    # ---------------------------------------------------- two servers --
    other = Guild(2002, 5)
    n7, _ = join(Member(11, 'Daggerio (Deceased)', other))
    yes('J6 another server counts for itself (got %r)' % (n7,), n7 == 5)
    yes('J6 and leaves the first server\'s count alone',
        ((on_disk() or {}).get('1001') or {}).get('last') == 61)

    # ------------------------------------------------------ the floor --
    if not os.environ.get('JOIN_NUMBER_FLOOR'):
        yes('J7 the floor is 28, the highest number already on a card, when '
            'bot.env.json does not set one (got %r)' % (FLOOR_AT_IMPORT,),
            FLOOR_AT_IMPORT == 28)
    bot.JOINS = os.path.join(TMP, 'fresh.json')
    bot.JOIN_FLOOR = 28
    g2 = Guild(3003, 26)
    n8, _ = join(Member(300, 'First after the fix', g2))
    yes('J7 the first join with no record and 26 members is the 29th, past '
        'the 28 already on two cards (got %r)' % (n8,), n8 == 29)
    bot.JOIN_FLOOR = 0

    # ------------------------------------------ a record that cannot be read --
    bot.JOINS = os.path.join(TMP, 'garbled.json')
    with open(bot.JOINS, 'w', encoding='utf-8') as f:
        f.write('{"1001": {"last": 4')
    del SAID[:]
    g3 = Guild(1001, 33)
    n9, ok9 = join(Member(400, 'Unlucky', g3))
    yes('J8 a record that cannot be read still greets, with the member count '
        '(got %r)' % (n9,), n9 == 33 and ok9)
    left = text_of(bot.JOINS)
    yes('J8 and the unreadable record is left as it was, not written over '
        'with a new one that starts again', left == '{"1001": {"last": 4')
    yes('J8 and the log says so', any('could not read or write' in s
                                      for s in SAID))

    # --------------------------------------- a record that cannot be written --
    bot.JOINS = os.path.join(TMP, 'no-such-folder', 'joins.json')
    del SAID[:]
    g4 = Guild(1001, 34)
    n10, ok10 = join(Member(401, 'Also unlucky', g4))
    yes('J9 a record that cannot be written still greets, with the member '
        'count (got %r)' % (n10,), n10 == 34 and ok10)
    yes('J9 and the log says so', any('could not read or write' in s
                                      for s in SAID))

    # ---------------------------------------------- a write that dies half way --
    bot.JOINS = os.path.join(TMP, 'whole.json')
    g5 = Guild(1001, 40)
    join(Member(500, 'Before', g5))
    whole = text_of(bot.JOINS)

    class HalfJson(object):
        def __getattr__(self, name):
            return getattr(json, name)

        def dump(self, _d, f):
            f.write('{"1001": {"la')
            raise OSError('the disk filled up')

    bot.json = HalfJson()
    try:
        g5.member_count = 41
        n11, ok11 = join(Member(501, 'During', g5))
    finally:
        bot.json = keep['json']
    after = text_of(bot.JOINS)
    yes('J10 a write that dies half way greets with the member count (got %r)'
        % (n11,), n11 == 41 and ok11)
    yes('J10 and the record is the whole old one, not half of a new one',
        bool(whole) and after == whole
        and ((on_disk() or {}).get('1001') or {}).get('last') == 40)
finally:
    bot.JOINS = keep['joins']
    bot.JOIN_FLOOR = keep['floor']
    bot.log = keep['log']
    bot.json = keep['json']
    shutil.rmtree(TMP, ignore_errors=True)


# ------------------------------------------------ what Install-Bot touches --
with open(os.path.join(os.path.dirname(HERE), 'scripts', 'deploy', 'Install-Bot.ps1'), encoding='utf-8') as f:
    install = f.read()
lines = install.splitlines()

# The code is Bot-Code.ps1's list (#5357): four files by name, then the
# modules bot.py imports, which can only be names of the shape bot_<x>.py.
with open(os.path.join(os.path.dirname(HERE), 'scripts', 'deploy', 'Bot-Code.ps1'), encoding='utf-8') as f:
    code_ps = f.read()
named = re.search(r"return @\(([^)]*)\) \+ @\(Get-ThornswoodBotParts \$Repo\)", code_ps)
shape = "-cmatch '^import (bot_[a-z0-9_]+)\\s*(#.*)?$'" in code_ps
sends = re.search(r"foreach \(\$f in @\(Get-ThornswoodBotCode \$Repo\) \+ @\(([^)]*)\)\)", install)
listed = ((re.findall(r"'([^']+)'", named.group(1)) if named else [])
          + [n + '.py' for n in harness_bot.parts()]
          + (re.findall(r"'([^']+)'", sends.group(1)) if sends else [])) if named and sends else None
yes('I1 the code Install-Bot sends is a fixed list, and the record is not '
    'on it (got %r)' % (listed,),
    shape and listed == ['bot.py', '_pyguard.py', 'trust.py', 'card.py']
    + [n + '.py' for n in harness_bot.parts()]
    + ['staff-channel.txt', 'dev-channel.txt', 'requirements.txt', 'factions.json']
    and len(harness_bot.parts()) > 0
    and 'joins.json' not in (listed or []))

dests = []
for ln in lines:
    if re.search(r'&\s*scp\b', ln):
        m = re.search(r':(\$[^"\s]+)"', ln)
        dests.append(m.group(1) if m else ln.strip())
# service/BotService.cs is the source of the Windows service the bot runs
# under (issue #465), which replaced roll-log.ps1 here. It is a program, not
# the record, and I4 below still refuses any write that names joins.json.
allowed = ['$Root/$f', '$Root/assets/join-card.png',
           '$Root/service/BotService.cs', '$far']
# Since #1093 the code goes up into a stage folder first ($Root/$stageName/$rel,
# stage, check, swap), each file under its key in $send. So that destination is
# a name Install-Bot chose only while every key it puts in $send is one of the
# names above.
send_keys = re.findall(r"\$send\[(?:'([^']+)'|\$f)\]\s*=", install)
send_names = [k or '$f' for k in send_keys]
staged_ok = bool(send_names) and all(
    k == '$f' or ('$Root/' + k) in allowed for k in send_names)
if staged_ok:
    allowed.append('$Root/$stageName/$rel')
yes('I2 every file Install-Bot copies up lands on a name it chose, none of '
    'them joins.json (got %r, staged under %r)' % (dests, send_names),
    bool(dests) and all(d in allowed for d in dests))

gone = []
for i, ln in enumerate(lines):
    if re.search(r'Remove-Item', ln, re.I):
        m = re.search(r"Remove-Item\s+(?:-LiteralPath\s+)?(\S+)", ln, re.I)
        g = m.group(1).strip("'`") if m else ln.strip()
        # The clearing of a stage an earlier run left behind: folders named
        # .stage-* and nothing else, filtered on the line above.
        if g.lstrip('`') == '$_.FullName' and ".Name -like '.stage-*'" in lines[i - 1]:
            g = 'an old .stage-* folder'
        gone.append(g)
yes('I3 the only files Install-Bot deletes are its own temporary ones '
    '(got %r)' % (gone,),
    bool(gone) and all(g.lstrip('`') in ('$far', '$tmp', '$exe', 'an old .stage-* folder') for g in gone))

writes = [ln for ln in lines
          if re.search(r'scp|Remove-Item|WriteAllText|Set-Content|Out-File|'
                       r'Copy-Item|Move-Item|Rename-Item', ln, re.I)
          and 'joins' in ln.lower()]
yes('I4 nothing in Install-Bot that writes, moves or deletes names the '
    'record', writes == [])

with open(os.path.join(ROOT, '.gitignore'), encoding='utf-8') as f:
    ignored = [ln.strip() for ln in f]
yes('I5 the record and its .tmp are kept out of git',
    'bot/joins.json' in ignored
    and 'bot/joins.json.tmp' in ignored)


# ------------------------------------------------------- the background --
BG = os.path.join(HERE, 'assets', 'join-card.png')
yes('B1 card.render still draws on assets/join-card.png',
    os.path.normcase(os.path.abspath(card.BACKGROUND)) == os.path.normcase(BG))

bg = Image.open(BG).convert('RGB')
yes('B2 the background is the size the card always was, 1000 by 360 (got %r)'
    % (bg.size,), bg.size == (1000, 360))


def mean(im, box):
    # get_flattened_data, not getdata: Pillow 12.1 deprecated getdata and
    # Pillow 14 removes it (#1401). The pin is 13.0.0, which has both.
    px = list(im.crop(box).get_flattened_data())
    return [sum(p[i] for p in px) / float(len(px)) for i in range(3)]


# The starfield was near black everywhere; this corner of the banner is the
# setting sun. Measured on 24 Sep: red 196.6 on the banner, 17.8 on the
# starfield.
sun = mean(bg, (150, 0, 260, 40))
yes('B3 it is the banner and not the starfield: the sunset is in the top '
    'left corner (red %.1f)' % sun[0], sun[0] > 120)

# Close rather than identical, because the build check runs a newer Pillow
# than the machine that made the committed file, and a JPEG decoder or a
# resize can move a pixel by one. Measured 0.000 on the same Pillow; the
# starfield against the banner is 26.9.
maker = os.path.normpath(os.path.join(HERE, '..', 'scripts', 'oneoff', 'make-join-card.py'))
built_path = os.path.join(tempfile.mkdtemp(prefix='ts-card-'), 'built.png')
try:
    r = subprocess.run([sys.executable, maker, '--out', built_path],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       timeout=120)
    ok = r.returncode == 0 and os.path.exists(built_path)
    diff = None
    if ok:
        built = Image.open(built_path).convert('RGB')
        if built.size == bg.size:
            a = built.tobytes()
            b = bg.tobytes()
            diff = sum(abs(x - y) for x, y in zip(a, b)) / float(len(a))
    yes('B4 make-join-card.py builds the background that is committed, from '
        'the banner in bot/ (mean difference %s)' % (
            '%.3f' % diff if diff is not None else 'none, it did not build'),
        diff is not None and diff < 2.0)
finally:
    shutil.rmtree(os.path.dirname(built_path), ignore_errors=True)

drawn = Image.open(card.render('VENUS', None, 29, None, 'venus')).convert('RGB')
yes('B5 card.render draws a card 1000 by 360 (got %r)' % (drawn.size,),
    drawn.size == (1000, 360))
corner = (0, 0, 60, 60)
yes('B6 and draws it on that background: the corner away from the words is '
    'the background untouched',
    drawn.crop(corner).tobytes() == bg.crop(corner).tobytes())


# ---------------------------------------------------------- readability --
# What the words sit on: the card exactly as render draws it, wash and all,
# with the words and the rule left off.
class Quiet(ImageDraw.ImageDraw):
    def text(self, *a, **k):
        pass

    def line(self, *a, **k):
        pass


real_draw = ImageDraw.Draw
ImageDraw.Draw = lambda im, mode=None: Quiet(im, mode)
try:
    under = Image.open(card.render('A long enough name here', None, 28)).convert('RGB')
finally:
    ImageDraw.Draw = real_draw


def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lum(rgb):
    return 0.2126 * _lin(rgb[0]) + 0.7152 * _lin(rgb[1]) + 0.0722 * _lin(rgb[2])


def contrast(a, b):
    return (max(a, b) + 0.05) / (min(a, b) + 0.05)


# The same measure taken on the starfield card, with the card.py of 24 Sep, as
# (contrast against the median of what is behind the line, contrast against
# its brightest tenth). WCAG contrast ratios.
STARFIELD = {
    'the caps line': ((316, 96, 700, 122), card.QUIET, 6.70, 6.14),
    'the name': ((316, 136, 940, 205), card.PAGE, 14.82, 14.24),
    'the gold rule': ((316, 210, 436, 218), card.GOLD, 7.75, 7.20),
    'the number': ((316, 228, 600, 258), card.GOLD, 7.75, 7.69),
}
for label, (box, colour, was50, was90) in STARFIELD.items():
    px = sorted(lum(p) for p in under.crop(box).get_flattened_data())
    c50 = contrast(lum(colour), px[len(px) // 2])
    c90 = contrast(lum(colour), px[int(len(px) * 0.9)])
    yes('R1 %s is as readable as on the starfield: %.2f against the middle of '
        'what is behind it, was %.2f' % (label, c50, was50), c50 >= was50 * 0.99)
    yes('R1 %s against the brightest tenth behind it: %.2f, was %.2f, and '
        'past the 4.5 of WCAG AA' % (label, c90, was90),
        c90 >= was90 * 0.93 and c90 >= 4.5)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
