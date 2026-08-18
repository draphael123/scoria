# SCORIA

An isometric souls-like action roguelike set in a forest the forge killed.

**Hook — the armoury rack is your character sheet.** Class is decided by weapon.
Each weapon levels permanently across every run, so starting a run means walking
to the rack and choosing which mastery to carry in.

**Play it:** https://scoria-pi.vercel.app

(`scoria.vercel.app` is an unrelated project — Vercel subdomains are global.)

## Current state — Slice 0

The combat-feel vertical slice. One clearing, one blade, one Slagbound. Everything
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

Around the fight:

- A dead forest built from procedural canvas textures — no binary assets. The
  trees are grown by recursive branching, and every branch segment in the wood
  is one instance of a single cylinder, so it all costs one draw call
- Ambient life: drifting ash and embers, guttering fires on layered sines, the
  ruined furnace still burning
- A hand-rolled post chain: bloom, vignette, colour grade, grain. Bloom earns
  its place because nearly every readable signal here is emissive
- Jointed, animated rigs — stride driven by distance travelled so feet never
  skate, shoulder twist through the swing, idle breathing, roll tuck
- Weapon trails, contact shadows, hit flashes and scorch decals
- Knockback, camera punch, hitstop, and a beat of slow motion the instant you
  break poise
- Floating damage typed by kind, a threat arc pointing at whatever is winding
  up at you, combo pips, and a roll-cost ghost on the stamina bar
- Tall props fade out when they come between the camera and the duel, because
  a fixed isometric camera gives the player no way to look around them
- Title screen, pause menu and persisted settings (volumes, screen shake,
  quality, frame-data overlay)
- Synthesised audio — no sample files. The enemy windup plays a rising tone
  that resolves exactly on impact, giving the telegraph a second channel for
  when the floor decal is hidden behind your own body
- Touch controls with a floating movement stick, so strafing round a locked
  target works with a thumb that never lands twice in the same place

### Character creation

Four attributes on a six-point buy — Vigour, Endurance, Strength, Agility —
plus plate colour, heraldry, helm shape and crest. The spread is deliberately
narrow: class comes from the weapon in this game, so attributes shape a run
without deciding it. A default 2/2/2/2 build derives exactly the tuned
baseline (100 vigour, 100 stamina, 0.35s i-frames).

### Tutorial

A nine-step sequence against a wicker effigy, every step gated on the player
actually performing the action rather than on a timer or a "next" button:
move, lock on, chain, heavy, run stamina dry, roll through a telegraph, guard,
break poise. Then it hands straight off to the real fight.

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
| Esc | Menu |
| F1 | Frame-data overlay |
| P / . | Pause / step one frame |
| R | Restart |

On touch devices the controls appear automatically: drag anywhere on the left
half to move, buttons on the right to strike, and hold GUARD to block.

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
