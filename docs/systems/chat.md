# Text chat

What you type. Enter opens the box. A line that starts with `/` is a
command. A line that does not is speech.

If the chat input refuses Enter, its text stays in the open box. You can
edit it, press Enter again, or use Escape to return to the game.

While disconnected, chat keeps the newest 20 waiting lines. If another
line removes the oldest one, a warning says it was removed and the new
one is queued. It does not repeat the contents of either line.

How a line is said, out of character, and the dice are typed, and the
help names them. There are no buttons for them on the chat box.
Decided by Patrick on 4 Oct (#1639): "Allow those commands and don't
do buttons."

Speech is local. Two people on the Whiterun road are not read by a
smith in Markarth.

Same cell first. Two people at the same coordinates in different
cells are not in earshot. The distances are in the same units as
`/ooc`, which is 4000 units, about 57 metres.

| How you say it | Who hears it |
| --- | --- |
| A plain line | About 57 metres, same cell |
| `/me` and what the character does | The same |
| `/do` and what there is to see | The same |
| `/w` or `/whisper` | A quarter of that, about 14 metres |
| `/s`, `/shout`, `/y`, or `/yell` | Three times that, about 171 metres |

`/me draws a sword` is an attempt. Whether it lands is the other
person's. A plain line cannot say that.

## Out of character

`/ooc` or `/o`, and the words. The same 57 metres and the same cell.
The line is drawn in brackets, so a scene can see that it stepped
out. It is how a scene asks for the yes on [Death](death.md).
`/ooc can we not` ends the scene. It does not undo what already
happened.

A line longer than 300 characters is cut to 300. If nobody is near
enough, you are told.

## Dice

`/roll` or `/r`, and the dice. The number is the sides: `/roll 20` is
one twenty sided die, and `/roll 6x3` is three six sided ones.
Count-d-sides notation works too: `/roll 1d20` is one twenty sided die,
and `/roll 3d6` is three six sided ones. A leading `d` is fine.
`/roll` alone is a twenty. Up to 1000 sides and
100 dice. The server rolls it, so nobody can make a number up, and
the result goes to the same people `/ooc` reaches.

## Above the head

A line that is speech also sits above the head, for the people close
enough to read it.

What floats:

- A line that does not start with `/`.
- `/me`, and what the character does.
- `/do`, and what there is to see.
- `/ooc` and `/o`.
- `/w` or `/whisper`, for people inside the whisper reach.
- `/s`, `/shout`, `/y`, or `/yell`, for people inside the shout reach.

What does not float: every other command. Those stay in the box. A
bard plays from the [emote wheel](emotes.md), which is what pays the
rest on [People beside you](people.md). A lyric above the head is a
plain line or a `/me`.

A friend request, a party invite, and a trade offer are not answered
in the box. A prompt appears with Accept and Refuse. See
[Friends](friends.md), [Party](party.md), and [Trade](trade.md).

The float uses the same reach as the table above, and the same cell.
A plain line, a `/me`, a `/do`, and an `/ooc` float inside about 57
metres. A whisper floats inside about 14 metres. A shout floats
inside about 171 metres. Outside that reach, that line is not above
the head.

One line at a time. A newer line replaces it. It stays for 6 seconds.
The float is cut at 80 characters. The full line stays in the box,
and an `/ooc` in the box is still cut at 300.

The float has the same shape as the box. A plain line is the words.
A `/me` is the action. A `/do` is what there is to see. An `/ooc` is
in brackets. A whisper and a shout use the same words they use in
the box.

An emote uses this same one line. The names are on
[Emotes](emotes.md). A newer typed line replaces it, and an emote
replaces a typed line.

You see your own float. Someone who has turned off your text does not
see it, in the box or above the head. That switch is on
[Voice](voice.md). The speaking mark on that page is the microphone.
It is not this text.

## Where this is

`/ooc` is local, 4000 units, same cell, in the voice service. `/roll` is
rolled in the server and goes to the same people. `/me`, `/do`,
`/w`, `/s`, and `/ooc` are local, whether or not the plain-line switch is
on. They are kept by the voice service and not sent on to the game server.

Plain speech in the box is local on both servers: the same cell,
4000 units, the same reach as the line above the head.
`Install-Voice.ps1` sets the switch on for live and dev, and keeps
whatever range is running when it is not told one. Left unset, a
plain line still goes to everybody.

The line above the head is local either way: 4000 units for a
plain line, a `/me`, a `/do`, and an `/ooc`, 1000 for a whisper, and
12000 for a shout. Same cell first. One line, 6 seconds, cut at 80
characters. You see your own. Text mute hides it in the box and
above the head.

Staff silence stops the words above the head as well as the box. It
does not hide a name.
