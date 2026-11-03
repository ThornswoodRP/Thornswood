"""
The ticket desks' panels, the world's open switch, and the lines under
the panel.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import traceback
import urllib.request

import discord

import bot_tickets
from bot_core import (CREATOR_IDS, CREATOR_NAMES, SITE, STAFF_IDS, STAFF_NAMES,
    TICKETS, TICKETS_SAID, TICKET_DESKS, _role_hit, by_name, client, log,
    log_channel, thread_block)
from bot_staff_channel import trouble_say
from bot_tickets import (STAFF_LEADERSHIP_RULE, TicketModal, seat_refusal,
    ticket_refusal)


class TicketPanel(discord.ui.View):
    """One desk's panel (TICKET_DESKS), offering only its kinds, or with desk
       None the one panel of before the split, offering every kind. A desk
       with no kind to offer today (the playtest one while the world is
       open) is its words alone."""

    def __init__(self, desk=None):
        super().__init__(timeout=None)
        if desk_kinds(desk):
            self.add_item(TicketPicker(desk))


def desk_kinds(desk):
    """The KINDS a desk's panel offers, in KINDS' order; every one for None."""
    if desk is None:
        return list(bot_tickets.KINDS)
    want = dict(TICKET_DESKS).get(desk, ())
    return [k for k in bot_tickets.KINDS if k[0] in want]


class TicketPicker(discord.ui.Select):
    def __init__(self, desk=None):
        super().__init__(
            # A custom_id of its own a desk, so a press on any posted panel
            # is answered after a restart; the one of before keeps its own.
            custom_id='thornswood:ticket' + ('' if desk is None else ':' + desk),
            placeholder='What do you need?',
            options=[discord.SelectOption(label=lab, value=k, description=desc[:100])
                     for k, lab, desc in desk_kinds(desk)])

    async def callback(self, interaction):
        # Told here, before the form opens, so nobody types out a whole
        # application only to be turned away at the end of it.
        k = self.values[0]
        no = (ticket_refusal(interaction) or
              seat_refusal(k, interaction.user, interaction.guild))
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        lab = dict((a, b) for a, b, _ in bot_tickets.KINDS)[k]
        await interaction.response.send_modal(TicketModal(k, lab, interaction.guild))


_PANEL_THREAD = ('It asks a few questions, then opens a thread only you and staff '
                 'can see. Nothing here is public and nobody else in the server '
                 'can read it.')
_PANEL_TOP = ('**Open a ticket**\n\n'
              'Pick the one that fits. ' + _PANEL_THREAD + '\n\n')
_PANEL_SEATS = ('**Apply: Jarl** and **Apply: Faction Leader** are '
                'answered in character, and list only the seats nobody holds. A '
                'Jarl is a faction leader with an application of its own, because '
                'a hold is a seat like no other. A faction has one leader. ' +
                STAFF_LEADERSHIP_RULE + ' Somebody who holds a seat cannot apply '
                'for staff either.')
_PANEL_ANSWER = 'Applying for one does not give you it. Somebody reads it and answers.'
_PANEL_JOBS = (_PANEL_SEATS + '\n\n'
               'The jobs below that are open to anybody already in, and they are jobs '
               'rather than titles: each one is work somebody is currently doing '
               'instead of you.\n\n' + _PANEL_ANSWER)
_PANEL_PLAY_ALPHA = ('Thornswood is in alpha, and the world is open by application. Anyone '
                     'can download it. **Apply to be an alpha playtester** is the one '
                     'everybody starts with: once it is accepted you get the Playtester '
                     'role, and that is what lets you press Play. It asks whether you are '
                     '18 or over and whether you accept the rules, so read #rules first. '
                     'Your answers are kept against your Discord account.')
_PANEL_PLAY_OPEN = ('Thornswood is open: anyone in the Discord can play, so there is '
                    'nothing to apply for to get in. Read #rules, because being here '
                    'and in the world means accepting them.')
PANEL_ALPHA = _PANEL_TOP + _PANEL_PLAY_ALPHA + '\n\n' + _PANEL_JOBS
PANEL_OPEN = _PANEL_TOP + _PANEL_PLAY_OPEN + '\n\n' + _PANEL_JOBS
PANEL = PANEL_ALPHA


def desk_panel(desk):
    """A desk's words, for the world as it is now (OPEN); PANEL for None."""
    if desk == 'get-help':
        return ('**Get help**\n\n'
                'It will not install, will not start or will not connect, or '
                'something else is wrong that staff can fix. Pick **I need help** '
                'below. ' + _PANEL_THREAD)
    if desk == 'report-someone':
        return ('**Report somebody**\n\n'
                'Something happened and it should not have. Pick **Report '
                'somebody** below. ' + _PANEL_THREAD + ' The person you report '
                'never sees it.')
    if desk == 'apply-to-playtest':
        if OPEN:
            return '**Apply to play**\n\n' + _PANEL_PLAY_OPEN
        return '**Apply to play**\n\n' + _PANEL_PLAY_ALPHA + ' ' + _PANEL_THREAD
    if desk == 'apply-for-a-seat':
        return ('**Apply for a seat**\n\n' + _PANEL_SEATS + '\n\n' + _PANEL_THREAD +
                '\n\n' + _PANEL_ANSWER)
    if desk == 'apply-for-staff':
        return ('**Apply for staff**\n\n'
                'These are jobs rather than titles: each one is work somebody is '
                'currently doing instead of you. Somebody who holds a Jarl seat or '
                'leads a faction cannot apply. ' + _PANEL_THREAD + '\n\n' + _PANEL_ANSWER)
    return PANEL

