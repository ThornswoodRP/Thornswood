"""
test-rules-gate.py

React to the rules, get Member (#5841).

Patrick, 12 Nov 2026 (page cards q-discord-hand-given-member and
q-discord-readback, A): reacting to the rules gives Member, and the reaction
is the record that somebody accepts the rules and is 18 or over. No button.
Taking the reaction off takes Member off. The Members given by hand, who
never answered anything, lose it and get it back by reacting. Staff and
Playtesters too, and only Member comes off them (Patrick, 12 Nov, 3:32 PM). The live audit of 12 Nov found 20 Members, every one given by
hand, and nothing in the bot that gave Member.

So this checks:

  W  it is part of the bot: bot.py loads it, the bot asks Discord for
     reaction events, its start puts the message up in every server, and the
     build's -Posts run never deletes the message, by the same first line
  P  its start in a #rules with no message of its own posts one, reacts to
     it so there is something to press, takes Member from every Member who
     has not reacted, staff included and nothing else of theirs, gives it to
     whoever has, and records each on the site
  A  a second start finds the same message and changes nothing; old words on
     it are edited to the new ones in place, reactions and all
  R  a reaction on it gives Member and records a yes; one on another message,
     with another emoji, or by the bot itself does nothing
  U  taking the reaction off takes Member off and records a no; a
     staff member loses Member as well, and keeps their own role
  F  with no Member role, or the bot's own role under it, nothing is given or
     taken and the log says why; a failure reading #rules leaves Member as it
     is

bot.py is imported for real. Every guild, member and message is a stand-in.
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
import importlib.util
import itertools
import types

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('RULES_CHANNEL', 'MEMBER_ROLE', 'STAFF_ROLES'):
    os.environ.pop(_k, None)

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
G = sys.modules['bot_rules_gate']
MARK = G.MARK
_ids = itertools.count(7000)

SAID = []
PUSHED = []
G.log = lambda *a: SAID.append(' '.join(str(x) for x in a))


async def _push(*a):
    PUSHED.append(a)
G.push_async = _push


class Role(object):
    def __init__(self, name, position):
        self.id = next(_ids)
        self.name = name
        self.position = position

    def __lt__(self, other):
        return self.position < other.position

    def __repr__(self):
        return '<role %s>' % self.name


class Person(object):
    def __init__(self, name, roles=(), bot=False):
        self.id = next(_ids)
        self.name = self.display_name = name
        self.roles = list(roles)
        self.bot = bot

    async def add_roles(self, role, reason=None):
        self.roles.append(role)

    async def remove_roles(self, role, reason=None):
        self.roles.remove(role)


class Reaction(object):
    def __init__(self, emoji, users, me=False):
        self.emoji = emoji
        self._users = users
        self.me = me

    def users(self):
        users = list(self._users)

        async def walk():
            for u in users:
                yield u
        return walk()


class Message(object):
    def __init__(self, author, content, ch):
        self.id = next(_ids)
        self.author = author
        self.content = content
        self.channel = ch
        self.reactions = []
        self.type = discord.MessageType.default
        self.edits = 0

    async def edit(self, content=None):
        self.content = content
        self.edits += 1

    async def add_reaction(self, emoji):
        for r in self.reactions:
            if r.emoji == emoji:
                r.me = True
                r._users.append(ME)
                return
        self.reactions.append(Reaction(emoji, [ME], me=True))

    def react(self, who, emoji=MARK):
        for r in self.reactions:
            if r.emoji == emoji:
                r._users.append(who)
                return
        self.reactions.append(Reaction(emoji, [who]))


class Channel(object):
    def __init__(self, name, broken=False):
        self.id = next(_ids)
        self.name = name
        self.messages = []
        self.broken = broken

    async def send(self, text):
        m = Message(ME, text, self)
        self.messages.append(m)
        return m

    def history(self, limit=100):
        if self.broken:
            raise discord.HTTPException(types.SimpleNamespace(status=500, reason='x'), 'no')
        msgs = list(reversed(self.messages))[:limit]

        async def walk():
            for m in msgs:
                yield m
        return walk()


ME = Person('Thornswood', bot=True)


def server(bot_above=True, member_role=True, broken=False):
    g = types.SimpleNamespace(id=next(_ids), name='Thornswood')
    g.member = Role('Member', 5) if member_role else None
    g.tester = Role('Playtester', 6)
    g.support = Role('Support', 8)
    top = Role('Thornswood bot', 10 if bot_above else 3)
    g.roles = [r for r in (g.member, g.tester, g.support, top) if r is not None]
    g.me = types.SimpleNamespace(id=ME.id, top_role=top,
                                 guild_permissions=types.SimpleNamespace(manage_roles=True))
    g.rules = Channel('rules', broken=broken)
    g.text_channels = [g.rules]
    m = [g.member] if g.member else []
    g.hand = Person('Hand Given', m)
    g.reacted = Person('Reacted Early')
    g.tester_p = Person('A Playtester', m + [g.tester])
    g.staff_p = Person('A Supporter', m + [g.support])
    g.nobody = Person('Nobody Yet')
    g.members = [ME, g.hand, g.reacted, g.tester_p, g.staff_p, g.nobody]
    g.get_member = lambda uid: next((p for p in g.members if p.id == uid), None)
    return g


SERVERS = {}
G.client = types.SimpleNamespace(user=ME, get_guild=lambda gid: SERVERS.get(gid))


def run(coro):
    return asyncio.run(coro)


def has(who, g):
    return g.member in who.roles


def pushed_for(who):
    return [p for p in PUSHED if p[4] == who.id]


def payload(g, who, msg=None, emoji=MARK):
    return types.SimpleNamespace(guild_id=g.id, user_id=who.id,
                                 message_id=(msg or g.gate).id, emoji=emoji,
                                 member=who)


# ------------------------------------------------------------------- W --
src = dict((n, open(os.path.join(HERE, n), encoding='utf-8').read())
           for n in ('bot.py', 'bot_core.py', 'bot_ready.py'))
yes('W bot.py loads it', 'import bot_rules_gate' in src['bot.py'])
yes('W the bot asks Discord for reaction events',
    bot.client.intents.guild_reactions and bot.client.intents.members)
yes('W its start puts the message up in every server',
    'await ensure_rules_gate(g)' in src['bot_ready.py'])
yes('W the reaction handlers on the running client are its own',
    getattr(bot.client, 'on_raw_reaction_add', None) is G.on_raw_reaction_add
    and getattr(bot.client, 'on_raw_reaction_remove', None) is G.on_raw_reaction_remove)
spec = importlib.util.spec_from_file_location(
    'build_discord_rules_gate', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)
yes('W the build knows the message by the same first line',
    B.RULES_GATE_FIRST_LINE == G.GATE_FIRST_LINE and G.GATE_TEXT.startswith(G.GATE_FIRST_LINE))
ch = Channel('rules')
gate_msg = Message(ME, G.GATE_TEXT, ch)
rules_msg = Message(ME, '# Rules\n\nSeven, because nobody reads twenty.', ch)
yes('W -Posts never deletes the message people react to, and still replaces '
    'the rules\' own words',
    not B.doc_post_of_mine(gate_msg, ME.id) and B.doc_post_of_mine(rules_msg, ME.id))
content = sys.modules.get('content')
if content is None:
    import content  # noqa: E402
yes('W #rules tells people which message to react to',
    G.GATE_FIRST_LINE.strip('*') in ' '.join(content.RULES.split()))
yes('W every staff role counts as staff for the ping buttons, the same list as the build\'s staff',
    sorted(G.EVERY_STAFF_NAMES) == sorted(n.lower() for n in B.STAFF))
yes('W the message says 18 or over, the rules, Member and the record',
    all(w in G.GATE_TEXT for w in ('18 or over', 'accept the rules', 'Member role',
                                   'the record', MARK)))

# ------------------------------------------------------------------- P --
g = server()
SERVERS[g.id] = g
# Somebody reacted while there was a message, before this start: put one up
# by hand first, the way an earlier start would have left it.
early = Message(ME, G.GATE_TEXT, g.rules)
g.rules.messages.append(early)
early.react(g.reacted)
early.react(g.tester_p)
early.react(g.hand, emoji='\N{THUMBS UP SIGN}')
del SAID[:]
del PUSHED[:]
run(G.ensure_rules_gate(g))
g.gate = early
yes('P it finds its message and posts no second one', len(g.rules.messages) == 1
    and G.GATE_IDS.get(g.id) == early.id)
yes('P it reacts to its own message with the mark, so there is something to press',
    any(r.emoji == MARK and r.me for r in early.reactions))
yes('P whoever reacted gets Member', has(g.reacted, g))
yes('  and it is recorded on the site as a yes against their Discord id',
    [(p[0], p[5]['yes']) for p in pushed_for(g.reacted)] == [('member', True)])
yes('P the hand-given Member who has not reacted with the mark loses Member '
    '(a thumbs up is not the mark)', not has(g.hand, g))
yes('  and it is recorded as a no, with a staff inbox line saying why',
    [(p[0], p[5]['yes']) for p in pushed_for(g.hand)] == [('member', False)]
    and 'Reacting there gives it back' in pushed_for(g.hand)[0][2])
yes('P the Playtester who reacted keeps Member, and nothing is recorded for them',
    has(g.tester_p, g) and not pushed_for(g.tester_p))
yes('P staff who have not reacted lose Member and keep their staff role',
    not has(g.staff_p, g) and g.support in g.staff_p.roles)
yes('P somebody with no role and no reaction is left alone',
    g.nobody.roles == [] and not pushed_for(g.nobody))
yes('P the bot never gives itself anything', ME.roles == [])
yes('P the log says the counts',
    any('2 reacted' in s and '1 given Member' in s and '2 without a reaction' in s
        for s in SAID))

g2 = server()
SERVERS[g2.id] = g2
run(G.ensure_rules_gate(g2))
yes('P in a #rules with no message of its own it posts one and reacts to it',
    len(g2.rules.messages) == 1 and g2.rules.messages[0].content == G.GATE_TEXT
    and any(r.emoji == MARK and r.me for r in g2.rules.messages[0].reactions)
    and G.GATE_IDS.get(g2.id) == g2.rules.messages[0].id)
yes('  and every Member who has not reacted loses it, staff and Playtesters too',
    not has(g2.hand, g2) and not has(g2.tester_p, g2) and not has(g2.staff_p, g2))

# ------------------------------------------------------------------- A --
del PUSHED[:]
before = [list(p.roles) for p in g.members]
run(G.ensure_rules_gate(g))
yes('A a second start finds the same message, posts, edits and reacts nothing more',
    len(g.rules.messages) == 1 and early.edits == 0
    and len([r for r in early.reactions if r.emoji == MARK]) == 1
    and sum(1 for u in early.reactions[0]._users if u is ME) == 1)
yes('  and changes nobody\'s roles and records nothing',
    [list(p.roles) for p in g.members] == before and not PUSHED)
old = Message(ME, G.GATE_FIRST_LINE + '\n\nOlder words.', g2.rules)
g3 = server()
SERVERS[g3.id] = g3
g3.rules.messages.append(old)
old.react(g3.hand)
run(G.ensure_rules_gate(g3))
yes('A old words on its message are edited to the new ones in place, and the '
    'reactions on it still count',
    old.content == G.GATE_TEXT and old.edits == 1 and len(g3.rules.messages) == 1
    and has(g3.hand, g3))

# ------------------------------------------------------------------- R --
del PUSHED[:]
run(G.on_raw_reaction_add(payload(g, g.nobody)))
yes('R a reaction with the mark on its message gives Member', has(g.nobody, g))
yes('  and records a yes that says 18 or over',
    [(p[0], p[5]['yes']) for p in pushed_for(g.nobody)] == [('member', True)]
    and '18 or over' in pushed_for(g.nobody)[0][5]['said'])
run(G.on_raw_reaction_add(payload(g, g.nobody)))
yes('R a second reaction event changes and records nothing more',
    g.nobody.roles.count(g.member) == 1 and len(pushed_for(g.nobody)) == 1)
del PUSHED[:]
other = Message(ME, 'Something else', g.rules)
p = Person('Somebody Else')
g.members.append(p)
run(G.on_raw_reaction_add(payload(g, p, msg=other)))
run(G.on_raw_reaction_add(payload(g, p, emoji='\N{THUMBS UP SIGN}')))
run(G.on_raw_reaction_add(payload(g, ME)))
yes('R a reaction on another message, another emoji, or the bot\'s own does nothing',
    p.roles == [] and ME.roles == [] and not PUSHED)

# ------------------------------------------------------------------- U --
del PUSHED[:]
run(G.on_raw_reaction_remove(payload(g, g.nobody)))
yes('U taking the reaction off takes Member off', not has(g.nobody, g))
yes('  and records a no', [(p[0], p[5]['yes']) for p in pushed_for(g.nobody)]
    == [('member', False)])
run(G.on_raw_reaction_add(payload(g, g.staff_p)))
yes('U staff who react get Member back', has(g.staff_p, g))
del PUSHED[:]
run(G.on_raw_reaction_remove(payload(g, g.staff_p)))
yes('U staff who take it off lose Member and only Member, and the no is recorded',
    not has(g.staff_p, g) and g.support in g.staff_p.roles
    and [p[5]['yes'] for p in pushed_for(g.staff_p)] == [False])

# ------------------------------------------------------------------- F --
for what, kw in (('no Member role', dict(member_role=False)),
                  ('the bot\'s own role under Member', dict(bot_above=False))):
    gf = server(**kw)
    SERVERS[gf.id] = gf
    before = [list(x.roles) for x in gf.members]
    del SAID[:]
    del PUSHED[:]
    run(G.ensure_rules_gate(gf))
    gf.gate = gf.rules.messages[0]
    run(G.on_raw_reaction_add(payload(gf, gf.nobody)))
    yes('F with %s nothing is given or taken' % what,
        [list(x.roles) for x in gf.members] == before)
    yes('  and the log says why', any('Member' in s and ('no Member' in s or 'no ' in s
                                                        or 'cannot' in s) for s in SAID))
gb = server(broken=True)
SERVERS[gb.id] = gb
del SAID[:]
run(G.ensure_rules_gate(gb))
yes('F a failure reading #rules leaves Member as it is, and says so',
    has(gb.hand, gb) and any('left as it is' in s for s in SAID))
gn = server()
gn.text_channels = []
del SAID[:]
run(G.ensure_rules_gate(gn))
yes('F with no #rules it says which setting to change and changes nothing',
    has(gn.hand, gn) and any('RULES_CHANNEL' in s for s in SAID))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
