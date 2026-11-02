"""
test-gm-channels.py

The Gamemasters category is the gamemasters' space.

Djinn's layout of 15 Oct 2026, confirmed by him on 17 Oct (#2519): the
gamemaster ranks and Moderator, @everyone denied, nothing public. Since #3317
(Patrick, 22 Oct) it is one of the staff spaces, the same shape as the others:
the council (Owner, Co-Owner and every lead) sees every space, an
announcements channel the gamemasters read and the council posts in, and
#gm-rules read only but for Lead Gamemaster, Owner and Co-Owner. Loremasters
read #gm-announcements, #gm-event-plans and #gm-scene-summaries, so a scene
stays inside the lore.

Holds:

  G1 Build-Discord.py has a Gamemasters category with #gm-announcements,
     #gm-rules, #gm-event-plans, #gm-scene-summaries, #gm-chat,
     #gm-suggestions, #gm-discipline and GM Voice, in that order, and the old
     #gm only as make=False; Djinn's channels are all in KEEP
  G2 every channel in it is a Gamemasters space mode, nothing public, open,
     read or membersread sits in it, and no other category uses that space
  G3 the category itself is gated as the Gamemasters space
  G4 @everyone cannot see a channel of the space
  G5 the space lets the gamemaster ranks, Moderator and the council see,
     talk and read back
  G6 it grants nothing to Member, Playtester, Dev or the other ranks
  G7 the only other entry is the bot itself, so it keeps the channels
     without Administrator
  G8 a gamemaster role that is not on the server is passed over rather than
     stopping the build
  G9 #gm-rules: the ranks read and cannot post, start threads or post in
     them; Lead Gamemaster, Owner and Co-Owner post; the rest get nothing
  G10 Loremasters read the three channels named for them and talk in none

Build-Discord.py is imported for real, under another name, so its __main__
block never runs. Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import importlib.util
import types


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

spec = importlib.util.spec_from_file_location(
    'build_discord_gm', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


class Role(object):
    def __init__(self, name, rid):
        self.name = name
        self.id = rid

    def __repr__(self):
        return '<role %s>' % self.name


def server(names):
    everyone = Role('@everyone', 1)
    rs = [everyone] + [Role(n, 10 + i) for i, n in enumerate(names)]
    bot = Role('Thornswood Bot', 999)
    guild = types.SimpleNamespace(default_role=everyone, me=bot, roles=rs)
    return guild, dict((r.name, r) for r in rs)


def granted(ow, role):
    o = ow.get(role)
    return o is not None and o.view_channel is True


# ------------------------------------------------------------------ G1 --
plan = dict(B.PLAN)
gm = plan.get('Gamemasters')
yes('G1 Build-Discord.py has a Gamemasters category', gm is not None)
gm = gm or []
made = [s for s in gm if s.get('make', True)]
want = [('text', 'gm-announcements'), ('text', 'gm-rules'), ('text', 'gm-event-plans'),
        ('text', 'gm-scene-summaries'), ('text', 'gm-chat'), ('text', 'gm-suggestions'),
        ('text', 'gm-discipline'), ('voice', 'GM Voice')]
yes('G1 it makes the eight channels of the space, in order (got %r)'
    % [(s['kind'], s['name']) for s in made],
    [(s['kind'], s['name']) for s in made] == want)
yes('G1 the 14 Oct #gm is named only so prune leaves it, never made',
    [(s['name'], s.get('make', True)) for s in gm if not s.get('make', True)] == [('gm', False)])
DJINN = ('gm-rules', 'gm-scene-summaries', 'gm-chat', 'gm-suggestions',
         'gm-discipline', 'gm voice', 'gm')
yes("G1 every one of Djinn's channels is in KEEP",
    all(n in B.KEEP for n in DJINN))

# ------------------------------------------------------------------ G2 --
SPACE_MODES = ('space', 'spaceread', 'spacerules')
yes('G2 every channel in Gamemasters is a Gamemasters space mode, and #gm-rules is its rules',
    bool(gm) and all(s.get('mode') in SPACE_MODES and s.get('space') == 'Gamemasters'
                     for s in gm)
    and [s['name'] for s in gm if s.get('mode') == 'spacerules'] == ['gm-rules'])
yes('G2 nothing public, open, read or membersread is in Gamemasters',
    not any(s.get('mode', 'open') in ('public', 'open', 'read', 'membersread')
            for s in gm))
yes('G2 no other category uses the Gamemasters space',
    not any(s.get('space') == 'Gamemasters'
            for cat, specs in B.PLAN if cat != 'Gamemasters' for s in specs))

# ------------------------------------------------------------------ G3 --
yes('G3 the Gamemasters category is gated as its space',
    B.category_mode('Gamemasters') == ('space', 'Gamemasters'))

# ------------------------------------------------------------- G4 to G7 --
COUNCIL = list(B.COUNCIL_ROLES)
RANKS = ['Gamemaster', 'Trial Gamemaster', 'Moderator']
NAMES = COUNCIL + ['Dev', 'Gamemaster', 'Loremaster', 'Trial Gamemaster',
                   'Moderator', 'Content Creator', 'Support', 'Playtester', 'Member']
guild, roles = server(NAMES)
ow = B.overwrites(guild, 'space', roles, space='Gamemasters')

ev = ow.get(guild.default_role)
yes('G4 @everyone cannot see a channel of the space',
    ev is not None and ev.view_channel is False)

for n in RANKS + COUNCIL:
    o = ow.get(roles[n])
    yes('G5 %s sees, talks and reads back' % n,
        o is not None and o.view_channel is True and o.send_messages is True
        and o.read_message_history is True)

for n in ('Member', 'Playtester', 'Dev', 'Loremaster', 'Content Creator', 'Support'):
    yes('G6 %s is granted nothing in a channel of the space' % n, roles[n] not in ow)

others = [k for k in ow if k is not guild.default_role
          and getattr(k, 'name', None) not in RANKS + COUNCIL]
yes('G7 the only other entry is the bot itself (got %r)' % others,
    others == [guild.me] and granted(ow, guild.me))

# ------------------------------------------------------------------ G8 --
guild2, roles2 = server(['Lead Gamemaster', 'Gamemaster'])
ow2 = B.overwrites(guild2, 'space', roles2, space='Gamemasters')
yes('G8 Trial Gamemaster missing from the server is passed over, not fatal',
    granted(ow2, roles2['Gamemaster']) and granted(ow2, roles2['Lead Gamemaster'])
    and not any(getattr(k, 'name', '') == 'Trial Gamemaster' for k in ow2))

# ------------------------------------------------------------------ G9 --
rw = B.overwrites(guild, 'spacerules', roles, space='Gamemasters')
e9 = rw.get(guild.default_role)
yes('G4 @everyone cannot see #gm-rules', e9 is not None and e9.view_channel is False)
for n in RANKS + [c for c in COUNCIL if c not in ('Owner', 'Co-Owner', 'Lead Gamemaster')]:
    o = rw.get(roles[n])
    yes('G9 %s reads #gm-rules and cannot post, start a thread or post in one' % n,
        o is not None and o.view_channel is True and o.read_message_history is True
        and o.send_messages is False and o.create_public_threads is False
        and o.send_messages_in_threads is False)
for n in ('Lead Gamemaster', 'Owner', 'Co-Owner'):
    o = rw.get(roles[n])
    yes('G9 %s posts in #gm-rules' % n,
        o is not None and o.view_channel is True and o.send_messages is True)
for n in ('Member', 'Loremaster', 'Playtester', 'Dev'):
    yes('G9 %s is granted nothing in #gm-rules' % n, roles[n] not in rw)
yes('G9 the bot is named in #gm-rules', granted(rw, guild.me))

# ----------------------------------------------------------------- G10 --
lore = dict((s['name'], s) for s in gm)
for name in ('gm-announcements', 'gm-event-plans', 'gm-scene-summaries'):
    o = B.spec_overwrites(guild, lore[name], roles).get(roles['Loremaster'])
    yes('G10 a Loremaster reads #%s and cannot post there' % name,
        o is not None and o.view_channel is True and o.send_messages is False)
yes('G10 and is in no other channel of the space',
    all(roles['Loremaster'] not in B.spec_overwrites(guild, s, roles) for s in gm
        if s['name'] not in ('gm-announcements', 'gm-event-plans', 'gm-scene-summaries')))

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
