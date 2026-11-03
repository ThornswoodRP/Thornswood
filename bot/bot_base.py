"""
Where the bot's files are, and the roots it trusts (#3111), before
anything else connects. The first module bot.py loads.

Part of the bot: bot.py loads it (#5357).
"""
import os
import urllib.request

# The bot's own records, joins.json, open-tickets.json, heartbeat.json
# and commands-synced.json, go in a folder of their own, data beside bot.py, and
# so does bot.log, which the service writes (issue #1104). The service's
# account may write there and nowhere else in the bot's folder: the code is
# read only to it, so nothing that gets into the bot can rewrite bot.py or put
# a module beside it for the next start to import. The service names the
# folder in THORNSWOOD_BOT_DATA (BotService.cs). With no data folder yet, a
# box whose full install has not run since, the records stay beside bot.py
# where they were, so a code only deploy never starts the join numbers again;
# the full install moves them across while the bot is stopped (Bot-Service.ps1).
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get('THORNSWOOD_BOT_DATA') or (
    os.path.join(HERE, 'data') if os.path.isdir(os.path.join(HERE, 'data')) else HERE)

# The roots the bot trusts are its own file, roots.pem in its data folder: the
# roots in certifi's bundle (requirements.txt, by hash) less those trust.py
# leaves out, eMudhra's (#3111). It is written again at every start, before
# discord.py or urllib makes a single connection.
#
# Not the box's certificate store. Its automatic root update is off by
# policy, so it lacks what discord.com chains to and the handshake died with
# "unable to get local issuer certificate" (#2736); and it holds emSign Root
# CA - G1 in LocalMachine\Root (read on the box 21 Oct). Python's default
# SSL context on Windows loads that store as well as SSL_CERT_FILE, so
# pointing SSL_CERT_FILE at the file is not enough on its own. Every
# connection the bot makes goes through CONTEXT instead, made from the file
# alone: urllib through the opener installed here, discord.py's HTTP and
# gateway through the connector TrustedClient gives it at login.
# SSL_CERT_FILE names the same file for anything else in the process.
#
# Always this file, whatever the environment named before. Install-Bot used to
# set SSL_CERT_FILE to certifi's bundle as the box's own Python found it, with
# none of py-libs on its path, so it named the certifi that Python had
# installed for itself, if any, and not the one requirements.txt pins.
# certifi is in requirements.txt beside discord.py, so a bot without it is
# missing its libraries and stops here, saying so, rather than connecting
# without its roots (#2736).
import trust
ROOTS = os.path.join(DATA_DIR, 'roots.pem')
_trusted, _left_out = trust.write_bundle(ROOTS)
os.environ['SSL_CERT_FILE'] = ROOTS
os.environ['REQUESTS_CA_BUNDLE'] = ROOTS
CONTEXT = trust.context(ROOTS)
urllib.request.install_opener(
    urllib.request.build_opener(urllib.request.HTTPSHandler(context=CONTEXT)))

import discord


# A discord.Client whose every request and gateway connection verifies
# against CONTEXT (#3111). trust.py makes the class, the one every script in
# bot/ that logs in to Discord makes its client from (#3604).
TrustedClient = trust.client_class(CONTEXT)
