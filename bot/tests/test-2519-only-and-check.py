"""
test-2519-only-and-check.py

Issue #2519. A run of the builder approved for one part of the Discord does
that part and nothing else, and -Check says what the same run would do.

On 22 Oct 2026 at 3:59 AM a -Check run for the Gamemasters category, approved
with the Attach Files overwrite on #welcome-travelers, planned far more:
  - 50 role moves, every role after Server Booster, for roles already in
    order: the builder counted places down from its own role, and Server
    Booster, which something else manages and the builder never moves, was
    not where that count put it, so every role after it read one place off;
  - "would write" for all seven read only posts, though a run without -Posts
    leaves them alone;
  - and it MADE the Gamemasters category, because the category step had no
    -Check guard ("made 1").
Plus a hand-made gated channel and two server or channel settings that the
approval did not cover.

What this checks, with Build-Discord.py imported for real under another name
and every guild, role and channel a stand-in that records what would have
been asked of Discord:
  1. role_order: roles already in the plan's order are not moved, whatever
     sits between them; roles out of order, a managed one included (#3317:
     the audit found Patreon out of place after every build), are put in
     order among the places they hold, in one request; a role the plan does
     not name keeps its place; and a role made this run goes under the plan
     role above it;
  2. -Check makes no category, no channel and no webhook, and says would
     make for each;
  3. -Check without -Posts says the posts are left alone and never would
     write; with -Posts it says would write;
  4. DISCORD_ONLY='Gamemasters,welcome-travelers': the category and its
     channels are made, #welcome-travelers gets the bot's Attach Files
     overwrite, and nothing else is asked of Discord: no role made or moved,
     no other channel written, no server setting, no post, no webhook;
  5. a name the plan does not have stops it before Discord is asked;
  6. DISCORD_ONLY='lore,factions' with -Posts (#3656: the run of 27 Oct
     said "made 0, already there 127" and wrote nothing, because ONLY
     stopped before the post step): exactly those two posts are written,
     each with its Changelog thread, and nothing else is asked of Discord;
     a named channel's post links the live channels it mentions; without
     -Posts both are left alone; with -Check it says would write for those
     two and asks for nothing; a named draft is never written; and a whole
     -Posts run still writes every post that is not a draft.

Never connects to anything. The news webhook file goes to a temporary folder.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import asyncio
import contextlib
import importlib.util
import io
import itertools
import re
import shutil
import tempfile
import types


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


spec = importlib.util.spec_from_file_location(
    'build_discord_2519', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
discord = B.discord


# ------------------------------------------------------------ stand-ins --
class Role(object):
    def __init__(self, guild, name, position, managed=False):
        self.guild = guild
        self.name = name
        self.id = 1000 + len(guild.roles)
        self.position = position
        self.managed = managed
        self.permissions = discord.Permissions(0)

    async def edit(self, **kw):
        self.guild.calls.append(('role.edit', self.name, kw))
        if 'position' in kw:
            self.guild.move(self, kw['position'])

    def __repr__(self):
        return '<role %s>' % self.name


class Member(object):
    def __init__(self, roles):
        self.id = 424242
        self.roles = list(roles)
        self.top_role = self.roles[-1]


PLACES = itertools.count(100)


class Channel(object):
    def __init__(self, guild, name, kind, category=None, topic=None, ow=None):
        self.guild = guild
        self.name = name
        self.kind = kind
        self.category = category
        self.topic = topic
        self.ow = dict(ow or {})
        self.channels = []
        # Made in the plan's order, so the sidebar is the plan's (#3317).
        self.id = next(PLACES)
        self.position = self.id

    @property
    def type(self):
        if self.kind in ('voice', 'create_voice_channel'):
            return discord.ChannelType.voice
        if self.kind in ('category', 'create_category'):
            return discord.ChannelType.category
        return discord.ChannelType.text

    @property
    def overwrites(self):
        return dict(self.ow)

    def overwrites_for(self, target):
        o = self.ow.get(target)
        if o is None:
            return discord.PermissionOverwrite()
        a, d = o.pair()
        return discord.PermissionOverwrite.from_pair(a, d)

    async def set_permissions(self, target, overwrite=None, reason=None):
        self.guild.calls.append(('set_permissions', self.name, target))
        a, d = overwrite.pair()
        self.ow[target] = discord.PermissionOverwrite.from_pair(a, d)

    async def edit(self, **kw):
        # A place's overwrites set whole (#3317) are its own call, so a check
        # on topics and settings is not confused with them.
        if 'overwrites' in kw:
            self.guild.calls.append(('overwrites', self.name, kw))
            self.ow = dict(kw['overwrites'])
            return
        self.guild.calls.append(('channel.edit', self.name, kw))

    async def webhooks(self):
        return list(self.guild.hooks)

    async def create_webhook(self, **kw):
        self.guild.calls.append(('create_webhook', self.name, kw))
        return types.SimpleNamespace(name='Thornswood', url='https://example.invalid/hook')

    async def delete(self, **kw):
        self.guild.calls.append(('delete', self.name, kw))

    def __repr__(self):
        return '<#%s>' % self.name


class Guild(object):
    def __init__(self):
        self.id = 1
        self.name = 'Thornswood stand-in'
        self.roles = []
        self.calls = []
        self.categories = []
        self.channels = []
        self.hooks = [types.SimpleNamespace(name='Thornswood', url='https://example.invalid/hook')]
        self.features = ['COMMUNITY']
        self.rules_channel = object()
        self.system_channel = object()
        self.afk_channel = None
        with open(os.path.join(HERE, 'staff-channel.txt'), encoding='utf-8') as f:
            self.staff_updates = types.SimpleNamespace(id=int(f.read().strip()), name='staff-updates')
        self.public_updates_channel = self.staff_updates
        self.safety_alerts_channel = self.staff_updates
        self.default_role = Role(self, '@everyone', 0)
        self.me = None
        self._state = types.SimpleNamespace(http=types.SimpleNamespace(
            bulk_channel_update=self._positions))


    async def onboarding(self):
        return types.SimpleNamespace(enabled=getattr(self, 'onboarding_enabled', False))

    async def edit_onboarding(self, **kw):
        self.calls.append(('edit_onboarding', None, kw))
        self.onboarding_enabled = kw.get('enabled', getattr(self, 'onboarding_enabled', False))

    async def edit_role_positions(self, positions, reason=None):
        """Discord's bulk move, the one request role_order sends (#3317)."""
        self.calls.append(('role positions', None, dict((r.name, p) for r, p in positions.items())))
        for r, p in positions.items():
            r.position = p

    def move(self, role, position):
        """Discord's move: the role takes that position and the others keep
           their order around it, numbered 1 up (0 is @everyone)."""
        rest = sorted((r for r in self.roles if r is not role), key=lambda r: r.position)
        rest.insert(max(0, min(len(rest), position - 1)), role)
        for i, r in enumerate(rest):
            r.position = i + 1

    def top_down(self):
        return [r.name for r in sorted(self.roles, key=lambda r: -r.position)]

    async def _made(self, what, name, **kw):
        self.calls.append((what, name))
        ch = Channel(self, name, what, category=kw.get('category'),
                     topic=kw.get('topic'), ow=kw.get('overwrites'))
        self.channels.append(ch)
        if what == 'create_category':
            self.categories.append(ch)
        elif kw.get('category') is not None:
            kw['category'].channels.append(ch)
        return ch

    async def create_role(self, name=None, **kw):
        self.calls.append(('create_role', name))
        r = Role(self, name, 1)
        for o in self.roles:
            o.position += 1
        self.roles.append(r)
        return r

    async def _positions(self, guild_id, payload, reason=None):
        """The one request that sets the sidebar's order (#3317)."""
        self.calls.append(('positions', None, payload))
        at = dict((p['id'], p['position']) for p in payload)
        for ch in self.channels + self.categories:
            if ch.id in at:
                ch.position = at[ch.id]

    async def create_category(self, name, **kw):
        return await self._made('create_category', name, **kw)

    async def create_text_channel(self, name, **kw):
        return await self._made('create_text_channel', name, **kw)

    async def create_voice_channel(self, name, **kw):
        return await self._made('create_voice_channel', name, **kw)

    async def create_forum(self, name, **kw):
        return await self._made('create_forum', name, **kw)

    def get_channel(self, cid):
        return self.staff_updates if cid == self.staff_updates.id else None

    async def edit(self, **kw):
        self.calls.append(('guild.edit', None, kw))


