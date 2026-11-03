"""
test-3317-seats.py

The seat rule and the open seats, on the ticket panel (#3317).

Patrick, 22 Oct 2026, 11:03 AM: "any Staff role can't also be a faction
leader which includes Jarl's (Jarls are faction leaders bt have a seperate
application on purprse because of hwo different the role is and importatn to
the server, also when Applying to be a jarl the application should give an
option to choose which Hold and only include the open seats)". He picked the
bot refusing it (page card q-3317-seat-rule-check, A). This proves:

  S1 the bot's staff roles, seats and faction short names are Build-Discord.py's,
     so a role the build makes is the role the bot reads
  S2 the Jarl form is a required pick of the open holds and four questions,
     five items, and a held seat is not offered
  S3 the Faction Leader form offers the open faction seats and Other
  S4 staff picking Jarl or Faction Leader are told no before the form opens,
     and again when it comes back; with every Jarl seat held, nobody is
  S5 a seat holder picking a staff application is told no; picking a
     playtest, report or help ticket is not
  S6 a STAFF_ROLES id counts as staff for the rule whatever the role is named
  S7 a seat filled after the form opened is flagged at the top of the ticket

The real bot module and Build-Discord.py are imported. Read only. Never
connects to anything.
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
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
for _k in ('TICKET_CHANNEL', 'TICKET_LOG', 'STAFF_ROLES', 'TICKET_COOLDOWN',
           'UPPER_STAFF_ROLES'):
    os.environ.pop(_k, None)

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


try:
    import discord  # noqa: F401
except ImportError:
    print('SKIP  discord.py is not installed here, so the bot cannot be imported')
    print('')
    print('0 passed, 0 failed')
    sys.exit(0)

import harness_bot  # noqa: E402

bot = harness_bot.whole()
spec = importlib.util.spec_from_file_location(
    'build_discord_seats', os.path.join(HERE, 'Build-Discord.py'))
B = importlib.util.module_from_spec(spec)
spec.loader.exec_module(B)

bot.log = lambda *a: None
bot.KEY = ''


async def _push(*a):
    return None


bot.push_async = _push
bot.OPEN_TICKETS = os.path.join(tempfile.mkdtemp(prefix='thornswood-seats-'),
                                'open-tickets.json')


class Role(object):
    def __init__(self, name, rid, members=()):
        self.name = name
        self.id = rid
        self.members = list(members)
        self.mention = '<@&%d>' % rid


class Person(object):
    def __init__(self, uid, name, roles=()):
        self.id = uid
        self.name = self.display_name = name
        self.mention = '<@%d>' % uid
        self.roles = list(roles)
        self.bot = False


class Perms(object):
    def __init__(self, everything):
        self.everything = everything

    def __getattr__(self, _name):
        return self.everything


class Thread(object):
    def __init__(self, tid, name):
        self.id = tid
        self.name = name
        self.mention = '<#%d>' % tid
        self.archived = False
        self.sent = []

    async def add_user(self, m):
        pass

    async def send(self, text=None, **kw):
        self.sent.append(text or '')

    def body(self):
        return '\n\n'.join(self.sent[1:])


class Channel(object):
    def __init__(self, name, guild):
        self.name = name
        self.guild = guild
        self.made = []

    def permissions_for(self, who):
        return Perms(who is self.guild.me)

    async def send(self, *a, **k):
        pass

    async def create_thread(self, name=None, **k):
        t = Thread(9000 + len(self.made), name)
        self.made.append(t)
        self.guild.threads[t.id] = t
        return t


class Guild(object):
    def __init__(self):
        self.id = 1
        self.name = 'Thornswood'
        self.me = Person(1, 'Thornswood')
        self.me.bot = True
        self.threads = {}
        self.roles = [Role('Moderator', 11)]
        self.text_channels = [Channel(bot.TICKETS[0], self)]

    def get_thread(self, tid):
        return self.threads.get(tid)

    def give(self, who, name, rid):
        r = next((r for r in self.roles if r.name == name), None)
        if r is None:
            r = Role(name, rid)
            self.roles.append(r)
        r.members.append(who)
        who.roles.append(r)
        return r


class Response(object):
    def __init__(self):
        self.said = []
        self.modal = None

    async def send_message(self, text, ephemeral=False, **k):
        self.said.append((text, ephemeral))

    async def send_modal(self, modal):
        self.modal = modal

    async def defer(self, **k):
        pass


class Followup(object):
    def __init__(self):
        self.said = []

    async def send(self, text, ephemeral=False, **k):
        self.said.append(text)


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        self.channel = guild.text_channels[0]
        self.response = Response()
        self.followup = Followup()


def pick(guild, who, kind):
    """Pick a kind off the real panel, as Discord would."""
    p = bot.TicketPicker()
    p._values = [kind]
    i = Interaction(guild, who)
    bot._last_ticket.clear()
    asyncio.run(p.callback(i))
    return i


def labels(sel):
    return [o.value for o in sel.options]


# ------------------------------------------------------------------ S1 --
yes('S1 the bot counts every staff role Build-Discord.py makes, and no other',
    sorted(bot.SEAT_RULE_STAFF) == sorted(B.STAFF))
yes('S1 the seats are the build\'s: each Jarl, then each faction leader',
    bot.seat_roles() == list(B.SEATS))
yes('S1 a faction\'s leader role is named the build\'s way',
    bot.FACTION_SHORT == B.FACTION_SHORT
    and [bot.faction_leader_role(f) for f in bot.faction_names()]
    == list(B.FACTION_LEADERS))

# ------------------------------------------------------------------ S2 --
G = Guild()
lab = dict((a, b) for a, b, _ in bot.KINDS)
form = bot.TicketModal('jarl', lab['jarl'], G)
yes('S2 the Jarl form is a required pick of every hold while none is held',
    form.hold_select is not None and form.hold_select.required is True
    and labels(form.hold_select) == list(bot.OFFICE_TOWNS))
yes('S2 then its four questions, five items in all',
    len(form.fields) == 4 and len(form.children) == 5
    and [q for q, _, _ in bot.QUESTIONS['jarl']][0] == 'Who is your character?')
balgruuf = Person(300, 'Balgruuf')
G.give(balgruuf, 'Jarl of Whiterun', 400)
form = bot.TicketModal('jarl', lab['jarl'], G)
yes('S2 a held Jarl seat is not offered',
    labels(form.hold_select) == [h for h in bot.OFFICE_TOWNS if h != 'Whiterun'])
G.give(Person(301, 'Nobody'), 'Jarl of Solitude', 401)
G.roles[-1].members = []
form = bot.TicketModal('jarl', lab['jarl'], G)
yes('S2 a seat whose role is there with nobody in it is open',
    'Solitude' in labels(form.hold_select))

# ------------------------------------------------------------------ S3 --
leader = Person(302, 'Ancano')
G.give(leader, 'Thalmor Leader', 402)
form = bot.TicketModal('faction', lab['faction'], G)
yes('S3 the Faction Leader form offers the open seats, then Other',
    labels(form.faction_select)
    == [f for f in bot.faction_names() if f != 'Thalmor Remnant'] + [bot.FACTION_OTHER])

# ------------------------------------------------------------------ S4 --
gm = Person(303, 'Gwen')
G.give(gm, 'Gamemaster', 403)
for kind in ('jarl', 'faction'):
    i = pick(G, gm, kind)
    yes('S4 a Gamemaster picking %s is told no before the form opens' % kind,
        i.response.modal is None and i.response.said
        and i.response.said[0][1] is True
        and 'You hold a staff role (Gamemaster)' in i.response.said[0][0])
support = Person(304, 'Sam')
G.give(support, 'Support', 404)
i = pick(G, support, 'jarl')
yes('S4 so is Support, which is staff for this rule',
    i.response.modal is None and 'Support' in i.response.said[0][0])
plain = Person(305, 'Ada')
i = pick(G, plain, 'jarl')
yes('S4 somebody with no staff role gets the form, with the open holds',
    i.response.modal is not None and not i.response.said
    and 'Whiterun' not in labels(i.response.modal.hold_select))
modal = i.response.modal
gm_back = bot.TicketModal('jarl', lab['jarl'], G)
gm_back.hold_select._values = ['Riften']
i = Interaction(G, gm)
asyncio.run(gm_back.on_submit(i))
yes('S4 and a form a Gamemaster sends back anyway is refused, no ticket made',
    not G.text_channels[0].made and i.response.said
    and 'You hold a staff role' in i.response.said[0][0])
for h in bot.OFFICE_TOWNS:
    G.give(Person(500 + len(G.roles), 'J'), 'Jarl of ' + h, 600 + len(G.roles))
i = pick(G, plain, 'jarl')
yes('S4 with every Jarl seat held, Apply: Jarl says so and opens nothing',
    i.response.modal is None and i.response.said[0][0] == bot.NO_OPEN_HOLD)
for r in G.roles:
    if r.name.startswith('Jarl of ') and r.name != 'Jarl of Whiterun':
        r.members = []

# ------------------------------------------------------------------ S5 --
for kind in bot.STAFF_JOB_KINDS:
    i = pick(G, balgruuf, kind)
    yes('S5 the Jarl of Whiterun picking %s is told no' % kind,
        i.response.modal is None
        and 'You hold Jarl of Whiterun' in i.response.said[0][0])
i = pick(G, leader, 'dev')
yes('S5 so is a faction leader', 'You hold Thalmor Leader' in i.response.said[0][0])
for kind in ('report', 'help'):
    i = pick(G, balgruuf, kind)
    yes('S5 a seat holder still opens a %s ticket' % kind,
        i.response.modal is not None and not i.response.said)

# ------------------------------------------------------------------ S6 --
was = set(bot.STAFF_IDS)
bot.STAFF_IDS.add(777)
odd = Person(306, 'Odd', [Role('Renamed Rank', 777)])
i = pick(G, odd, 'faction')
yes('S6 a STAFF_ROLES id counts whatever the role is called',
    i.response.modal is None and 'Renamed Rank' in i.response.said[0][0])
bot.STAFF_IDS.clear()
bot.STAFF_IDS.update(was)

# ------------------------------------------------------------------ S7 --
modal.hold_select._values = ['Riften']
for f in modal.fields:
    f._value = 'In character.'
G.give(Person(307, 'Laila'), 'Jarl of Riften', 405)
i = Interaction(G, plain)
bot._last_ticket.clear()
asyncio.run(modal.on_submit(i))
made = G.text_channels[0].made
yes('S7 a hold filled after the form opened still makes the ticket, flagged at the top',
    len(made) == 1
    and made[0].body().startswith('**CHECK THIS ONE.** The hold they picked has a Jarl now.')
    and '**Which hold?**\nRiften' in made[0].body())

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
