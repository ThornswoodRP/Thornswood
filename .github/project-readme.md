# Thornswood To Do

Everything the Thornswood team needs to do, in the order to do it. One card
is one issue on [ThornswoodRP/Thornswood](https://github.com/ThornswoodRP/Thornswood/issues),
and this board is the only record of outstanding work: if it is not here, it
is not going to get done.

## Reading it

- **Order** is the do-order. Sort the view by Order and work down.
- **Status** says where it stands: Todo, In Progress, or Done (merged and
  waiting only on a test).
- **area:** labels say which part of the project it is.
- **needs: patrick** marks what waits on Patrick.
- **anyone can start** marks work that needs nobody in particular.
- Each issue says where the problem lives, what is known, the steps as a
  checklist, the commands, when it is done, and the traps.

## Working on it

- Assign yourself when you start, and move the card to In Progress.
- Found something new? Open an issue with the Work for the team form and give it
  the Order of where it belongs (52.5 between 52 and 53 is fine), not the end.
- Something that fits an existing issue goes on that issue as an edit or a
  comment, not a second issue.
- Write down what was measured and what is left, not just that you looked.
- A fix changes the cause. No band-aids: nothing that notices the damage and
  undoes it, and no retry that hopes a race comes out right. Until the cause
  is found, finding it is the work.
- A pull request that finishes an issue says `Closes #N`; merging it closes
  the issue and moves the card to Done.
- A fix people would notice says `Refs #N` instead, and its issue stays open
  until the fix is on main, where testers test. Then it is closed with a
  comment that starts `Test task:` and `Server: Main`, plain steps any
  playtester can do, which the bot posts to #test-tasks.
- A check only a dev can do (staff or dev commands, the dev server, logs,
  the box, a setup testers cannot make) is a `Test task:` with `Server: Dev`,
  in developer terms with a `Build:` line: the bot posts it at once in the
  staff-only #dev-test-tasks, and it stays while the fix is on main.
- #known-issues holds only findings nothing has been done about: an issue
  with a merged change or a test task leaves it by itself.
- One post per issue per forum: change the comment, never post again by
  hand. docs/guide/the-board.md, "Test tasks and known issues", has both shapes.

The rules behind all of this are in
[Developer-Guide.md](https://github.com/ThornswoodRP/Thornswood/blob/main/Developer-Guide.md).
Every entry from before the board, finished ones included, is in the team's
dated To Do List of 25 September, kept in the private ops repo; an "entry 243"
in the code means entry 243 there.