class Client(object):
    def __init__(self, guild):
        self.guilds = [guild]

    def get_guild(self, _gid):
        return self.guilds[0]

    async def close(self):
        pass


def live_server(other_between=False, booster_low=False):
    """The server as the 22 Oct -Check found it: every role of the plan there
       and in the plan's order, Server Booster (managed by Discord) included,
       or sat low with booster_low, and a role the plan does not name between
       two of the plan's; every category
       and channel of the plan there except the Gamemasters category; and a
       channel made by hand behind the gate with no overwrite for the bot,
       the way #jukebox is."""
    g = Guild()
    names = [n for n, _c, _h, _p in B.ROLES if not (booster_low and n == 'Server Booster')]
    if other_between:
        order = ['Thornswood Bot'] + names[:6] + ['Some Other Bot'] + names[6:]
    else:
        order = ['Thornswood Bot'] + names + ['Some Other Bot']
    if booster_low:
        order.append('Server Booster')
    pos = len(order)
    for n in order:
        g.roles.append(Role(g, n, pos, managed=(n == 'Server Booster')))
        pos -= 1
    g.me = Member([r for r in g.roles if r.name == 'Thornswood Bot'])
    roles = dict((r.name, r) for r in g.roles)
    bare = types.SimpleNamespace(default_role=g.default_role, me=None, roles=g.roles)
    for catname, specs in B.PLAN:
        if catname == 'Gamemasters':
            continue
        cat = None
        if catname:
            cat = Channel(g, catname, 'category')
            g.categories.append(cat)
            g.channels.append(cat)
        for s in specs:
            if not s.get('make', True):
                continue
            want = s['name'].lower().replace(' ', '-') if s['kind'] != 'voice' else s['name']
            ow = B.with_bot(g, B.overwrites(bare, s.get('mode', 'open'), roles, s.get('hold'),
                                            space=s.get('space'), read_extra=s.get('read_extra'),
                                            faction=s.get('faction')),
                            B.bot_needs(s)) if s.get('key') != 'JOIN' else {}
            ch = Channel(g, want, s['kind'], category=cat, topic=s.get('topic'), ow=ow)
            g.channels.append(ch)
            if cat is not None:
                cat.channels.append(ch)
            if s.get('key') == 'AFK':
                g.afk_channel = ch
    around = [c for c in g.categories if c.name == 'Staff'][0]
    juke = Channel(g, 'jukebox', 'text', category=around,
                   ow={g.default_role: discord.PermissionOverwrite(view_channel=False)})
    g.channels.append(juke)
    around.channels.append(juke)
    return g


