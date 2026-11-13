# Voice

How far a spoken word carries. The launcher holds the microphone.
The game does not. Hold V to talk. O leaves the microphone open. B
steps the distance.

The launcher has to be open. Muffle and Invisibility do not change
these distances.

| Voice | Full strength out to | Gone at | The mark |
| --- | --- | --- | --- |
| Whisper | 1.5 metres | 7 metres | Pale blue |
| Ordinary | 4 metres | 30 metres | White |
| Yell | 9 metres | 85 metres | Amber |

A yell is louder than a whisper at the same spot. Past the far
number, the level is nothing.

## The mark above the head

While the microphone is open, a mark sits above the head: a round
dot that comes up when they press to talk and goes when they let go,
and that breathes while it is up, the same as the microphone at the
bottom of your own screen. The mark is not words. The server does not hear words. Words above a head are
typed, and they are on [Text chat](chat.md).

The color is the distance that voice is set to. Whisper is pale
blue. Ordinary is white. Yell is amber. A party name stays green, on
[Party](party.md).

The mark is its own mark, above the name. It does not recolor the
name. A friend request, a party invite, or a trade offer is a
different prompt, with Accept and Refuse. It is not this mark.

You see it only when you are inside that person's range. A whisper
is gone at 7 metres, ordinary speech at 30, a yell at 85. Outside
that, there is no mark. There is no dim mark for someone you cannot
hear.

You do not see the mark on your own head. The microphone at the
bottom of your screen names the distance you are on, and while you
speak it takes that distance's color: pale blue, white or amber, the
color everybody in range sees above you.

A voice mute hides the mark as well as the sound. Hiding their name
does not hide the mark. Turning off their text does not hide it
either.

## What you can turn off

Three switches, each for one person, and each only for you. They
work on anyone, not only a friend. None of them tells the other
person. They are saved on the character and they survive a restart.
A staff silence is a different tool, further down.

| Switch | What you stop | How |
| --- | --- | --- |
| Voice | Hearing them, and seeing the speaking mark | Look at them and press L, or Mute beside them on P |
| Text | Their lines in the box, and the words above their head | Text beside them on P |
| Name | Their name above their head | Name beside them on P |

P has the three beside each friend, beside each person under Near
you, who is everybody close enough to look at, and beside each
person under Muted and hidden. That last list is everybody you have
switched off, friend or not, online or not, and pressing the switch
again there turns it back on. Nobody types a command for any of it.

Turning off their voice does not turn off their text. Turning off
their name does not turn off either. The party map marker and the
arrow on the strip stay when the name is hidden, so you can still
find someone in your party. That is on [Party](party.md).

P lists the three switches for each friend and for each person in
your party. The look-at prompt offers the same three.

## Every name

Hide every name, on P, hides every name above a head, for you. Show
names puts them back. A name you hid one person at a time
stays hidden after you turn this off. The party map marker and the
arrow on the strip stay, the same as hiding one name. It is saved on
the character.

## Staff silence

Staff are the Discord roles that already take a staff seat: Owner,
Gamemaster, Dev, Loremaster, Moderator.

`/silence` and the name, then the minutes if not 30 (a day at most)
and why. Their voice, their local text, the words above their head,
and the speaking mark stop for everybody. They are told how long. They
cannot lift it. `/unsilence` and the name, from any other staff member,
lifts it, and it lifts by itself when the minutes run out.

`/silence` with nothing after it says how it is used.

It also stops them writing in a faction or business chat. That chat
is on [Factions and businesses](factions.md). It does not hide their
name. The three switches above stay personal, and a personal mute
does not lift a silence.

## Voice as words (not on yet)

The voice service can show what someone says as words above their
head, the same line typed chat draws there. It is off. It stays off
until staff turn it on with `THORNSWOOD_CAPTIONS=on`, and nothing
sends it any words yet.

When it is on, the words go to the people who can hear the speaker
and nobody else: the same cell, out to 7 metres for a whisper, 30
for ordinary speech and 85 for a yell. The speaker sees their own.
The service never writes them down. A staff silence stops them.

Staff can tune it without a release:

