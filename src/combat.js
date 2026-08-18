import { angleDelta, clamp } from './util.js';
import { STATE, PHASE } from './actor.js';
import { PLAYER, SLAGBOUND, IMPACT } from './config.js';

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

  let damage = atk.damage * (attacker.damageMul || 1);

  // Stagger amplifies incoming damage — this is the punish window.
  // Off the target's own definition — a Cinderbone is not a Slagbound.
  const tdef = target.def || SLAGBOUND;
  if (target.state === STATE.STAGGER) damage *= tdef.staggerDamageMul;

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

  out.push(ev);
  if (target.hp <= 0) target.kill();
  return ev;
}