def run(g, check=False, posts=False, only='', prune=False):
    B.CHECK = check
    B.POSTS = posts
    B.PRUNE = prune
    B.ROLES_ONLY = False
    B.ONLY = [n.strip() for n in only.split(',') if n.strip()]
    B.GUILD = ''
    B.client = Client(g)
    del B.made[:]
    del B.kept[:]
    del B.failed[:]
    g.calls = []
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        asyncio.run(B.on_ready())
    return buf.getvalue()


TMP = tempfile.mkdtemp(prefix='ts-2519-only-')
try:
    B.WEBHOOK_OUT = os.path.join(TMP, 'news-webhook.txt')

    # ---- 1. role_order --------------------------------------------------
    def plan_of(g):
        return dict((r.name, r) for r in g.roles if r.name in set(n for n, _c, _h, _p in B.ROLES))

    def top_plan(g):
        want = [n for n, _c, _h, _p in B.ROLES]
        return [n for n in g.top_down() if n in want] == want

    g = live_server()
    yes('roles already in the plan\'s order are not moved', B.role_order(g, plan_of(g)) is None)
    g = live_server(other_between=True)
    yes('  nor with a role the plan does not name between two of the plan\'s',
        B.role_order(g, plan_of(g)) is None)

    g = live_server(booster_low=True)
    order = B.role_order(g, plan_of(g))
    yes('Server Booster, managed by Discord, sat low is put in its place too (#3317)',
        order is not None and not top_plan(g))
    asyncio.run(g.edit_role_positions(dict((r, len(order) - i) for i, r in enumerate(order))))
    yes('  and afterwards every plan role is in the plan\'s order', top_plan(g))

    g = live_server(other_between=True)
    by = dict((r.name, r) for r in g.roles)
    a, b = by['Owner'], by['Moderator']
    a.position, b.position = b.position, a.position
    under = [r.name for r in sorted(g.roles, key=lambda r: -r.position)]
    next_to = under[under.index('Some Other Bot') - 1]
    order = B.role_order(g, plan_of(g))
    asyncio.run(g.edit_role_positions(dict((r, len(order) - i) for i, r in enumerate(order))))
    yes('two roles swapped are put back, the rest in the plan\'s order', top_plan(g))
    after = g.top_down()
    yes('  and a role the plan does not name keeps its place among them',
        after[after.index('Some Other Bot') - 1] == next_to)
    yes('  and the bot\'s own role is not in the request',
        'Thornswood Bot' not in [r.name for r in order] and g.top_down()[0] == 'Thornswood Bot')

    g = live_server()
    by = dict((r.name, r) for r in g.roles)
    fresh = by['Citizen of Morthal']
    for r in g.roles:
        if r.position < fresh.position:
            r.position += 1
    fresh.position = 1
    order = B.role_order(g, plan_of(g), new={'Citizen of Morthal'})
    asyncio.run(g.edit_role_positions(dict((r, len(order) - i) for i, r in enumerate(order))))
    yes('a role made this run, at the bottom, goes under the plan role above it', top_plan(g))

    # ---- 2 and 3. -Check ------------------------------------------------
    g = live_server()
    out = run(g, check=True)
    yes('-Check asks Discord for nothing at all', g.calls == [])
    yes('  and makes no category (the 22 Oct -Check made Gamemasters)',
        not any(c[0] == 'create_category' for c in g.calls) and 'made 0' in out)
    yes('  and says it would make the category and each of its channels',
        'category Gamemasters' in out and '#gm-rules' in out and '#gm-discipline' in out and 'voice GM Voice' in out)
    yes('  and plans no role move for roles already in order', 'would move' not in out)
    yes('  without -Posts it never says would write, and says the posts are left alone',
        'would write' not in out and 'left alone' in out and '-Posts rewrites them' in out)
    yes('  and writes down no webhook, though one is there', not os.path.exists(B.WEBHOOK_OUT))
    # The server as the layout run of 22 Oct found it: the faction chats
    # and voices in one Factions category, and no category per faction yet.
    # -Check said "would make" for each; the build moved them (#3317).
    g = live_server()
    comp = [c for c in g.categories if c.name == 'The Companions'][0]
    old = Channel(g, 'Factions', 'category')
    g.categories.append(old)
    g.channels.append(old)
    g.categories.remove(comp)
    g.channels.remove(comp)
    for ch in list(comp.channels):
        if ch.name in ('companions', 'The Companions'):
            ch.category = old
            old.channels.append(ch)
        else:
            g.channels.remove(ch)
    out = run(g, check=True)
    lines = [ln.strip() for ln in out.splitlines()]
    yes('-Check of a faction category not made yet says it would make the category',
        'category The Companions' in out and g.calls == [])
    yes('  and that it would move the faction\'s chat and voice in from Factions, by their was lines',
        '#companions in Factions becomes #companions in The Companions' in out
        and '#The Companions in Factions becomes #The Companions in The Companions' in out)
    yes('  and not that it would make them',
        not any(ln.endswith('#companions') and 'would make' in ln for ln in lines)
        and not any(ln.endswith('voice The Companions') for ln in lines))
    yes('  and still that it would make the channels that are new',
        any(ln.endswith('#companions-leadership') and 'would make' in ln for ln in lines))
    out = run(live_server(), check=True, posts=True)
    yes('-Check with -Posts says would write', 'would write' in out)

    g = live_server()
    g.hooks = []
    out = run(g, check=True)
    yes('-Check with no news webhook makes none and writes no file',
        not any(c[0] == 'create_webhook' for c in g.calls) and not os.path.exists(B.WEBHOOK_OUT)
        and 'would make' in out and 'news webhook' in out)

    # ---- 3b. -Prune -Check: a planned name in the wrong category (#3317) --
    # The live build of 22 Oct left a second #game-rules in In Character,
    # beside the plan's in Roleplay Guide, and -Prune took it for the plan's.
    g = live_server()
    ic = [c for c in g.categories if c.name == 'In Character'][0]
    stray = Channel(g, 'game-rules', 'text', category=ic)
    g.channels.append(stray)
    ic.channels.append(stray)

    async def no_threads():
        return []
    g.active_threads = no_threads
    out = run(g, check=True, prune=True)
    yes('-Prune -Check would remove a planned name left in the wrong category',
        out.count('would remove #game-rules') == 1)
    yes('  and asks Discord for nothing, not even the forum rebuild it plans',
        g.calls == [] and 'would rebuild' in out)

    # ---- 4. ONLY --------------------------------------------------------
    g = live_server()
    roles_before = [(r.name, r.position) for r in g.roles]
    out = run(g, only='Gamemasters,welcome-travelers')
    made = [c[1] for c in g.calls if c[0].startswith('create_')]
    yes('ONLY Gamemasters,welcome-travelers makes the category and its eight channels',
        made == ['Gamemasters', 'gm-announcements', 'gm-rules', 'gm-event-plans',
                 'gm-scene-summaries', 'gm-chat', 'gm-suggestions', 'gm-discipline',
                 'GM Voice'])
    perms = [c for c in g.calls if c[0] in ('set_permissions', 'overwrites')]
    wel = [c for c in g.channels if c.name == 'welcome-travelers'][0]
    yes('  gives #welcome-travelers the bot\'s Attach Files overwrite, and writes no other channel',
        [c[1] for c in perms] == ['welcome-travelers'] and wel.overwrites_for(g.me).attach_files is True)
    yes('  makes and moves no role',
        not any(c[0] in ('create_role', 'role.edit') for c in g.calls) and
        [(r.name, r.position) for r in g.roles] == roles_before)
    # #welcome-travelers has a topic in the plan since 23 Oct (#3317), and a
    # channel named here gets its plan, topic included; nothing else does.
    edits = [c for c in g.calls if c[0] == 'channel.edit']
    yes('  changes no server setting, post or webhook, and no topic but the named channel\'s',
        not any(c[0] in ('guild.edit', 'create_webhook', 'delete') for c in g.calls)
        and [(c[1], sorted(c[2])) for c in edits] == [('welcome-travelers', ['topic'])]
        and 'would write' not in out and not os.path.exists(B.WEBHOOK_OUT))
    yes('  leaves #jukebox alone', not any(c[1] == 'jukebox' for c in g.calls))
    yes('  and says what it was limited to', 'Gamemasters, welcome-travelers. Nothing else was touched' in out)

    g = live_server()
    out = run(g, check=True, only='Gamemasters,welcome-travelers')
    yes('ONLY with -Check asks Discord for nothing, and names the category, its channels and the overwrite',
        g.calls == [] and 'category Gamemasters' in out and
        '#welcome-travelers gets the overwrites of its mode' in out)

    # ---- 6. ONLY with -Posts (#3656) ------------------------------------
    # post() and keep_changelog() are the build's own, and their work on a
    # channel is bot/tests/test-3336-changelogs.py's. Here they are recorders, so
    # this sees which channels a run writes and with what.
    wrote, threads = [], []
    real_post, real_changelog = B.post, B.keep_changelog

    async def record_post(ch, text, found):
        wrote.append((getattr(ch, 'name', None), text, dict(found)))

    async def record_changelog(ch, key):
        threads.append(getattr(ch, 'name', None))
        return None
    B.post, B.keep_changelog = record_post, record_changelog
    try:
        def written(g, **kw):
            del wrote[:]
            del threads[:]
            return run(g, **kw)

        g = live_server()
        roles_before = [(r.name, r.position) for r in g.roles]
        out = written(g, only='lore,factions', posts=True)
        yes('ONLY lore,factions with -Posts writes exactly #lore and #factions',
            [w[0] for w in wrote] == ['lore', 'factions'])
        yes('  each from its own words in content.py, with its change line',
            [w[1] for w in wrote] == [B.doc_with_footer('LORE'), B.doc_with_footer('FACTIONS')])
        yes('  each after its Changelog thread', threads == ['lore', 'factions'])
        yes('  makes, moves and rewrites nothing else: no role, channel, setting, webhook or delete',
            g.calls == [] and [(r.name, r.position) for r in g.roles] == roles_before
            and not os.path.exists(B.WEBHOOK_OUT))
        yes('  and says what it was limited to and that it made nothing',
            'lore, factions. Nothing else was touched' in out and 'made 0' in out)

        g = live_server()
        out = written(g, only='rules', posts=True)
        links = wrote[0][2] if wrote else {}
        named = dict((s['key'], s['name']) for _c, ss in B.PLAN for s in ss if s.get('key'))
        said = sorted(set(re.findall(r'<#([A-Z]+)>', B.C.DOCS['RULES'])))
        yes('a named channel\'s post links the live channels it mentions, not only the named one (%s)'
            % ', '.join(said),
            [w[0] for w in wrote] == ['rules'] and len(said) > 0 and
            all(getattr(links.get(k), 'name', None) == named[k] for k in said)
            and g.calls == [])

        g = live_server()
        out = written(g, only='lore,factions')
        yes('ONLY lore,factions without -Posts writes no post and says both are left alone',
            wrote == [] and threads == [] and '2 read only post(s). -Posts rewrites them.' in out
            and g.calls == [])

        g = live_server()
        out = written(g, check=True, only='lore,factions', posts=True)
        yes('ONLY lore,factions with -Posts and -Check asks Discord for nothing',
            g.calls == [] and wrote == [] and threads == [])
        yes('  and says it would write those two and no other',
            out.count('would write') == 2 and '#lore and its changelog' in out
            and '#factions and its changelog' in out)

        g = live_server()
        out = written(g, only='playtester-rules', posts=True)
        yes('a named channel whose words are a draft is never written',
            wrote == [] and 'its words are a draft waiting on approval' in out)

        g = live_server()
        out = written(g, posts=True)
        live = [s['name'] for _c, ss in B.PLAN for s in ss
                if s.get('post') and s['key'] not in B.C.DRAFTS]
        yes('a whole -Posts run still writes every post that is not a draft (%d)' % len(live),
            sorted(w[0] for w in wrote) == sorted(live) and len(live) > 2)
    finally:
        B.post, B.keep_changelog = real_post, real_changelog

    # ---- 5. a name the plan does not have -------------------------------
    try:
        B.plan_for(['Gamemasters', 'gm-lounge'])
        bad = None
    except ValueError as e:
        bad = str(e)
    yes('a name the plan does not have is refused, naming it', bad is not None and 'gm-lounge' in bad)
    yes('a channel named alone is planned in its own category, by itself',
        B.plan_for(['welcome-travelers']) == [(c, [s for s in ss if s['name'] == 'welcome-travelers'])
                                               for c, ss in B.PLAN if any(s['name'] == 'welcome-travelers' for s in ss)])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
