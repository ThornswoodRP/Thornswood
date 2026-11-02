"""
test-ticket-fallback.py

When a private thread will not open, the ticket goes to a channel only staff
can read, and never into a channel everybody can.

From the To Do List, entry 154: "When a private thread cannot open, reports
and applications are posted into the public channel", and "A reported member
reading the report in the channel is a safety problem, not a formatting one."

The fallback used to post the whole ticket into the channel the panel lives
in, which the whole server can read. The obvious fix, posting it into the log
channel instead, was broken too: TICKET_LOG's first name is tickets, and until
24 September Build-Discord.py's PLAN made a #tickets with mode='open'. The PLAN
now makes #tickets staff only, but it never changes a channel that is already
there, so the log channel is checked by its permissions, not trusted by its
name.

The real bot module is imported and the real coroutines are run: on_submit,
log_channel and ensure_panel. Only what touches Discord is replaced, by stub
guilds, channels, roles and people, and the thread creation always raises.
The site push is replaced by a counter. One scenario loads Build-Discord.py
too, without running it, to build #tickets from the PLAN's own roles and
overwrites. The one open ticket file is pointed at a scratch folder, so the
real one beside bot.py is never read or written.

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
import itertools
import tempfile

# bot.py refuses to load without one, and never uses it unless client.run is
# called, which nothing here does.
os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')
# The defaults are what is being tested, so nothing in this shell may move them.
for _k in ('TICKET_CHANNEL', 'TICKET_LOG', 'STAFF_ROLES', 'CREATOR_ROLES',
           'TICKET_COOLDOWN', 'UPPER_STAFF_ROLES'):
    os.environ.pop(_k, None)

import discord  # noqa: E402

import bot  # noqa: E402

bot.OPEN_TICKETS = os.path.join(tempfile.mkdtemp(prefix='thornswood-fallback-'),
                                'open-tickets.json')

PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


SAID = []
bot.log = lambda *a: SAID.append(' '.join(str(x) for x in a))

PUSHED = []


async def _push(*a):
    PUSHED.append(a)

bot.push_async = _push

_ids = itertools.count(1000)
SECRET = 'He followed me from Riverwood and took my horse. REPORT-BODY-7731'


class Perm(object):
    def __init__(self, **kw):
        self.__dict__.update(kw)


def deny():
    return discord.PermissionOverwrite(view_channel=False)


def allow():
    return discord.PermissionOverwrite(view_channel=True)


class Role(object):
    def __init__(self, name, admin=False, bot_role=False):
        self.id = next(_ids)
        self.name = name
        self.mention = '<@&%s>' % name
        self.members = []
        self.permissions = Perm(administrator=admin)
        self._bot = bot_role

    def is_bot_managed(self):
        return self._bot


class Person(object):
    def __init__(self, name, roles=(), is_bot=False):
        self.id = next(_ids)
        self.name = name
        self.display_name = name
        self.mention = '<@%s>' % name
        self.roles = list(roles)
        self.bot = is_bot
        self.guild_permissions = Perm(manage_channels=False)
        self.dms = []

    async def send(self, text=None, **kw):
        self.dms.append(text or '')

    def __str__(self):
        return self.name


class Channel(object):
    """
    A text channel. What anybody can see is worked out the way Discord does
    it for a role: @everyone's overwrite first, then the role's own. The bot
    can always see and post; whether it can open a private thread is `threads`.
    """

    def __init__(self, guild, name, overwrites=None, threads=True, category=None):
        self.guild = guild
        self.id = next(_ids)
        self.name = name
        self.overwrites = dict(overwrites or {})
        self.threads = threads
        self.category = category
        self.mention = '<#%s>' % name
        self.jump_url = 'https://discord.com/channels/x/%d' % self.id
        self.sent = []
        self.thread_tries = 0

    def permissions_for(self, who):
        if who is self.guild.me:
            return Perm(view_channel=True, send_messages=True,
                        create_private_threads=self.threads,
                        send_messages_in_threads=self.threads)
        if getattr(getattr(who, 'permissions', None), 'administrator', False):
            return Perm(view_channel=True)
        see = True
        ev = self.overwrites.get(self.guild.default_role)
        if ev is not None and ev.view_channel is not None:
            see = ev.view_channel
        if who is not self.guild.default_role:
            own = self.overwrites.get(who)
            if own is not None and own.view_channel is not None:
                see = own.view_channel
        return Perm(view_channel=see)

    async def send(self, text=None, **kw):
        self.sent.append(text or '')

    async def create_thread(self, **kw):
        self.thread_tries += 1
        raise RuntimeError('403 Forbidden (error code: 50013): Missing Permissions')

    def history(self, limit=30):
        async def nothing():
            if False:
                yield None
        return nothing()

    def text(self):
        return '\n'.join(self.sent)


class Guild(object):
    def __init__(self, name='Thornswood', manage=True):
        self.id = next(_ids)
        self.name = name
        self.default_role = Role('@everyone')
        self.roles = [self.default_role]
        self.me = Person('Thornswood', is_bot=True)
        self.me.guild_permissions = Perm(manage_channels=manage)
        self.text_channels = []
        self.made = []

    def role(self, name, **kw):
        r = Role(name, **kw)
        self.roles.append(r)
        return r

    def channel(self, name, **kw):
        c = Channel(self, name, **kw)
        self.text_channels.append(c)
        return c

    async def create_text_channel(self, name, overwrites=None, category=None, **kw):
        c = Channel(self, name, overwrites=overwrites, category=category)
        self.text_channels.append(c)
        self.made.append(c)
        return c


class Field(object):
    def __init__(self, value):
        self.value = value


class Response(object):
    def __init__(self):
        self.said = []

    async def defer(self, **kw):
        pass

    async def send_message(self, text=None, **kw):
        self.said.append(text or '')


class Followup(object):
    def __init__(self):
        self.said = []

    async def send(self, text=None, **kw):
        self.said.append(text or '')


class Interaction(object):
    def __init__(self, guild, user):
        self.guild = guild
        self.user = user
        # Where the form was opened from, which the ticket limit reads to tell
        # staff from everybody else. Without it the limit fails open and every
        # form in here would pass it through its error path, not its real one.
        self.channel = guild.text_channels[0] if guild.text_channels else None
        self.response = Response()
        self.followup = Followup()


def server(threads=True, manage=True):
    """
    The server as it stands: the panel in #tickets-and-applications, which
    anybody can read, and the usual roles. Returns the guild, the panel channel
    and the staff role.
    """
    g = Guild(manage=manage)
    mod = g.role('Moderator')
    g.role('Owner', admin=True)
    g.role('Playtester')
    g.role('Content Creator')
    g.role('Thornswood bot', bot_role=True)
    panel = g.channel('tickets-and-applications', threads=threads)
    return g, panel, mod


def staff_only(g, mod):
    return {g.default_role: deny(), mod: allow()}


def report(g, who=None):
    """One person reports another, through the real modal."""
    who = who or Person('Arvel')
    ix = Interaction(g, who)
    PUSHED[:] = []

    async def go():
        m = bot.TicketModal('report', 'Report somebody')
        m.fields = [Field('Nazeem, outside the Mare'), Field(SECRET), Field('a clip at 21:40')]
        await m.on_submit(ix)
    asyncio.run(go())
    return who, ix


def nowhere_public(what, chans):
    yes(what, all(SECRET not in c.text() for c in chans))


def run(what, fn):
    try:
        fn()
    except Exception as e:
        yes('%s ran without an exception (%s: %s)' % (what, e.__class__.__name__, e), False)


# ------------------------------------------------ THE ONE THIS IS FOR --
def load_build_discord():
    """Build-Discord.py as a module. Its client only runs under __main__."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'build_discord', os.path.join(HERE, 'Build-Discord.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def plan_shape():
    # The server as Build-Discord.py's PLAN builds it since #3317: a report
    # opens off #report-someone in Tickets, which anybody can read (page card
    # q-3317-ticket-split, A; it was #tickets-and-applications until then),
    # and #ticket-log in Staff with mode='staff' (it was #tickets beside the
    # panel from 24 September). Every role the PLAN makes is here with the
    # permissions it gives it, and both channels carry the PLAN's own
    # overwrites, so a change to either shows up here.
    bd = load_build_discord()
    where = {}
    for cat, specs in bd.PLAN:
        for spec in specs:
            where[spec['name']] = (cat, spec.get('mode'))
    tickets = where.get('ticket-log', (None, None))
    panel_at = where.get('report-someone', (None, None))
    yes("the PLAN makes #ticket-log, TICKET_LOG's first name, in Staff, for the council",
        bot.TICKET_LOG[0] == 'ticket-log' and tickets == ('Staff', 'council'))
    yes("and a report's desk, #report-someone, in the public Tickets",
        bot.desk_of('report') == 'report-someone'
        and panel_at == ('Tickets', 'read'))

    g = Guild()
    roles = {}
    for name, _colour, _hoist, perms in bd.ROLES:
        roles[name] = g.role(name, admin=bool(perms.administrator))
    g.role('Thornswood bot', bot_role=True)
    # Each with the mode the PLAN gives it, and 'open' when the PLAN gives none,
    # the same default Build-Discord.py uses.
    panel = g.channel('report-someone',
                      overwrites=bd.overwrites(g, panel_at[1] or 'open', roles))
    book = g.channel('ticket-log', overwrites=bd.overwrites(g, tickets[1] or 'open', roles))
    who, ix = report(g)

    yes("A REPORT WHOSE THREAD FAILS LANDS IN THE PLAN'S STAFF ONLY #ticket-log",
        SECRET in book.text())
    nowhere_public('and not in the panel channel', [panel])
    yes('nothing new is made, so a -Prune run has nothing of the bot\'s to delete',
        not g.made)
    yes("the PLAN's #ticket-log passes the staff only check", bot.private_channel_ok(g, book))
    yes('closed tickets are written down there too',
        asyncio.run(bot.log_channel(g)) is book)