# THE ONE SWITCH (#428), read off the site so there is one copy of it: the
# site's config.json "open", which /api/public hands out. Off, which is today,
# the panel is the alpha one above and the application asks the age and rules
# questions. On, anybody in the Discord can play, so the application goes from
# the panel, and with it the age and rules questions, which were only ever
# asked on the way in. THORNSWOOD_OPEN in bot.env.json overrides the site, for
# a dev bot or a site that is down. Read once, in setup_hook, before the panel
# view is registered; flipping it means restarting the bot.
KINDS_ALPHA = list(bot_tickets.KINDS)
OPEN = False


def site_open():
    """Whether the world is open to everybody, from THORNSWOOD_OPEN when it is
       set and otherwise from the site. Anything that goes wrong answers no,
       the alpha, which is what is true until somebody flips the switch."""
    env = os.environ.get('THORNSWOOD_OPEN', '').strip().lower()
    if env in ('1', 'true', 'yes', 'open'):
        return True
    if env in ('0', 'false', 'no', 'alpha', 'closed'):
        return False
    try:
        with urllib.request.urlopen(SITE + '/api/public', timeout=8) as r:
            return json.loads(r.read().decode('utf-8')).get('open') is True
    except Exception as e:
        log('could not ask the site whether the world is open, so the panel is '
            'the alpha one:', e)
        return False


#
# THE STATUS LINES (#3147). The bot's status, under its name in the member
# list, is one of Thornswood's hints and lore lines, a new one every
# LINES_EVERY seconds. Their one copy is site\data\site\lines.md; the site
# hands them out in /api/public as "lines", read here at every change, so a
# line edited there reaches the bot once its merge's Release is on the site
# (the deploy agent, #5190), with no bot install. Hints and lore lines take turns, each list in its own order.
LINES_EVERY = 15 * 60


def status_lines(lines):
    """The lines the status steps through: a hint, then a lore line, in turn,
       until both lists are used up. A lore line is its quote alone; its source
       does not fit in a status."""
    lines = lines if isinstance(lines, dict) else {}
    hints = [h for h in (lines.get('hints') or []) if isinstance(h, str) and h]
    lore = [x.get('text') for x in (lines.get('lore') or [])
            if isinstance(x, dict) and isinstance(x.get('text'), str) and x.get('text')]
    out = []
    for i in range(max(len(hints), len(lore))):
        out.extend(([hints[i]] if i < len(hints) else []) + ([lore[i]] if i < len(lore) else []))
    return out


def site_lines():
    """The status lines from the site's /api/public. Raises when the site
       cannot be read, for watch_lines to say."""
    with urllib.request.urlopen(SITE + '/api/public', timeout=8) as r:
        return status_lines(json.loads(r.read().decode('utf-8')).get('lines'))


async def watch_lines():
    """
    Sets the status to the next line every LINES_EVERY seconds. When the site
    cannot be read, or hands out no lines, that is said in bot.log and the
    status stays as it is until the next pass. Nothing in here may end the
    loop.
    """
    await client.wait_until_ready()
    at = 0
    while not client.is_closed():
        try:
            texts = await asyncio.get_running_loop().run_in_executor(None, site_lines)
            if texts:
                await client.change_presence(
                    activity=discord.CustomActivity(name=texts[at % len(texts)]))
                at += 1
            else:
                log('status lines: the site handed out none, so the status '
                    'stays as it is until the next pass')
        except Exception:
            log('status lines: could not set the next one, so the status stays '
                'as it is until the next pass:\n' + traceback.format_exc())
        await asyncio.sleep(LINES_EVERY)


