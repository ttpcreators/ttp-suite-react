/**
 * L'araignée-robot (même principe que la vidéo @everything.bends : petit corps noir en blocs,
 * huit longues pattes fines aux articulations roses, pattes plantées qui avancent une à une).
 * Moteur pur, sans React ni DOM : on lui donne une cible, il calcule le corps, les genoux et les pieds.
 * Même code pour la page de crawl (web-crawler), les vidéos Remotion et TTP Suite.
 */

export type Pt = { x: number; y: number };
export type Leg = { hip: Pt; knee: Pt; foot: Pt; lifting: boolean };
export type SpiderPose = { body: Pt; legs: Leg[]; speed: number; moving: boolean };

type Foot = { at: Pt; from: Pt; to: Pt; t: number; stepping: boolean };

const ANGLES = [-62, -24, 14, 52]; // direction de repos de chaque paire de pattes (degrés, 0 = horizontal)
const GROUP_A = [0, 3, 5, 6]; // les pattes qui avancent ensemble (démarche alternée)

export type SpiderOptions = {
  /** Taille globale (1 = corps de 22 × 30 px, pattes de ~120 px d'envergure). */
  scale?: number;
  /** Vitesse maximale en px par seconde. */
  maxSpeed?: number;
  /** Petit tic de patte au repos (vivante). */
  idle?: boolean;
  /** Graine pour les petits mouvements au repos (vidéo : même rendu à chaque fois). */
  seed?: number;
};