run("the PLAN's shape", plan_shape)


def public_tickets_shape():
    # The panel channel is public, the thread refuses, and a #tickets that
    # everybody can read is there, which is TICKET_LOG's first name. The PLAN
    # made exactly that until 24 September, and a re-run of the new PLAN
    # leaves a channel that is already there as it was.
    g, panel, mod = server()
    public_tickets = g.channel('tickets')
    who, ix = report(g)

    yes('the thread was tried', panel.thread_tries == 1)
    nowhere_public('THE REPORT IS NOT IN THE PANEL CHANNEL, nor in the public #tickets',
                   [panel, public_tickets])
    made = [c for c in g.made if c.name == 'ticket-log']
    yes('a public #tickets is passed over and #ticket-log is made instead',
        len(made) == 1 and not [c for c in g.made if c.name == 'tickets'])
    yes('the channel it made is staff only by its permissions',
        bool(made) and bot.private_channel_ok(g, made[0]))
    yes('and the report is in it, with the reason the thread did not open',
        bool(made) and SECRET in made[0].text() and 'No private thread' in made[0].text())
    yes('the log says why #tickets was passed over',
        any('#tickets is named in TICKET_LOG' in s for s in SAID))
    said = ' '.join(ix.followup.said)
    yes('the person is told it reached staff, not that it went into the channel',
        'only staff' in said and 'in the channel' not in said)
    yes('the site inbox still gets it', len(PUSHED) == 1)

