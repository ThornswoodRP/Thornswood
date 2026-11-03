"""
test-2758-deletion-requests.py

A deletion request is taken out of the bot's own records as it starts
(#2758). scripts\\vps\\Delete-Person.ps1 stops nothing: it writes
deletion-requests.json into the bot's data folder, and bot.py takes it out
of joins.json and open-tickets.json before it connects (Patrick, 18 Oct
2026: "it should just fully apply the rest upon a server restart").

This runs the real apply_deletion_requests on a scratch data folder:
their join number and open ticket go and the last number given out stays,
everybody else's stay, the request is deleted and the log line names no id;
a record that will not parse leaves the request waiting and changes
nothing; a request that is not one is left as it is; and the main guard
takes the request before client.run.

Read only. Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import json
import shutil
import tempfile

os.environ.setdefault('DISCORD_TOKEN', 'not-a-real-token')

import harness_bot  # noqa: E402

bot = harness_bot.whole()
PASS = []
FAIL = []


def yes(what, cond):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what)


ME = '111111111111111111'
YOU = '222222222222222222'
d = tempfile.mkdtemp(prefix='thornswood-2758-bot-')
bot.JOINS = os.path.join(d, 'joins.json')
bot.OPEN_TICKETS = os.path.join(d, 'open-tickets.json')
bot.DELETION_REQUESTS = os.path.join(d, 'deletion-requests.json')


def put(p, v):
    with open(p, 'w', encoding='utf-8') as f:
        f.write(v if isinstance(v, str) else json.dumps(v))


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def fresh():
    put(bot.JOINS, {'900': {'last': 40, 'members': {ME: 39, YOU: 40}}})
    put(bot.OPEN_TICKETS, {'900:' + ME: 123, '900:' + YOU: 456})
    put(bot.DELETION_REQUESTS, {'people': [{'discordId': ME, 'profiles': [5001]}]})


yes('with no request it does nothing', bot.apply_deletion_requests() is None)

fresh()
line = bot.apply_deletion_requests()
joins = json.loads(read(bot.JOINS))
tickets = json.loads(read(bot.OPEN_TICKETS))
yes('their join number goes, the last number given out stays, the other stays',
    ME not in joins['900']['members'] and joins['900']['members'][YOU] == 40 and joins['900']['last'] == 40)
yes('their open ticket goes, the other stays', ('900:' + ME) not in tickets and tickets['900:' + YOU] == 456)
yes('the request is deleted', not os.path.exists(bot.DELETION_REQUESTS))
yes('the log line says counts and no id',
    line == 'deletion requests: 1 person(s): join numbers 1, open tickets 1; done, and the request is gone')

fresh()
put(bot.OPEN_TICKETS, '{"900:')
before = read(bot.JOINS)
line = bot.apply_deletion_requests()
yes('a record that will not parse leaves the request waiting and changes nothing',
    os.path.exists(bot.DELETION_REQUESTS) and read(bot.JOINS) == before and 'waits for the next start' in line)

fresh()
put(bot.DELETION_REQUESTS, {'people': [{'discordId': 'nobody'}]})
before = read(bot.JOINS)
line = bot.apply_deletion_requests()
yes('a request that is not one is left as it is',
    read(bot.DELETION_REQUESTS) == '{"people": [{"discordId": "nobody"}]}' and read(bot.JOINS) == before and
    'not a list of deletion requests' in line)

src = read(os.path.join(HERE, 'bot.py'))
main = src[src.index("if __name__ == '__main__':\n    if ('--setup-channels'"):]
yes('the main guard takes the request before client.run',
    0 < main.index('apply_deletion_requests()') < main.index('client.run(TOKEN)'))

shutil.rmtree(d, ignore_errors=True)
print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