def set_open(on):
    """Point the panel, its kinds and the age and rules questions at one mode."""
    global OPEN, PANEL
    OPEN = on is True
    bot_tickets.KINDS = [k for k in KINDS_ALPHA if not (OPEN and k[0] == 'playtest')]
    bot_tickets.AGE_KINDS = () if OPEN else ('playtest',)
    bot_tickets.RULES_KINDS = bot_tickets.AGE_KINDS
    PANEL = PANEL_OPEN if OPEN else PANEL_ALPHA


def _panel_options(msg):
    """
    The value and label of every option the POSTED dropdown is offering.

    Read off the message rather than off KINDS, because the two are exactly
    what can drift: the options a dropdown offers live in the message that was
    posted, not in the View this process builds on startup.

    An empty list when the components cannot be read, which does not match the
    wanted list, so the panel is edited. That is the right way round to fail:
    an edit nobody needed costs one audit log line, and a kind that never
    appears costs somebody a ticket they cannot open.
    """
    pairs = []
    try:
        for row in getattr(msg, 'components', None) or []:
            for item in getattr(row, 'children', None) or []:
                for o in getattr(item, 'options', None) or []:
                    pairs.append((getattr(o, 'value', ''), getattr(o, 'label', '')))
    except Exception:
        return []
    return pairs


def _panel_wanted(desk=None):
    return [(k, lab) for k, lab, _ in desk_kinds(desk)]


def panel_is_current(msg, desk=None):
    """
    True when the posted panel already says what it should, text and options.

    Its own function so it can be run without a Discord to run it against:
    bot/tests/test-ready.py drives it with a made up message. The decision
    is the part worth pinning, because getting it wrong in either direction is
    a real fault: too eager and the panel is edited on every reconnect, too
    lazy and a ticket kind added later never appears for anybody.
    """
    return (getattr(msg, 'content', None) == desk_panel(desk)
            and _panel_options(msg) == _panel_wanted(desk))


# Which servers staff have been told cannot open ticket threads, and why, so
# a reconnect does not tell them again.
_told_blocked = set()


async def ensure_panel(guild):
    """Every desk's panel (TICKET_DESKS), current, in its own channel. On a
       server not yet split, the one panel of before in TICKETS; where that
       channel is still there beside the desks, its panel says where they
       went (#3317, q-3317-ticket-split)."""
    desks = [(d, by_name(guild, [d])) for d, _k in TICKET_DESKS]
    here = [(d, ch) for d, ch in desks if ch is not None]
    old = by_name(guild, TICKETS)
    if not here and old is None:
        names = ', '.join('#' + c.name for c in guild.text_channels) or 'none'
        log('there is no ticket channel in "%s": none of #%s, and no #%s, so there '
            'is no panel and no tickets. Text channels there: %s. Build-Discord.py '
            'makes them.' % (guild.name, ', #'.join(d for d, _k in TICKET_DESKS),
                             TICKETS_SAID, names))
        return

    book = await log_channel(guild)
    if book is not None:
        log('closed tickets are written down in #%s' % book.name)

    if not here:
        await desk_ready(guild, old, None, book)
        return
    gone = [d for d, ch in desks if ch is None]
    if gone:
        log('there is no #%s in "%s", so those tickets have nowhere to open. '
            'Build-Discord.py makes them.' % (', #'.join(gone), guild.name))
    for d, ch in here:
        await desk_ready(guild, ch, d, book)
    if old is not None:
        await point_old_panel(old, here)


