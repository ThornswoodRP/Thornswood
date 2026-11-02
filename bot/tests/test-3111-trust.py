"""
test-3111-trust.py

#3111: the roots the bot trusts, with the certifi requirements.txt pins and
the real bot.py import. tests\test-3111-emudhra-trust.js holds the same filter
on a fixture in the gate; this is the nightly half, with the bot's libraries.

  1. The certifi installed here is the one requirements.txt pins, so what is
     measured below is what the box runs.
  2. trust.write_bundle on certifi's own bundle keeps every root that is not
     eMudhra's, byte for byte and in order, and none that is, read back
     through ssl's own decoder.
  3. bot.py, imported in a child Python with its data folder in a scratch
     folder and SSL_CERT_FILE pointing somewhere else, writes roots.pem
     there over a planted file, and SSL_CERT_FILE and ssl's default cafile
     both name it afterwards, and the import prints nothing.
  4. Every connection goes through bot.CONTEXT, made from that file alone:
     it holds exactly the written roots, urllib's installed opener uses it,
     and both clients bot.py makes log in with a connector on it, and so do
     backfill.py's and redraw.py's (#3604); Build-Discord.py's and a
     trust.client_class() client log in on a context of the same roots,
     made at login in a folder of its own. On the box,
     where a default context also loads LocalMachine Root and its emSign
     Root CA - G1, the count of those is printed beside it.

Never connects to anything.
"""
import os
import sys
# bot\, the folder above: the bot's tests sit in bot\tests (#5341), and
# _pyguard and the bot are found from there.
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
import _pyguard  # noqa: F401  (first after the path: Python 3.11 or newer, #2276)
import json
import re
import shutil
import subprocess
import tempfile

import certifi

import trust

PASS, FAIL = [], []

# Run in a child Python: imports bot.py, then reads back what its connections
# verify against. login() is stopped where discord.py would first reach the
# network, so nothing is connected to.
PROBE = '''
import asyncio, json, os, ssl, sys, urllib.request
sys.path.insert(0, sys.argv[1])
import bot
import discord.http


def orgs(ctx):
    return [dict(kv for rdn in c['subject'] for kv in rdn).get('organizationName', '') for c in ctx.get_ca_certs()]


class Stop(Exception):
    pass


seen = []


async def static_login(self, token):
    seen.append(getattr(self.connector, '_ssl', None) is bot.CONTEXT)
    raise Stop()


discord.http.HTTPClient.static_login = static_login


async def logins():
    for c in (bot.client, bot.TrustedClient(intents=discord.Intents(guilds=True))):
        try:
            await c.login('not-a-real-token')
        except Stop:
            pass


asyncio.run(logins())

# The scripts beside the bot (#3604). backfill.py and redraw.py take the
# bot's own class; Build-Discord.py and Wipe-Channels.py make the roots at
# login from trust.py into a folder of their own.
import importlib.util
import trust
own = []


async def own_login(self, token):
    ctx = getattr(self.connector, '_ssl', None)
    own.append(orgs(ctx) if isinstance(ctx, ssl.SSLContext) else None)
    raise Stop()


async def scripts():
    import backfill
    import redraw
    for c in (backfill.client, redraw.client):
        try:
            await c.login('not-a-real-token')
        except Stop:
            pass
    discord.http.HTTPClient.static_login = own_login
    spec = importlib.util.spec_from_file_location('build_discord', os.path.join(sys.argv[1], 'Build-Discord.py'))
    build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(build)
    for c in (build.client, trust.client_class()(intents=discord.Intents.none())):
        try:
            await c.login('not-a-real-token')
        except Stop:
            pass


asyncio.run(scripts())
handlers = [h for h in urllib.request._opener.handlers if isinstance(h, urllib.request.HTTPSHandler)]
default = orgs(ssl.create_default_context())
print(json.dumps({
    'env': os.environ['SSL_CERT_FILE'], 'req': os.environ['REQUESTS_CA_BUNDLE'],
    'cafile': ssl.get_default_verify_paths().cafile,
    'context': len(orgs(bot.CONTEXT)), 'context_orgs': orgs(bot.CONTEXT),
    'default': len(default), 'default_emudhra': len([o for o in default if 'emudhra' in o.lower()]),
    'urllib': len(handlers) == 1 and handlers[0]._context is bot.CONTEXT,
    'login': seen, 'own': own}))
'''


def yes(what, cond, why=''):
    (PASS if cond else FAIL).append(what)
    print(('PASS  ' if cond else 'FAIL  ') + what + (('\n      ' + why) if why and not cond else ''))


def blocks(text):
    return re.findall(r'-----BEGIN CERTIFICATE-----\s.*?-----END CERTIFICATE-----', text, re.S)


# 1. the pin
req = open(os.path.join(HERE, 'requirements.txt'), encoding='utf-8').read()
pinned = re.search(r'^certifi==(\S+)', req, re.M).group(1)
yes('the certifi installed (%s) is the one requirements.txt pins (%s)' % (certifi.__version__, pinned),
    [int(x) for x in certifi.__version__.split('.')] == [int(x) for x in pinned.split('.')])

