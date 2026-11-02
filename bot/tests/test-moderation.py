"""
test-moderation.py

The staff action watcher in bot.py (#412): what a moderator does in the game
(/kick, /freeze, /silence, /warn and the rest) is said in the staff channel,
once, from for-bot\\moderation.log beside each game server (#2321).

Checked: what is already in the files when the bot starts is treated as said;
a new line is said once and says which server; a line still being written is
left for the next look; a line that is not an action says nothing; a flood is
one line; a file that cannot be read is skipped rather than read as empty,
and said in bot.log once, and again once it can be read (#2321); nothing
typed in the game can ping anybody.

The real bot module is imported and the real coroutine is run over real
files in a temp folder. Only the Discord send, the client and the sleep are
replaced. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import inspect
import json
import shutil
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import bot  # noqa: E402

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


class Stop(BaseException):
    """Ends the loop. BaseException, because the loop catches Exception."""


class AsyncioShim(object):
    def __init__(self, on_sleep):
        self._on_sleep = on_sleep

    def __getattr__(self, name):
        return getattr(asyncio, name)

    async def sleep(self, seconds):
        return self._on_sleep(seconds)


class FakeClient(object):
    guilds = []

    async def wait_until_ready(self):
        return None

    def is_closed(self):
        return False


WORK = tempfile.mkdtemp(prefix='thornswood-moderation-')
LIVE = os.path.join(WORK, 'live', 'moderation.log')
DEV = os.path.join(WORK, 'dev', 'moderation.log')
os.makedirs(os.path.dirname(LIVE))
os.makedirs(os.path.dirname(DEV))


def row(did, who='Bjorn', why='', n=0, **more):
    r = {'at': '2026-09-28T20:00:%02dZ' % n, 'server': 'main', 'did': did,
         'by': 1001, 'byName': 'Aela', 'who': 2002, 'whoName': who, 'why': why}
    r.update(more)
    return json.dumps(r)


def put(path, lines, tail=''):
    with open(path, 'w', encoding='utf-8', newline='') as f:
        f.write(''.join(l + '\n' for l in lines) + tail)


LOGGED = []


def drive(steps):
    """Run watch_moderation; before each sleep, apply the next step (a
    function). Returns what was said before each sleep."""
    said = []
    ticks = []
    state = {'i': 0}
    del LOGGED[:]

    async def fake_say(text):
        said.append(text)

    def on_sleep(seconds):
        ticks.append(list(said))
        del said[:]
        if state['i'] >= len(steps):
            raise Stop()
        steps[state['i']]()
        state['i'] += 1

    keep = (bot.MODERATION_LOGS, bot.report_say, bot.client, bot.asyncio, bot.log)
    bot.MODERATION_LOGS = [('live', LIVE), ('dev', DEV)]
    bot.report_say = fake_say
    bot.client = FakeClient()
    bot.asyncio = AsyncioShim(on_sleep)
    bot.log = lambda *a: LOGGED.append(' '.join(str(x) for x in a))
    try:
        try:
            asyncio.run(bot.watch_moderation())
        except Stop:
            pass
    finally:
        (bot.MODERATION_LOGS, bot.report_say, bot.client, bot.asyncio, bot.log) = keep
    return ticks


try:
    yes('bot.py has the watcher', all(hasattr(bot, n) for n in
        ('watch_moderation', 'moderation_text', 'MODERATION_LOGS', 'MODERATION_EVERY')))

    # M1: what is there at start is said already.
    old = [row('warn', why='old', n=1)]
    put(LIVE, old)
    if os.path.exists(DEV):
        os.remove(DEV)
    ticks = drive([lambda: None])
    yes('M1 nothing already in the file is said on start', all(t == [] for t in ticks))

    # M2: a new line is said once, with the server it came from.
    put(LIVE, old)
    ticks = drive([lambda: put(LIVE, old + [row('kick', why='spam', n=2)]),
                   lambda: None, lambda: None])
    said = [s for t in ticks for s in t]
    yes('M2 a new kick is said', len(said) == 1 and 'removed Bjorn (profile 2002) from the world: spam' in said[0])
    yes('M2 and says the live server', len(said) == 1 and said[0].startswith('**Staff on the live server:**'))

    # M3: the dev server's file, from no file at all.
    put(LIVE, old)
    if os.path.exists(DEV):
        os.remove(DEV)
    ticks = drive([lambda: put(DEV, [row('freeze', n=3)]), lambda: None])
    said = [s for t in ticks for s in t]
    yes('M3 the dev file appearing is read, and says dev',
        len(said) == 1 and said[0].startswith('**Staff on the dev server:**') and 'froze Bjorn' in said[0])

    # M4: a line still being written waits for its line ending.
    put(LIVE, old)
    put(DEV, [])
    half = row('warn', why='mid write', n=4)
    ticks = drive([lambda: put(LIVE, old, half[:20]),
                   lambda: put(LIVE, old + [half]), lambda: None])
    yes('M4 half a line says nothing', ticks[1] == [])
    yes('M4 and the whole line is said once it lands', len(ticks[2]) == 1 and 'mid write' in ticks[2][0])

    # M5: rubbish is skipped, the loop carries on.
    put(LIVE, old)
    ticks = drive([lambda: put(LIVE, old + ['not json', row('nonsense', n=5), row('warn', why='real', n=6)]),
                   lambda: None])
    said = [s for t in ticks for s in t]
    yes('M5 only the real action is said', len(said) == 1 and 'real' in said[0])

    # M6: a flood is one line.
    put(LIVE, old)
    many = [row('silence', n=10 + i, minutes=5) for i in range(12)]
    ticks = drive([lambda: put(LIVE, old + many), lambda: None])
    said = [s for t in ticks for s in t]
    yes('M6 twelve at once is one line saying how many', len(said) == 1 and '12 staff actions' in said[0])

    # M7: nothing typed in the game pings anybody.
    text = bot.moderation_text('live', json.loads(row('warn', who='@everyone', why='<@&111111111111111111> [x](http://e.invalid)')))
    yes('M7 an @everyone in a name is text', '@everyone' not in text and '@\u200beveryone' in text)
    yes('M7 a role mention in a reason is text', '<@&111111111111111111>' not in text)
    yes('M7 a masked link is shown as what it is', '\\[x](http://e.invalid)' in text)
    for w in (text, bot.moderation_text('dev', json.loads(row('kick')))):
        if 'player' in w.lower() or '\u2014' in w:
            yes('M7 the words are the house words', False)
            break
    else:
        yes('M7 the words are the house words', True)

    # M8: every action the gamemode writes has words here.
    gm = open(os.path.join(HERE, '..', 'game', 'gamemode.js'), encoding='utf-8').read()
    dids = ['kick', 'freeze', 'unfreeze', 'bring', 'goto', 'silence', 'unsilence', 'warn',
            'give', 'spawn', 'tp', 'ban', 'unban', 'note',
            # One character or the whole account, and PK (#1010).
            'banaccount', 'unbanaccount', 'pk',
            # An admin undoing a PK made by mistake (#1010, 29 September).
            'unpk']
    yes('M8 every action the staff block records has a sentence here',
        all(("record('%s'" % d) in gm and d in bot._MOD_DID for d in dids))
    # The site is server.js over its modules in site/lib since #5357; the hub's
    # writes are in those modules.
    site_dir = os.path.join(HERE, '..', 'site')
    site = ''.join(open(os.path.join(site_dir, f), encoding='utf-8').read()
                   for f in ['server.js'] + ['lib/' + n for n in sorted(os.listdir(os.path.join(site_dir, 'lib')))
                                             if n.endswith('.js')])
    yes('M8 and so does every one the hub writes',
        all(("modLog({ did: '%s'" % d) in site and d in bot._MOD_DID
            for d in ('ban', 'unban', 'note', 'banaccount', 'unbanaccount', 'pk', 'unpk')))

    # M10: the hub's lines say the site, and name a person by account.
    hub = bot.moderation_text('site', {'did': 'banaccount', 'byName': 'Aela', 'whoName': 'Bjorn',
                                       'why': 'until 2026-10-01 18:00 UTC: spam'})
    yes('M10 an account ban from the hub says the site and the whole account, with no profile number',
        hub == '**Staff on the site:** Aela banned the whole account of Bjorn, every character on it: '
               'until 2026-10-01 18:00 UTC: spam')
    game = bot.moderation_text('live', json.loads(row('ban', why='for good: cheating')))
    yes('M10 a character ban from the game says the server, the character and the profiles',
        game == '**Staff on the live server:** Aela (profile 1001) banned the character Bjorn (profile 2002): '
                'for good: cheating')
    pk = bot.moderation_text('dev', json.loads(row('pk', why='died in the siege')))
    yes('M10 a PK says the character died for good, and why',
        pk == '**Staff on the dev server:** Aela (profile 1001) killed Bjorn (profile 2002) for good (PK), '
              'quietly: died in the siege')
    unpk = bot.moderation_text('site', {'did': 'unpk', 'byName': 'Aela', 'who': 2003,
                                        'whoName': 'Hrefna (Bjorn)', 'why': 'made by mistake'})
    yes('M10 undoing a PK says who undid it, the character, that it can be played again, and why',
        unpk == '**Staff on the site:** Aela undid the PK of Hrefna (Bjorn) (profile 2003), so the '
                'character can be played again: made by mistake')
    note = bot.moderation_text('dev', json.loads(row('note', why='asked twice about the bridge')))
    yes('M10 a note says what it says', 'wrote a note on Bjorn (profile 2002): asked twice' in note)

    # M11: somebody's own /stuck (#414) says the server, the person and the
    # gamemode's whole sentence, not "Staff on", and pings nobody.
    stuck = bot.moderation_text('dev', {
        'did': 'stuck', 'by': 2002, 'byName': 'Bjorn', 'who': 2002, 'whoName': 'Bjorn',
        'why': 'used /stuck and was sent back a few steps, from 3c:Skyrim.esm (1, 2, 3) to '
               '3c:Skyrim.esm (400, 2, 3). Character ff000002, Discord 111.'})
    yes('M11 a /stuck line says the server, the person and where from and to',
        stuck == '**/stuck on the dev server:** Bjorn (profile 2002) used /stuck and was sent back '
                 'a few steps, from 3c:Skyrim.esm (1, 2, 3) to 3c:Skyrim.esm (400, 2, 3). '
                 'Character ff000002, Discord 111.')
    yes('M11 the gamemode writes it', "did: 'stuck'" in gm and 'stuck' in bot._MOD_DID)
    pinged = bot.moderation_text('live', {'did': 'stuck', 'by': 5, 'byName': '@everyone',
                                          'why': 'used /stuck <@&111111111111111111>'})
    yes('M11 nothing in it pings anybody', '@everyone' not in pinged and '<@&111111111111111111>' not in pinged)

    # M12: somebody moved out for being idle (#1142) says the server, the
    # person and the gamemode's why, and pings nobody.
    idle = bot.moderation_text('live', {
        'did': 'idle', 'by': 2002, 'byName': 'Bjorn', 'who': 2002, 'whoName': 'Bjorn',
        'why': 'no answer to "Are you still here?" within 60 seconds'})
    yes('M12 an idle line says the server, the person, what happened and why',
        idle == '**Idle on the live server:** Bjorn (profile 2002) was taken back to the character choice '
                'and put in line: no answer to "Are you still here?" within 60 seconds')
    yes('M12 the gamemode writes it', "did: 'idle'" in gm and 'idle' in bot._MOD_DID)
    idle_ping = bot.moderation_text('dev', {'did': 'idle', 'who': 5, 'whoName': '@everyone',
                                            'why': '<@&111111111111111111>'})
    yes('M12 nothing in it pings anybody',
        '@everyone' not in idle_ping and '<@&111111111111111111>' not in idle_ping)
    yes('M12 no em dash and never the forbidden word',
        chr(0x2014) not in idle and ('pla' + 'yer') not in idle.lower())

    # M14: staff at a building's door (#2551, Patrick, 17 Oct): the property
    # block's staff presses come through the staff block's record with the
    # building and its hold in the why, and each reads as who did what where.
    yes('M14 the property block records each staff press at a door, and each has a sentence here',
        all(("staffRecord('%s'" % d) in gm and d in bot._MOD_DID for d in ('evict', 'rent', 'norent', 'rentpaid')))
    ev = bot.moderation_text('dev', json.loads(row('evict', who='Alice', why='Breezehome, in Whiterun')))
    yes('M14 an eviction by staff says who, whose claim and where',
        ev == '**Staff on the dev server:** Aela (profile 1001) ended the claim of Alice (profile 2002): '
              'Breezehome, in Whiterun')
    rn = bot.moderation_text('live', json.loads(row('rent', who='Alice',
                                                    why='50 gold every 7 days on Jakob\'s House, which answers to no hold')))
    yes('M14 rent set by staff says the amount and the building, a building of no hold too',
        rn == '**Staff on the live server:** Aela (profile 1001) set the rent on the claim of Alice (profile 2002): '
              '50 gold every 7 days on Jakob\'s House, which answers to no hold')
    nr = bot.moderation_text('dev', json.loads(row('norent', who='@everyone', why='<@&111111111111111111> Breezehome')))
    yes('M14 no rent by staff says so, and nothing in it pings anybody',
        nr.startswith('**Staff on the dev server:** Aela (profile 1001) took the rent off the claim of ')
        and '@everyone' not in nr and '<@&111111111111111111>' not in nr)
    yes('M14 no em dash and never the forbidden word',
        all(chr(0x2014) not in t and ('pla' + 'yer') not in t.lower() for t in (ev, rn, nr)))

    # M15: staff on the world's card, the Office page of K (#513, Patrick,
    # 17 Oct): each press comes through the staff block's record with the
    # stage as the who, and reads as who did what to the world.
    yes('M15 the world stage block records each staff press on the card, and each has a sentence here',
        all(("log.record('%s'" % d) in gm and d in bot._MOD_DID
            for d in ('worldpropose', 'worldconfirm', 'worlddrop')))
    wp = bot.moderation_text('dev', {'did': 'worldpropose', 'by': 1001, 'byName': 'Aela', 'who': 0,
                                     'whoName': 'A landing', 'why': 'from peace to landing, force: remnant'})
    yes('M15 a proposal says who proposed which stage, and from where',
        wp == '**Staff on the dev server:** Aela (profile 1001) proposed moving the world to A landing: '
              'from peace to landing, force: remnant')
    wc = bot.moderation_text('live', {'did': 'worldconfirm', 'by': 1001, 'byName': 'Aela', 'who': 0,
                                      'whoName': 'A landing', 'why': 'from peace to landing, proposed by Bjorn (profile 2002)'})
    yes('M15 a confirm says who confirmed it and who proposed it',
        wc == '**Staff on the live server:** Aela (profile 1001) confirmed moving the world to A landing: '
              'from peace to landing, proposed by Bjorn (profile 2002)')
    wd = bot.moderation_text('dev', {'did': 'worlddrop', 'by': 1001, 'byName': 'Aela', 'who': 0,
                                     'whoName': '@everyone', 'why': '<@&111111111111111111>'})
    yes('M15 a drop says so, and nothing in it pings anybody',
        wd.startswith('**Staff on the dev server:** Aela (profile 1001) dropped the proposal to move the world to ')
        and '@everyone' not in wd and '<@&111111111111111111>' not in wd)
    yes('M15 no em dash and never the forbidden word',
        all(chr(0x2014) not in t and ('pla' + 'yer') not in t.lower() for t in (wp, wc, wd)))

    # M16: staff on the crafting card, the Office page of K (#3167): each
    # press comes through the staff block's record, and reads as who did what
    # to whom, with the why the gamemode writes.
    yes('M16 the staff crafting block records each change on the card, and each has a sentence here',
        all(("st.record('%s'" % d) in gm and d in bot._MOD_DID
            for d in ('craftrank', 'craftrecipes', 'craftgive')))
    cr = bot.moderation_text('dev', json.loads(row('craftrank', who='Alice', why='Platewright from Novice to Advanced')))
    yes('M16 a raise says who raised whose rank, from what to what',
        cr == '**Staff on the dev server:** Aela (profile 1001) raised a rank of Alice (profile 2002): '
              'Platewright from Novice to Advanced')
    cg = bot.moderation_text('live', json.loads(row('craftgive', who='Alice', why='2 Iron Ingot: lost in the crash at 4 PM')))
    yes('M16 a give back says what, how many, and why',
        cg == '**Staff on the live server:** Aela (profile 1001) gave back to Alice (profile 2002): '
              '2 Iron Ingot: lost in the crash at 4 PM')
    cl = bot.moderation_text('dev', json.loads(row('craftrecipes', who='@everyone', why='<@&111111111111111111>')))
    yes('M16 a list handed again says so, and nothing in it pings anybody',
        cl.startswith('**Staff on the dev server:** Aela (profile 1001) handed the newer recipe list to the game of ')
        and '@everyone' not in cl and '<@&111111111111111111>' not in cl)
    yes('M16 no em dash and never the forbidden word',
        all(chr(0x2014) not in t and ('pla' + 'yer') not in t.lower() for t in (cr, cg, cl)))

    # M9: started with the others, and sent through report_say (mentions off).
    src = inspect.getsource(bot.on_ready)
    yes('M9 on_ready starts it', 'asyncio.create_task(watch_moderation())' in src)
    yes('M9 it speaks through report_say', 'report_say(' in inspect.getsource(bot.watch_moderation))
    logs = dict(bot.MODERATION_LOGS)
    yes('M9 by default it reads both game servers\' for-bot folders and the site\'s, never private (#2321)',
        [w for w, _ in bot.MODERATION_LOGS] == ['live', 'dev', 'site']
        and logs['live'] == r'C:\Thornswood-Server\for-bot\moderation.log'
        and logs['dev'] == r'C:\Thornswood-Server-Dev\for-bot\moderation.log'
        and os.path.dirname(logs['site']) == os.path.dirname(bot.TROUBLE_FILE)
        and not any('private' in p.lower() for p in logs.values()))

    # M13: a file that cannot be read is said in bot.log, once, naming it and
    # why, and once more when it can be read again; nothing is said in the
    # channel for it (#2321). A folder where the file should be is a read that
    # is refused, on Windows and elsewhere, as the bot's account is refused a
    # file it has no rule on. What is in it when it first opens cannot be told
    # from history, so it is taken as said, as at start (M1); a line after that
    # is said.
    put(LIVE, old)
    if os.path.exists(DEV):
        os.remove(DEV)
    os.makedirs(DEV)

    def opens():
        os.rmdir(DEV)
        put(DEV, [row('warn', why='before the bot could read it', n=20)])
    ticks = drive([lambda: None, lambda: None, opens,
                   lambda: put(DEV, [row('warn', why='before the bot could read it', n=20),
                                     row('kick', why='after', n=21)]),
                   lambda: None])
    said = [s for t in ticks for s in t]
    refused = [l for l in LOGGED if 'cannot read' in l]
    yes('M13 a moderation.log that cannot be read is a line in bot.log, naming it and why',
        len(refused) == 1 and DEV in refused[0] and 'the dev server' in refused[0] and 'Error' in refused[0])
    yes('M13 said once, not at every look', len(refused) == 1)
    yes('M13 and once more when it can be read', len([l for l in LOGGED if 'can be read again' in l and DEV in l]) == 1)
    yes('M13 nothing is said in the channel while it cannot be read, and a line after it opens is',
        len(said) == 1 and 'removed Bjorn' in said[0] and said[0].startswith('**Staff on the dev server:**'))
    if os.path.isdir(DEV):
        os.rmdir(DEV)
finally:
    shutil.rmtree(WORK, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
