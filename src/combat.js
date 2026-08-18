import { angleDelta, clamp } from './util.js';

/* The frontal-armour half-angle for a body, or 0 if it has none. */
function tdefArc(target) {
  return (target.def && target.def.armorArc) || 0;
}
import { STATE, PHASE } from './actor.js';
import { PLAYER, SLAGBOUND, IMPACT, BLEED } from './config.js';

export const GUARD_ARC = 2.44;   // ~140 degrees of frontal coverage

/* ---- hitbox shapes ------------------------------------------------------
   Both are flat tests on the XZ plane. Deliberately no physics engine: an
   ARPG wants authored hitboxes, not simulated ones. ---------------------- */

export function arcHits(attacker, target, reach, arc) {
  const d = attacker.distanceTo(target);
  if (d > reach + target.radius) return false;
  if (d < 1e-4) return true;
  const a = attacker.angleTo(target);
  return Math.abs(angleDelta(attacker.facing, a)) <= arc * 0.5;
}

export function circleHits(attacker, target, radius, offset) {
  const cx = attacker.x + Math.sin(attacker.facing) * offset;
  const cz = attacker.z + Math.cos(attacker.facing) * offset;
  return Math.hypot(target.x - cx, target.z - cz) <= radius + target.radius;
}

export function attackCovers(attacker, target) {
  const a = attacker.atk;
  if (!a) return false;

  // A projectile attack does no damage where the attacker is standing — the
  // shot does it, somewhere else, later. The wedge it draws on the floor is an
  // AIM LINE and nothing more.
  if (a.projectile) return false;

  // A ground zone is anchored to the world, not to the caster. Once it is cast
  // the caster may walk away and it still goes off exactly where it was put.
  if (a.zone && attacker.atkAim) {
    return Math.hypot(target.x - attacker.atkAim.x, target.z - attacker.atkAim.z)
           <= a.radius + target.radius;
  }

  if (a.shape === 'circle') return circleHits(attacker, target, a.radius, a.offset);
  return arcHits(attacker, target, a.reach ?? attacker.cfg.reach ?? 2.4, a.arc ?? 1.9);
}

/* ---- resolution ---------------------------------------------------------
   Called every fixed step. Only does anything during the ACTIVE phase, and
   only once per target per swing. ---------------------------------------- */

export function resolveActive(attacker, targets, out) {
  if (!attacker.atk || attacker.phase !== PHASE.ACTIVE) return;
  for (const t of targets) {
    if (t === attacker || t.dead) continue;
    if (attacker.atkHits.has(t)) continue;
    if (!attackCovers(attacker, t)) continue;
    attacker.atkHits.add(t);
    applyDamage(attacker, t, attacker.atk, out);
  }
}