scratch = tempfile.mkdtemp(prefix='test-3111-')
try:
    # 2. certifi's bundle through the filter
    source = open(certifi.where(), encoding='ascii').read()
    every = blocks(source)
    theirs = [b for b in every if trust.distrusted(trust.describe(b))]
    ours = [b for b in every if not trust.distrusted(trust.describe(b))]
    dest = os.path.join(scratch, 'roots.pem')
    count, out = trust.write_bundle(dest)
    written = blocks(open(dest, encoding='ascii').read())
    yes('certifi %s carries %d roots, %d of them eMudhra\'s: %s' % (
        certifi.__version__, len(every), len(theirs), ', '.join(out) or 'none'),
        len(every) > 100 and len(out) == len(theirs))
    yes('every root that is not eMudhra\'s is written, byte for byte and in order',
        written == ours and count == len(ours))
    orgs = [trust.describe(b)['subject'].get('organizationName', '') for b in written]
    yes('none written is eMudhra\'s, read back through ssl',
        not [o for o in orgs if 'emudhra' in o.lower()] and not re.search('emsign|emudhra', open(dest).read(), re.I))

    # 3. the real import
    data = os.path.join(scratch, 'data')
    os.makedirs(data)
    planted = os.path.join(data, 'roots.pem')
    with open(planted, 'w') as f:
        f.write('planted by the harness\n')
    elsewhere = os.path.join(scratch, 'elsewhere.pem')
    shutil.copy(certifi.where(), elsewhere)
    env = dict(os.environ, THORNSWOOD_BOT_DATA=data, SSL_CERT_FILE=elsewhere,
               REQUESTS_CA_BUNDLE=elsewhere, DISCORD_TOKEN='not-a-real-token')
    probe = open(os.path.join(scratch, 'probe.py'), 'w')
    probe.write(PROBE)
    probe.close()
    r = subprocess.run([sys.executable, os.path.join(scratch, 'probe.py'), HERE], env=env,
                       capture_output=True, text=True, timeout=120)
    said = {}
    try:
        said = json.loads(r.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        pass
    yes('bot.py imports with its data folder and SSL_CERT_FILE elsewhere', r.returncode == 0 and said,
        (r.stdout + r.stderr)[-800:])
    same = lambda p: bool(p) and os.path.normcase(os.path.abspath(p)) == os.path.normcase(planted)
    yes('SSL_CERT_FILE, REQUESTS_CA_BUNDLE and ssl\'s default cafile all name data\\roots.pem afterwards',
        same(said.get('env')) and same(said.get('req')) and same(said.get('cafile')), json.dumps(said))
    yes('CONTEXT trusts exactly the written roots, none eMudhra\'s, and nothing from the machine\'s stores',
        said.get('context') == len(ours) and not [o for o in said.get('context_orgs', []) if 'emudhra' in o.lower()],
        json.dumps({k: said.get(k) for k in ('context', 'default')}))
    print('      (a default context here holds %s roots, %s of them eMudhra\'s: what CONTEXT keeps the bot from)'
          % (said.get('default'), said.get('default_emudhra')))
    yes('every urllib request goes through CONTEXT', said.get('urllib') is True)
    yes('the bot\'s client and the --setup-channels client both log in with a connector on CONTEXT',
        said.get('login', [])[:2] == [True, True], json.dumps(said.get('login')))
    yes('backfill.py and redraw.py log in with the bot\'s TrustedClient, on CONTEXT too (#3604)',
        said.get('login', [])[2:] == [True, True], json.dumps(said.get('login')))
    own = said.get('own') or []
    yes('Build-Discord.py and a trust.client_class() client, Wipe-Channels.py\'s, log in on a context of the same roots, none eMudhra\'s',
        len(own) == 2 and all(o is not None and len(o) == len(ours) and not [x for x in o if 'emudhra' in x.lower()] for o in own),
        json.dumps([len(o) if o else o for o in own]))
    text = open(planted, encoding='ascii').read()
    yes('the planted roots.pem was written over with the bundle, and it holds no eMudhra root',
        'planted' not in text and blocks(text) == ours)
    yes('and imported, it prints nothing, so a tool reading bot.py\'s output reads only its own',
        r.stdout.strip().count('\n') == 0)
    run = open(os.path.join(HERE, 'bot.py'), encoding='utf-8').read()
    main = run[run.rindex("\nif __name__ == '__main__':"):]
    yes('run as the bot, it logs how many roots it trusts and which it left out, before it connects',
        "log('trusting %d root certificates from %s, leaving out %s' % (" in main
        and main.index('trusting %d root') < main.index('client.run(TOKEN)'))
finally:
    shutil.rmtree(scratch, ignore_errors=True)

print('')
print('%d passed, %d failed' % (len(PASS), len(FAIL)))
sys.exit(1 if FAIL else 0)