| Setting | Default | What it does |
| --- | --- | --- |
| `THORNSWOOD_CAPTION_TAIL_MS` | 2000 | How long words still go after the talk key comes up |
| `THORNSWOOD_CAPTION_BURST` | 3 | How many lines may go at once |
| `THORNSWOOD_CAPTION_REFILL_MS` | 1000 | How often one more line is allowed after that |
| `THORNSWOOD_CAPTION_REACH` | the voice reach | A shorter cap, never past the voice reach |
| `THORNSWOOD_CAPTION_TEXT_MUTE` | on | `off` means only the Voice switch hides someone's words |

`/health` on the voice service shows whether it is on, how many lines
went out and how many were dropped, and each setting.

Still waiting on Patrick's answers on #2475: turning speech into
words in the launcher, whether the words are kept, and the switches
for your own words and for seeing other people's.

## Where this is

The three distances, V, O, B, and the voice mute are in the server.
The microphone is the launcher's. A voice mute sets the level to
nothing on your machine. The sound goes from machine to machine, so
the server cannot stop it for you alone without also stopping it for
them, and a personal mute does not tell the other person. Staff
silence is the moderation tool: the service tells every client to
close that microphone and to hear nothing from them.

Text mute is remembered on the character, and the chat service drops
those lines for the person who turned them off. Hiding a name, and
hiding every name, are remembered too, and the name tag is drawn
clear. P lists Mute, Text, and Name for each friend, each person
near you and each person switched off, and Hide every name for the
whole list. The buttons and L send the server the lines `/mute` and
`/hidename` once were, and nobody is told to type them. The look-at
prompt offers only the voice switch, on L, and the party rows on P
have no switches yet; Text and Name for somebody who is not a friend
are under Near you on P. Whether the prompt gets rows for them too is
asked on #1628.

The mark above the head is drawn while the microphone is open. It
sits above the name, and it does not recolor the name. Whisper is
pale blue and gone at 7 metres, ordinary speech is white and gone at
30, and a yell is amber and gone at 85. Same cell first. You do not
see it on your own head. A voice mute hides it. Hiding a name does
not, and neither does turning their text off. The launcher still
draws its own speaking light.

Staff `/silence` stops their voice, what they type, the words above
the head, and the speaking mark for everybody. It does not hide
their name.

Voice and the text chat need the launcher signed in to Discord. The
voice service lets a connection in only with a join token, and it
makes one only when the site says that Discord account owns the
character. While the site cannot answer, nobody new gets into voice
or the chat; a connection already in stays in (#1303, #1315).

Voice has two clients: the launcher's voice page and the game's
overlay. The voice service also served a plain browser page of its
own at https://thornswood.net/voice/ until #1822. It had no way to
get a join token, because it could not sign in to Discord, so it
could never get in. Nothing linked to it, and it is gone.

The game's chat connection is on the roster as well, because the
overlay's own voice rides it when no launcher has the audio. Once a
launcher has it, the overlay answers nobody, so the chat tells the
service that connection carries no voice, and says so in every join
after. Its place on the roster is marked, and both clients connect to
nobody marked and close a connection they had, so a launcher holds
one connection for each other person with voice and reports that
many (#1925). `tests/test-1925-voice-relay-peers.js` runs it through
the real service. The overlay still reads that connection for where
everybody is, the voice modes and staff silences, which the speaking
marks and the party strip are drawn from, and drops only the offers
and the roster. That holds whether the launcher took the audio before
or after the overlay was set up (#1959);
`tests/test-1959-relay-keeps-reading.js` runs both orders.

Both clients connect to everybody the service names on its roster,
and both offer again whenever their own side changes, as when the
microphone opens. When two offers cross, the one who joined first
ignores the other's and the later one gives way and answers. The
service always sends the roster that names somebody before anything
that person sends, even to a connection that has fallen behind. The
game's overlay shares the chat's connection, which can join before
the overlay is listening: at the character choice, or when the
launcher's join token comes back first. Until the overlay listens,
the chat keeps the newest roster and the offers sent to it, and hands
them over in that order (#1869).
`tests/test-1869-voice-negotiation.js` runs both clients through the
real service.

The service sends each connection where everybody near is once, when
it joins, and after that only who moved. So the chat also keeps that
first view with every move since, the voice modes said since the
roster, and any staff silence still on, and hands them over too
(#1924). Without them an overlay that started listening late never
saw anybody standing still, itself included: no speaking marks until
it moved, and the party strip read the same empty table.
`tests/test-1924-voice-whole-view.js` runs it through the real
service.