run('a public #tickets', public_tickets_shape)


def private_log_exists():
    g, panel, mod = server()
    public_tickets = g.channel('tickets')
    book = g.channel('ticket-log', overwrites=staff_only(g, mod))
    report(g)
    yes('an existing staff only #ticket-log is used', SECRET in book.text())
    yes('and nothing new is made', not g.made)
    nowhere_public('and nothing lands anywhere public', [panel, public_tickets])

run('an existing private #ticket-log', private_log_exists)


def private_tickets():
    # What log_channel made after the panel channel was renamed: a staff only
    # #tickets. It is still the first choice, so nothing live moves.
    g, panel, mod = server()
    book = g.channel('tickets', overwrites=staff_only(g, mod))
    report(g)
    yes('a staff only #tickets is still the first choice', SECRET in book.text() and not g.made)
    nowhere_public('and the panel channel stays clean', [panel])

run('a staff only #tickets', private_tickets)


def two_called_tickets():
    # Two channels, one name, the public one listed first. by_name would hand
    # back whichever the server lists first.
    g, panel, mod = server()
    public_tickets = g.channel('tickets')
    book = g.channel('tickets', overwrites=staff_only(g, mod))
    report(g)
    yes('with two called #tickets, the staff only one gets it', SECRET in book.text())
    nowhere_public('and the public one does not', [public_tickets, panel])

