/**
 * Ball meshes with generated textures: WPA colors (Equipment Specifications
 * §16) — solids 1–8, stripes 9–15 on white, numbers on white circles, 6 and
 * 9 underscored. The cue ball carries six small dots so spin is visible.
 */
import * as THREE from "three"

const COLORS: Record<number, string> = {
  1: "#f4c20d",
  2: "#1f4fbf",
  3: "#d0202e",
  4: "#5a2d8c",
  5: "#f26a1b",
  6: "#13804a",
  7: "#7b1e2c",
  8: "#121212",
}

const W = 512
const H = 256

function ballTexture(id: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext("2d")!
  const ivory = "#f7f4ea"
  if (id === "cue") {
    g.fillStyle = ivory
    g.fillRect(0, 0, W, H)
    // Dots at the six axis directions of the equirectangular map.
    g.fillStyle = "#c62828"
    for (const [u, v] of [
      [0, 0.5],
      [0.25, 0.5],
      [0.5, 0.5],
      [0.75, 0.5],
    ] as const) {
      g.beginPath()
      g.arc(u * W, v * H, 7, 0, 2 * Math.PI)
      g.fill()
    }
    g.fillRect(0, 0, W, 6)
    g.fillRect(0, H - 6, W, 6)
    // Wrap the dot at u = 0.
    g.beginPath()
    g.arc(W, H / 2, 7, 0, 2 * Math.PI)
    g.fill()
  } else {
    const n = Number(id)
    const color = COLORS[n > 8 ? n - 8 : n]!
    if (n > 8) {
      g.fillStyle = ivory
      g.fillRect(0, 0, W, H)
      g.fillStyle = color
      g.fillRect(0, H * 0.3, W, H * 0.4)
    } else {
      g.fillStyle = color
      g.fillRect(0, 0, W, H)
    }
    for (const u of [0.25, 0.75]) {
      const cx = u * W
      const cy = H / 2
      g.fillStyle = ivory
      g.beginPath()
      g.arc(cx, cy, 30, 0, 2 * Math.PI)
      g.fill()
      g.fillStyle = "#111"
      g.font = `bold ${n >= 10 ? 30 : 36}px system-ui, sans-serif`
      g.textAlign = "center"
      g.textBaseline = "middle"
      g.save()
      g.translate(cx, cy)
      if (u > 0.5) g.rotate(Math.PI)
      g.fillText(id, 0, 1)
      if (n === 6 || n === 9) g.fillRect(-8, 15, 16, 3)
      g.restore()
    }
  }
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

export function createBall(id: string, R: number): THREE.Mesh {
  const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(id), roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 })
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), mat)
  mesh.castShadow = true
  mesh.name = id
  // Show a number toward the viewer at the start.
  mesh.quaternion.setFromEuler(new THREE.Euler(Math.PI / 2, 0, Math.random() * 2 * Math.PI))
  return mesh
}

const tmpAxis = new THREE.Vector3()
const tmpQ = new THREE.Quaternion()

/** Rotate a ball by angular velocity w (world frame, rad/s) over dt seconds. */
export function spin(mesh: THREE.Object3D, w: readonly number[], dt: number): void {
  const mag = Math.hypot(w[0]!, w[1]!, w[2]!)
  if (mag === 0 || dt === 0) return
  tmpAxis.set(w[0]! / mag, w[1]! / mag, w[2]! / mag)
  tmpQ.setFromAxisAngle(tmpAxis, mag * dt)
  mesh.quaternion.premultiply(tmpQ)
}