export function applyDamage(attacker, target, atk, out) {
  const ev = { type: 'hit', attacker, target, atk, result: 'clean', damage: 0, x: target.x, z: target.z };

  if (target.invulnerable) {
    ev.result = 'iframe';
    out.push(ev);
    return ev;
  }

  // VENT deals no fixed damage. It deals whatever heat it just got rid of,
  // scaled — so the tome's panic button is weakest exactly when you least
  // needed to press it, and hardest when you were about to root yourself.
  const base = atk.ventScale
    ? (attacker.ventPower || 0) * atk.ventScale
    : atk.damage;
  let damage = base * (attacker.damageMul || 1);

  // Stagger amplifies incoming damage — this is the punish window.
  // Off the target's own definition — a Cinderbone is not a Slagbound.
  const tdef = target.def || SLAGBOUND;
  if (target.state === STATE.STAGGER) damage *= tdef.staggerDamageMul;

  // THE PLATE. A frontally-armoured body takes almost nothing from inside its
  // own facing arc, and no poise at all — so chipping away at the front is not
  // a slower way to win, it is not a way to win. Getting behind it is the only
  // answer, which is what turns its slow turn rate into the whole fight.
  //
  // `guardOpen` is set for the length of the one attack that swings the plate
  // ACROSS its own front, and by a blow heavy enough to throw it wide.
  const arc = tdefArc(target);
  if (arc && target.guardOpen <= 0 && !atk.ignoreArmor) {
    const fromAngle = target.angleTo(attacker);
    if (Math.abs(angleDelta(target.facing, fromAngle)) <= arc) {
      target.hp -= damage * (target.def.armorMul ?? 0.1);
      ev.result = 'clang';
      ev.damage = damage * (target.def.armorMul ?? 0.1);
      target.knock(attacker.x, attacker.z, IMPACT.knockGuard);
      // A heavy enough single blow throws the plate open regardless. Without
      // this a weapon with no way round is simply locked out of the fight.
      if ((atk.poise || 0) >= (target.def.guardBreakPoise ?? 999)) {
        target.guardOpen = target.def.guardBreakTime ?? 2;
        ev.result = 'guardbreak';
      }
      out.push(ev);
      return ev;
    }
  }

  // HYPERARMOUR. A weapon that declares it finishes its swing through a blow
  // instead of being interrupted by one. That is the whole reason a 0.72s
  // windup is playable, and it converts the question from "does this fit in
  // the gap?" to "can I afford this trade?" — so it has to cost. The extra
  // damage IS the price; without it, trading is strictly free.
  const armored = !!(target.armored);
  if (armored) damage *= (target.armorDamageMul || 1);

  // --- guard ------------------------------------------------------------
  const guarding = target.state === STATE.GUARD && target.guard;
  if (guarding) {
    const fromAngle = target.angleTo(attacker);
    const frontal = Math.abs(angleDelta(target.facing, fromAngle)) <= GUARD_ARC * 0.5;
    if (frontal) {
      const g = target.guard;
      if (target.stamina >= g.staminaPerHit) {
        target.spendStamina(g.staminaPerHit);
        const absorbed = damage * g.absorb;
        const through = damage - absorbed + absorbed * g.chip;
        target.hp -= through;
        ev.result = 'guarded';
        ev.damage = through;
        target.guardFlash = 0.16;
        target.knock(attacker.x, attacker.z, IMPACT.knockGuard);
        out.push(ev);
        if (target.hp <= 0) target.kill();
        return ev;
      }
      // Not enough stamina to hold it — guard break. Full damage + long stagger.
      target.spendStamina(target.stamina);
      target.stagger(PLAYER.hitStagger * 2.2);
      target.knock(attacker.x, attacker.z, IMPACT.knockHeavy);
      target.hp -= damage;
      ev.result = 'guardbreak';
      ev.damage = damage;
      out.push(ev);
      if (target.hp <= 0) target.kill();
      return ev;
    }
  }

  // --- clean hit --------------------------------------------------------
  target.hp -= damage;
  ev.damage = damage;

  // Damage aimed at the ECONOMY rather than at the bar. Blackdamp cannot kill
  // you; it can only take away your ability to do anything about the things
  // that can. On a heat weapon it drives the bar the other way, which is the
  // same threat expressed in that weapon's own currency.
  if (atk.stamDamage && target.spendStamina) {
    target.spendStamina(atk.stamDamage);
    ev.stam = atk.stamDamage;
  }

  // Damage aimed at the ECONOMY rather than at the bar. Blackdamp cannot kill
  // you; it can only take away your ability to do anything about the things
  // that can. On a heat weapon it drives the bar the other way, which is the
  // same threat expressed in that weapon's own currency.

  // Every clean blow MOVES the thing it hits. A hit that only changes a
  // number does not read as a hit. Impact class is a property of the BLOW
  // (atk.heavy), never of its id, so adding a weapon needs no edit here.
  // An attack may declare its own shove — the greataxe's HEAVE exists to move
  // bodies, so its knockback is the point rather than a side effect.
  target.knock(attacker.x, attacker.z,
    target.isPlayer
      ? (armored ? IMPACT.knockArmored : IMPACT.knockTaken)
      : (atk.knock ?? (atk.heavy ? IMPACT.knockHeavy : IMPACT.knockLight)));

  if (target.poise !== undefined) {
    const resist = target.staggerResist > 0 ? tdef.staggerResistMul : 1;
    target.poise -= (atk.poise || 0) * resist;
    target.poiseTimer = 0;
    if (target.poise <= 0) {
      target.poise = target.maxPoise;
      target.stagger(tdef.staggerDuration);
      target.knock(attacker.x, attacker.z, IMPACT.knockStagger);
      ev.result = 'stagger';
    }
  } else if (armored) {
    // Rocked, not stopped. A much smaller shove, no state change, and the
    // usual mercy window so a crowd cannot shred you mid-swing.
    ev.result = 'armored';
    target.invuln = Math.max(target.invuln, PLAYER.hurtInvuln);
  } else {
    target.stagger(PLAYER.hitStagger);
    target.invuln = Math.max(target.invuln, PLAYER.hurtInvuln);
  }

  // BLEED. Applied on any clean landing, and it is the knives' whole damage
  // model: stacks that decay unless you keep feeding them, and detonate at the
  // threshold. Deliberately NOT poise — poise is one big opening you earn once,
  // bleed is pressure you have to maintain.
  if (atk.bleed && ev.result !== 'iframe') {
    target.bleed = Math.min(BLEED.maxStacks, (target.bleed || 0) + atk.bleed);
    target.bleedFresh = 0;
    if (target.bleed >= BLEED.pop) {
      target.bleed = 0;
      target.hp -= BLEED.popDamage;
      ev.bleedPop = true;
      out.push({ type: 'hit', attacker, target, atk, result: 'bleed',
                 damage: BLEED.popDamage, x: target.x, z: target.z });
    }
  }

  out.push(ev);
  if (target.hp <= 0) target.kill();
  return ev;
}

/* Bleed ticking, run once per fixed step for every living body. Kept out of
   the actor update loops so it applies to the player and the enemies through
   exactly the same path. */
export function tickBleed(actor, dt, out) {
  if (!actor.bleed || actor.dead) return;
  actor.bleedFresh += dt;
  actor.bleedTick += dt;
  if (actor.bleedTick >= BLEED.tickEvery) {
    actor.bleedTick -= BLEED.tickEvery;
    const dmg = BLEED.tickDamage * actor.bleed;
    actor.hp -= dmg;
    out.push({ type: 'hit', attacker: null, target: actor, atk: { id: 'bleed', heavy: false },
               result: 'bleedtick', damage: dmg, x: actor.x, z: actor.z });
    if (actor.hp <= 0) actor.kill();
  }
  // Stop feeding it and it falls off. This is what stops the knives from
  // being a weapon you can apply once and then walk away from.
  if (actor.bleedFresh > BLEED.decayAfter) {
    actor.bleedDecay = (actor.bleedDecay || 0) + dt;
    if (actor.bleedDecay >= BLEED.decayEvery) {
      actor.bleedDecay = 0;
      actor.bleed = Math.max(0, actor.bleed - 1);
    }
  } else {
    actor.bleedDecay = 0;
  }
}
