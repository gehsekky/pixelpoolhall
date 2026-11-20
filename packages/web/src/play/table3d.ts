/**
 * 3D pool table built from the physics table geometry, so what you see is
 * what the balls collide with: cushion noses, pocket facings, jaws and
 * pocket openings all come from `Table`. Frame: physics coordinates, z up.
 */
import * as THREE from "three"
import type { Table, TableSpec } from "@pixelpoolhall/physics"

type V2 = THREE.Vector2

/** Pooltool rail ids of the six cushion runs between pockets (see table-builder.ts). */
const MAIN_RAILS = new Set(["3", "6", "9", "12", "15", "18"])

/** Width of the wooden rail outside the cushions, m (WPA allows 4–7½ in overall). */
const RAIL_WOOD = 0.1
/** Distance of the sights from the cushion nose (WPA spec §6: 3 11/16 in). */
const SIGHT_OFFSET = 0.0936625
/** Depth of the pocket liners below the cloth, m. */
const POCKET_DEPTH = 0.12

/** Height of the cushion and rail tops above the cloth. */
export const railTop = (spec: TableSpec): number => spec.cushionHeight + 0.006

function arc(center: V2, radius: number, a0: number, sweep: number, n: number): V2[] {
  const out: V2[] = []
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n
    out.push(new THREE.Vector2(center.x + radius * Math.cos(a), center.y + radius * Math.sin(a)))
  }
  return out
}

/** Short arc around `center` from p to q. */
function shortArc(center: V2, radius: number, p: V2, q: V2, n = 10): V2[] {
  const a0 = Math.atan2(p.y - center.y, p.x - center.x)
  const a1 = Math.atan2(q.y - center.y, q.x - center.x)
  let d = a1 - a0
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return arc(center, radius, a0, d, n)
}

/**
 * Outline of a rectangle combined with circles that cross its boundary:
 * "union" bulges out around each circle (the hole in the wooden rail),
 * "cut" bites each circle out (the cloth with pocket holes).
 */
function rectWithCircles(x0: number, y0: number, x1: number, y1: number, circles: { c: V2; r: number }[], mode: "union" | "cut"): V2[] {
  const P = (x: number, y: number) => new THREE.Vector2(x, y)
  // Start mid-way along the bottom edge, which no pocket touches; go counterclockwise.
  const verts = [P((x0 + x1) / 2, y0), P(x1, y0), P(x1, y1), P(x0, y1), P(x0, y0), P((x0 + x1) / 2, y0)]
  const s: number[] = [0]
  for (let i = 1; i < verts.length; i++) s.push(s[i - 1]! + verts[i]!.distanceTo(verts[i - 1]!))
  const at = (t: number): V2 => {
    let i = 0
    while (i < verts.length - 2 && s[i + 1]! < t) i++
    const f = (t - s[i]!) / (s[i + 1]! - s[i]!)
    return verts[i]!.clone().lerp(verts[i + 1]!, f)
  }
  const inside = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1

  // Perimeter interval covered by each circle.
  const spans: { a: number; b: number; c: V2; r: number }[] = []
  for (const { c, r } of circles) {
    const hits: number[] = []
    for (let i = 0; i < verts.length - 1; i++) {
      const p = verts[i]!
      const d = verts[i + 1]!.clone().sub(p)
      const len = d.length()
      d.divideScalar(len)
      const m = p.clone().sub(c)
      const B = m.dot(d)
      const disc = B * B - (m.lengthSq() - r * r)
      if (disc <= 0) continue
      for (const u of [-B - Math.sqrt(disc), -B + Math.sqrt(disc)]) if (u >= 0 && u <= len) hits.push(s[i]! + u)
    }
    if (hits.length !== 2) continue
    hits.sort((p, q) => p - q)
    spans.push({ a: hits[0]!, b: hits[1]!, c, r })
  }
  spans.sort((p, q) => p.a - q.a)

  const out: V2[] = []
  const covered = (t: number) => spans.some((sp) => t > sp.a && t < sp.b)
  const items = [...s.slice(0, -1).map((t, i) => ({ t, vert: i })), ...spans.map((sp) => ({ t: sp.a, span: sp }))].sort((p, q) => p.t - q.t)
  for (const it of items) {
    if ("vert" in it) {
      if (!covered(it.t)) out.push(verts[it.vert!]!.clone())
      continue
    }
    const { a, b, c, r } = it.span!
    const pa = at(a)
    const pb = at(b)
    const a0 = Math.atan2(pa.y - c.y, pa.x - c.x)
    const a1 = Math.atan2(pb.y - c.y, pb.x - c.x)
    const ccw = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    const mid = a0 + ccw / 2
    const midInside = inside(c.x + r * Math.cos(mid), c.y + r * Math.sin(mid))
    const sweep = midInside === (mode === "cut") ? ccw : ccw - 2 * Math.PI
    out.push(...arc(c, r, a0, sweep, 32))
  }
  return out
}

