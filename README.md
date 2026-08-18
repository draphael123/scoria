# SCORIA

An isometric souls-like action roguelike set in a dead forge-city.

**Hook — the armoury rack is your character sheet.** Class is decided by weapon.
Each weapon levels permanently across every run, so starting a run means walking
to the rack and choosing which mastery to carry in.

## Current state — Slice 0

The combat-feel vertical slice. One room, one blade, one Slagbound. Everything
downstream (the run, the town, the trees) waits on the answer to a single
question: **is a duel in an isometric camera actually fun?**

Shipped in this slice:

- Souls-slow attacks with three uncancellable phases (windup / active / recover)
- Lock-on as the primary targeting mode; WASD becomes strafe/backstep
- Stamina as the single economy — attacks, rolls and guard all draw from it
- Rolling with a real i-frame window; guard with chip damage and guard-break
- Poise and stagger, with a resistance window so stagger cannot be chain-locked
- Ground telegraphs: enemy attacks paint their hitbox on the floor and a bright
  fill scales 0 → 1, so the fill reaching the outline *is* the moment of impact
- Hitstop and screen shake on impact
- A frame-data debug overlay (F1) — the actual tuning instrument

## Running it

Serve over http:// — ES modules will not load from file://

```bash
python -m http.server 5810
```

Then open http://localhost:5810

## Controls

| Input | Action |
|---|---|
| WASD | Move (strafe when locked on) |
| LMB / J | Light attack — 3-hit chain |
| RMB / K | Heavy attack |
| Shift / F | Guard |
| Space | Roll (backstep with no direction held) |
| Tab / Q | Lock-on |
| F1 | Frame-data overlay |
| P / . | Pause / step one frame |
| R | Restart |

## Tuning

Every number that decides how combat feels lives in [`src/config.js`](src/config.js).
Nothing else needs editing to retune the fight.

`window.SCORIA` is exposed for headless work:

```js
SCORIA.sim({ policy: 'trade' })   // one scripted fight
SCORIA.simBatch(9)                // a spread of seeds
SCORIA.setPaused(true)            // freeze, then SCORIA.frameStep()
```

`sim()` is a **smoke test, not a balance oracle** — a scripted policy cannot
measure whether a fight feels good. Read its asserts (FIGHT_HAPPENED,
IFRAMES_WORKED, STAGGER_REACHABLE), not its win rate.

## Roadmap

- **Slice 1** — three enemies at once, plus the greataxe, to prove weapon = class
- **Slice 2** — the run: five rooms, a boss, death, back to town. Fire tome (Heat)
- **Slice 3** — the town and in-run levelling
- **Slice 4** — weapon trees
