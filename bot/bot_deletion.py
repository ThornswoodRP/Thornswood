"""
Deletion requests, taken out of the bot's records as it starts (#2758).

Part of the bot: bot.py loads it (#5357).
"""
import json
import os
import re

from bot_base import DATA_DIR
from bot_core import log
from bot_joins import _joins_read, _joins_write
from bot_tickets import OPEN_TICKETS


# A deletion request, taken out of the bot's own records as it starts (#2758).
# Patrick, 18 Oct 2026, after the first real deletion on his own account: "it
# should not restart everytime we want to delete a person it should just fully
# apply the rest upon a server restart". scripts\vps\Delete-Person.ps1 stops
# nothing: it writes the request into deletion-requests.json in the bot's data
# folder,
#
#     {"people": [{"discordId": "111111111111111111", "profiles": [5001]}]}
#
# and this takes it out before the bot connects, so no click can write one of
# these files back while it goes: their join number (the last number given out
# stays in joins.json, so nobody is handed theirs again) and their open ticket.
# A file that is there and will not parse, or a write that does not take,
# leaves the request for the next start, and is said; running it again finds
# what is already gone gone. The log says counts and never an id.
DELETION_REQUESTS = os.path.join(DATA_DIR, 'deletion-requests.json')


def apply_deletion_requests():
    """Takes every request in deletion-requests.json out of joins.json and
       open-tickets.json, then deletes it. Returns the line it logged, or
       None when there was no request."""
    def said(m):
        line = 'deletion requests: ' + m
        log(line)
        return line
    if not os.path.exists(DELETION_REQUESTS):
        return None
    try:
        with open(DELETION_REQUESTS, encoding='utf-8-sig') as f:
            req = json.load(f)
        people = req.get('people') if isinstance(req, dict) else None
        ids = [str(p.get('discordId')) for p in people] if isinstance(people, list) and all(isinstance(p, dict) for p in people) else None
    except (OSError, ValueError) as e:
        return said('the request could not be read (%s), so nothing was removed and it is left as it is' % type(e).__name__)
    if not ids or not all(re.match(r'^\d{17,20}$', i) for i in ids):
        return said('the request is not a list of deletion requests, so nothing was removed and it is left as it is')
    try:
        joins = _joins_read()
        tickets = {}
        if os.path.exists(OPEN_TICKETS):
            with open(OPEN_TICKETS, encoding='utf-8-sig') as f:
                tickets = json.load(f)
            if not isinstance(tickets, dict):
                raise ValueError(OPEN_TICKETS + ' is not a JSON object')
    except (OSError, ValueError) as e:
        return said('the records could not be read (%s), so nothing was removed and the request waits for the next start' % type(e).__name__)
    numbers = marks = 0
    for g in joins.values():
        members = g.get('members') if isinstance(g, dict) else None
        if isinstance(members, dict):
            for i in ids:
                if i in members:
                    del members[i]
                    numbers += 1
        # And when they left (#2353), which is about them as much as the number.
        left = g.get('left') if isinstance(g, dict) else None
        if isinstance(left, dict):
            for i in ids:
                if i in left:
                    del left[i]
                    marks += 1
    gone = [k for k in tickets if k.split(':')[-1] in ids]
    for k in gone:
        del tickets[k]
    try:
        if numbers or marks:
            _joins_write(joins)
        if gone:
            tmp = OPEN_TICKETS + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(tickets, f)
            os.replace(tmp, OPEN_TICKETS)
    except OSError as e:
        return said('a record could not be written (%s), so the request waits for the next start' % type(e).__name__)
    what = '%d person(s): join numbers %d, open tickets %d' % (len(ids), numbers, len(gone))
    try:
        os.remove(DELETION_REQUESTS)
    except OSError as e:
        return said(what + '; the request could not be deleted (%s), so it runs again at the next start' % type(e).__name__)
    return said(what + '; done, and the request is gone')
