"""
React to the rules, get Member (#5841).

Part of the bot: bot.py loads it (#5357).

THE ORDER (Patrick, 12 Nov 2026, page cards q-discord-hand-given-member and
q-discord-readback, A): somebody new sees #rules and #welcome-travelers.
Reacting to the rules gives Member, and the reaction is the record that they
accept the rules and are 18 or over (the rules open with that). Member opens
the welcome, about and application channels. An approved application gives
Playtester, which opens the rest. "Don't make it a button."

The bot keeps one message of its own in #rules, GATE_TEXT, and reacts to it
with MARK so there is something to press. It is a message apart from the
rules' own words, which Build-Discord.py -Posts deletes and writes again: a
reaction on those would go with them. Build-Discord.py leaves any message of
the bot's that starts with GATE_FIRST_LINE (doc_post_of_mine).

Member follows the reaction. Adding MARK gives Member and taking it off takes
Member off, and each is sent to the site's record of who accepted the rules
against the Discord id (#428), which also puts a line in the staff inbox. A
reaction added or taken off while the bot was not running reaches no event,
so when the bot starts it reads who has reacted and sets Member to match:
given to everybody who reacted, taken from everybody else. That is how the
Members given by hand before this, who never answered anything (the audit of
12 Nov named 15), come off and get it back by reacting.

STAFF AND PLAYTESTERS TOO (Patrick, 12 Nov 2026, 3:32 PM, after he took his
own reaction off and kept Member: "yeah staff loose it to but only that role,
they keep their other roles Obviosuly so it doesnt really change anything for
them"). Member follows the reaction for everybody; only Member is touched, so
a Playtester's or staff member's own roles still open what they open.

Only Member is ever given or taken here.
"""
import os
import traceback

from bot_core import (STAFF_IDS, STAFF_NAMES, _guild_roles, _role_tokens,
                      _who_hits, by_name, client, log, push_async)
from bot_tickets import SEAT_RULE_STAFF


RULES_CHANNEL = [n.strip().lower() for n in
                 os.environ.get('RULES_CHANNEL', 'rules').split(',') if n.strip()]
# The same setting the hold panel reads: an id or a name.
MEMBER_ROLE = os.environ.get('MEMBER_ROLE', 'Member').strip()
MEMBER_IDS, MEMBER_NAMES = _role_tokens([MEMBER_ROLE] if MEMBER_ROLE else [])
TESTER_IDS, TESTER_NAMES = _role_tokens(['Playtester'])
# Every staff role, Trial Gamemaster, Content Creator and Support included:
# each opens more than Member (Build-Discord.py's STAFF, which
# test-rules-gate.py holds this to). STAFF_ROLES ids count too.
EVERY_STAFF_IDS, EVERY_STAFF_NAMES = _role_tokens(list(SEAT_RULE_STAFF))

MARK = '\N{WHITE HEAVY CHECK MARK}'
# Build-Discord.py keeps any message of the bot's that starts with this line,
# so the words below can change without the build learning them again.
GATE_FIRST_LINE = '**React here for the Member role**'
GATE_TEXT = (GATE_FIRST_LINE + '\n\n'
             'React with ' + MARK + ' on this message to say you are 18 or '
             'over and you accept the rules in this channel. That gives you '
             'the Member role, which opens the welcome, about and application '
             'channels. Your reaction is the record that you accepted them. '
             'Take it off and Member comes off with it.\n\n'
             'Once a playtest application is approved, Playtester opens the '
             'rest of the Discord.')

# The gate message's id in each server, found or posted when the bot starts.
GATE_IDS = {}


def member_role(guild):
    found = _guild_roles(guild, MEMBER_IDS, MEMBER_NAMES)
    return found[0] if found else None


def keeps_more(who):
    """Playtester or staff: their own roles open more than Member (the ping
       buttons let them in without it, bot_pings.py). The gate takes Member
       from them like anybody else."""
    return (_who_hits(who, TESTER_IDS, TESTER_NAMES)
            or _who_hits(who, EVERY_STAFF_IDS, EVERY_STAFF_NAMES)
            or _who_hits(who, STAFF_IDS, STAFF_NAMES))


def can_give(guild, role):
    """Discord refuses a role at or above the bot's own highest with a bare
       Forbidden, so it is checked first and logged in words."""
    me = guild.me
    return bool(me.guild_permissions.manage_roles) and role < me.top_role


def _name(who):
    return str(getattr(who, 'display_name', None) or getattr(who, 'name', ''))[:60]


# What the site's record says, and the staff inbox line, for each way Member
# moves here.
SAID = {
    'reacted': ('Yes, by reacting to the rules in #rules: 18 or over and the rules accepted',
                'Took Member', 'Reacted to the rules, so Member was given.'),
    'unreacted': ('Took their reaction to the rules off',
                  'Gave up Member', 'Took their reaction to the rules off, so Member came off.'),
    'never': ('Had Member without a reaction to the rules',
              'Member taken off',
              'Had Member without a reaction to the rules in #rules, so Member came '
              'off. Reacting there gives it back.'),
}