/** Cushion block for one main rail: nose, the two jaws, the two facings, back edge. */
function cushionOutline(table: Table, id: string): V2[] {
  const v = (p: readonly number[]) => new THREE.Vector2(p[0]!, p[1]!)
  const rail = table.linear.find((c) => c.id === id)!
  const facings = table.linear.filter((c) => !MAIN_RAILS.has(c.id))
  const end = (e: V2) => {
    const jaw = table.circular.reduce((best, j) =>
      Math.abs(v(j.center).distanceTo(e) - j.radius) < Math.abs(v(best.center).distanceTo(e) - best.radius) ? j : best,
    )
    const facing = facings.reduce((best, f) => (v(f.p2).distanceTo(e) < v(best.p2).distanceTo(e) ? f : best))
    return { jaw, facing }
  }
  const p1 = v(rail.p1)
  const p2 = v(rail.p2)
  const e1 = end(p1)
  const e2 = end(p2)
  return [
    v(e1.facing.p1),
    ...shortArc(v(e1.jaw.center), e1.jaw.radius, v(e1.facing.p2), p1),
    ...shortArc(v(e2.jaw.center), e2.jaw.radius, p2, v(e2.facing.p2)),
    v(e2.facing.p1),
  ]
}

export interface TableMeshes {
  group: THREE.Group
  /** The cloth (for pointer picking). */
  cloth: THREE.Mesh
}

export function buildTable(table: Table, spec: TableSpec): TableMeshes {
  const { w, l } = spec
  const cw = spec.cushionWidth
  const top = railTop(spec)
  const group = new THREE.Group()

  const clothMat = new THREE.MeshStandardMaterial({ color: 0x1d5e86, roughness: 0.92, metalness: 0 })
  const cushionMat = new THREE.MeshStandardMaterial({ color: 0x18557a, roughness: 0.88 })
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a2f1a, roughness: 0.45, metalness: 0.05 })
  const darkWoodMat = new THREE.MeshStandardMaterial({ color: 0x2e170c, roughness: 0.6 })
  const pocketMat = new THREE.MeshBasicMaterial({ color: 0x030303, side: THREE.BackSide })
  const sightMat = new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.3 })

  const circles = table.pockets.map((p) => ({ c: new THREE.Vector2(p.center[0], p.center[1]), r: p.radius }))

  // Cloth, with the pocket openings cut out, out to the back of the cushions.
  const clothShape = new THREE.Shape(rectWithCircles(-cw, -cw, w + cw, l + cw, circles, "cut"))
  const cloth = new THREE.Mesh(new THREE.ShapeGeometry(clothShape, 24), clothMat)
  cloth.receiveShadow = true
  group.add(cloth)

  // Cushions.
  for (const id of MAIN_RAILS) {
    const shape = new THREE.Shape(cushionOutline(table, id))
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: top, bevelEnabled: false, curveSegments: 4 }), cushionMat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // Wooden rails, with the pocket openings.
  const o = cw + RAIL_WOOD
  const railShape = new THREE.Shape([
    new THREE.Vector2(-o, -o),
    new THREE.Vector2(w + o, -o),
    new THREE.Vector2(w + o, l + o),
    new THREE.Vector2(-o, l + o),
  ])
  railShape.holes.push(new THREE.Path(rectWithCircles(-cw, -cw, w + cw, l + cw, circles, "union")))
  const railDepth = top + 0.13
  const rails = new THREE.Mesh(
    new THREE.ExtrudeGeometry(railShape, { depth: railDepth, bevelEnabled: false, curveSegments: 4 }),
    woodMat,
  )
  rails.position.z = top - railDepth
  rails.castShadow = true
  rails.receiveShadow = true
  group.add(rails)

  // Pocket liners.
  for (const p of table.pockets) {
    const h = top + POCKET_DEPTH
    const liner = new THREE.Mesh(new THREE.CylinderGeometry(p.radius - 0.001, p.radius * 0.92, h, 48, 1, true), pocketMat)
    liner.rotation.x = Math.PI / 2
    liner.position.set(p.center[0], p.center[1], top - h / 2)
    group.add(liner)
    const bottom = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 40), new THREE.MeshBasicMaterial({ color: 0x030303 }))
    bottom.position.set(p.center[0], p.center[1], -POCKET_DEPTH)
    group.add(bottom)
  }

  // Sights: 18 diamonds at quarter widths and eighth lengths (WPA 2.1 and spec §6).
  const sightGeo = new THREE.CircleGeometry(0.0065, 4)
  const sight = (x: number, y: number) => {
    const m = new THREE.Mesh(sightGeo, sightMat)
    m.position.set(x, y, top + 0.0005)
    group.add(m)
  }
  for (const k of [1, 2, 3, 5, 6, 7]) {
    sight(-SIGHT_OFFSET, (k * l) / 8)
    sight(w + SIGHT_OFFSET, (k * l) / 8)
  }
  for (const k of [1, 2, 3]) {
    sight((k * w) / 4, -SIGHT_OFFSET)
    sight((k * w) / 4, l + SIGHT_OFFSET)
  }

  // Body and legs.
  const bodyH = 0.16
  const body = new THREE.Mesh(new THREE.BoxGeometry(w + 2 * o - 0.04, l + 2 * o - 0.04, bodyH), darkWoodMat)
  body.position.set(w / 2, l / 2, -0.13 - bodyH / 2)
  group.add(body)
  const legH = 0.76 - 0.13 - bodyH
  for (const [x, y] of [
    [0.1, 0.15],
    [w - 0.1, 0.15],
    [0.1, l - 0.15],
    [w - 0.1, l - 0.15],
    [0.1, l / 2],
    [w - 0.1, l / 2],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, legH), darkWoodMat)
    leg.position.set(x, y, -0.13 - bodyH - legH / 2)
    group.add(leg)
  }

  return { group, cloth }
}
