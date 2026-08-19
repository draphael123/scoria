# Music

Three tracks, all **CC0 / public domain**, from
[OpenGameArt](https://opengameart.org). CC0 requires no attribution — the
credits below are there because it costs nothing and the people who made these
are the reason the game has music at all.

| file         | track              | author                                        |
|--------------|--------------------|-----------------------------------------------|
| `menu.mp3`   | Crystal Cave       | cynicmusic (Peter Sadlon) — cynicmusic.com    |
| `town.mp3`   | Town Theme (RPG)   | cynicmusic (Peter Sadlon) — cynicmusic.com    |
| `combat.mp3` | Battle Theme A     | cynicmusic (Peter Sadlon) — cynicmusic.com    |

Sources, verified CC0 on the submission page rather than by the search filter
(the filter is not reliable per-item — several results that came back under a
CC0 search turned out to be OGA-BY on their own page):

- opengameart.org/content/crystal-cave-song18
- opengameart.org/content/town-theme-rpg
- opengameart.org/content/battle-theme-a

## Replacing them

Drop a file at `audio/<name>.ogg` or `.mp3` and it replaces that track on the
next load. Names are `menu`, `town`, `combat`. If a file is missing the
synthesised score plays instead, so removing one is a valid edit.

Files are looped end to end and loop points are not honoured — pick or trim
tracks that already loop cleanly.

**Set the trim.** `TRACK_TRIM` in `src/audio.js` pulls each recorded track down
onto the loudness curve the synth score was written to: menu quietest, combat
loudest. That curve exists because the enemy windup tone is the one sound in
this game that is load-bearing, and music mastered to somebody else's level
will sit straight on top of it. To find the number for a new file, measure its
RMS and divide the target (0.0104 menu / 0.0266 town / 0.0627 combat) by
`rms * 0.5`.

## Other sources

- **opengameart.org** — filter to CC0, then confirm on each submission page.
- **freesound.org** — CC0 filter; good for drones and ambience, uneven.
- **incompetech.com** (Kevin MacLeod) — CC-BY, so attribution is *required*
  rather than polite. Excellent quality. If you use it, the credit has to be
  visible in the game before you ship.

Note: freepd.com is gone as of 2026-08.
