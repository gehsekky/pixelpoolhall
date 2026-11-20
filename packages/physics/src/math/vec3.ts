/**
 * Small 3-vector helpers. Vectors are plain tuples; these functions return new
 * tuples and never mutate their inputs. Hot paths (event detection) work on
 * scalars instead and don't use these.
 */

export type Vec3 = [number, number, number]

export const ZERO: Readonly<Vec3> = [0, 0, 0]
export const Z_HAT: Readonly<Vec3> = [0, 0, 1]

export const vec = (x: number, y: number, z: number): Vec3 => [x, y, z]
export const copy = (a: Readonly<Vec3>): Vec3 => [a[0], a[1], a[2]]
export const add = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Readonly<Vec3>, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
/** a + k b */
export const addScaled = (a: Readonly<Vec3>, b: Readonly<Vec3>, k: number): Vec3 => [a[0] + k * b[0], a[1] + k * b[1], a[2] + k * b[2]]
export const dot = (a: Readonly<Vec3>, b: Readonly<Vec3>): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Readonly<Vec3>, b: Readonly<Vec3>): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const norm = (a: Readonly<Vec3>): number => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
export const norm2d = (a: Readonly<Vec3>): number => Math.sqrt(a[0] * a[0] + a[1] * a[1])
export const squaredNorm = (a: Readonly<Vec3>): number => a[0] * a[0] + a[1] * a[1] + a[2] * a[2]

/** a / |a|; the zero vector maps to itself. */
export function unit(a: Readonly<Vec3>): Vec3 {
  const n = norm(a)
  return n === 0 ? [0, 0, 0] : [a[0] / n, a[1] / n, a[2] / n]
}

/** Velocity of the point at R d on a ball's surface: v + w x (R d). */
export function surfaceVelocity(v: Readonly<Vec3>, w: Readonly<Vec3>, d: Readonly<Vec3>, R: number): Vec3 {
  return add(v, cross(w, scale(d, R)))
}

/** surfaceVelocity with v's component along d removed: the sliding velocity at that point. */
export function tangentSurfaceVelocity(v: Readonly<Vec3>, w: Readonly<Vec3>, d: Readonly<Vec3>, R: number): Vec3 {
  return add(addScaled(v, d, -dot(v, d)), cross(w, scale(d, R)))
}

/** Velocity of the ball's contact point with the cloth: v + w x (-R z) = (vx - R wy, vy + R wx, vz). */
export function slipVelocity(v: Readonly<Vec3>, w: Readonly<Vec3>, R: number): Vec3 {
  return [v[0] - R * w[1], v[1] + R * w[0], v[2]]
}