run('two called #tickets', two_called_tickets)


def nowhere_private():
    # Every TICKET_LOG name is public: fail closed. Discord gets nothing.
    g, panel, mod = server()
    a = g.channel('tickets')
    b = g.channel('ticket-log')
    who, ix = report(g)
    nowhere_public('WITH NOWHERE PRIVATE, NOTHING GOES INTO DISCORD AT ALL', [panel, a, b])
    yes('nothing is made under a name a public channel already has', not g.made)
    yes('the site inbox still gets it', len(PUSHED) == 1)
    yes('and the person is told by DM', len(who.dms) == 1)
    said = ' '.join(ix.followup.said)
    yes('and in the reply, without claiming a channel', 'Sent to staff' in said and 'channel' not in said)

run('nowhere private', nowhere_private)


def cannot_make():
    g, panel, mod = server(manage=False)
    a = g.channel('tickets')
    who, ix = report(g)
    nowhere_public('a bot that cannot make the channel posts nothing public', [panel, a])
    yes('and still pushes to the site and tells the person', len(PUSHED) == 1 and len(who.dms) == 1)

run('no Manage Channels', cannot_make)


def blocked_ahead():
    # thread_block knows before trying, and the thread is never attempted.
    g, panel, mod = server(threads=False)
    g.channel('tickets')
    book = g.channel('ticket-log', overwrites=staff_only(g, mod))
    report(g)
    yes('a missing Create Private Threads is not even tried', panel.thread_tries == 0)
    yes('and the ticket reaches the staff only channel with the reason',
        SECRET in book.text() and 'Create Private Threads' in book.text())
    nowhere_public('and not the panel channel', [panel])

run('threads blocked ahead of time', blocked_ahead)


def no_panel_channel():
    # The panel channel renamed out from under the bot. The old code had no
    # channel to fall back to and gave staff nothing in Discord.
    g = Guild()
    mod = g.role('Moderator')
    book = g.channel('ticket-log', overwrites=staff_only(g, mod))
    report(g)
    yes('with no panel channel the ticket still reaches staff privately', SECRET in book.text())

run('no panel channel', no_panel_channel)


def fallback_counts():
    # One new ticket every five minutes, from To Do entry 308. A ticket that
    # fell back is still a ticket. If this path skipped the limit, the staff
    # only channel would be the one a person could fill fifty times a minute.
    g, panel, mod = server()
    book = g.channel('tickets', overwrites=staff_only(g, mod))
    SAID[:] = []
    who, ix = report(g)
    yes('a report that falls back reaches the staff only channel', SECRET in book.text())
    posts = len(book.sent)
    again, ix2 = report(g, who)
    yes('THE SAME PERSON SENDING ANOTHER AT ONCE IS REFUSED, fallback or not',
        len(ix2.response.said) == 1 and 'minute' in ix2.response.said[0])
    yes('and nothing more is posted or pushed',
        len(book.sent) == posts and not PUSHED and panel.thread_tries == 1)
    yes('the limit was read, not skipped by an error',
        not any('ticket limit could not be checked' in s for s in SAID))
    bot._last_ticket.clear()

run('a fallen back ticket counts', fallback_counts)


# -------------------------------------------------- what private means --
def private_means():
    g, panel, mod = server()
    creator = [r for r in g.roles if r.name == 'Content Creator'][0]
    tester = [r for r in g.roles if r.name == 'Playtester'][0]
    botrole = [r for r in g.roles if r.name == 'Thornswood bot'][0]
    ok = bot.private_channel_ok

    yes('a channel with no overwrites is not private', not ok(g, Channel(g, 'x')))
    yes('staff only is private', ok(g, Channel(g, 'x', overwrites=staff_only(g, mod))))
    yes('a Playtester overwrite makes it not private',
        not ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), mod: allow(),
                                              tester: allow()})))
    yes('so does Content Creator, which does not read reports',
        not ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), creator: allow()})))
    yes('a bot role that can see it does not count',
        ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), botrole: allow()})))
    yes('an Administrator role does not count, since nothing could keep it out',
        ok(g, Channel(g, 'x', overwrites={g.default_role: deny()})))
    stranger = Person('Nazeem', roles=[tester])
    yes('one person given it by name makes it not private',
        not ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), stranger: allow()})))
    helper = Person('Lydia', roles=[mod])
    yes('a member of staff given it by name is fine',
        ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), helper: allow()})))
    yes('the bot given it by name is fine',
        ok(g, Channel(g, 'x', overwrites={g.default_role: deny(), g.me: allow()})))

    class Broken(Channel):
        def permissions_for(self, who):
            raise RuntimeError('cache not ready')
    yes('permissions it cannot read are a no', not ok(g, Broken(g, 'x')))

