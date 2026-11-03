"""
What staff do in the world, said in the staff channel.

Part of the bot: bot.py loads it (#5357).
"""
import asyncio
import json
import os
import traceback

from bot_core import TROUBLE_FILE, _int_env, as_typed, client, log
from bot_reports import report_say
from bot_offices import office_text


# What a moderator did in the game (#412): /kick, /freeze, /silence, /warn and
# the rest. The gamemode appends one JSON line per action to
# for-bot\moderation.log beside each game server, on this same box, and this
# says each new line once in the staff channel, so the record is outside the
# game and in front of the rest of staff. A file rather than a request, for the
# same reason as watch_trouble: no new secret, port or ticket.
#
# for-bot, not private (#2321): private is SYSTEM's and Administrators' alone,
# and a rule on one file in it could only be given once the gamemode had made
# the file, long after the install that gives it. Install-Bot.ps1 gives the
# bot's account read on the for-bot folder, which a file made later takes.
MODERATION_LOGS = [
    ('live', os.environ.get('MODERATION_LOG',
                            r'C:\Thornswood-Server\for-bot\moderation.log')),
    ('dev', os.environ.get('MODERATION_LOG_DEV',
                           r'C:\Thornswood-Server-Dev\for-bot\moderation.log')),
    # Bans and notes made on the hub, which the site writes beside
    # trouble.json. The game's own /ban and /note are in the two above.
    ('site', os.environ.get('MODERATION_LOG_SITE',
                            os.path.join(os.path.dirname(TROUBLE_FILE), 'moderation.log'))),
]
MODERATION_EVERY = _int_env('MODERATION_EVERY', 30)
# More than this in one look from one server is said as a count, not a wall.
MODERATION_AT_ONCE = 10

_MOD_DID = {
    'kick': 'removed %s from the world',
    'freeze': 'froze %s in place',
    'unfreeze': 'let %s move again',
    'bring': 'brought %s to them',
    'goto': 'went to %s',
    'silence': 'silenced %s',
    'unsilence': 'let %s speak again',
    'warn': 'warned %s',
    'give': 'gave %s',
    'spawn': 'spawned beside %s',
    'tp': 'sent %s',
    # One character, or the whole account, and a character killed for good (#1010).
    'ban': 'banned the character %s',
    'unban': 'lifted the ban on the character %s',
    'banaccount': 'banned the whole account of %s, every character on it',
    'unbanaccount': 'lifted the ban on the account of %s',
    'pk': 'killed %s for good (PK), quietly',
    # An admin undoing a PK made by mistake (#1010, 29 September).
    'unpk': 'undid the PK of %s, so the character can be played again',
    'note': 'wrote a note on %s',
    # Staff at a building's door, from the Office page of K (#2551, Patrick,
    # 17 Oct): the why names the building and its hold, and the rent set.
    'evict': 'ended the claim of %s',
    'rent': 'set the rent on the claim of %s',
    'norent': 'took the rent off the claim of %s',
    # Rent handed over in person, marked paid on the Office page (#3895).
    'rentpaid': 'marked rent paid by %s',
    # Staff on the world's card, the Office page of K (#513): the stage is
    # the who, and the why says from where, to where, and the force.
    'worldpropose': 'proposed moving the world to %s',
    'worldconfirm': 'confirmed moving the world to %s',
    'worlddrop': 'dropped the proposal to move the world to %s',
    # Staff on the crafting card, the Office page of K (#3167): the why says
    # which rank from what to what, or what was given back and why.
    'craftrank': 'raised a rank of %s',
    'craftrecipes': 'handed the newer recipe list to the game of %s',
    'craftgive': 'gave back to %s',
    # Not staff: somebody's own /stuck (#414), said as its why reads.
    'stuck': 'used /stuck',
    # Not staff either: the server took somebody idle out of the world (#1142).
    'idle': 'was moved out for being idle',
}


