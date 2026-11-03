"""
The bot as the harnesses see it: one set of names, as bot.py was before it
was split into modules by area (#5357).

    import harness_bot
    bot = harness_bot.whole()

bot.X reads X from the module that has it. bot.X = v puts v in every module
of the bot that holds the name X, the module X is defined in and each one
that imported it, so a harness that stands in for log, client, a record's
path or asyncio stands in for it everywhere the bot uses it, as it did when
the bot was one file. A name the bot does not have cannot be set: a harness
that sets one is testing nothing, and says so here instead.

source() is all of the bot's code, bot.py and its modules in the order
bot.py loads them, for the harnesses that read the code itself.

Only the harnesses use this. It is not one of the bot's files and never
goes to the box (Install-Bot.ps1 and App-Part.ps1 name those).
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# A line of bot.py that imports one of its modules, read the same way by
# scripts/deploy/Bot-Code.ps1, which lists what goes to the box.
PART = re.compile(r'^import (bot_[a-z0-9_]+)\s*(#.*)?$')


def parts():
    """The bot's modules' names, in the order bot.py imports them."""
    names = []
    with open(os.path.join(HERE, 'bot.py'), encoding='utf-8') as f:
        for line in f:
            m = PART.match(line.rstrip('\r\n'))
            if m and m.group(1) not in names:
                names.append(m.group(1))
    return names


def files():
    """bot.py and its modules, as paths, in the order bot.py loads them."""
    return [os.path.join(HERE, 'bot.py')] + [os.path.join(HERE, n + '.py') for n in parts()]


def source():
    """All of the bot's code as one text, in the order bot.py loads it."""
    out = []
    for p in files():
        with open(p, encoding='utf-8') as f:
            out.append(f.read())
    return '\n'.join(out)


class Whole:
    """bot.py and its modules as one set of names."""

    def __init__(self, entry, modules):
        object.__setattr__(self, '_entry', entry)
        object.__setattr__(self, '_modules', modules)

    def _all(self):
        return self._modules + [self._entry]

    def __getattr__(self, name):
        for m in self._all():
            d = vars(m)
            if name in d:
                return d[name]
        raise AttributeError('the bot has no %s' % name)

    def __setattr__(self, name, value):
        held = [m for m in self._all() if name in vars(m)]
        if not held:
            raise AttributeError('the bot has no %s to stand in for' % name)
        for m in held:
            setattr(m, name, value)

    def __dir__(self):
        out = set()
        for m in self._all():
            out.update(vars(m))
        return sorted(out)


def whole():
    """Import bot.py (and so every module of it) and return the one view."""
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import bot
    return Whole(bot, [sys.modules[n] for n in parts()])
