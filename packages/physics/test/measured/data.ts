/**
 * Published measurements of real balls on real tables, used to validate and
 * fit the physics (docs/physics-design.md, "Measured data").
 *
 * Only measured values (facts) are recorded here, with their sources; no
 * text, figures or code are copied. Values given in a source as a fitted
 * curve are marked as such.
 */

const INCH = 0.0254
const deg = Math.PI / 180

export interface Source {
  cite: string
  url: string
}

export const SOURCES = {
  mathavan2009: {
    cite: 'S. Mathavan, M. R. Jackson, R. M. Parkin, "Application of high-speed imaging to determine the dynamics of billiards", Am. J. Phys. 77(9), 788–794 (2009)',
    url: "https://doi.org/10.1119/1.3157159",
  },
  alciatoreB11: {
    cite: 'D. G. Alciatore, "TP B.11: Shallow-angle contact-point mirror kick system" (2010); data taken with Bob Jewett, March 2009',
    url: "https://billiards.colostate.edu/technical_proofs/new/TP_B-11.pdf",
  },
  alciatoreB3: {
    cite: 'D. G. Alciatore, "TP B.3: Throw calibration and contour plots" (2008); measurements by Colin Colenso',
    url: "https://billiards.colostate.edu/technical_proofs/new/TP_B-3.pdf",
  },
} satisfies Record<string, Source>

/** Snooker equipment in Mathavan 2009 (Riley Renaissance table). */
export const SNOOKER = {
  /** Ball diameter 52.4 mm (stated). */
  R: 0.0524 / 2,
  /** Not stated; a standard snooker ball (about 141 g). Nothing below depends on it noticeably. */
  m: 0.141,
  /** Cushion nose height 36 mm (stated). */
  cushionHeight: 0.036,
}

/**
 * Mathavan 2009, §III.A: cloth friction from tracked balls (snooker cloth).
 * Rolling deceleration 0.124–0.126 m/s² (μ_r 0.0127–0.0129); sliding
 * 1.75–2.40 m/s² (μ_s 0.178–0.245), along random directions.
 */
export const CLOTH_FRICTION = {
  source: SOURCES.mathavan2009,
  rolling: [0.0127, 0.0129] as const,
  sliding: [0.178, 0.245] as const,
}

/**
 * Mathavan 2009, §III.B: 31 rolling balls with no side spin, straight into a
 * snooker cushion, 0.28–3.5 m/s. Rebound speed (just after the impact)
 * against the incoming speed, given as the authors' least-squares
 * quadratic through the 31 points (a fitted curve, the points themselves
 * are only plotted).
 */
export const CUSHION_REBOUND_SPEED = {
  source: SOURCES.mathavan2009,
  range: [0.28, 3.5] as const,
  shots: 31,
  rebound: (v: number) => -0.0877 * v * v + 1.131 * v - 0.0953,
  /** Their straight-line fit's slope (an average restitution) and the slope at low speed. */
  linearSlope: 0.818,
  lowSpeedSlope: 0.91,
}

/**
 * Alciatore TP B.11 (pool, with Bob Jewett, 2009): a slow rolling cue ball
 * with no English into a rail. Angles from the rail, degrees: incoming;
 * immediately after the rail (high-speed video); and effective, once the
 * ball has finished curving (from where it next met a rail). "Slow" isn't
 * quantified.
 */
export const RAIL_REBOUND_ANGLE = {
  source: SOURCES.alciatoreB11,
  in: [10, 20, 30, 40, 50, 60, 70, 80],
  immediate: [5, 10.5, 23, 37, 46, 56, 70, 79.95],
  effective: [3.5, 8.4, 16.9, 25.2, 35.7, 48.7, 64.1, 75.5],
}

/**
 * Alciatore TP B.3 (pool, measurements by Colin Colenso): object ball throw
 * on stun shots (no follow or draw at contact), in inches per yard, for a
 * cut angle φ and cue ball speed v. `english` is Alciatore's percentage of
 * side spin at contact, ω = (5/4)(v/R)·english, positive for outside English.
 * Speeds are his scale: soft 4 km/h, medium 12 km/h, power 36 km/h (and
 * medium-soft 8 km/h).
 */
export interface ThrowPoint {
  cut: number
  v: number
  english: number
  /** Inches per yard (positive: in the direction of the cue ball's motion across the line of centers). */
  throwInPerYd: number
}

const kmh = (x: number) => x / 3.6
export const THROW = {
  source: SOURCES.alciatoreB3,
  points: [
    // No English (his calibration set).
    { cut: 30, v: kmh(4), english: 0, throwInPerYd: 4.8 },
    { cut: 45, v: kmh(4), english: 0, throwInPerYd: 5.6 },
    { cut: 30, v: kmh(8), english: 0, throwInPerYd: 3.5 },
    { cut: 45, v: kmh(8), english: 0, throwInPerYd: 3 },
    { cut: 30, v: kmh(12), english: 0, throwInPerYd: 3 },
    { cut: 45, v: kmh(12), english: 0, throwInPerYd: 2.3 },
    // 50% inside and outside English.
    { cut: 30, v: kmh(4), english: -0.5, throwInPerYd: 4.3 },
    { cut: 30, v: kmh(4), english: 0.5, throwInPerYd: -0.5 },
    { cut: 30, v: kmh(12), english: -0.5, throwInPerYd: 1.7 },
    { cut: 30, v: kmh(12), english: 0.5, throwInPerYd: -0.1 },
    { cut: 30, v: kmh(36), english: -0.5, throwInPerYd: 0.6 },
    { cut: 30, v: kmh(36), english: 0.5, throwInPerYd: -0.8 },
    { cut: 45, v: kmh(4), english: -0.5, throwInPerYd: 3.9 },
    { cut: 45, v: kmh(4), english: 0.5, throwInPerYd: 2.3 },
    { cut: 45, v: kmh(12), english: -0.5, throwInPerYd: 1 },
    { cut: 45, v: kmh(12), english: 0.5, throwInPerYd: 1.4 },
    { cut: 45, v: kmh(36), english: -0.5, throwInPerYd: 0.5 },
    { cut: 45, v: kmh(36), english: 0.5, throwInPerYd: 0.9 },
  ] satisfies ThrowPoint[],
}

/**
 * Mathavan 2009, Table I: a rolling cue ball into an object ball (snooker).
 * Incoming speed, cut angle, and each ball's speed once it has stopped
 * sliding and rolls (measured).
 */
export const BALL_BALL_SPEEDS = {
  source: SOURCES.mathavan2009,
  shots: [
    { v: 1.539, cut: 33.83, cue: 0.816, object: 0.836 },
    { v: 1.032, cut: 26.36, cue: 0.52, object: 0.629 },
    { v: 1.364, cut: 40.52, cue: 0.925, object: 0.7 },
    { v: 1.731, cut: 46.5, cue: 1.275, object: 0.787 },
    { v: 0.942, cut: 18.05, cue: 0.365, object: 0.581 },
  ],
}

export const units = { INCH, deg }
