# SCORIA

An isometric souls-like action roguelike set in a forest the forge killed.

**Hook — the armoury rack is your character sheet.** Class is decided by weapon.
Each weapon levels permanently across every run, so starting a run means walking
to the rack and choosing which mastery to carry in.

**Play it:** https://scoria-pi.vercel.app

(`scoria.vercel.app` is an unrelated project — Vercel subdomains are global.)

## Current state — Slice 1

Slice 0 asked whether a duel in an isometric camera is fun. It is, so Slice 1
asks the two questions that come next: **does the weapon actually decide the
class**, and **does isometric combat survive a crowd?**

### The greataxe — Cupola Splitter, class Breaker

A second weapon that is not a slower sword. Four of its differences are rules
rather than numbers:

- **Hyperarmour** — its swings cannot be interrupted during windup and active,
  only during recovery, at the cost of +20% damage taken. This turns the
  question from *does this fit in the gap* into *can I afford this trade*, and
  it is the only reason a 0.72s windup is playable at all
- **A 360 sweep** — the second link of its chain hits everything around you.
  Nothing in the sword's kit can touch anything behind you
- **A circular heavy** — the Splitter paints a disc on the floor, the same
  shape family as the Slagbound's overhead. Every sword attack is a wedge
- **A rescaled roll** — 22% less distance, 15% longer, 30% dearer, with the
  i-frame *window* untouched. You dodge just as safely and cannot reposition

And the numbers that matter follow from those. Reach 3.15 against the sword's
2.35 opens a **0.53u band where your axe connects and the Slagbound's swipe
cannot** — the sword has no such band and fights inside its reach at all times.
The two weapons also punish *different attacks*: the sword's L1 fits inside the
swipe's 0.62s recovery, and only the axe's Splitter fits inside the overhead's
0.95s. Same enemy, two different fights.

### Three Slagbounds, and the aggro token

**At most one enemy may be in windup at any moment.** Not a probability — a
rule. A Slagbound cannot begin an attack without the token and only one exists,
so two ground telegraphs can never overlap because two can never exist.
Readability is the core mechanic here, so it is guaranteed structurally rather
than tuned for.

Everything else follows from that:

- Enemies without the token hold a **distinct orbit slot measured from your
  facing**, so turning to deal with the one in front walks the others around
  behind you. That is what gives the greataxe's sweep a reason to exist
- The holder's molten core is lit and the circlers are banked — a body-level
  tell, deliberately not another floor decal, because the floor belongs to the
  telegraph
- The token is granted by hunger: a body that has waited long enough always
  wins the next turn, so the ring rotates instead of the two nearest bodies
  trading it forever
- The handoff pause is skipped in a duel, so the one-on-one fight keeps exactly
  the cadence it was playtested with — measured identical, seed for seed
- Your own telegraph is drawn in **cold steel, the enemy's in ember**. Orange is
  the danger channel and belongs to the enemy alone
- Lock-on cycles with E and the mouse wheel, ordered by bearing; the camera
  widens with the spread of the crowd; enemy-vs-enemy collision is weighted
  evenly instead of by array order

### The off-hand button

One binding, a different verb per weapon — the clearest expression of
weapon=class anywhere in the control scheme.

- **Sword — GUARD.** A heater shield, carried on the off arm at all times and
  brought up when you hold the button. Absorbs 72%, chips the rest, and breaks
  if you hold it with no stamina. It answers pressure by *absorbing* it.
- **Greataxe — HEAVE.** No shield; both hands are on the haft. A press throws a
  wide two-handed shove: almost no damage, enormous poise and knockback, 166°
  of arc. It answers pressure by *displacing* it — it is not an attack, it is a
  way of buying a metre of floor when the ring closes.

`weapon.offhand` decides which, so the daggers' parry and the tome's vent slot
into the same button later without touching input, HUD or touch controls.

### Room two — the sorting floor

Clear the clearing and the tree line opens: a column of light at the edge, and
walking into it carries your health and stamina into the next room. That
carry-over is the whole reason two rooms feel like somewhere you are *going*
rather than a fight select — the first room has to cost you something.

Waiting there are five **Cinderbones**. Deliberately not weaker Slagbounds:

|  | Slagbound | Cinderbone |
|---|---|---|
| punishes | bad **reads** | bad **position** |
| hp / poise | 180 / 48 | 55 / 16 |
| hesitation | 0.45–1.15s | 0.22–0.60s |
| the threat | the swing in front of you | having nowhere to roll to |

16 poise means one greataxe Cleave staggers a Cinderbone outright while a sword
light needs two, so the weapons feel different against the crowd before any
damage number is involved. One Sweep clears three; a sword takes them one at a
time, and taking them one at a time is how you end up surrounded.

**The token still holds absolutely — five bodies, one windup.** Pressure comes
from *cadence*: a Cinderbone hesitates for a third as long, so the token changes
hands two or three times as fast. Measured over 30s with five bodies:
`maxConcurrentWindup` 1, and all five take turns.

The room is the same clearing re-dressed rather than a second world — the forge
goes out, the light pool goes cold, and the floor fills with picked-over bone
and tipped sorting tables. Rebuilding the wood per room would cost a hitch and
buy nothing: the trees are not what tells you where you are, the light is.

### The rack

Weapon choice now happens in the character creator, above the attributes,
because the weapon decides the class and the attributes only shade it. Locked
weapons are shown too — seeing what is not yet forged is half of what makes a
rack read as a rack. A segmented control below picks the fight: ONE or THREE.

### From Slice 0

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
python tools/devserver.py 5810
```

(`python -m http.server` works too, but it lets the browser cache modules — and
a fresh `config.js` beside a stale `game.js` fails silently rather than loudly.)

Then open http://localhost:5810

## Controls

| Input | Action |
|---|---|
| WASD | Move (strafe when locked on) |
| LMB / J | Light attack — chain (3 links on the sword, 2 on the axe) |
| RMB / K | Heavy attack |
| Space | Roll (backstep with no direction held) |
| Tab / Q | Lock-on |
| E / wheel | Cycle target |
| Shift / F | Off hand — GUARD with the sword, HEAVE with the greataxe |
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
SCORIA.sim({ weapon: 'greataxe', encounter: 'trio' })   // one scripted fight
SCORIA.smoke(7)                   // every weapon x encounter, asserts only
SCORIA.setWeapon('greataxe')      // swap class without walking the creator
SCORIA.setEncounter('trio')
SCORIA.setPaused(true)            // freeze, then SCORIA.frameStep()
```

`sim()` is a **smoke test, not a balance oracle** — a scripted policy cannot
measure whether a fight feels good, and a greedy bot under-reads positional
mechanics, which is most of what Slice 1 added. Read its asserts, not its win
rate:

| Assert | What it proves |
|---|---|
| `FIGHT_HAPPENED` | both sides connected at least once |
| `IFRAMES_WORKED` | a roll actually phased a blow |
| `STAGGER_REACHABLE` | poise can still be broken |
| `HYPERARMOUR_FIRED` | an armoured swing survived contact |
| `ONE_TELEGRAPH` | **the token invariant** — never two windups at once |

`ONE_TELEGRAPH` is structural rather than statistical, so a failure there is a
bug and not a tuning miss.

## Roadmap

- ~~**Slice 1** — three enemies at once, plus the greataxe~~ ✅
- ~~**Slice 1.5** — a second room, skeletons, and the off-hand verb~~ ✅
- **Slice 2** — the run: five rooms, a boss, death, back to town. Fire tome (Heat)
- **Slice 3** — the town and in-run levelling
- **Slice 4** — weapon trees