async def record(who, how):
    """The site's record of who accepted the rules (#428), and a line in the
       staff inbox."""
    said, title, detail = SAID[how]
    accepted = how == 'reacted'
    await push_async('member', '%s: %s' % (title, _name(who)), detail, _name(who),
                     who.id, {'said': said, 'yes': bool(accepted)})


async def set_member(guild, who, want, why):
    """Give or take Member. True when it changed."""
    role = member_role(guild)
    if role is None or not can_give(guild, role):
        log('cannot %s Member: the role %s is missing, or the bot has no Manage '
            'Roles, or its own role is not above it.'
            % ('give' if want else 'take', MEMBER_ROLE))
        return False
    has = role in getattr(who, 'roles', [])
    if has == want:
        return False
    try:
        if want:
            await who.add_roles(role, reason=why)
        else:
            await who.remove_roles(role, reason=why)
        return True
    except Exception:
        log('Member was not %s for %s:\n%s'
            % ('given' if want else 'taken', who.id, traceback.format_exc()))
        return False


def _is_gate(payload):
    return (GATE_IDS.get(payload.guild_id) == payload.message_id
            and str(payload.emoji) == MARK
            and payload.user_id != client.user.id)


async def reacted(payload):
    if not _is_gate(payload):
        return
    guild = client.get_guild(payload.guild_id)
    who = getattr(payload, 'member', None) or (guild and guild.get_member(payload.user_id))
    if guild is None or who is None or getattr(who, 'bot', False):
        return
    if await set_member(guild, who, True, 'Reacted to the rules in #rules'):
        log('gave Member to %s, who reacted to the rules' % who.id)
        await record(who, 'reacted')


async def unreacted(payload):
    if not _is_gate(payload):
        return
    guild = client.get_guild(payload.guild_id)
    who = guild and guild.get_member(payload.user_id)
    if guild is None or who is None or getattr(who, 'bot', False):
        return
    # Staff and Playtesters too: only Member comes off (Patrick, 12 Nov).
    if await set_member(guild, who, False, 'Took their reaction to the rules off'):
        log('took Member from %s, who took their reaction to the rules off' % who.id)
    await record(who, 'unreacted')


@client.event
async def on_raw_reaction_add(payload):
    try:
        await reacted(payload)
    except Exception:
        log('rules reaction failed:\n' + traceback.format_exc())


@client.event
async def on_raw_reaction_remove(payload):
    try:
        await unreacted(payload)
    except Exception:
        log('rules reaction removal failed:\n' + traceback.format_exc())


async def _find(ch):
    async for m in ch.history(limit=100):
        if (m.author.id == client.user.id
                and (getattr(m, 'content', '') or '').startswith(GATE_FIRST_LINE)):
            return m
    return None


async def _reactors(msg):
    """The ids of everybody who has reacted with MARK, the bot left out."""
    out = set()
    for r in getattr(msg, 'reactions', None) or []:
        if str(r.emoji) == MARK:
            async for u in r.users():
                if u.id != client.user.id:
                    out.add(u.id)
    return out


async def match_members(guild, reactors):
    """Member to everybody who reacted and from everybody else, staff and
       Playtesters included. The counts go in the log."""
    role = member_role(guild)
    if role is None:
        return 0, 0
    given = taken = 0
    for who in guild.members:
        if getattr(who, 'bot', False):
            continue
        if who.id in reactors:
            if await set_member(guild, who, True, 'Reacted to the rules in #rules'):
                given += 1
                await record(who, 'reacted')
        elif role in who.roles:
            if await set_member(guild, who, False,
                                'Has not reacted to the rules in #rules'):
                taken += 1
                await record(who, 'never')
    return given, taken


async def ensure_rules_gate(guild):
    ch = by_name(guild, RULES_CHANNEL)
    if ch is None:
        log('there is no #%s in "%s", so nobody can react for Member. Set '
            'RULES_CHANNEL in bot.env.json to the right channel.'
            % (RULES_CHANNEL[0], guild.name))
        return
    if member_role(guild) is None:
        log('there is no %s role, so reacting to the rules gives nothing.' % MEMBER_ROLE)
    try:
        msg = await _find(ch)
        if msg is None:
            msg = await ch.send(GATE_TEXT)
            log('the Member reaction message is posted in #%s' % ch.name)
        elif msg.content != GATE_TEXT:
            await msg.edit(content=GATE_TEXT)
            log('the Member reaction message is updated in #%s' % ch.name)
        GATE_IDS[guild.id] = msg.id
        mine = any(str(r.emoji) == MARK and getattr(r, 'me', False)
                   for r in getattr(msg, 'reactions', None) or [])
        if not mine:
            await msg.add_reaction(MARK)
        reactors = await _reactors(msg)
    except Exception:
        log('the Member reaction message failed, so Member was left as it is:\n'
            + traceback.format_exc())
        return
    given, taken = await match_members(guild, reactors)
    log('Member follows the rules reaction in #%s: %d reacted, %d given Member, '
        '%d without a reaction had it taken off' % (ch.name, len(reactors), given, taken))
