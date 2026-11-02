"""
test-3317-factions.py

The sixteen factions in Discord (#3317).

Patrick, 22 Oct 2026, on the page: 16 factions (q-3317-faction-roster, B),
each with a member role and a Leader role (q-3317-faction-roles, A), the
Leader giving the member role (q-3317-faction-member-give, A), and every
faction's 4E 252 entry in lore/factions.md, which he approved the same day.
Later that day: "Factions are supposed to have their own invidual categories
like the holds", with "their own announcements, vcs, faction leaderships
channels", and its own seats channel with the Leader's buttons
(q-3317-faction-category, C: "One Officer role, not Court and Steward", in a
channel "called leadership since it's not a court"). This proves:

  F1 factions.json is the sixteen, and each has a member role (its short
     name), a Leader role and an Officer role, the Leader a seat and the
     rest not, and none of them ever deleted
  F2 the Trading Company role is renamed to the company's member role, so
     everybody holding it keeps it; Business Owner is in the plan
  F3 a category per faction, named after it, in the order of factions.json,
     after In Character and before the holds: announcements, chat,
     leadership, seats, voice; the chat and voice moved from Factions by name; Factions
     and #seats retired
  F4 a faction's chat and voice: its members, Leader and Officers
     talk; another faction's people, a Playtester, a Moderator and a Jarl get
     nothing; FACTION_STAFF talks; @everyone sees none
  F5 announcements: members read, the Leader, Officers and council post;
     leadership: the Leader and Officers talk, members do not; seats: the
     Leader and FACTION_STAFF read, members and Officers see nothing
  F6 lore/factions.md has an entry for every faction, by its short name

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
import json
import types


PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


SIXTEEN = ['Imperial Embassy', 'Thalmor Remnant', 'Free Skyrim Trading Company',
           'The Companions', 'College of Winterhold', 'Bards College',
           'Thieves Guild', 'Dark Brotherhood', 'Vigilants of Stendarr',
           'Dawnguard', 'Silver Hand', 'Forsworn', 'Orc Strongholds',
           'Khajiit Caravans', 'Blades', 'Volkihar Clan']

with open(os.path.join(HERE, 'factions.json'), encoding='utf-8') as f:
    yes('F1 factions.json is the sixteen of lore/factions.md, in its order',
        json.load(f) == SIXTEEN)

with open(os.path.join(HERE, '..', 'lore', 'factions.md'), encoding='utf-8') as f:
    lore = f.read()

try:
    import discord  # noqa: F401
except ImportError:
    print('SKIP  discord.py is not installed here, so the builder cannot be imported')
    print('')
    print('%d passed, %d failed' % (len(PASS), len(FAIL)))
    sys.exit(1 if FAIL else 0)

spec = importlib.util.spec_from_file_location(
    'build_discord_factions', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)


class Role(object):
    def __init__(self, name, rid):
        self.name = name
        self.id = rid

    def __repr__(self):
        return '<role %s>' % self.name


everyone = Role('@everyone', 1)
rs = [everyone] + [Role(n, 10 + i) for i, (n, _, _, _) in enumerate(B.ROLES)]
guild = types.SimpleNamespace(default_role=everyone, me=Role('Thornswood Bot', 999), roles=rs)
roles = dict((r.name, r) for r in rs)
plan = dict(B.PLAN)


def can(ow, name):
    """'talk', 'read' or None for a role in a set of overwrites."""
    o = ow.get(roles[name])
    if o is None or o.view_channel is not True:
        return None
    return 'talk' if o.send_messages is not False else 'read'


# ------------------------------------------------------------------ F1 --
names = [n for n, _, _, _ in B.ROLES]
hoist = dict((n, h) for n, _, h, _ in B.ROLES)
yes('F1 every faction has its member role, by its short name',
    list(B.FACTION_MEMBERS) == [B.FACTION_SHORT.get(f, f) for f in SIXTEEN]
    and all(m in names for m in B.FACTION_MEMBERS))
yes('F1 every faction has its Leader role, a seat, shown on its own',
    all(n in names and n in B.SEATS and hoist[n] for n in B.FACTION_LEADERS)
    and len(B.FACTION_LEADERS) == 16)
yes('F1 a member role is no seat and not shown on its own',
    not any(m in B.SEATS or hoist[m] for m in B.FACTION_MEMBERS))
yes('F1 the short names are the two the application always used',
    B.FACTION_MEMBERS[1] == 'Thalmor' and B.FACTION_MEMBERS[3] == 'Companions')
offices = [m + ' Officer' for m in B.FACTION_MEMBERS]
yes('F1 every faction has one Officer role: "Companions Officer", and no Court or Steward',
    all(n in names for n in offices) and B.FACTION_OFFICE_ROLES == offices
    and len(offices) == 16
    and not any(n.endswith(' Court') or n.startswith('Steward of ')
                for n in names if n not in B.OFFICE_ROLES)
    and B.faction_roles('The Companions') == ('Companions Leader', 'Companions Officer',
                                               'Companions'))
yes('F1 an Officer is no seat, not shown on its own, and sits under the members',
    not any(n in B.SEATS or hoist[n] for n in offices)
    and min(names.index(n) for n in offices) > max(names.index(m) for m in B.FACTION_MEMBERS))
yes('F1 no faction role is a hold\'s: no faction is named like a hold',
    not set(B.FACTION_OFFICE_ROLES) & set(B.OFFICE_ROLES)
    and not set(B.FACTION_MEMBERS) & set(B.HOLDS))
yes('F1 every faction role is in the never-deleted list',
    all(n in B.KEEP for n in offices + list(B.FACTION_MEMBERS) + list(B.FACTION_LEADERS)))

# ------------------------------------------------------------------ F2 --
yes('F2 Trading Company is renamed to Free Skyrim Trading Company, never made twice',
    B.ROLE_WAS.get('Free Skyrim Trading Company') == ('Trading Company',)
    and 'Trading Company' not in names)
yes('F2 Business Owner is in the plan, with nothing of its own',
    'Business Owner' in names
    and dict((n, p) for n, _, _, p in B.ROLES)['Business Owner'].value == 0)

# ------------------------------------------------------------------ F3 --
cats = [c for c, _ in B.PLAN]
i = cats.index('In Character')
yes('F3 a category per faction, in the order of factions.json, after In Character and before the first hold',
    cats[i + 1:i + 1 + len(SIXTEEN)] == SIXTEEN
    and cats.index(B.HOLDS[0]) == i + 1 + len(SIXTEEN))
yes('F3 the Factions category and #seats are retired, and planned nowhere',
    'Factions' not in cats and 'Factions' in B.RETIRED_CATEGORIES
    and 'seats' in B.RETIRED and 'Factions' not in B.CATEGORY_MODE
    and not any(s['name'] == 'seats' for _, specs in B.PLAN for s in specs))
bad = []
for f in SIXTEEN:
    slug = B.faction_slug(f)
    got = [(s['kind'], s['name'], s.get('mode'), s.get('faction'), s.get('was'))
           for s in plan[f]]
    want = [('text', slug + '-announcements', 'factionread', f, None),
            ('text', slug, 'faction', f, (('Factions', slug),)),
            ('text', slug + '-leadership', 'factionlead', f, None),
            ('text', slug + '-seats', 'factionseats', f, None),
            ('voice', f, 'faction', f, (('Factions', f),))]
    if got != want:
        bad.append(f)
yes('F3 each: announcements, chat, leadership, seats, voice; the chat and voice moved from Factions by name'
    + (': not ' + ', '.join(bad) if bad else ''), not bad)
yes('F3 the channel names are plain: #companions, #free-skyrim-trading-company',
    B.faction_slug('The Companions') == 'companions'
    and B.faction_slug('Free Skyrim Trading Company') == 'free-skyrim-trading-company')

# ------------------------------------------------------------------ F4 --
places = dict((s['name'], B.spec_overwrites(guild, s, roles)) for s in plan['The Companions'])
comp = places['companions']
voice = places['The Companions']
yes('F4 #companions and its voice: the members, Leader and Officers talk',
    all(can(ow, n) == 'talk' for ow in (comp, voice)
        for n in ('Companions', 'Companions Leader', 'Companions Officer')))
yes('F4 #companions: the Silver Hand, its Leader, its Officers and a Thalmor get nothing',
    can(comp, 'Silver Hand') is None and can(comp, 'Silver Hand Leader') is None
    and can(comp, 'Silver Hand Officer') is None and can(comp, 'Thalmor') is None)
yes('F4 #companions: the council, the gamemasters and the Loremasters talk',
    all(can(comp, n) == 'talk' for n in B.FACTION_STAFF)
    and 'Loremaster' in B.FACTION_STAFF and 'Trial Gamemaster' in B.FACTION_STAFF)
yes('F4 #companions: a Playtester, a Moderator and a Jarl get nothing',
    can(comp, 'Playtester') is None and can(comp, 'Moderator') is None
    and can(comp, 'Jarl of Whiterun') is None)
yes('F4 @everyone sees none of a faction\'s channels',
    all(ow[everyone].view_channel is False for ow in places.values()))
cow = B.category_overwrites(guild, 'The Companions', roles)
yes('F4 the category is gated as its faction: its people and FACTION_STAFF, @everyone out',
    B.category_mode('The Companions') == ('faction', None)
    and all(can(cow, n) == 'talk' for n in B.FACTION_STAFF + ('Companions',))
    and can(cow, 'Thalmor') is None and cow[everyone].view_channel is False)

# ------------------------------------------------------------------ F5 --
ann = places['companions-announcements']
yes('F5 #companions-announcements: the members read, and do not post',
    can(ann, 'Companions') == 'read')
yes('F5 #companions-announcements: the Leader, Officers and council post',
    all(can(ann, n) == 'talk' and ann[roles[n]].manage_messages is True
        for n in ('Companions Leader', 'Companions Officer') + B.COUNCIL_ROLES))
yes('F5 #companions-announcements: another faction gets nothing',
    can(ann, 'Thalmor') is None and can(ann, 'Thalmor Leader') is None)
lead = places['companions-leadership']
yes('F5 #companions-leadership: the Leader and Officers talk, the members see nothing',
    all(can(lead, n) == 'talk' for n in ('Companions Leader', 'Companions Officer'))
    and can(lead, 'Companions') is None and can(lead, 'Thalmor Officer') is None)
seats = places['companions-seats']
yes('F5 #companions-seats: the Leader and FACTION_STAFF see the panel',
    all(can(seats, n) is not None for n in ('Companions Leader',) + B.FACTION_STAFF))
yes('F5 #companions-seats: the members, Officers and other Leaders see nothing',
    all(can(seats, n) is None for n in ('Companions', 'Companions Officer',
                                         'Thalmor Leader')))
yes('F5 #companions-seats: the Leader reads and does not talk; the buttons need no more',
    can(seats, 'Companions Leader') == 'read')

# ------------------------------------------------------------------ F6 --
missing = [m for m in B.FACTION_MEMBERS if m not in lore]
yes('F6 lore/factions.md has every faction' + (': missing ' + ', '.join(missing) if missing else ''),
    not missing)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
