import { MASTERY, MASTERY_ABILITIES, BOON_MODS, WEAPONS, STANDING } from './config.js';

/* ---------------------------------------------------------------------------
   MASTERY — what the weapon keeps.

   The one piece of state in this game that outlives a run, a death and a
   session, so it lives in its own module rather than inside the character, the
   game or the run. Nothing here knows what a fight is; it is told what
   happened and it writes it down.

   The storage key is versioned. A mastery table that changes shape and silently
   reads an old save is a player waking up with a rank they did not earn or
   losing one they did, and both are worse than starting again.
   ------------------------------------------------------------------------ */
const KEY = 'scoria.mastery.v1';

function blank() {
  const out = {};
  for (const id of Object.keys(MASTERY.rites)) out[id] = { rite: 0, rank: 0 };
  return out;
}

export function loadMastery() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const saved = JSON.parse(raw);
    const out = blank();
    for (const id of Object.keys(out)) {
      const s = saved[id];
      if (!s) continue;
      out[id].rite = Math.max(0, +s.rite || 0);
      out[id].rank = rankFor(out[id].rite);
    }
    return out;
  } catch { return blank(); }
}

export function saveMastery(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

/* Rank is DERIVED from the count, never stored as the truth. One number is the
   save; everything else is computed from it, so a threshold retune reranks
   every existing save correctly instead of stranding it. */
export function rankFor(rite) {
  let r = 0;
  for (let i = 1; i < MASTERY.thresholds.length; i++) {
    if (rite >= MASTERY.thresholds[i]) r = i;
  }
  return r;
}

export function progress(rite) {
  const r = rankFor(rite);
  const lo = MASTERY.thresholds[r];
  const hi = MASTERY.thresholds[r + 1];
  if (hi === undefined) return { rank: r, frac: 1, have: rite, need: null };
  return { rank: r, frac: Math.min(1, (rite - lo) / (hi - lo)), have: rite - lo,
           need: hi - lo };
}

/* Everything a weapon's current rank grants, flattened. Ranks are CUMULATIVE:
   reaching 3 keeps 1 and 2, because a progression that takes things away to
   give you others is a respec screen, not a mastery. */
export function masteryMods(weaponId, m) {
  const out = { ...BOON_MODS };
  const rite = MASTERY.rites[weaponId];
  const st = m && m[weaponId];
  if (!rite || !st) return out;
  for (let i = 0; i < st.rank; i++) {
    for (const [k, v] of Object.entries(rite.ranks[i].mods || {})) {
      if (BOON_MODS[k] === 1) out[k] *= v;
      else out[k] += v;
    }
  }
  return out;
}

export function masteryAbilities(weaponId, m) {
  const rite = MASTERY.rites[weaponId];
  const st = m && m[weaponId];
  if (!rite || !st) return [];
  const out = [];
  for (let i = 0; i < st.rank; i++) {
    const id = rite.ranks[i].ability;
    if (id && MASTERY_ABILITIES[id]) out.push(MASTERY_ABILITIES[id]);
  }
  return out;
}

/* ---------------------------------------------------------------------------
   THE RITES, counted from the event stream.

   Each weapon's rite is the one thing that weapon is FOR, so this is where the
   design lives rather than in a table of numbers: you cannot advance a weapon
   by playing well in general, only by taking the specific risk it is built
   around. A sword that never blocks and an axe that never eats a hit both stay
   at rank zero however many rooms they clear.
   ------------------------------------------------------------------------ */
export function countRite(weaponId, events, player) {
  let n = 0;
  for (const ev of events) {
    switch (weaponId) {
      case 'sword':
        // Blows you turned aside. Not blows you avoided — the point of a
        // shield is choosing to stand there.
        if (ev.target === player && ev.result === 'guarded') n++;
        break;
      case 'greataxe':
        /* Blows you ate MID-SWING. `armored` is set by the hyperarmour path,
           so this cannot be farmed by standing still and being hit — you have
           to have chosen to keep swinging through it.

           Worth two, because it is the only rite in the game that costs
           health to perform. Measured at one it came in at half the rate of
           every other weapon over the same two and a half minutes, which is
           the axe being punished for being the axe. */
        if (ev.target === player && ev.result === 'armored') n += 2;
        break;
      case 'daggers':
        // Things that actually bled out, not hits that applied a stack.
        if (ev.attacker === player && ev.result === 'bleed') n++;
        break;
      case 'tome':
        /* Heat DUMPED, and scaled by how much. A flat count per vent made the
           tome worth eight times every other rite in the same two minutes,
           because venting is cheap and you can do it cold — and venting cold
           is precisely the thing a bellows-master would not do. Scaling by
           `ventPower` means the rite is "held it, then let it go", which is
           the skill the weapon is actually about. */
        if (ev.attacker === player && ev.atk && ev.atk.id === 'V1') {
          n += Math.max(0, Math.round((player.ventPower || 0) / 30));
        }
        break;
      default: break;
    }
  }
  return n;
}


/* ---------------------------------------------------------------------------
   STANDING. Bought with gold, kept forever, and stored beside mastery because
   the two are the same KIND of thing: the parts of a character that outlive a
   run. Gold itself is banked here too — it has to survive the browser being
   closed, or the shop is a thing you can only use in the session you earned in.
   ------------------------------------------------------------------------ */
const BANK_KEY = 'scoria.bank.v1';

export function loadBank() {
  try {
    const raw = localStorage.getItem(BANK_KEY);
    const d = { gold: 0, owned: [] };
    if (!raw) return d;
    const b = JSON.parse(raw);
    return { gold: Math.max(0, +b.gold || 0),
             owned: Array.isArray(b.owned) ? b.owned.filter(
               (id) => STANDING.some((x) => x.id === id)) : [] };
  } catch { return { gold: 0, owned: [] }; }
}

export function saveBank(b) {
  try { localStorage.setItem(BANK_KEY, JSON.stringify(b)); } catch { /* private mode */ }
}

export function owns(bank, id) { return !!bank && bank.owned.includes(id); }

export function buyStanding(bank, id) {
  const item = STANDING.find((x) => x.id === id);
  if (!item || !bank || owns(bank, id) || bank.gold < item.cost) return false;
  bank.gold -= item.cost;
  bank.owned.push(id);
  saveBank(bank);
  return true;
}
