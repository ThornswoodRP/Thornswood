"""
The Member button in #start-here (#5841).

Part of the bot: bot.py loads it (#5357).

THE GATE (#3317, Patrick, 22 Oct 2026, page card q-3317-member-gate, A).
Somebody who joins sees Start Here. Member, which opens Information, comes
from a button in #start-here once they have answered two yes or no
questions: are they 18 or over, and do they accept the rules in #rules.
Until #5841 no part of the bot made that button, so Member reached people
only by hand and nobody had answered either question (the audit of 12 Nov
2026 named 20 Members and no record of a yes from any of them).

Two yeses give Member. The answer to the rules goes to the site's record of
who accepted them, against the Discord id, the way an application's does
(push, then /api/ticket, #428), so the staff inbox shows who took Member and
when. A no gives nothing and is not kept. Pressing it with Member already
says so and asks nothing.
"""
import os
import traceback

import discord

from bot_core import (_guild_roles, _role_tokens, _who_hits, by_name, client,
                      log, push_async)


GATE_CHANNEL = [n.strip().lower() for n in
                os.environ.get('MEMBER_GATE_CHANNEL', 'start-here').split(',')
                if n.strip()]
# The same setting the hold panel reads: an id or a name.
MEMBER_ROLE = os.environ.get('MEMBER_ROLE', 'Member').strip()
MEMBER_IDS, MEMBER_NAMES = _role_tokens([MEMBER_ROLE] if MEMBER_ROLE else [])

GATE_ID = 'thornswood:member:start'

GATE_PANEL = ('**Get the Member role**\n\n'
              'Member opens the announcement channels. Press the button and '
              'answer two questions: are you 18 or over, and do you accept '
              'the rules in #rules. Your answer to the rules is kept against '
              'your Discord account.')

AGE_ASK = 'Are you 18 or over? Thornswood is an adult server.'
RULES_ASK = 'Do you accept the rules in #rules?'
UNDER_AGE = ('Thornswood is 18 and over, so Member cannot be given. '
             'If you pressed No by mistake, press the button again.')
NOT_RULES = ('Member needs the rules accepted. Read #rules, then press the '
             'button again.')
ALREADY = 'You have the Member role already.'
GIVEN = 'You have the Member role now. The announcement channels are open to you.'
CANNOT = ('Member cannot be given right now. Ask staff in a ticket, and they '
          'will sort it.')
WENT_WRONG = 'That did not go through. Press the button again, or ask staff.'


def member_role(guild):
    found = _guild_roles(guild, MEMBER_IDS, MEMBER_NAMES)
    return found[0] if found else None


def has_member(who):
    return _who_hits(who, MEMBER_IDS, MEMBER_NAMES)


def can_give(guild, role):
    """Discord refuses a role at or above the bot's own highest with a bare
       Forbidden, so it is checked first and logged in words."""
    me = guild.me
    return bool(me.guild_permissions.manage_roles) and role < me.top_role


def rules_record(name):
    """What the site keeps for a yes from the button (#428's shape)."""
    return {'said': 'Yes, by the Member button in #start-here, after saying '
                    'they are 18 or over', 'yes': True}


async def give_member(interaction):
    """Both answers were yes: give Member and send the rules answer to the
       site. Returns the words to show."""
    guild, who = interaction.guild, interaction.user
    if guild is None:
        return CANNOT
    if has_member(who):
        return ALREADY
    role = member_role(guild)
    if role is None or not can_give(guild, role):
        log('cannot give Member: the role %s is missing, or the bot has no '
            'Manage Roles, or its own role is not above it.' % MEMBER_ROLE)
        return CANNOT
    try:
        await who.add_roles(role, reason='Said 18 or over and accepted the rules '
                                         'in #start-here (#5841)')
    except Exception:
        log('Member was not given:\n' + traceback.format_exc())
        return WENT_WRONG
    name = str(getattr(who, 'display_name', None) or getattr(who, 'name', ''))
    log('gave Member to %s, who said 18 or over and accepted the rules' % who.id)
    await push_async('member', 'Took Member: %s' % name[:60],
                     'Said they are 18 or over and accept the rules, by the '
                     'Member button in #start-here.',
                     name[:60], who.id, rules_record(name))
    return GIVEN


class Answer(discord.ui.Button):
    def __init__(self, label, yes, step):
        super().__init__(label=label,
                         style=(discord.ButtonStyle.success if yes
                                else discord.ButtonStyle.secondary))
        self.yes = yes
        self.step = step

    async def callback(self, interaction):
        try:
            if not self.yes:
                await interaction.response.edit_message(
                    content=UNDER_AGE if self.step == 'age' else NOT_RULES, view=None)
                return
            if self.step == 'age':
                await interaction.response.edit_message(content=RULES_ASK,
                                                        view=Question('rules'))
                return
            said = await give_member(interaction)
            await interaction.response.edit_message(content=said, view=None)
        except Exception:
            log('Member question failed:\n' + traceback.format_exc())


class Question(discord.ui.View):
    """One question, Yes and No, only for the person who pressed. Not
       persistent: an answer left for ten minutes asks again from the start."""
    def __init__(self, step):
        super().__init__(timeout=600)
        self.add_item(Answer('Yes', True, step))
        self.add_item(Answer('No', False, step))


class GateButton(discord.ui.Button):
    def __init__(self):
        super().__init__(label='Get Member', style=discord.ButtonStyle.primary,
                         custom_id=GATE_ID)

    async def callback(self, interaction):
        try:
            if has_member(interaction.user):
                await interaction.response.send_message(ALREADY, ephemeral=True)
                return
            await interaction.response.send_message(AGE_ASK, view=Question('age'),
                                                    ephemeral=True)
        except Exception:
            log('Member button failed:\n' + traceback.format_exc())


class MemberGatePanel(discord.ui.View):
    """Persistent, like the hold panel, so the button outlives a restart."""
    def __init__(self):
        super().__init__(timeout=None)
        self.add_item(GateButton())


def _ids(msg):
    out = []
    for row in getattr(msg, 'components', None) or []:
        for item in getattr(row, 'children', None) or []:
            out.append(getattr(item, 'custom_id', ''))
    return out


def gate_panel_is_current(msg):
    return getattr(msg, 'content', None) == GATE_PANEL and _ids(msg) == [GATE_ID]


async def ensure_member_gate(guild):
    ch = by_name(guild, GATE_CHANNEL)
    if ch is None:
        log('there is no #%s in "%s", so there is no Member button. Set '
            'MEMBER_GATE_CHANNEL in bot.env.json to the right channel.'
            % (GATE_CHANNEL[0], guild.name))
        return
    if member_role(guild) is None:
        log('there is no %s role, so the Member button will say so.' % MEMBER_ROLE)
    try:
        async for m in ch.history(limit=50):
            if m.author.id == client.user.id and GATE_ID in _ids(m):
                if gate_panel_is_current(m):
                    log('Member button is already current in #%s' % ch.name)
                    return
                await m.edit(content=GATE_PANEL, view=MemberGatePanel())
                log('Member button updated in #%s' % ch.name)
                return
        await ch.send(GATE_PANEL, view=MemberGatePanel())
        log('Member button posted in #%s' % ch.name)
    except Exception:
        log('Member button failed to post:\n' + traceback.format_exc())
