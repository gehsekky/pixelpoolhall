/**
 * The floating cue stick. Built along +y with the tip at the origin, so
 * placing it is just: put the origin at the tip position and point +y back
 * along the cue toward the butt.
 */
import * as THREE from "three"

interface Piece {
  len: number
  /** Radius at the tip end and at the butt end, m. */
  r0: number
  r1: number
  color: number
  roughness?: number
}

// 58 in (1.47 m) cue: tip, ferrule, maple shaft, joint, forearm, wrap, butt cap.
const PIECES: Piece[] = [
  { len: 0.012, r0: 0.0064, r1: 0.0065, color: 0x2f6fb5, roughness: 0.9 },
  { len: 0.025, r0: 0.0065, r1: 0.0066, color: 0xf3f0e6, roughness: 0.3 },
  { len: 0.7, r0: 0.0066, r1: 0.0098, color: 0xe2c690, roughness: 0.35 },
  { len: 0.02, r0: 0.0105, r1: 0.0105, color: 0x1a1a1a, roughness: 0.2 },
  { len: 0.45, r0: 0.0105, r1: 0.0128, color: 0x3b1d10, roughness: 0.3 },
  { len: 0.25, r0: 0.0128, r1: 0.0138, color: 0x111111, roughness: 0.8 },
  { len: 0.02, r0: 0.0142, r1: 0.0142, color: 0x1a1a1a, roughness: 0.2 },
]

export function createCue(): THREE.Group {
  const group = new THREE.Group()
  let y = 0
  for (const p of PIECES) {
    // CylinderGeometry's top (+y) gets radiusTop; our +y points to the butt.
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(p.r1, p.r0, p.len, 32),
      new THREE.MeshStandardMaterial({ color: p.color, roughness: p.roughness ?? 0.4 }),
    )
    mesh.position.y = y + p.len / 2
    mesh.castShadow = true
    group.add(mesh)
    y += p.len
  }
  return group
}

const Y = new THREE.Vector3(0, 1, 0)

/**
 * Pose the cue for a strike: aim `phi` and elevation `theta` (degrees, as in
 * the physics CueStrike), contact offsets a (side, + = left) and b (height,
 * + = above center) in ball radii, with the tip `gap` metres short of the
 * contact point.
 */
export function poseCue(cue: THREE.Object3D, center: THREE.Vector3, R: number, phi: number, theta: number, a: number, b: number, gap: number): void {
  const ph = (phi * Math.PI) / 180
  const th = (theta * Math.PI) / 180
  // Cue direction (butt to tip), pointing down when elevated.
  const f = new THREE.Vector3(Math.cos(th) * Math.cos(ph), Math.cos(th) * Math.sin(ph), -Math.sin(th))
  const right = new THREE.Vector3().crossVectors(f, new THREE.Vector3(0, 0, 1)).normalize()
  const up = new THREE.Vector3().crossVectors(right, f)
  const depth = Math.sqrt(Math.max(0, 1 - a * a - b * b))
  const contact = center
    .clone()
    .addScaledVector(right, -a * R)
    .addScaledVector(up, b * R)
    .addScaledVector(f, -depth * R)
  cue.position.copy(contact).addScaledVector(f, -gap)
  cue.quaternion.setFromUnitVectors(Y, f.clone().negate())
}