async def desk_ready(guild, ch, desk, book):
    """One desk's channel: who cannot use /close there, whether a private
       thread can be opened in it, and its panel posted or made current."""
    # Said at startup rather than the first time somebody applies, because the
    # first time somebody applies is the worst moment to find out.
    # Slash commands are a permission of their own, and it is granted per
    # channel. The server owner bypasses every overwrite, so /close looked
    # fine to the one person who could never have been blocked by it while
    # staff saw nothing at all. Named here rather than left to be discovered.
    # Read from the cache with no request, so nothing here waits on Discord or
    # throws: it is no longer in a try that dropped any error unsaid (#2736).
    blocked = []
    for r in guild.roles:
        if not (_role_hit(r, STAFF_IDS, STAFF_NAMES)
                or _role_hit(r, CREATOR_IDS, CREATOR_NAMES)):
            continue
        if not getattr(ch.permissions_for(r), 'use_application_commands', True):
            blocked.append(r.name)
    if blocked:
        log('%s cannot use /close in #%s: Use Application Commands is off '
            'for them there. Turn it on in that channel\'s permissions. The '
            'Close button on the ticket works for them either way.'
            % (', '.join(blocked), ch.name))

    why = thread_block(guild, ch)
    if why:
        if book is not None:
            where = '#%s, which only staff can read' % book.name
        else:
            where = ('the site inbox and nowhere in Discord, because there is '
                     'no staff only channel to put it in')
        fix = ('%s. Tick it in that channel\'s permissions, or on the bot\'s '
               'role server wide. Until then every ticket goes to %s.'
               % (why, where))
        log('tickets in "%s" will NOT get a private thread: %s' % (guild.name, fix))

        # Said in the staff channel too, because the log is on the VPS and
        # nobody reads it until something is already wrong. Once per process:
        # this runs on every reconnect, and a flaky evening would say it ten
        # times.
        #
        # THE PANEL STAYS UP. The To Do List asked for the bot to refuse to
        # start here, "so the permission gets fixed before a stranger finds
        # out". With the fallback staff only there is nothing left for a
        # stranger to find. Refusing would not take the panel down either: the
        # posted one keeps answering through the view setup_hook registers.
        # All it would do is take away the one way to report somebody, on the
        # night that way is broken.
        if (guild.id, ch.name, why) not in _told_blocked:
            _told_blocked.add((guild.id, ch.name, why))
            await trouble_say('**Tickets cannot open a private thread:** ' + fix)
    else:
        log('ticket threads look fine in #%s' % ch.name)

    try:
        head = desk_panel(desk).split('\n', 1)[0]
        async for m in ch.history(limit=30):
            # Its words alone when it has no kind to offer, so found by its
            # first line as well as by a dropdown.
            if m.author.id == client.user.id and (
                    m.components or (m.content or '').startswith(head)):
                # The options a dropdown offers live in the message that was
                # posted, not in the View this process builds on startup. So
                # leaving the old message alone is exactly why a ticket kind
                # added later never appeared for anybody: the code had it, the
                # message did not. Editing in place keeps the same message and
                # its spot in the channel and puts the current list on it.
                #
                # BUT ONLY WHEN THERE IS SOMETHING TO CHANGE. This ran on every
                # reconnect, so a flaky evening was a stream of edits to the
                # same message, each one an entry in the audit log and a write
                # against the rate limit the bot is already fighting. The text
                # and the option list are compared first, and both are
                # compared: comparing the text alone puts back the bug above,
                # where a kind added later never appeared because the words
                # around it had not changed.
                if panel_is_current(m, desk):
                    log('ticket panel is already current in #%s' % ch.name)
                    return
                await m.edit(content=desk_panel(desk), view=TicketPanel(desk))
                log('ticket panel updated in #%s' % ch.name)
                return
        await ch.send(desk_panel(desk), view=TicketPanel(desk))
        log('ticket panel posted in #%s' % ch.name)
    except Exception:
        log('panel failed:\n' + traceback.format_exc())




MOVED_HEAD = '**Tickets have moved**'


def moved_text(here):
    return (MOVED_HEAD + '\n\nEvery kind of ticket has a channel of its own now: ' +
            ', '.join(ch.mention for _d, ch in here) + '. Open yours there. A '
            'ticket already open here stays open until staff close it.')


async def point_old_panel(old, here):
    """The one panel of before, in a channel the desks replaced and -Prune has
       not deleted yet: its dropdown taken off, and where each desk is said.
       A ticket thread still open off it keeps working."""
    text = moved_text(here)
    try:
        async for m in old.history(limit=30):
            if m.author.id != client.user.id:
                continue
            if m.content == text and not m.components:
                return
            if m.components or (m.content or '').startswith(MOVED_HEAD):
                await m.edit(content=text, view=None)
                log('the old panel in #%s now says where the tickets went' % old.name)
                return
    except Exception:
        log('the old panel in #%s could not be changed:\n' % old.name
            + traceback.format_exc())
