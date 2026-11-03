"""
Tickets: the kinds and their questions, the form, one at a time,
closing and keeping.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import datetime
import json
import os
import re
import time
import traceback
import typing

import discord

from bot_base import DATA_DIR, HERE
from bot_core import (FACTION_REFUSED, FACTION_THREAD_FAILED, STAFF_IDS,
    STAFF_NAMES, TICKETS_SAID, TICKET_LOG, TICKET_NAMES, UPPER_STAFF_IDS,
    _int_env, _pushes, _role_hit, _who_hits, as_typed, client, desk_of, log,
    log_channel, push_async, thread_block, ticket_channel, ticket_pull_roles,
    ticket_pull_tokens, tree)
from bot_holds import OFFICE_TOWNS


# 'Apply to play' is not here on purpose. Patrick, 28 Sep: "we are in alpha so
# the world is open by application". Anyone can download it, and the one way
# into the world is this application, which gives the Playtester role when it
# is accepted. A second 'Apply to play' asked people to guess which one they
# wanted and half of them guessed wrong. The key stays 'playtest' because the
# site inbox and ROLE_FOR file it under that name.
KINDS = [
    ('playtest',    'Apply to be an alpha playtester',
                    'How you get into the world. Anyone can apply. Break it and write down how.'),
    ('jarl',        'Apply: Jarl',          'A seat in a hold. In character, and the first ones come out of these.'),
    ('faction',     'Apply: Faction Leader', 'A seat at the head of a faction. In character, and the first ones come out of these.'),
    ('gamemaster',  'Apply: Gamemaster',    'Run events, settle disputes, hold the line in character.'),
    ('loremaster',  'Apply: Loremaster',    'Keep the history straight and write the rest of it.'),
    ('moderator',   'Apply: Moderator',     'The unglamorous one. Tickets, reports, difficult people.'),
    ('dev',         'Apply: Dev',           'Server, launcher, site, mods. Anything that compiles.'),
    ('creator',     'Apply: Content Creator', 'Video, streams, screenshots, writing about the place.'),
    ('report',      'Report somebody',      'Something happened and it should not have.'),
    ('help',        'I need help',          'It will not install, will not start, or will not connect.'),
]

# The role each application is asking for, so the thread and the site inbox say
# what it is without anybody reading three answers first. None of these grant
# anything: giving out the role is still a person deciding.
ROLE_FOR = {
    'playtest':   'Playtester',
    'jarl':       'Jarl of the hold named below',
    'faction':    'Faction Lead of the faction named below',
    'gamemaster': 'Gamemaster',
    'loremaster': 'Loremaster',
    'moderator':  'Moderator',
    'dev':        'Dev',
    'creator':    'Content Creator',
}

# Every job asks the same three things, because the answers that matter are the
# same three every time: what you have done, how much time you really have, and
# whether you want the job or the title.
def _job(what, examples):
    return [
        ('What experience do you have?',
         examples, True),
        ('How much time can you give it?',
         'Hours a week, and which days. Honest beats keen.', True),
        ('Why this role?',
         'What draws you to ' + what + ' rather than the rest.', True),
    ]

# Asked first, on the two tickets that are a way IN. Everything else on the
# panel is for somebody already here, who answered this to get here.
#
# It is a typed answer rather than a box to tick because Discord modals have no
# box to tick. What it is worth is the record: their own words, against their
# Discord id, at a time, kept in the thread and in the site inbox.
AGE_Q = ('Are you 18 or over?', 'Thornswood is an adult server. Yes or no.', False)
AGE_KINDS = ('playtest',)

# #428: before this, nobody ever accepted the rules. Somebody could join for the
# invite, be let in, press Play and have agreed to nothing. Asked on the same
# tickets as the age question, for the same reason and in the same way: their
# own words against their Discord id, at a time, in the thread, the site inbox
# and the site's record of who accepted (push, then /api/ticket on the site).
# Anything that does not read as a yes goes at the top of the thread for staff,
# and nobody is given the role without somebody reading it.
RULES_Q = ('Do you accept the rules in #rules?',
           'Read #rules and thornswood.net/rules first. Yes or no.', False)
RULES_KINDS = AGE_KINDS

_ACCEPT = ('yes', 'yep', 'yeah', 'yup', 'y ', 'ye', 'i do', 'i accept', 'accept',
           'i agree', 'agree', 'i have', "i've", 'sure', 'of course', 'ok',
           'okay', 'absolutely', 'definitely', 'read and', 'correct', 'affirmative')


def accepted_rules(text):
    """
    Whether an answer to the rules question reads as a yes.

    Generous, like said_yes, and it never refuses anybody by itself: a no only
    puts a line at the top of the thread for a person to read. A no word
    anywhere at the start wins, so "no, not yet" is never taken for a yes.
    """
    t = (text or '').strip().lower()
    if not t:
        return False
    if t == 'n' or t.startswith(_NO) or t.startswith(("don't", 'dont', 'do not',
                                                     'i do not', "i don't", 'i dont',
                                                     'haven', 'have not', 'not yet')):
        return False
    return t == 'y' or t.startswith(_ACCEPT)

_NO  = ('no', 'nope', 'nah', 'not ', 'under', 'minor')
_YES = ('yes', 'yep', 'yeah', 'yup', 'y ', 'ye', 'i am', 'im ', "i'm ", 'sure',
        'correct', 'of course', 'affirmative', 'over', 'above')


def said_yes(text):
    """
    Whether an answer to the age question reads as a yes.

    Generous on purpose, and it never rejects anything by itself. Somebody
    typing "27" or "im 34" has answered the question; somebody typing "no", or
    nothing at all, is the case this exists to catch. A guess about how a
    stranger types is not a good enough reason to throw an application away,
    so the worst this does is put a line at the top of the thread and leave it
    to a person.
    """
    t = (text or '').strip().lower()
    if not t:
        return False

    # A NUMBER BEATS A WORD, and this order is the whole fix.
    #
    # It used to check the yes words first, and "I'm 16" starts with "i'm ",
    # which is in that list. So a sixteen year old answering in a sentence
    # read as a yes and the thread was never flagged, which is the one answer
    # this function exists to catch.
    #
    # An age is 1 to 120. Anything bigger is a year, a postcode or a number of
    # hours, and treating "born in 2009" as an age of 2009 would be a yes for
    # the same person. A text with no age-like number in it falls through to
    # the words below exactly as before.
    #
    # ANY NUMBER UNDER EIGHTEEN IS A NO, even beside a bigger one. "my brother
    # is 30, im 16" is not an answer anybody should be reading as a yes, and
    # this function never rejects anybody by itself: a no here puts a line at
    # the top of the thread for a person to read.
    #
    # It costs the occasional honest answer a flag: "34 and have been for 2
    # years" reads as a no because of the 2. That is deliberate and is the
    # cheap direction to be wrong in. A flag costs somebody five seconds of
    # reading; a miss lets a minor through with nothing saying so.
    ages = []
    for n in re.findall(r'\d+', t):
        try:
            v = int(n)
        except Exception:
            continue
        if 1 <= v <= 120:
            ages.append(v)
    if ages:
        if min(ages) < 18:
            return False
        return True

    if t == 'n' or t.startswith(_NO):
        return False
    if t.startswith(_YES):
        return True
    return False


QUESTIONS = {
    # The one application to be in the world. It asks about the character,
    # because that is what somebody is here for, and about testing, because
    # that is what being in it means today. It does not ask who they are
    # outside the game: that is answered by them being in the Discord.
    #
    # Discord takes five questions on a form and no more, so the rules
    # question (#428) took the place of "Have you roleplayed before", which
    # now rides along in the character question's hint.
    'playtest': [
        AGE_Q,
        RULES_Q,
        ('Who do you want to play?',
         'A sentence about the character, and where you have roleplayed before, if anywhere.', True),
        ('How much time can you give it?', 'Hours a week, and which days.', True),
        ('Describe a bug you have run into', 'What you did, what happened, what should have happened. Short.', True),
    ],
    # The only application here that is answered in character. The seats are
    # empty and the first people to hold them are picked out of these, so the
    # questions ask about the character rather than about the person, and the
    # last one asks the thing that actually decides it: whether they can lose
    # the seat and keep playing.
    # The hold itself is a Select of the open seats only, built in
    # TicketModal (#3317, Patrick, 22 Oct: "only include the open seats").
    'jarl': [
        ('Who is your character?',
         'Name, where they come from, what they have been doing until now. In character.', True),
        ('What is their claim to the seat?',
         'Blood, a war record, coin, or being the one who stayed. Something a hold would accept.', True),
        ('What would they change in the hold?',
         'What they actually do with it. Answer as them, not as you.', True),
        ('What happens if they lose the seat?',
         'A seat that cannot be lost is not a seat. Say how you play that.', True),
    ],
    # A faction lead seat. The same three questions the Trading Company form
    # used to ask, answered in character. The second question is reworded so
    # it fits any faction, not the company and hauling; that wording is a
    # proposal. Required and optional stay as they were: long means optional.
    # The faction pick itself is a Select, required, built in TicketModal,
    # because a form with no faction is useless. The Free Skyrim Trading
    # Company is one of the seats (bot/factions.json).
    'faction': [
        ('Who is your character?',
         'Name, where they come from, what they have been doing until now. In character.', True),
        ('What would they do with the faction?',
         'What they actually do with it. Answer as them, not as you.', True),
        ('How much time can you give it?', 'Hours a week, and which days.', True),
    ],
    'gamemaster': _job('running events',
        'Events you have run, groups you have led, tables you have DMed.'),
    'loremaster': _job('the lore',
        'Worldbuilding, wikis, writing, anything you have kept consistent over time.'),
    'moderator': _job('moderating',
        'Servers or forums you have moderated, and roughly how big.'),
    'dev': _job('the code',
        'Languages, projects, a repo link. Papyrus and C# are the useful ones here.'),
    'creator': _job('making things about Thornswood',
        'Channel, streams, a portfolio, anything you have put out.'),
    'report': [
        ('Who, and where?', 'Name and the channel or the place in the world.', False),
        ('What happened?', 'What they did, what you did, and roughly when.', True),
        ('Anything we can look at?', 'Screenshots, a clip, a time to check the log against.', True),
    ],
    'help': [
        ('What is going wrong?', 'One line.', False),
        ('What were you doing when it broke?', 'Installing, launching, connecting, playing.', True),
        ('What did it say, if anything?', 'Paste the error.', True),
    ],
}


# Named factions, names only, beside this file. Other is always added in
# code, last, and is never stored here. A name change is a pull request.
# A named faction is offered only while its "<faction> Leader" role has
# nobody in it (#3317); Other is always offered.
FACTIONS_FILE = os.path.join(HERE, 'factions.json')
FACTION_OTHER = 'Other'
FACTION_PICK_Q = 'Which faction?'
FACTION_OTHER_Q = 'If Other, which faction?'
FACTION_OTHER_HINT = 'Only if you picked Other. The name of the faction.'
HOLD_PICK_Q = 'Which hold?'
# THE SEAT RULE (#3317, Patrick, 22 Oct, 11:03 AM): "any Staff role can't
# also be a faction leader which includes Jarl's (Jarls are faction leaders
# but have a separate application on purpose ...)". He picked the bot
# refusing it (page card q-3317-seat-rule-check, A): staff cannot apply for
# a seat, and a seat holder cannot apply for staff. Every staff role counts,
# Trial Gamemaster, Content Creator and Support included, so the names are
# Build-Discord.py's STAFF, and test-3317-seats.py holds the two to the same
# list. STAFF_ROLES ids count too.
LEADERSHIP_KINDS = ('jarl', 'faction')
SEAT_RULE_STAFF = ('Owner', 'Co-Owner',
                   'Lead Dev', 'Dev',
                   'Lead Gamemaster', 'Gamemaster', 'Trial Gamemaster',
                   'Lead Loremaster', 'Loremaster',
                   'Lead Moderator', 'Moderator',
                   'Lead Content Creator', 'Content Creator',
                   'Lead Support', 'Support')
# The applications that make somebody staff. Apply: Lead and Apply: Support
# join this when they are on the panel.
STAFF_JOB_KINDS = ('gamemaster', 'loremaster', 'moderator', 'dev', 'creator')
# A faction's leader role uses its short name, as Build-Discord.py makes it.
FACTION_SHORT = {'Thalmor Remnant': 'Thalmor', 'The Companions': 'Companions'}
# Djinn, 12 Oct 2026. On the public panel, word for word.
STAFF_LEADERSHIP_RULE = 'No GM or staff member (Loremaster, Discord Moderator, or any other staff role) may hold an in-game RP role with faction leadership, such as a Jarl or a faction lead.'
SEAT_STAFF_REFUSED = ('You hold a staff role (%s). Nobody on staff may hold a '
                      'Jarl seat or lead a faction, so this application is '
                      'closed to you.')
SEAT_HELD_REFUSED = ('You hold %s. Nobody who holds a Jarl seat or leads a '
                     'faction may be on staff. To apply, give the seat up '
                     'first: say so in an "I need help" ticket.')
NO_OPEN_HOLD = ('Every Jarl seat is held right now, so there is nothing to '
                'apply for. When one opens it is listed here.')


def faction_leader_role(faction):
    """The leader role of a named faction: "Thalmor Leader"."""
    return FACTION_SHORT.get(faction, faction) + ' Leader'


def jarl_role(hold):
    return 'Jarl of ' + hold


def seat_roles():
    """Every seat of the world, as role names: each Jarl, then each faction leader."""
    return ([jarl_role(h) for h in OFFICE_TOWNS] +
            [faction_leader_role(f) for f in faction_names()])


def _role_named(guild, name):
    for r in getattr(guild, 'roles', None) or []:
        if getattr(r, 'name', None) == name:
            return r
    return None


def seat_is_open(guild, role_name):
    """
    Nobody holds this seat. A seat whose role is not on the server yet is
    open: nobody can hold a role that does not exist.
    """
    r = _role_named(guild, role_name)
    return r is None or not list(getattr(r, 'members', None) or [])


def open_holds(guild):
    """The holds whose Jarl seat is empty, in the order of OFFICE_TOWNS."""
    return [h for h in OFFICE_TOWNS if seat_is_open(guild, jarl_role(h))]


def open_factions(guild):
    """The named factions whose leader seat is empty, in factions.json order."""
    return [f for f in faction_names()
            if seat_is_open(guild, faction_leader_role(f))]


def seats_held(who):
    """The seat roles this person holds, by name."""
    seats = set(seat_roles())
    return [r.name for r in getattr(who, 'roles', None) or []
            if getattr(r, 'name', None) in seats]


def seat_refusal(kind, who, guild):
    """
    Why this person cannot open this application, in words, or None.

    Asked when they pick from the panel and again when the form comes back.
    Unlike ticket_refusal it holds for staff too, because the rule is about
    staff. Anything that goes wrong in here lets them through, for the reason
    ticket_refusal gives, and the council reading the ticket is the check.
    """
    try:
        if kind in LEADERSHIP_KINDS:
            held = leadership_staff_held(who)
            if held:
                return SEAT_STAFF_REFUSED % ', '.join(held)
            if kind == 'jarl' and not open_holds(guild):
                return NO_OPEN_HOLD
        if kind in STAFF_JOB_KINDS:
            held = seats_held(who)
            if held:
                return SEAT_HELD_REFUSED % ', '.join(held)
        return None
    except Exception:
        log('the seat rule could not be checked, so this one was let '
            'through:\n' + traceback.format_exc())
        return None


def faction_names():
    """The named factions, from factions.json beside this file. Other is not in it."""
    try:
        with open(FACTIONS_FILE, encoding='utf-8') as f:
            d = json.load(f)
        if isinstance(d, list):
            return [str(n).strip() for n in d if str(n).strip()]
    except Exception as e:
        log('could not read factions.json:', e)
    return []


def faction_pick_options(guild=None):
    """
    Select options for the form: every named faction whose leader seat is
    open, then Other last. With no guild to look in, every named faction.
    """
    names = faction_names() if guild is None else open_factions(guild)
    opts = [discord.SelectOption(label=n[:100], value=n[:100]) for n in names]
    opts.append(discord.SelectOption(label=FACTION_OTHER, value=FACTION_OTHER))
    return opts


def hold_pick_options(guild=None):
    """Select options for the Jarl form: every hold whose Jarl seat is open."""
    holds = list(OFFICE_TOWNS) if guild is None else open_holds(guild)
    return [discord.SelectOption(label=h, value=h) for h in holds]


def faction_pick_is_known(picked):
    """True for a named faction in factions.json, or for Other.

    Other is a normal option and is not flagged. A value that is not on
    the list (a tampered submit) is not known. Empty is not known.
    """
    name = (picked or '').strip()
    if not name:
        return False
    if name == FACTION_OTHER:
        return True
    return name in faction_names()


def field_said(item):
    """What a form field holds: a Select's first pick, or a TextInput's text."""
    vals = getattr(item, 'values', None)
    if isinstance(vals, (list, tuple)):
        return (str(vals[0]) if vals else '').strip()
    return (getattr(item, 'value', None) or '').strip()


def leadership_staff_held(who):
    """
    Names of the staff roles they hold, for the seat rule.

    Every staff role counts (SEAT_RULE_STAFF, and any STAFF_ROLES id), wider
    than is_staff, which decides /close and the ticket limits.
    """
    try:
        ids = set(STAFF_IDS)
        names = set(STAFF_NAMES) | set(n.lower() for n in SEAT_RULE_STAFF)
        found = []
        for r in getattr(who, 'roles', None) or []:
            if _role_hit(r, ids, names):
                found.append(r.name)
        return found
    except Exception:
        return []


class TicketModal(discord.ui.Modal):
    def __init__(self, kind, label, guild=None):
        super().__init__(title=label[:45])
        self.kind = kind
        self.label_text = label
        self.fields = []
        self.faction_select = None
        self.faction_other = None
        self.hold_select = None
        # Discord takes five items on a form. The faction kind uses all five:
        # a required Select of every open faction seat plus Other (discord.py
        # 2.6.0 put Select inside a modal; 2.7.1 is the pin), an optional
        # Other box, and the three copied questions. The Jarl kind is a
        # required Select of the open holds and its four questions. The
        # seats are read off the guild the form is opened in.
        if kind == 'jarl':
            sel = discord.ui.Select(
                placeholder='Pick a hold',
                options=hold_pick_options(guild),
                min_values=1,
                max_values=1,
                required=True)
            self.hold_select = sel
            self.add_item(discord.ui.Label(
                text=HOLD_PICK_Q[:45],
                component=sel))
        if kind == 'faction':
            sel = discord.ui.Select(
                placeholder='Pick a faction',
                options=faction_pick_options(guild),
                min_values=1,
                max_values=1,
                required=True)
            self.faction_select = sel
            self.add_item(discord.ui.Label(
                text=FACTION_PICK_Q[:45],
                component=sel))
            other = discord.ui.TextInput(
                label=FACTION_OTHER_Q[:45],
                placeholder=FACTION_OTHER_HINT[:100],
                style=discord.TextStyle.short,
                required=False,
                max_length=200)
            self.faction_other = other
            self.add_item(other)
        for q, ph, long in QUESTIONS[kind]:
            item = discord.ui.TextInput(
                label=q[:45],
                placeholder=ph[:100],
                style=discord.TextStyle.paragraph if long else discord.TextStyle.short,
                required=not long,
                max_length=1000 if long else 200)
            self.fields.append(item)
            self.add_item(item)

    async def on_submit(self, interaction):
        # Checked again here, and counted here rather than on the panel, so a
        # form opened by mistake and cancelled costs nobody five minutes. See
        # TICKET_COOLDOWN for why there is a limit at all.
        no = (ticket_refusal(interaction) or
              seat_refusal(self.kind, interaction.user, interaction.guild))
        if no:
            await interaction.response.send_message(no, ephemeral=True)
            return
        # Faction Leader tickets go only to the IDs in UPPER_STAFF_ROLES.
        # Empty, or IDs that match no role, means refuse: do not open a
        # thread only the applicant can see, and do not fall through to
        # general staff. Other kinds are unchanged.
        if self.kind == 'faction':
            if not UPPER_STAFF_IDS:
                log('UPPER_STAFF_ROLES is empty, so a Faction Leader ticket '
                    'was refused. Set it to the Owner role ID and the Lead '
                    'Gamemaster role ID.')
                await interaction.response.send_message(
                    FACTION_REFUSED, ephemeral=True)
                return
            if not ticket_pull_roles('faction', interaction.guild):
                log('UPPER_STAFF_ROLES ids %s matched no role on this '
                    'server, so a Faction Leader ticket was refused'
                    % sorted(UPPER_STAFF_IDS))
                await interaction.response.send_message(
                    FACTION_REFUSED, ephemeral=True)
                return
        # Before the first await, so two forms sent in the same moment cannot
        # both get past the check above.
        _last_ticket[_ticket_key(interaction.guild, interaction.user)] = _now()
        await interaction.response.defer(ephemeral=True, thinking=True)
        guild = interaction.guild
        who = interaction.user

        asking = ROLE_FOR.get(self.kind)

        def answered(want):
            """What they typed in the question that reads exactly like this."""
            for item, (q, _, _) in zip(self.fields, QUESTIONS[self.kind]):
                if q == want:
                    return field_said(item)
            return ''

        age_said = answered(AGE_Q[0]) if self.kind in AGE_KINDS else ''

        # The rules answer, kept for the site's record of who accepted them.
        rules = None
        rules_said = ''
        if self.kind in RULES_KINDS:
            rules_said = answered(RULES_Q[0])
            rules = {'said': rules_said[:200], 'yes': accepted_rules(rules_said)}

        # The faction pick is read again here. Other is a normal option and
        # is not flagged. A value that is not a named faction and not Other
        # (a tampered submit) is flagged. The pick and the Other box stay out of the opening line
        # and out of Asking for: they go only in the escaped answers below.
        picked = field_said(self.faction_select) if self.faction_select is not None else ''
        other_said = field_said(self.faction_other) if self.faction_other is not None else ''
        hold = field_said(self.hold_select) if self.hold_select is not None else ''

        def written(clean):
            lines = []
            if self.kind == 'jarl':
                lines.append('**%s**\n%s'
                             % (HOLD_PICK_Q, clean(hold) or 'nothing said'))
            if self.kind == 'faction':
                lines.append('**%s**\n%s'
                             % (FACTION_PICK_Q, clean(picked) or 'nothing said'))
                lines.append('**%s**\n%s'
                             % (FACTION_OTHER_Q, clean(other_said) or 'nothing said'))
            for item, (q, _, _) in zip(self.fields, QUESTIONS[self.kind]):
                lines.append('**%s**\n%s'
                             % (q, clean(field_said(item)) or 'nothing said'))
            out = '\n\n'.join(lines)
            if asking:
                out = '**Asking for:** ' + asking + '\n\n' + out
            # Anything that does not read as a yes says so at the top, in words,
            # on the line staff read first. It never stops the ticket: losing
            # somebody's application over how they phrased one answer would be
            # worse than a person spending two seconds reading it.
            if self.kind in AGE_KINDS and not said_yes(age_said):
                out = ('**CHECK THIS ONE.** Asked if they are 18 or over they '
                       'said "%s".\n\n' % (clean(age_said) or 'nothing')) + out
            if rules is not None and not rules['yes']:
                out = ('**CHECK THIS ONE.** Asked if they accept the rules they '
                       'said "%s".\n\n' % (clean(rules_said) or 'nothing')) + out
            # A seat can be filled between the form opening and coming back,
            # and two people can apply for the same open seat; the council
            # reads which. A pick that was never on the list is a tampered
            # submit.
            if self.kind == 'faction' and not faction_pick_is_known(picked):
                out = ('**CHECK THIS ONE.** The faction they picked is not on '
                       'the list.\n\n') + out
            elif (self.kind == 'faction' and picked != FACTION_OTHER
                  and not seat_is_open(guild, faction_leader_role(picked))):
                out = ('**CHECK THIS ONE.** The faction they picked has a '
                       'leader now.\n\n') + out
            if self.kind == 'jarl' and hold not in OFFICE_TOWNS:
                out = ('**CHECK THIS ONE.** The hold they picked is not on '
                       'the list.\n\n') + out
            elif self.kind == 'jarl' and not seat_is_open(guild, jarl_role(hold)):
                out = ('**CHECK THIS ONE.** The hold they picked has a Jarl '
                       'now.\n\n') + out
            return out

        # Two copies of the same ticket, because the two places that take it
        # protect themselves differently (#1354).
        #
        # detail is as they typed it, for the site, which escapes its own
        # output and whose inbox is the record of what they really wrote.
        #
        # shown is what goes into Discord, where their words would otherwise be
        # read as formatting and as mentions. Before this, an answer of
        # "@everyone" pinged the server from inside a staff thread, a role
        # mention pulled a role into it, and a few asterisks could hide the
        # rest of the application behind a heading. The questions and the
        # CHECK THIS ONE line are ours and stay bold; nothing of theirs does.
        detail = written(lambda v: v)
        shown = written(as_typed)

        title =('%s, %s' % (self.label_text, who.display_name))[:96]

        # Mentioning a role does not put anybody in a private thread. Only
        # people who have been added to one can see it, so a ticket opened
        # without this was visible to the applicant and to nobody else, and the
        # @mention went into a room staff were not in. They are added one at a
        # time, which is the only way Discord offers.
        # Faction Leader tickets go only to the IDs in UPPER_STAFF_ROLES.
        # Other kinds still use STAFF_ROLES (and Content Creator on creator
        # applications).
        staff_roles = ticket_pull_roles(self.kind, guild)
        if not staff_roles:
            ids, names = ticket_pull_tokens(self.kind)
            log('no role matched ids %r or names %r, so nobody will be pulled '
                'into this ticket. Set STAFF_ROLES in bot.env.json to the role '
                'ids or names this server actually uses.'
                % (sorted(ids), sorted(names)))
        head = '%s opened this. %s' % (who.mention,
                                       ' '.join(r.mention for r in staff_roles))

        ch = ticket_channel(guild, self.kind)
        why = None
        opened = None
        posted = False

        if ch is None:
            why = ('there is no text channel called #%s in this server'
                   % (desk_of(self.kind) or TICKETS_SAID))
            log(why)
        else:
            why = thread_block(guild, ch)
            if why:
                log('no ticket thread: %s' % why)
            else:
                try:
                    # Private, not invitable: only people the bot adds can
                    # read it. Roles with Manage Threads on this channel
                    # (Lead Gamemaster and Trial Gamemaster, per the note
                    # on is_staff) can still open a private thread. That
                    # is Discord's permission, not something this bot sets.
                    opened = await ch.create_thread(
                        name=title,
                        type=discord.ChannelType.private_thread,
                        invitable=False,
                        auto_archive_duration=10080)
                except Exception as e:
                    why = 'Discord refused to open the thread (%s)' % e
                    log('the ticket thread could not be created:\n'
                        + traceback.format_exc())
                    opened = None

        # From here the thread exists. Everything after it is allowed to fail
        # on its own without throwing the thread away, which is what used to
        # happen: one member who could not be added took the whole ticket down
        # and left an empty thread nobody was in.
        if opened is not None:
            remember_ticket(guild, who, opened)
            try:
                await opened.add_user(who)
            except Exception as e:
                log('could not add %s to their own ticket: %s' % (who, e))

            added = 0
            seen = set()
            for r in staff_roles:
                for m in r.members:
                    if m.id == who.id or m.id in seen or m.bot:
                        continue
                    seen.add(m.id)
                    try:
                        await opened.add_user(m)
                        added += 1
                    except Exception as e:
                        log('could not add %s to the ticket thread: %s' % (m, e))

            if staff_roles and added == 0:
                log('staff roles %r matched but nobody was added to the ticket '
                    'thread. If those roles have members, the bot is missing '
                    'permissions in #%s.'
                    % ([r.name for r in staff_roles], ch.name))

            try:
                # The head is ours and is the one post meant to ping: the
                # person who opened the ticket, and each staff role, by id.
                # Not @everyone, which nothing this bot writes ever says.
                await opened.send(head[:1900], view=TicketTools(),
                                  suppress_embeds=True,
                                  allowed_mentions=discord.AllowedMentions(
                                      everyone=False, users=True, roles=True))
                # Their words. Escaped above, with every mention switched
                # off here as well, and embeds suppressed so a bare link
                # cannot draw its preview. Anything the escaping misses
                # still pings nobody.
                for chunk in _chunks(shown, 1900):
                    await opened.send(chunk,
                                      suppress_embeds=True,
                                      allowed_mentions=discord.AllowedMentions.none())
                posted = True
            except Exception as e:
                why = 'the thread opened but nothing could be written in it (%s)' % e
                log('writing the ticket into the thread failed:\n'
                    + traceback.format_exc())
                # Faction Leader: a half-written private thread that
                # general staff cannot see, and that we then refuse, is
                # leftover. Delete this object, the one create_thread
                # just returned, never one looked up by name.
                if self.kind == 'faction':
                    try:
                        await opened.delete()
                    except Exception:
                        log('could not delete the half-written Faction '
                            'Leader thread:\n' + traceback.format_exc())
                    forget_ticket(guild, who, opened)

        # A ticket nobody can see is the same as no ticket, and a ticket
        # everybody can see is worse. If the thread could not be made, or could
        # not be written in, the whole ticket goes to the staff only log
        # channel instead, with the reason riding along so whoever reads it can
        # fix the cause without going to the VPS for a log.
        #
        # IT USED TO GO INTO THE PANEL CHANNEL, on the argument that the panel
        # channel was no more public than the thread. It was far more public. A
        # private thread is readable by the person who opened it and the staff
        # added to it; the panel channel is readable by everybody who can open
        # a ticket, which is the whole server. A report about somebody would go
        # up in front of the person it was about. From the To Do List: "A
        # reported member reading the report in the channel is a safety
        # problem, not a formatting one."
        #
        # log_channel checks the channel really is staff only before handing it
        # back. When there is no such channel, nothing goes into Discord at
        # all: the site inbox still gets the ticket below, and the person is
        # told by DM.
        fell_back = False
        # A Faction Leader ticket that has no private thread must not go
        # into #tickets or the site inbox: those are readable by general
        # staff. Refuse, tell the applicant to try again, and log it.
        # Other kinds keep the staff-only log fallback below.
        if not posted and self.kind == 'faction':
            log('Faction Leader ticket had no private thread%s. It was not written to the staff log or the site inbox.'
                % ((' (%s)' % why) if why else ''))
            try:
                await who.send(FACTION_THREAD_FAILED)
            except Exception as e:
                log('could not DM %s about the refused Faction Leader '
                    'ticket: %s' % (who, e))
        elif not posted:
            try:
                book = await log_channel(guild)
            except Exception:
                log('could not look for the staff only log channel:\n'
                    + traceback.format_exc())
                book = None
            if book is None:
                log('no staff only channel to put this ticket in, so Discord '
                    'has no copy of it. It goes to the site inbox only.')
            else:
                note = ''
                if why:
                    note = '\n_No private thread for this one: %s._' % why
                try:
                    # The display name in the title is theirs as well, so it
                    # is escaped here the way the answers are. The thread name
                    # above is a name rather than a post and keeps it as it is.
                    await book.send(
                        ('**%s**\n%s%s' % (as_typed(title, 96), head, note))[:1900],
                        suppress_embeds=True,
                        allowed_mentions=discord.AllowedMentions(
                            everyone=False, users=True, roles=True))
                    for chunk in _chunks(shown, 1900):
                        await book.send(chunk,
                                        suppress_embeds=True,
                                        allowed_mentions=discord.AllowedMentions.none())
                    fell_back = True
                except Exception:
                    log('the ticket could not be posted in #%s either:\n'
                        % book.name + traceback.format_exc())

        # And whatever happened in Discord, the person gets told something
        # true. The old wording promised a message that nothing ever sent.
        if not posted and not fell_back and self.kind != 'faction':
            try:
                await who.send(
                    'Your ticket reached staff, but Discord would not let the '
                    'bot open a thread for it. Nothing is lost: it is in the '
                    'staff inbox. Somebody will get back to you.')
            except Exception as e:
                log('could not even DM %s about the failed ticket: %s' % (who, e))

        # The site copy is bookkeeping, and nobody waits on it. It used to be
        # awaited here, before the reply, and push gives the site twelve
        # seconds to answer, so with the site down a stranger pressing Submit
        # watched the bot think for twelve seconds before hearing their ticket
        # was open. To Do List 253: "A spinner that sits for ten seconds reads
        # as broken to somebody who has never used the server, and the site
        # copy still lands." It is started here rather than after the replies
        # so that a reply Discord refuses cannot take the site copy with it.
        # push_async logs its own failure, so nothing is lost by not awaiting.
        # A Faction Leader ticket that never opened a thread is not sent:
        # the site inbox is readable by general staff.
        if posted or self.kind != 'faction':
            task = asyncio.create_task(push_async(
                self.kind, '%s: %s' % (self.label_text, who.display_name),
                detail, str(who), who.id, rules))
            _pushes.add(task)
            task.add_done_callback(_pushes.discard)

        if posted:
            await interaction.followup.send(
                'Opened %s. Everything else goes in there.' % opened.mention,
                ephemeral=True)
        elif self.kind == 'faction':
            await interaction.followup.send(FACTION_THREAD_FAILED, ephemeral=True)
        elif fell_back:
            await interaction.followup.send(
                'Sent. A private thread would not open, so it has gone straight '
                'to staff instead, somewhere only staff can read it. Somebody '
                'will answer you by message.',
                ephemeral=True)
        else:
            await interaction.followup.send(
                'Sent to staff. Discord would not let a thread open for it, so '
                'the answer will come by message rather than in here.',
                ephemeral=True)


def _chunks(s, n):
    while s:
        cut = s[:n]
        if len(s) > n:
            at = cut.rfind('\n')
            if at > n // 2:
                cut = s[:at]
        yield cut
        s = s[len(cut):].lstrip('\n')


def is_staff(who):
    """
    Somebody holding one of the STAFF_ROLES roles, matched by id or by name.
    The one gate on /close, the Close ticket button and the
    ticket limits, and the same list that pulls staff into every ticket
    thread except Faction Leader, which uses UPPER_STAFF_ROLES.

    Nothing else makes somebody staff here, a channel permission included.
    This used to let in anybody the channel trusted with threads as well, and
    Lead Gamemaster and Trial Gamemaster carry Manage Threads on every channel
    (GM in Build-Discord.py) while neither is a staff role, so both could
    close any ticket and skip the ticket limits without one (#1342).

    Content Creator is not staff. That role is added to creator application
    threads through EXTRA_STAFF and nowhere else. It does not close tickets,
    and it does not skip the one open ticket rule or the five minute cooldown.

    A person whose roles cannot be read is not staff.
    """
    try:
        return _who_hits(who, STAFF_IDS, STAFF_NAMES)
    except Exception:
        return False


# ------------------------------------------------------- one at a time --
# From the To Do List: "A public panel that auto-adds staff to every thread is
# otherwise a free way to ping every moderator fifty times a minute". One
# ticket is a thread, every member of every staff role added to it one at a
# time, a post that mentions them all and a row in the site inbox, and the
# panel sits in a channel everybody can see. Before this nothing counted any of
# it. So a person gets one open ticket at a time, and one new ticket every five
# minutes. Staff are held to neither.
TICKET_COOLDOWN = _int_env('TICKET_COOLDOWN', 300)

# When each person last sent one. In memory, so a restart forgets it, and that
# is fine for a cooldown. The one open ticket rule is the one that has to
# survive a restart, and it does not live here.
_last_ticket = {}

# Which thread is each person's open ticket. On disk beside the code, for the
# same reason as STAMP further down: the process restarts in a loop, and a rule
# that forgets on every restart is not a rule. The thread name cannot carry it,
# because the name is the label and a display name, and a display name is
# neither unique nor fixed.
OPEN_TICKETS = os.path.join(DATA_DIR, 'open-tickets.json')


def _now():
    return time.monotonic()


def _ticket_key(guild, who):
    return '%s:%s' % (getattr(guild, 'id', 0), who.id)


def _open_tickets():
    try:
        with open(OPEN_TICKETS) as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _open_thread(guild, tid):
    """
    The thread, if it is still open, or None.

    get_thread reads the bot's own cache and asks Discord nothing, which
    matters on a click that has three seconds to be answered in. discord.py
    drops a thread from that cache the moment it is archived, and Close
    archives, so a closed ticket and a deleted one both come back None and
    the person is let through.
    """
    try:
        t = guild.get_thread(int(tid))
    except Exception:
        return None
    if t is None or getattr(t, 'archived', False):
        return None
    return t


def remember_ticket(guild, who, thread):
    """
    Write down that this thread is this person's open ticket.

    Entries for threads that are no longer open are dropped on the way, so the
    file stays the size of the queue rather than the size of everybody who
    ever asked for anything.
    """
    try:
        mine = '%s:' % getattr(guild, 'id', 0)
        keep = {}
        for k, v in _open_tickets().items():
            if k.startswith(mine) and _open_thread(guild, v) is None:
                continue
            keep[k] = v
        keep[_ticket_key(guild, who)] = thread.id
        with open(OPEN_TICKETS, 'w') as f:
            json.dump(keep, f)
    except Exception:
        log('could not write down which ticket %s has open, so they can open '
            'a second one:\n' % who + traceback.format_exc())


def forget_ticket(guild, who, thread):
    """
    Drop this thread from the open-ticket file, if it is still the one
    written. Used when a Faction Leader thread is deleted in the same
    submit that created it, so the person is not held to a ticket that
    no longer exists. Matches on the thread's id, never its name.
    """
    try:
        key = _ticket_key(guild, who)
        have = _open_tickets()
        if have.get(key) != getattr(thread, 'id', None):
            return
        have.pop(key, None)
        with open(OPEN_TICKETS, 'w') as f:
            json.dump(have, f)
    except Exception:
        log('could not forget the half-written ticket for %s:\n'
            % who + traceback.format_exc())


def ticket_refusal(interaction):
    """
    Why this person cannot open a ticket right now, in words, or None.

    Asked twice: when somebody picks from the panel, so they hear it before
    typing anything, and again when the form comes back, because the form can
    be opened several times before any of them is sent.

    Anything that goes wrong in here lets them through. A bug that refused
    every ticket would refuse every playtest application with it, and that is
    the only way in.
    """
    try:
        who = interaction.user
        guild = interaction.guild
        if guild is None or is_staff(who):
            return None
        key = _ticket_key(guild, who)
        tid = _open_tickets().get(key)
        t = _open_thread(guild, tid) if tid else None
        if t is not None:
            return ('You already have a ticket open: %s. Say it in there and '
                    'staff will see it.' % t.mention)
        at = _last_ticket.get(key)
        if at is not None:
            left = TICKET_COOLDOWN - (_now() - at)
            if left > 0:
                mins = int((left + 59) // 60)
                return ('You have only just sent a ticket. You can send '
                        'another in %d minute%s.'
                        % (mins, '' if mins == 1 else 's'))
        return None
    except Exception:
        log('the ticket limit could not be checked, so this one was let '
            'through:\n' + traceback.format_exc())
        return None


def is_ticket_thread(ch):
    """
    True for a thread a ticket opened: one off a channel named in
    TICKET_DESKS or TICKET_CHANNEL, the only places TicketModal opens one. A ticket
    that could not have its thread goes into the TICKET_LOG channel as a
    plain message, never a thread, so that channel has none to close.

    This used to be any thread at all (#1776). /close in a Live smoke session
    thread (since removed) or a #tales post archived and locked it and wrote "Closed: ..."
    into the staff ticket record as if it were a ticket.

    A thread whose parent is not in the bot's cache is not a ticket here:
    refusing a close costs nothing, since staff can still archive a thread by
    hand.
    """
    if not isinstance(ch, discord.Thread):
        return False
    name = getattr(ch.parent, 'name', None)
    return bool(name) and name.lower() in TICKET_NAMES


def faction_leader_label():
    for k, lab, _d in KINDS:
        if k == 'faction':
            return lab
    return 'Apply: Faction Leader'


def is_faction_leader_thread(ch):
    """
    A ticket thread TicketModal opened for Apply: Faction Leader.

    The name starts with that label because that is what on_submit writes.
    Used only to decide who may /close this kind. is_staff is not changed.
    """
    if not is_ticket_thread(ch):
        return False
    label = faction_leader_label()
    name = getattr(ch, 'name', None) or ''
    return bool(label) and name.startswith(label)


def holds_upper_staff(who):
    """A role whose ID is in UPPER_STAFF_ROLES. Names are ignored."""
    try:
        return _who_hits(who, UPPER_STAFF_IDS, set())
    except Exception:
        return False


def can_close_ticket(who, ch):
    """
    Staff close every ticket. On a Faction Leader thread, a member whose
    role ID is in UPPER_STAFF_ROLES may close it too. is_staff itself is
    not changed: ticket limits and cooldowns still answer to that.
    """
    if is_staff(who):
        return True
    return is_faction_leader_thread(ch) and holds_upper_staff(who)


async def close_here(interaction, why=None):
    """
    Close the ticket this was used in.

    Archived and locked rather than deleted. A ticket is the record of what
    somebody was told and when, and the one time anybody goes looking for it
    is the argument afterwards, so nothing here removes anything. Locked means
    it takes a staff member to open it again, not a stray message. It is
    deleted TICKET_KEEP_DAYS after it closes, by watch_closed_tickets and not
    here (#2353).

    Only in a ticket's own thread (is_ticket_thread), refused before anything
    is said, archived or written down.
    """
    ch = interaction.channel
    if not is_ticket_thread(ch):
        await interaction.response.send_message(
            'This one only works inside a ticket.', ephemeral=True)
        return

    # is_staff is unchanged and still gates every other ticket, the
    # one-open-ticket rule and the cooldown. Faction Leader threads
    # also let through a member whose role ID is in UPPER_STAFF_ROLES.
    if not can_close_ticket(interaction.user, ch):
        await interaction.response.send_message(
            'Staff close these. Say what you need in here and somebody will.',
            ephemeral=True)
        return

    line = 'Closed by %s.' % interaction.user.mention
    if why:
        line += ' ' + why.strip()
    line += ('\nEverybody who was in here can still read it, and staff can open '
             'it again. It is deleted %d days after it was last closed.'
             % TICKET_KEEP_DAYS)
    await interaction.response.send_message(line[:1900])

    # Archiving drops a thread out of the sidebar and out of the channel's
    # active list, and a private one is then behind two clicks nobody finds. A
    # closed ticket nobody can find again is barely better than a lost one, so
    # a line is written down somewhere searchable with a link straight back to
    # it. Somewhere being the staff channel, not the one people apply in.
    try:
        book = await log_channel(interaction.guild)
        if book is not None:
            note = 'Closed: **%s**. By %s.' % (
                ch.name, interaction.user.display_name)
            if why:
                note += ' ' + why.strip()
            note += '\n' + ch.jump_url
            await book.send(note[:1900])
    except Exception:
        log('could not write the ticket down:\n' + traceback.format_exc())

    # Sent first, then archived. The other way round the message never lands,
    # because an archived thread will not take one.
    try:
        await ch.edit(archived=True, locked=True)
    except Exception:
        try:
            await ch.edit(archived=True)
        except Exception:
            log('could not archive the ticket thread:\n' + traceback.format_exc())


class TicketTools(discord.ui.View):
    """Sits on the ticket's first message. Persistent, so it still works after
       the bot restarts rather than going dead the moment anything updates."""
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label='Close ticket', style=discord.ButtonStyle.secondary,
                       custom_id='thornswood:close')
    async def close(self, interaction, button):
        await close_here(interaction)


@tree.command(name='close', description='Close this ticket. Staff only.')
@discord.app_commands.describe(why='Optional. What was decided.')
async def close_cmd(interaction: discord.Interaction,
                    why: typing.Optional[str] = None):
    await close_here(interaction, why)


# HOW LONG A CLOSED TICKET IS KEPT (#2353). Closing archived and locked the
# thread and nothing ever deleted it, so it was the one store with no keeping
# time. Decided by Patrick on 19 Oct: the bot deletes a ticket thread
# TICKET_KEEP_DAYS after it closes, the same 365 days the site keeps its copy
# of the application (INBOX_DAYS in site/server.js). Discord cannot undo it.
#
# When it closed is Discord's own archive_timestamp, not a record of ours. It
# is set for every archived thread, so the tickets closed before this was
# written are aged too, and so is one staff archived by hand. Opening a ticket
# again and closing it moves the time on, so the year starts over. A ticket
# nobody closed is archived by Discord after a week with nothing said in it
# (auto_archive_duration in TicketModal), and the bot already counts it as
# closed: _open_thread lets its person open another. So it ages from then.
#
# Only threads the bot opened off a TICKET_CHANNEL channel: a private thread
# a Gamemaster opened there by hand (see the note in TicketModal) is not a
# ticket and is never touched.
TICKET_KEEP_DAYS = 365
TICKET_KEEP_EVERY = 60 * 60


def ticket_past_keeping(thread, bot_id, cut):
    """
    True when this thread is a ticket the bot opened, archived, and archived
    before cut, an aware datetime. A thread whose close time is not an aware
    datetime, or whose opener cannot be read, is kept rather than guessed at.
    """
    if bot_id is None or getattr(thread, 'owner_id', None) != bot_id:
        return False
    if getattr(thread, 'archived', None) is not True:
        return False
    at = getattr(thread, 'archive_timestamp', None)
    if not isinstance(at, datetime.datetime) or at.tzinfo is None:
        return False
    return at < cut


async def age_closed_tickets(guild, bot_id, now):
    """
    Deletes this server's ticket threads closed more than TICKET_KEEP_DAYS
    before now, and returns (deleted, failed). Each one deleted is a line in
    bot.log with its id and when it closed; the staff record's Closed line
    carries the same id in its link. A list that cannot be read, or a delete
    Discord refuses, is a line with Discord's reason, and that thread stays
    until the next pass.
    """
    cut = now - datetime.timedelta(days=TICKET_KEEP_DAYS)
    deleted = failed = 0
    for ch in getattr(guild, 'text_channels', []):
        if (getattr(ch, 'name', '') or '').lower() not in TICKET_NAMES:
            continue
        due = []
        try:
            # Discord lists them newest closed first and, given before, only
            # those closed before it. ticket_past_keeping still checks each.
            async for t in ch.archived_threads(private=True, limit=None,
                                               before=cut):
                if ticket_past_keeping(t, bot_id, cut):
                    due.append(t)
        except Exception as e:
            failed += 1
            log('closed tickets: could not list the closed threads in #%s of '
                '"%s", so none of them was deleted this pass: %s: %s'
                % (ch.name, guild.name, type(e).__name__, e))
            continue
        for t in due:
            try:
                await t.delete()
            except Exception as e:
                failed += 1
                log('closed tickets: could not delete thread %s in #%s, closed '
                    '%s: %s: %s' % (t.id, ch.name,
                                    t.archive_timestamp.date().isoformat(),
                                    type(e).__name__, e))
                continue
            deleted += 1
            log('closed tickets: deleted thread %s in #%s, closed %s, more '
                'than %d days ago' % (t.id, ch.name,
                                      t.archive_timestamp.date().isoformat(),
                                      TICKET_KEEP_DAYS))
    return deleted, failed


# THE STAFF TICKET LOG IS KEPT THE SAME 365 DAYS (#3634). The bot writes two
# things into the TICKET_LOG channel: a whole ticket whose private thread
# would not open (its title with the opener's name, the opener's mention and
# every answer they typed), and a Closed line naming the thread, which is the
# opener's name, at every close. age_closed_tickets deletes the threads and
# never read this channel, so those copies had no keeping time while the
# privacy page said a ticket goes after 365 days. Each of the bot's own
# messages there now goes TICKET_KEEP_DAYS after it was posted: a fallback
# ticket the same year as a ticket in a thread, and a Closed line the same
# year as the thread it points at, which is deleted a year after that close.
# Only the bot's own messages, and never in a channel tickets open off, so a
# panel is never touched if TICKET_LOG is ever pointed at one.
async def age_ticket_log(guild, bot_id, now):
    """
    Deletes the bot's own messages in this server's TICKET_LOG channels that
    were posted more than TICKET_KEEP_DAYS before now, and returns (deleted,
    failed). Said in bot.log as counts a channel, never what a message said.
    A history that cannot be read, or a delete Discord refuses, is a line
    with Discord's reason, and the message stays until the next pass.
    """
    if bot_id is None:
        return 0, 0
    cut = now - datetime.timedelta(days=TICKET_KEEP_DAYS)
    deleted = failed = 0
    for ch in getattr(guild, 'text_channels', []):
        name = (getattr(ch, 'name', '') or '').lower()
        if name not in TICKET_LOG or name in TICKET_NAMES:
            continue
        due = []
        try:
            async for m in ch.history(limit=None, before=cut):
                at = getattr(m, 'created_at', None)
                if (getattr(getattr(m, 'author', None), 'id', None) == bot_id
                        and isinstance(at, datetime.datetime)
                        and at.tzinfo is not None and at < cut):
                    due.append(m)
        except Exception as e:
            failed += 1
            log('ticket log: could not read #%s of "%s", so none of it was '
                'deleted this pass: %s: %s'
                % (ch.name, guild.name, type(e).__name__, e))
            continue
        gone = 0
        for m in due:
            try:
                await m.delete()
            except Exception as e:
                failed += 1
                log('ticket log: could not delete message %s in #%s, posted '
                    '%s: %s: %s' % (m.id, ch.name, m.created_at.date().isoformat(),
                                    type(e).__name__, e))
                continue
            gone += 1
        if gone:
            deleted += gone
            log('ticket log: deleted %d of the bot\'s messages in #%s posted '
                'more than %d days ago' % (gone, ch.name, TICKET_KEEP_DAYS))
    return deleted, failed


async def watch_closed_tickets():
    """
    Runs age_closed_tickets and age_ticket_log on every server as the bot
    comes up and every TICKET_KEEP_EVERY seconds, like watch_join_numbers.
    Nothing in here may end the loop: a pass that fails is said in bot.log,
    and the threads and messages it did not reach are there for the next one.
    """
    await client.wait_until_ready()
    while not client.is_closed():
        now = datetime.datetime.now(datetime.timezone.utc)
        bot_id = getattr(client.user, 'id', None)
        for gd in list(client.guilds):
            for age in (age_closed_tickets, age_ticket_log):
                try:
                    await age(gd, bot_id, now)
                except Exception:
                    log('closed tickets: the %s pass on "%s" stopped part way, '
                        'so what it did not reach waits for the next one:\n%s'
                        % (age.__name__, gd.name, traceback.format_exc()))
        await asyncio.sleep(TICKET_KEEP_EVERY)