if hasattr(bot, 'private_channel_ok'):
    run('what private means', private_means)
else:
    yes('bot.private_channel_ok exists', False)


def closed_tickets():
    # close_here writes every closed ticket through log_channel, so a closed
    # application is somebody's answers too.
    g, panel, mod = server()
    public_tickets = g.channel('tickets')
    got = asyncio.run(bot.log_channel(g))
    yes('closed tickets are written down in a staff only channel, not the public #tickets',
        got is not None and got is not public_tickets and bot.private_channel_ok(g, got))

run('closed tickets', closed_tickets)


# ------------------------------------------------------------- startup --
class Client(object):
    def __init__(self, guilds):
        self.guilds = guilds
        self.user = Perm(id=4242)

    def get_channel(self, cid):
        for g in self.guilds:
            for c in g.text_channels:
                if c.id == cid:
                    return c
        return None


def startup():
    g, panel, mod = server(threads=False)
    g.channel('tickets', overwrites=staff_only(g, mod))
    # Found by its id, the one in staff-channel.txt, never by its name (#2940).
    staff = g.channel('staff-updates', overwrites=staff_only(g, mod))
    was_client, was_id = bot.client, bot.TROUBLE_ID
    bot.client, bot.TROUBLE_ID = Client([g]), staff.id
    SAID[:] = []
    try:
        asyncio.run(bot.ensure_panel(g))
        asyncio.run(bot.ensure_panel(g))      # a reconnect
    finally:
        bot.client, bot.TROUBLE_ID = was_client, was_id
    yes('STAFF ARE TOLD IN THEIR CHANNEL when threads cannot open, and only once',
        len(staff.sent) == 1 and 'Create Private Threads' in staff.sent[0])
    yes('the startup log no longer says tickets go into the panel channel',
        not any('as a plain message' in s for s in SAID)
        and any('which only staff can read' in s for s in SAID))
    yes('the panel still goes up, so a report can still be made',
        any(s == bot.PANEL for s in panel.sent))

run('startup', startup)


def faction_thread_fails():
    # Djinn: a Faction Leader ticket that cannot open a private thread
    # must not land in #tickets or the site inbox. General staff read both.
    g, panel, mod = server(threads=False)
    owner = [r for r in g.roles if r.name == 'Owner'][0]
    book = g.channel('tickets', overwrites=staff_only(g, mod))
    keep = bot.UPPER_STAFF_IDS
    bot.UPPER_STAFF_IDS = {owner.id}
    who = Person('Brynjolf')
    ix = Interaction(g, who)
    PUSHED[:] = []

    async def go():
        m = bot.TicketModal('faction', 'Apply: Faction Leader')
        m.faction_select._values = ['The Companions']
        m.faction_other._value = ''
        for f in m.fields:
            f._value = 'yes'
        await m.on_submit(ix)

    asyncio.run(go())
    bot.UPPER_STAFF_IDS = keep
    yes('a Faction Leader thread that fails is not written to #tickets',
        book.text() == '')
    nowhere_public('and not in the panel channel', [panel])
    yes('and not pushed to the site inbox', not PUSHED)
    yes('and the applicant is told to try again later',
        bot.FACTION_THREAD_FAILED in ix.followup.said
        and bot.FACTION_THREAD_FAILED in who.dms)

run('faction thread fails', faction_thread_fails)


# -------------------------------------------------------------- source --
src = open(os.path.join(HERE, 'bot.py'), encoding='utf-8').read()
yes('no fallback into the panel channel is left in the source',
    'if not posted and ch is not None' not in src)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
