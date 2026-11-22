/**
 * Physical parameters and model settings. Defaults match pooltool 0.6.0's
 * built-in defaults (the reference our Phase 1 engine is validated against);
 * Phase 3 refits them to measured data.
 */

export interface BallParams {
  /** Mass, kg. WPA range 5.5–6 oz. */
  m: number
  /** Radius, m. WPA 2.25 in. */
  R: number
  /** Ball–cloth sliding friction. Alciatore. */
  u_s: number
  /** Ball–cloth rolling resistance. Alciatore. */
  u_r: number
  /** Spin-decay coefficient divided by R (u_sp = u_sp_proportionality · R). pooltool. */
  u_sp_proportionality: number
  /** Ball–ball friction when the "average" friction model is used. */
  u_b: number
  /** Ball–ball restitution. */
  e_b: number
  /** Ball–table restitution. */
  e_t: number
  /** Ball–cushion restitution. */
  e_c: number
  /** Ball–cushion friction. */
  f_c: number
  /** Gravitational acceleration, m/s². */
  g: number
}

export const DEFAULT_BALL_PARAMS: Readonly<BallParams> = {
  m: 0.170097,
  R: 0.028575,
  u_s: 0.2,
  u_r: 0.01,
  u_sp_proportionality: (10 * 2) / 5 / 9,
  u_b: 0.05,
  e_b: 0.95,
  e_t: 0.5,
  e_c: 0.85,
  f_c: 0.2,
  g: 9.81,
}

/**
 * Ball parameters fitted to measured data, for each cushion model
 * (docs/physics-design.md, "Measured data"; `node test/measured-report.ts`).
 * The cushion's restitution and friction are fitted by least squares to the
 * rebound angles Alciatore and Jewett measured on a pool table (TP B.11, a
 * rolling ball with no English, 10–80° from the rail, angles once the ball
 * has finished curving). The rest are pooltool's defaults, which the
 * measurements support or can't improve (ball–ball speeds, cloth sliding
 * friction; see the docs).
 */
export const MEASURED_BALL_PARAMS: Readonly<Record<"stronge" | "mathavan", Readonly<BallParams>>> = {
  stronge: { ...DEFAULT_BALL_PARAMS, e_c: 0.98, f_c: 0.14 },
  mathavan: { ...DEFAULT_BALL_PARAMS, e_c: 0.79, f_c: 0.17 },
}

/** Spinning (about the vertical) friction coefficient. */
export const spinFriction = (p: BallParams): number => p.u_sp_proportionality * p.R

export interface CueSpecs {
  /** Cue mass, kg. */
  M: number
  /** Effective end mass of the shaft, kg (sets squirt; Alciatore TP A-31). */
  end_mass: number
  /** Tip radius, m. */
  tip_radius: number
}

export const DEFAULT_CUE_SPECS: Readonly<CueSpecs> = { M: 0.567, end_mass: 0.0056699, tip_radius: 0.0106045 }

export interface ModelConfig {
  ballBall: {
    /**
     * "frictional_inelastic": closed-form impulse (Alciatore TP A-5/A-6/A-14).
     * "mathavan": Mathavan et al. 2014, integrated in impulse steps; includes
     * the cloth's friction during the impact. Balls in the air always use
     * the closed form.
     */
    model: "frictional_inelastic" | "mathavan"
    /** Speed-dependent throw friction u_b = a + b exp(-c v_rel) (Alciatore TP A-14). */
    friction: { a: number; b: number; c: number }
    /** Mathavan: about how many impulse steps a collision takes. */
    iterations: number
  }
  cushion: {
    /**
     * "stronge": Stronge's compliant impact at the nose (closed form).
     * "mathavan": Mathavan et al. 2010, integrated in impulse steps; includes
     * the cloth's friction during the impact. A ball in the air always uses
     * Stronge's model.
     */
    model: "stronge" | "mathavan"
    /** Stronge compliant model: tangential/normal frequency ratio, in (1, 2). */
    omegaRatio: number
    /** Mathavan: maximum number of impulse steps in compression. */
    maxSteps: number
    /** Mathavan: smallest impulse step, N·s. */
    deltaP: number
  }
  stickBall: {
    englishThrottle: number
    squirtThrottle: number
  }
  ballTable: {
    /** Landings that would bounce lower than this (m, bottom of the ball) don't bounce. */
    minBounceHeight: number
  }
}

export const DEFAULT_MODEL_CONFIG: Readonly<ModelConfig> = {
  ballBall: { model: "frictional_inelastic", friction: { a: 0.009951, b: 0.108, c: 1.088 }, iterations: 1000 },
  cushion: { model: "stronge", omegaRatio: 1.8, maxSteps: 1000, deltaP: 0.001 },
  stickBall: { englishThrottle: 1, squirtThrottle: 1 },
  ballTable: { minBounceHeight: 0.005 },
}

/**
 * Model settings fitted to measured data (docs/physics-design.md, "Measured
 * data"). Throw friction: least squares to Colenso's 18 measured throws on
 * a pool table (in Alciatore TP B.3: stun shots at 30° and 45° cuts,
 * 4–36 km/h, with and without English). pooltool's default curve comes from
 * Marlow's three friction measurements and gives about a third of the
 * measured throw at medium speed.
 */
export const MEASURED_MODEL_CONFIG: Readonly<ModelConfig> = {
  ...DEFAULT_MODEL_CONFIG,
  ballBall: { ...DEFAULT_MODEL_CONFIG.ballBall, friction: { a: 0.0166, b: 0.215, c: 0.607 } },
}