def moderation_text(where, row):
    """
    One line of moderation.log as the staff channel reads it, or None for a
    line that is not one. Names and reasons were typed in the game, so they
    are escaped: nothing in them can ping anybody or dress itself up.
    """
    if isinstance(row, dict) and row.get('did') in ('office', 'jarlclash', 'jarlclear'):
        return office_text(row)
    if not isinstance(row, dict) or row.get('did') not in _MOD_DID:
        return None

    clean = as_typed

    def person(name, pid):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            pid = 0
        # The hub knows a person by account, not by profile.
        if pid <= 0:
            return clean(name, 40) or 'somebody'
        return '%s (profile %d)' % (clean(name, 40) or 'somebody', pid)

    # /stuck is not a staff action: the person did it to themselves, and the
    # gamemode writes the whole sentence (from where, to where, the account).
    if row['did'] == 'stuck':
        why = clean(row.get('why'), 600) or 'used /stuck.'
        return ('**/stuck on the %s server:** %s %s'
                % (where, person(row.get('byName'), row.get('by')), why))[:1900]

    # Moved out of the world for being idle (#1142): nobody did it to them, so
    # it reads as what happened and why, which the gamemode writes.
    if row['did'] == 'idle':
        why = clean(row.get('why'), 600) or 'nothing from their game for too long'
        return ('**Idle on the %s server:** %s was taken back to the character choice and put in line: %s'
                % (where, person(row.get('whoName'), row.get('who')), why))[:1900]

    did = _MOD_DID[row['did']] % person(row.get('whoName'), row.get('who'))
    try:
        minutes = int(row.get('minutes') or 0)
    except (TypeError, ValueError):
        minutes = 0
    if row['did'] == 'silence' and minutes > 0:
        did += ' for %d minute%s' % (minutes, '' if minutes == 1 else 's')
    why = clean(row.get('why'), 300)
    head = ('**Staff on the site:**' if where == 'site'
            else '**Staff on the %s server:**' % where)
    return ('%s %s %s%s'
            % (head, person(row.get('byName'), row.get('by')), did,
               (': ' + why) if why else '.'))[:1900]


def _moderation_lines(path):
    """
    (lines, why). lines is every whole line in one moderation.log, [] when
    there is no file yet (no staff action on that server so far), None when it
    could not be read, and then why says what refused it. A last line with no
    line ending is left for the next look, the same as _watch_log_lines.
    """
    try:
        with open(path, 'rb') as f:
            data = f.read()
    except FileNotFoundError:
        return [], ''
    except Exception as e:
        return None, '%s: %s' % (type(e).__name__, e)
    parts = data.decode('utf-8-sig', errors='replace').split('\n')
    return [p.rstrip('\r') for p in parts[:-1] if p.strip()], ''


def _moderation_unreadable(unread, where, path, why):
    """
    Say in bot.log when one moderation.log cannot be read, and when it can be
    again, once each rather than every look (#2321). Until #2321 a refused
    read was skipped with nothing logged, so a server whose staff log the
    bot's account could not open said nothing anywhere.
    """
    if why and unread.get(where) != why:
        unread[where] = why
        log('moderation: cannot read %s (%s), so staff actions on %s are not '
            'said in the staff channel until it can be. Install-Bot.ps1 gives '
            'the bot\'s account read on that folder.'
            % (path, why, 'the site' if where == 'site' else 'the %s server' % where))
    elif not why and where in unread:
        del unread[where]
        log('moderation: %s can be read again' % path)


async def watch_moderation():
    """
    Say each new staff action from the game in the staff channel, once.

    The lines already in each file when this starts are treated as said, as in
    watch_trouble, or every restart of the bot would repeat the history. A
    file that cannot be read is skipped for that look rather than read as
    empty, and said in bot.log. Nothing in here may end the loop.
    """
    await client.wait_until_ready()
    loop = asyncio.get_running_loop()
    seen = {}
    unread = {}
    for where, path in MODERATION_LOGS:
        lines, why = await loop.run_in_executor(None, _moderation_lines, path)
        seen[where] = set(lines) if lines is not None else None
        _moderation_unreadable(unread, where, path, why)
    log('moderation: reading %s every %ds'
        % (', '.join(p for _, p in MODERATION_LOGS), MODERATION_EVERY))

    while not client.is_closed():
        try:
            for where, path in MODERATION_LOGS:
                lines, why = await loop.run_in_executor(None, _moderation_lines, path)
                _moderation_unreadable(unread, where, path, why)
                if lines is None:
                    continue
                if seen.get(where) is None:
                    seen[where] = set(lines)
                    continue
                new = [l for l in lines if l not in seen[where]]
                seen[where].update(new)
                texts = []
                for l in new:
                    try:
                        text = moderation_text(where, json.loads(l))
                    except ValueError:
                        text = None
                    if text:
                        texts.append(text)
                if len(texts) > MODERATION_AT_ONCE:
                    await report_say(
                        '**%d staff actions on %s** since the last look, more '
                        'than this channel should carry one at a time. They '
                        'are in %s on the VPS.'
                        % (len(texts),
                           'the site' if where == 'site' else 'the %s server' % where,
                           path))
                else:
                    for text in texts:
                        await report_say(text)
        except Exception:
            log('moderation: the check itself failed, carrying on:\n'
                + traceback.format_exc())
        await asyncio.sleep(MODERATION_EVERY)
