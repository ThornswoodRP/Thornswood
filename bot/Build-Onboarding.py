#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
  Build-Onboarding.py

  Sets Discord's onboarding (Server Settings, Onboarding) from the rows it was
  written out in, issue #427: the default channels (board.json r25n), the hold
  question (r26n, r27n) and the "what are you here for" question (r28n).

  Everything is looked up by NAME on the server when it runs, so the roles and
  channels it hands out are the real ones on the day, not ids copied into a
  file that goes stale. It talks to Discord's REST API directly
  (GET and PUT /guilds/{id}/onboarding), so it needs no discord.py.

      python bot\\Build-Onboarding.py --check          reads, prints, changes nothing
      python bot\\Build-Onboarding.py --off            writes it, leaves it switched off
      python bot\\Build-Onboarding.py                  writes it and switches it on

  scripts\\deploy\\Set-DiscordOnboarding.ps1 asks for the token without showing
  it and runs this. Run --check first, every time.

  THE APPLICATION GATE. Since 23 and 24 September somebody who joins sees
  #welcome, #rules, #start-here, #disboard and the Applications category, and
  nothing else until staff give them Member (Build-Discord.py, THE GATE). The
  game itself opens on a separate role given when an application is accepted
  (site\\server.js access.play, Playtester). So by default this hands out no
  role at all: the hold question, which gives Member and a Citizen role, is
  left out, because holds are picked in #choose-your-hold once somebody is in
  (bot.py). --grant-member puts the hold question back exactly as r26n and r27n
  wrote it, and with it everybody who answers gets Member. It never hands out
  a role that opens the game or carries any power: see ALLOWED_ROLES.

  RULES AND AGE, OFF UNLESS ASKED. Entry 181 asked whether accepting the rules
  and stating the age go into onboarding too, so it is switched on once.
  --rules and --age each add one required question with a single answer, and
  both are off by default until Patrick and Djinn decide.

  WHAT DISCORD REFUSES. With onboarding on, Discord wants at least 7 default
  channels and at least 5 of them that @everyone can post in. Channels only
  some roles can see cannot be default channels or answers. The check works all
  of that out from the server as it is, says exactly which channel fails and
  why, and sends nothing while anything fails.

  The token is read from DISCORD_TOKEN and never printed. The bot needs Manage
  Server and Manage Roles for the PUT (Discord's rule for this endpoint). It
  keeps Administrator (#3317, Patrick, 22 Oct 2026), which covers both.
"""

import json
import os
import sys

API = 'https://discord.com/api/v10'

# Discord's permission bits, by number off
# https://docs.discord.com/developers/topics/permissions
ADMINISTRATOR = 1 << 3
MANAGE_CHANNELS = 1 << 4
MANAGE_GUILD = 1 << 5
VIEW_CHANNEL = 1 << 10
SEND_MESSAGES = 1 << 11
MANAGE_MESSAGES = 1 << 13
MANAGE_ROLES = 1 << 28
KICK_MEMBERS = 1 << 1
BAN_MEMBERS = 1 << 2
MODERATE_MEMBERS = 1 << 40
# A role that anybody can pick for themselves must not carry any of these.
POWERS = (('Administrator', ADMINISTRATOR), ('Manage Server', MANAGE_GUILD),
          ('Manage Roles', MANAGE_ROLES), ('Manage Channels', MANAGE_CHANNELS),
          ('Manage Messages', MANAGE_MESSAGES), ('Kick Members', KICK_MEMBERS),
          ('Ban Members', BAN_MEMBERS), ('Timeout Members', MODERATE_MEMBERS))

# Channel types that can be a default channel or an answer's channel: text,
# announcement and forum.
TEXTLIKE = (0, 5, 15)

# Discord's limits on the words, as its onboarding screen enforces them.
PROMPT_TITLE_MAX = 100
OPTION_TITLE_MAX = 50
OPTION_DESCRIPTION_MAX = 100

HOLDS = ['Whiterun', 'Solitude', 'Windhelm', 'Riften', 'Markarth',
         'Dawnstar', 'Morthal', 'Falkreath', 'Winterhold']

# What each hold is worth saying about, from bot\README.md's onboarding table.
HOLD_WORDS = {
    'Whiterun': 'The middle of everything',
    'Solitude': 'Court, trade, and the embassy',
    'Windhelm': "The High King's seat",
    'Riften': 'Fish, mead, and the Ratway',
    'Markarth': 'Stone, silver and old grudges',
    'Dawnstar': 'Cold, and the ships come in',
    'Morthal': "A swamp and the Jarl's hall",
    'Falkreath': 'Pines, and a graveyard bigger than the town',
    'Winterhold': 'What is left of it',
}

# The only roles onboarding may ever hand out. Member opens the Discord and
# nothing else; a Citizen role opens one hold's channel. Neither is on the
# list that opens the game (site\server.js access.play), and Playtester,
# every staff role, the Jarls and the Patreon tiers are given by a person.
ALLOWED_ROLES = ['Member'] + ['Citizen of ' + h for h in HOLDS]

# r25n. The first four are read only, the other five are where people talk.
DEFAULT_CHANNELS = ['welcome', 'rules', 'start-here', 'news',
                    'general', 'media', 'character-introductions', 'tales',
                    'rp-appreciation']


def plan(grant_member=False, rules=False, age=False):
    """What onboarding should be, by name. Nothing here knows an id.

       Questions are dicts: title, single (pick one), required, and options,
       each with a title, a description, role names and channel names."""
    prompts = []
    if rules:
        prompts.append(dict(
            key='rules',
            title='Have you read the rules?',
            single=True, required=True,
            options=[dict(title='I have read them and will keep to them',
                          description='Seven rules in #rules, short on purpose.',
                          roles=[], channels=['rules'])]))
    if age:
        prompts.append(dict(
            key='age',
            title='Thornswood is eighteen and over. Are you?',
            single=True, required=True,
            options=[dict(title='Yes, I am 18 or over',
                          description='Answering yes is you stating that you are.',
                          roles=[], channels=['rules'])]))
    if grant_member:
        # r26n and r27n. Pick one, members must answer. Every hold gives
        # Member and its own Citizen role, which is what opens that hold's
        # channel, so the hold channel itself is not listed: it is private,
        # and Discord takes only channels everybody can see as an answer.
        opts = []
        for h in HOLDS:
            opts.append(dict(title=h, description=HOLD_WORDS[h],
                             roles=['Member', 'Citizen of ' + h], channels=[]))
        opts.append(dict(title='Not decided yet',
                         description='Pick one later in #choose-your-hold.',
                         roles=['Member'], channels=[]))
        prompts.append(dict(
            key='hold',
            title='Which hold does your character call home?',
            single=True, required=True, options=opts))
    # r28n. Pick several, optional, channels only. r28n pointed "I want to
    # help test" at #test-these, which only testers and staff can see; testing
    # starts with an application now, so it points there instead: since the
    # ticket split (#3317, page card q-3317-ticket-split, A) that is
    # #apply-to-playtest.
    prompts.append(dict(
        key='here-for',
        title='What are you here for?',
        single=False, required=False,
        options=[
            dict(title='Roleplay', description='Stories from out there, one post each.',
                 roles=[], channels=['tales']),
            dict(title='Just playing', description='Talk about anything in #general.',
                 roles=[], channels=['general']),
            dict(title='I want to help test',
                 description='Testing starts with an application in #apply-to-playtest.',
                 roles=[], channels=['apply-to-playtest']),
            dict(title='I make videos', description='Screenshots and clips go in #media.',
                 roles=[], channels=['media']),
        ]))
    return dict(default_channels=list(DEFAULT_CHANNELS), prompts=prompts)


# ------------------------------------------------------------ the server --

def everyone_can(guild, channel):
    """(see, post) for @everyone in this channel: @everyone's own role, then
       the channel's overwrite for @everyone, Discord's documented order. The
       @everyone role's id is the guild's id. Posting in a forum is Send
       Messages too."""
    gid = str(guild['id'])
    base = 0
    for r in guild.get('roles', []):
        if str(r['id']) == gid:
            base = int(r.get('permissions', 0))
    if base & ADMINISTRATOR:
        return True, True
    for ow in channel.get('permission_overwrites') or []:
        if str(ow.get('id')) == gid:
            base = (base & ~int(ow.get('deny', 0))) | int(ow.get('allow', 0))
    see = bool(base & VIEW_CHANNEL)
    return see, see and bool(base & SEND_MESSAGES)


def _by_name(items, name, kinds=None):
    want = name.lower()
    return [i for i in items if (i.get('name') or '').lower() == want
            and (kinds is None or i.get('type') in kinds)]


def resolve(want, guild, current=None, enabled=True):
    """Turns the plan into the PUT body, using the ids on this server.

       Returns (body, problems, lines). problems is a list of sentences, each
       one a reason Discord would refuse this or a reason not to send it;
       nothing is sent while there is one. lines is what the plan does, in
       words, for --check to print."""
    problems, lines = [], []
    roles = guild.get('roles', [])
    chans = guild.get('channels', [])
    current = current or {}
    old_prompts = dict(((p.get('title') or '').lower(), p)
                       for p in current.get('prompts') or [])

    def channel(name, where):
        found = _by_name(chans, name, TEXTLIKE)
        if not found:
            problems.append('#%s (%s) is not on the server.' % (name, where))
            return None
        if len(found) > 1:
            problems.append('There are %d channels called #%s (%s). Rename one '
                            'so it is clear which is meant.' % (len(found), name, where))
            return None
        ch = found[0]
        see, post = everyone_can(guild, ch)
        if not see:
            problems.append('#%s (%s) is hidden from people who have just joined, '
                            'and Discord only takes channels everybody can see.'
                            % (name, where))
        return ch

    def role(name, where):
        if name not in ALLOWED_ROLES:
            problems.append('%s (%s) is not a role onboarding may hand out. Only '
                            'Member and the Citizen roles are.' % (name, where))
            return None
        found = _by_name(roles, name)
        if not found:
            problems.append('The role %s (%s) is not on the server. Make it first, '
                            'with exactly that name.' % (name, where))
            return None
        if len(found) > 1:
            problems.append('There are %d roles called %s (%s).' % (len(found), name, where))
            return None
        r = found[0]
        perms = int(r.get('permissions', 0))
        powers = [n for n, bit in POWERS if perms & bit]
        if powers:
            problems.append('The role %s carries %s, and anybody picking an answer '
                            'would get it. Take that off the role first.'
                            % (name, ', '.join(powers)))
        if r.get('managed'):
            problems.append('The role %s belongs to an integration and cannot be '
                            'handed out.' % name)
        return r

    # Default channels.
    default_ids, writable = [], 0
    lines.append('Default channels, everybody lands in these:')
    for name in want['default_channels']:
        ch = channel(name, 'a default channel')
        if ch is None:
            lines.append('  #%-26s not found' % name)
            continue
        see, post = everyone_can(guild, ch)
        default_ids.append(str(ch['id']))
        writable += 1 if post else 0
        lines.append('  #%-26s %s' % (name, 'everybody can post' if post else
                                      ('read only' if see else 'HIDDEN until a role opens it')))
    lines.append('  %d channels, %d that everybody can post in. Discord wants 7 and 5.'
                 % (len(default_ids), writable))
    if enabled:
        if len(default_ids) < 7:
            problems.append('Only %d default channels were found, and Discord wants '
                            'at least 7.' % len(default_ids))
        if writable < 5:
            problems.append('Only %d of the default channels let everybody post, and '
                            'Discord wants at least 5. Read only channels do not '
                            'count.' % writable)

    # Questions.
    prompts = []
    for i, q in enumerate(want['prompts']):
        if len(q['title']) > PROMPT_TITLE_MAX:
            problems.append('The question "%s" is longer than Discord takes.' % q['title'])
        old = old_prompts.get(q['title'].lower())
        old_opts = dict(((o.get('title') or '').lower(), o)
                        for o in (old or {}).get('options') or [])
        lines.append('')
        lines.append('Question: %s' % q['title'])
        lines.append('  %s, %s%s' % ('pick one' if q['single'] else 'pick several',
                                     'members must answer' if q['required'] else 'optional',
                                     ', keeps its place' if old else ''))
        options = []
        for o in q['options']:
            where = 'answer "%s"' % o['title']
            if len(o['title']) > OPTION_TITLE_MAX:
                problems.append('The %s is longer than the %d characters Discord takes.'
                                % (where, OPTION_TITLE_MAX))
            if len(o.get('description') or '') > OPTION_DESCRIPTION_MAX:
                problems.append('The description of the %s is longer than the %d '
                                'characters Discord takes.' % (where, OPTION_DESCRIPTION_MAX))
            rids, cids, said = [], [], []
            for rn in o['roles']:
                r = role(rn, where)
                if r is not None:
                    rids.append(str(r['id']))
                said.append('gives ' + rn)
            for cn in o['channels']:
                ch = channel(cn, where)
                if ch is not None:
                    cids.append(str(ch['id']))
                said.append('shows #' + cn)
            if not o['roles'] and not o['channels']:
                problems.append('The %s gives nothing, and Discord wants a role or a '
                                'channel on every answer.' % where)
            opt = dict(title=o['title'], description=o.get('description') or '',
                       role_ids=rids, channel_ids=cids)
            prev = old_opts.get(o['title'].lower())
            if prev is not None and prev.get('id'):
                opt['id'] = str(prev['id'])
            options.append(opt)
            lines.append('  %-26s %s' % (o['title'], ', '.join(said)))
        prompts.append(dict(
            id=str(old['id']) if old is not None and old.get('id') else str(i),
            type=0, title=q['title'], options=options,
            single_select=bool(q['single']), required=bool(q['required']),
            in_onboarding=True))

    # Questions already there that the plan does not have are replaced, so say so.
    kept = set(q['title'].lower() for q in want['prompts'])
    for t, p in old_prompts.items():
        if t not in kept:
            lines.append('')
            lines.append('Replaced: the question "%s" that is there now.' % p.get('title'))

    body = dict(prompts=prompts, default_channel_ids=default_ids,
                enabled=bool(enabled), mode=0)
    return body, problems, lines


# -------------------------------------------------------------- the wire --

class Refused(Exception):
    def __init__(self, status, text):
        Exception.__init__(self, '%s %s' % (status, text))
        self.status, self.text = status, text


class Api(object):
    """Discord's REST API with the bot's token. The token only ever goes into
       the Authorization header."""

    def __init__(self, token):
        self._token = token

    def call(self, method, path, body=None, reason=None):
        import time
        import urllib.request
        import urllib.error
        data = json.dumps(body).encode('utf-8') if body is not None else None
        for attempt in range(3):
            req = urllib.request.Request(API + path, data=data, method=method)
            req.add_header('Authorization', 'Bot ' + self._token)
            req.add_header('User-Agent', 'DiscordBot (https://thornswood.net, 1)')
            if data is not None:
                req.add_header('Content-Type', 'application/json')
            if reason:
                req.add_header('X-Audit-Log-Reason', reason)
            try:
                with urllib.request.urlopen(req, timeout=30) as res:
                    raw = res.read().decode('utf-8')
                    return json.loads(raw) if raw else None
            except urllib.error.HTTPError as e:
                text = e.read().decode('utf-8', 'replace')
                if e.code == 429 and attempt < 2:
                    try:
                        wait = float(json.loads(text).get('retry_after', 1))
                    except Exception:
                        wait = 1.0
                    time.sleep(min(wait, 10))
                    continue
                raise Refused(e.code, text)
        raise Refused(429, 'still rate limited')


def fetch(api, guild_id):
    """The server as the plan needs it: the guild with its roles, the
       channels with their overwrites, the onboarding there now, and the bot's
       own permissions."""
    g = api.call('GET', '/guilds/%s' % guild_id)
    g['channels'] = api.call('GET', '/guilds/%s/channels' % guild_id) or []
    onboarding = api.call('GET', '/guilds/%s/onboarding' % guild_id) or {}
    me = api.call('GET', '/users/@me') or {}
    # The bot's own member. A refusal here goes to the caller like the reads
    # above (#2736): it used to leave perms at 0, which then said the bot
    # lacked Manage Server and Manage Roles when Discord had only refused a
    # read.
    perms = 0
    member = api.call('GET', '/guilds/%s/members/%s' % (guild_id, me.get('id')))
    held = set(str(x) for x in (member or {}).get('roles') or []) | set([str(guild_id)])
    for r in g.get('roles', []):
        if str(r['id']) in held:
            perms |= int(r.get('permissions', 0))
    return g, onboarding, perms


def pick_guild(api, asked):
    if asked:
        return asked
    mine = api.call('GET', '/users/@me/guilds') or []
    if len(mine) == 1:
        return str(mine[0]['id'])
    print('The bot is in %d servers. Say which with --guild:' % len(mine))
    for g in mine:
        print('  %-40s %s' % (g.get('name'), g.get('id')))
    return None


def describe_now(guild, onboarding):
    names = dict((str(c['id']), c.get('name')) for c in guild.get('channels', []))
    out = ['Onboarding on %s now: %s, %d question(s), %d default channel(s).'
           % (guild.get('name'), 'ON' if onboarding.get('enabled') else 'off',
              len(onboarding.get('prompts') or []),
              len(onboarding.get('default_channel_ids') or []))]
    chosen = ['#' + (names.get(str(c)) or str(c))
              for c in onboarding.get('default_channel_ids') or []]
    if chosen:
        out.append('  ' + ' '.join(chosen))
    return out


USAGE = """\
python bot\\Build-Onboarding.py [--check] [--off] [--grant-member] [--rules] [--age]
                                [--guild <id>] [--body]

  --check         read the server and say what would be set. Changes nothing.
  --off           write the questions and channels but leave onboarding off,
                  so Preview can be walked before anybody sees it
  --grant-member  add the hold question, which gives Member and a Citizen role
                  to everybody who answers (off: the application gate stays)
  --rules         add a required "have you read the rules" question (off)
  --age           add a required "are you 18 or over" question (off)
  --guild <id>    which server, when the bot is in more than one
  --body          also print the exact body it would send
"""


def main(argv, api=None, out=print):
    args = list(argv)
    if '-h' in args or '--help' in args:
        out(USAGE)
        return 0
    known = ('--check', '--off', '--grant-member', '--rules', '--age', '--guild', '--body')
    guild_id = None
    if '--guild' in args:
        i = args.index('--guild')
        guild_id = (args[i + 1] if i + 1 < len(args) else '').strip()
        if not guild_id.isdigit():
            out('--guild wants the server id, the long number.')
            return 2
        del args[i:i + 2]
    for a in args:
        if a not in known:
            out('Not an option here: %s\n' % a)
            out(USAGE)
            return 2
    check = '--check' in args
    enabled = '--off' not in args
    guild_id = guild_id or os.environ.get('DISCORD_GUILD', '').strip() or None

    if api is None:
        token = os.environ.get('DISCORD_TOKEN', '').strip()
        if not token:
            out('No token. Set DISCORD_TOKEN first, or run '
                'scripts\\deploy\\Set-DiscordOnboarding.ps1.')
            return 2
        api = Api(token)

    want = plan(grant_member='--grant-member' in args,
                rules='--rules' in args, age='--age' in args)
    try:
        guild_id = pick_guild(api, guild_id)
        if guild_id is None:
            return 2
        guild, now, bot_perms = fetch(api, guild_id)
    except Refused as e:
        out('Discord refused the read (%s). Check the token and that the bot is '
            'in the server.' % e.status)
        return 2

    for line in describe_now(guild, now):
        out(line)
    out('')
    body, problems, lines = resolve(want, guild, now, enabled)
    for line in lines:
        out(line)
    out('')
    out('Rules question: %s. Age question: %s. Hold question: %s.'
        % ('in' if '--rules' in args else 'off (--rules adds it)',
           'in' if '--age' in args else 'off (--age adds it)',
           'in, gives Member' if '--grant-member' in args
           else 'off, the application gate stays (--grant-member adds it)'))
    out('Onboarding would be %s after this.' % ('switched ON' if enabled else 'left off'))
    out('The Server Guide (board rows r31n to r33n) is not part of this; it '
        'stays a by hand step.')
    if not bot_perms & ADMINISTRATOR and (
            (bot_perms & (MANAGE_GUILD | MANAGE_ROLES)) != (MANAGE_GUILD | MANAGE_ROLES)):
        problems.append('The bot has not got Manage Server and Manage Roles, which '
                        'Discord wants for this. It keeps Administrator (#3317): '
                        'tick it on its role again.')
    if '--body' in args:
        out('')
        out(json.dumps(body, indent=1, ensure_ascii=False))

    out('')
    if problems:
        out('Discord would refuse this, or it should not be sent:')
        for p in problems:
            out('  - ' + p)
        out('')
        out('Nothing was changed.')
        return 1
    if check:
        out('It all checks out. Nothing was changed: this was --check.')
        return 0
    try:
        got = api.call('PUT', '/guilds/%s/onboarding' % guild_id, body,
                       reason='Thornswood onboarding, issue 427')
    except Refused as e:
        out('Discord refused it (%s): %s' % (e.status, e.text))
        out('Nothing was changed.')
        return 1
    got = got or {}
    out('Set. Onboarding is %s, with %d question(s) and %d default channel(s).'
        % ('ON' if got.get('enabled') else 'off', len(got.get('prompts') or []),
           len(got.get('default_channel_ids') or [])))
    out('Now walk it: Server Settings, Onboarding, Preview at the top right, and '
        'check every answer gives the role you meant.')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