function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class SpiderEngine {
  pos: Pt;
  vel: Pt = { x: 0, y: 0 };
  private feet: Foot[];
  private hips: Pt[];
  private homes: Pt[];
  private upper: number;
  private lower: number;
  private maxSpeed: number;
  private idle: boolean;
  private rnd: () => number;
  private idleClock = 0;
  private group = 0;

  constructor(start: Pt, opts: SpiderOptions = {}) {
    const s = opts.scale ?? 1;
    this.upper = 46 * s;
    this.lower = 58 * s;
    this.maxSpeed = (opts.maxSpeed ?? 520) * s;
    this.idle = opts.idle ?? true;
    this.rnd = rand(opts.seed ?? 7);
    this.pos = { ...start };
    this.hips = [];
    this.homes = [];
    for (let i = 0; i < 4; i++) {
      for (const side of [-1, 1]) {
        const hip = { x: side * 9 * s, y: (-9 + i * 6) * s };
        const a = (ANGLES[i] * Math.PI) / 180;
        const r = (this.upper + this.lower) * 0.78;
        this.hips.push(hip);
        this.homes.push({ x: hip.x + side * Math.cos(a) * r, y: hip.y + Math.sin(a) * r });
      }
    }
    this.feet = this.homes.map((h) => {
      const at = { x: start.x + h.x, y: start.y + h.y };
      return { at, from: at, to: at, t: 1, stepping: false };
    });
  }

  /** Avance la simulation de `dt` secondes vers `target`. */
  update(dt: number, target: Pt) {
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dist = Math.hypot(dx, dy);
    const want = Math.min(this.maxSpeed, dist * 5);
    const vx = dist > 0.5 ? (dx / dist) * want : 0;
    const vy = dist > 0.5 ? (dy / dist) * want : 0;
    // Petite inertie : le corps glisse, il ne se téléporte pas.
    this.vel.x += (vx - this.vel.x) * Math.min(1, dt * 10);
    this.vel.y += (vy - this.vel.y) * Math.min(1, dt * 10);
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    const speed = Math.hypot(this.vel.x, this.vel.y);
    const reach = this.upper + this.lower;
    const stepDur = speed > 40 ? 0.11 : 0.16;
    const threshold = reach * (speed > 40 ? 0.42 : 0.3);

    let steppingCount = this.feet.filter((f) => f.stepping).length;
    const order = this.group === 0 ? GROUP_A : [1, 2, 4, 7];
    const tryStep = (i: number, extra: Pt = { x: 0, y: 0 }) => {
      const f = this.feet[i];
      const home = this.home(i);
      const lead = { x: this.vel.x * 0.16, y: this.vel.y * 0.16 };
      f.from = { ...f.at };
      f.to = { x: home.x + lead.x + extra.x, y: home.y + lead.y + extra.y };
      f.t = 0;
      f.stepping = true;
      steppingCount++;
    };
    for (const i of order) {
      const f = this.feet[i];
      if (f.stepping || steppingCount >= 4) continue;
      const h = this.home(i);
      if (Math.hypot(f.at.x - h.x, f.at.y - h.y) > threshold) tryStep(i);
    }
    // Les autres pattes rattrapent si elles sont vraiment trop loin.
    this.feet.forEach((f, i) => {
      if (f.stepping) return;
      const h = this.home(i);
      if (Math.hypot(f.at.x - h.x, f.at.y - h.y) > reach * 0.85) tryStep(i);
    });
    if (this.feet.every((f) => !f.stepping)) this.group = 1 - this.group;

    // Au repos : de temps en temps une patte tâte le terrain.
    if (this.idle && speed < 20) {
      this.idleClock -= dt;
      if (this.idleClock <= 0) {
        this.idleClock = 0.5 + this.rnd() * 0.9;
        const i = Math.floor(this.rnd() * 8);
        if (!this.feet[i].stepping) tryStep(i, { x: (this.rnd() - 0.5) * 22, y: (this.rnd() - 0.5) * 22 });
      }
    }

    for (const f of this.feet) {
      if (!f.stepping) continue;
      f.t = Math.min(1, f.t + dt / stepDur);
      const e = ease(f.t);
      f.at = { x: f.from.x + (f.to.x - f.from.x) * e, y: f.from.y + (f.to.y - f.from.y) * e };
      if (f.t >= 1) f.stepping = false;
    }
  }

  private home(i: number): Pt {
    return { x: this.pos.x + this.homes[i].x, y: this.pos.y + this.homes[i].y };
  }

  /** Corps, genoux (IK à deux segments, genou vers l'extérieur) et pieds, en coordonnées du monde. */
  pose(): SpiderPose {
    const legs: Leg[] = this.feet.map((f, i) => {
      const hip = { x: this.pos.x + this.hips[i].x, y: this.pos.y + this.hips[i].y };
      let dx = f.at.x - hip.x;
      let dy = f.at.y - hip.y;
      let d = Math.hypot(dx, dy) || 0.001;
      const max = this.upper + this.lower - 0.5;
      const min = Math.abs(this.upper - this.lower) + 0.5;
      const L = Math.max(min, Math.min(max, d));
      if (d > max) {
        dx = (dx / d) * L;
        dy = (dy / d) * L;
        d = L;
      }
      const cosA = (this.upper * this.upper + L * L - this.lower * this.lower) / (2 * this.upper * L);
      const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
      const base = Math.atan2(dy, dx);
      const side = i % 2 === 0 ? -1 : 1;
      // Genou du côté extérieur et un peu vers le haut, comme une vraie araignée vue de dessus.
      const k1 = { x: hip.x + Math.cos(base - a) * this.upper, y: hip.y + Math.sin(base - a) * this.upper };
      const k2 = { x: hip.x + Math.cos(base + a) * this.upper, y: hip.y + Math.sin(base + a) * this.upper };
      const score = (k: Pt) => (k.x - this.pos.x) * side - (k.y - this.pos.y) * 0.35;
      const knee = score(k1) > score(k2) ? k1 : k2;
      const foot = { x: hip.x + dx, y: hip.y + dy };
      return { hip, knee, foot, lifting: f.stepping };
    });
    const speed = Math.hypot(this.vel.x, this.vel.y);
    return { body: { ...this.pos }, legs, speed, moving: speed > 20 };
  }
}

/** Pour la vidéo : rejoue la simulation image par image, de façon identique à chaque rendu. */
export function simulateSpider(frames: number, fps: number, targetAt: (frame: number) => Pt, opts: SpiderOptions = {}): SpiderPose[] {
  const sp = new SpiderEngine(targetAt(0), { ...opts, seed: opts.seed ?? 11 });
  const out: SpiderPose[] = [];
  const sub = 2; // deux pas de calcul par image, plus fluide
  for (let f = 0; f < frames; f++) {
    for (let k = 0; k < sub; k++) sp.update(1 / fps / sub, targetAt(f));
    out.push(sp.pose());
  }
  return out;
}

/** Les couleurs de la vidéo de référence. */
export const SPIDER_COLORS = {
  ink: "#111111",
  joint: "#F23DD3", // rose des articulations et des étiquettes « LOVE »
  violet: "#5B2BF0", // violet des étiquettes « HATE »
  cyan: "#3AA0DD", // petite étiquette du robot
  silk: "rgba(17,17,17,0.22)",
};
