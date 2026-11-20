/**
 * Minimal 3D game view: the table, the balls and a floating cue.
 *
 * Controls:
 * - Move the mouse over the table to aim. A short click locks or unlocks the aim.
 * - Press the left button and drag toward you to draw the cue back. Release to shoot.
 *   Right-click or Esc while drawing cancels.
 * - Right-drag orbits the camera, the wheel zooms, and middle-drag pans.
 * - When the cue ball is in hand, drag it to place it.
 * - Keys:
 *   - ←/→ fine aim (Shift ×10);
 *   - W/A/S/D cue-tip offset;
 *   - R/F elevation;
 *   - 1/2/3 camera views;
 *   - G toggles the aim guide;
 *   - Space skips the replay.
 */
import {
  AI_LEVELS,
  chooseOption,
  createRng,
  CUE,
  executionNoise,
  FOUL_TEXT,
  Game,
  legalTargets,
  planShot,
  type AiPlan,
  type Call,
  type Discipline,
  type Option,
  type Player,
  type ShotRecord,
} from "@pixelpoolhall/game"
import type { CueStrike } from "@pixelpoolhall/physics"
import { stateAtTime } from "@pixelpoolhall/physics"
import * as THREE from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js"
import { createBall, spin } from "./balls3d.ts"
import { POCKET_NAMES, pocketToward } from "./calls.ts"
import { createCue, poseCue } from "./cue3d.ts"
import { buildTable } from "./table3d.ts"

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

// ---------- Scene ----------

const canvas = $<HTMLCanvasElement>("view")
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFShadowMap
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x14171c)

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 50)
camera.up.set(0, 0, 1)
const controls = new OrbitControls(camera, canvas)
controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE }
controls.enableDamping = true
controls.maxPolarAngle = Math.PI / 2 - 0.05
controls.minDistance = 0.3
controls.maxDistance = 8

scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x20160f, 0.3))
// Soft room reflections and fill light (the background stays plain).
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55

// ---------- Game state ----------

let game: Game
let tableGroup: THREE.Group | null = null
const balls = new Map<string, THREE.Mesh>()
const cue = createCue()
scene.add(cue)

/** Aim and stroke settings (CueStrike units). */
const aim = { phi: 90, theta: 0, a: 0, b: 0 }
let aimLocked = false
let showGuide = true

/** The current call (8-ball). Auto calls follow the aim guide until the player picks one. */
let call: Call | null = null
let callManual = false

/** Whether the next shot needs a call (8-ball after the break, WPA 4.6). */
const needsCall = () => {
  const s = game.state
  return game.discipline === "8-ball" && !s.isBreak && s.rules.callShots && s.winner === null && !s.pending
}
const legalNow = () => legalTargets(game.state, game.state.shooter, game.objectBalls())

function setCall(c: Call | null, manual: boolean): void {
  const same = JSON.stringify(c) === JSON.stringify(call) && manual === callManual
  call = c
  callManual = manual
  if (!same) updateHud()
}

/** A short click on a ball or a pocket picks the call. Returns false if the click hit neither. */
function pickCall(e: PointerEvent): boolean {
  if (!needsCall()) return false
  pointerTo(e)
  const objects = [...balls].filter(([id, m]) => id !== CUE && m.visible).map(([, m]) => m)
  const hitBall = raycaster.intersectObjects(objects)[0]
  if (hitBall) {
    const id = hitBall.object.name
    if (!legalNow().has(id)) {
      lastNotes = [`The ${id} isn't a legal ball to call.`]
      updateHud()
      return true
    }
    const pocket = call && call !== "safety" ? call.pocket : ""
    setCall({ ball: id, pocket }, true)
    return true
  }
  const p = onBallPlane(e)
  if (!p) return false
  const pocket = game.table.pockets.find((pk) => Math.hypot(p.x - pk.center[0], p.y - pk.center[1]) < pk.radius + 0.04)
  if (!pocket) return false
  const ball = call && call !== "safety" ? call.ball : ""
  setCall({ ball, pocket: pocket.id }, true)
  return true
}

const callComplete = () => call === "safety" || (call !== null && call.ball !== "" && call.pocket !== "")

type Mode =
  | { kind: "aim" }
  | { kind: "draw"; startY: number; startX: number; pull: number }
  | { kind: "stroke"; pull: number; V0: number; t: number; dur: number }
  | { kind: "place"; last: [number, number] }
  | { kind: "replay"; record: ShotRecord; t: number }
  /** The computer's turn: thinking, then swinging the cue onto its line, then drawing back. */
  | { kind: "ai"; phase: "think" | "aim" | "draw"; t: number; plan?: AiPlan; strike?: CueStrike; fromPhi?: number; pull?: number }
let mode: Mode = { kind: "aim" }

// ---------- Computer opponent ----------

/** The computer plays as player 2. */
const AI_PLAYER: Player = 1
type Opponent = "human" | keyof typeof AI_LEVELS
let opponent: Opponent = "medium"
let aiRng = createRng(1)
let aiDeciding = false

/** Whoever must act now: the chooser of a pending decision, else the shooter. */
const actor = (): Player => game.state.pending?.player ?? game.state.shooter
const aiActs = () => opponent !== "human" && game.state.winner === null && actor() === AI_PLAYER
const humanTurn = () => !aiActs()
const playerName = (i: Player) => (opponent === "human" ? `Player ${i + 1}` : i === AI_PLAYER ? `Computer (${AI_LEVELS[opponent].name})` : "You")

/** Cue draw-back that `speedFor` maps to V0. */
const pullFor = (V0: number) => MAX_PULL * Math.sqrt(Math.min(1, Math.max(0, (V0 - 0.15) / (MAX_SPEED - 0.15))))

function startAiTurn(): void {
  if (game.state.pending) {
    if (aiDeciding) return
    aiDeciding = true
    setTimeout(() => {
      aiDeciding = false
      if (!aiActs() || !game.state.pending || opponent === "human") return
      const o = chooseOption(game, AI_LEVELS[opponent], aiRng)
      const r = game.decide(o)
      lastNotes = [`${playerName(AI_PLAYER)} chose: ${OPTION_TEXT[o]}.`, ...r.notes]
      syncBalls()
      updateHud()
    }, 900)
    return
  }
  mode = { kind: "ai", phase: "think", t: 0 }
  updateHud()
  // Let the HUD paint "thinking" before the (blocking) search.
  setTimeout(() => {
    if (mode.kind !== "ai" || opponent === "human") return
    const level = AI_LEVELS[opponent]
    const plan = planShot(game, level, aiRng)
    if (plan.placement) {
      game.placeCueBall(plan.placement)
      syncBalls()
    }
    const strike = executionNoise(plan.strike, level, aiRng)
    aim.theta = strike.theta
    elevation.value = String(aim.theta)
    setTip(strike.a, strike.b)
    call = plan.call
    callManual = true
    mode = { kind: "ai", phase: "aim", t: 0, plan, strike, fromPhi: aim.phi, pull: 0 }
    updateHud()
  }, 60)
}

function advanceAi(m: Extract<Mode, { kind: "ai" }>, dt: number): void {
  if (m.phase === "think" || !m.strike) return
  m.t += dt
  if (m.phase === "aim") {
    const AIM_TIME = 0.9
    const d = ((((m.strike.phi - m.fromPhi!) % 360) + 540) % 360) - 180
    const f = Math.min(1, m.t / AIM_TIME)
    aim.phi = m.fromPhi! + d * (f * f * (3 - 2 * f))
    if (f >= 1) {
      aim.phi = m.strike.phi
      m.phase = "draw"
      m.t = 0
    }
  } else {
    const DRAW_TIME = 0.6
    const target = pullFor(m.strike.V0)
    m.pull = target * Math.min(1, m.t / DRAW_TIME)
    updatePower()
    if (m.t >= DRAW_TIME + 0.25) {
      const V0 = m.strike.V0
      mode = { kind: "stroke", pull: target, V0, t: 0, dur: Math.min(0.15, Math.max(0.04, (target + IDLE_GAP) / (V0 * 0.6))) }
    }
  }
}

const MAX_PULL = 0.3
const MAX_SPEED = 9
const IDLE_GAP = 0.012
const speedFor = (pull: number) => 0.15 + (MAX_SPEED - 0.15) * (pull / MAX_PULL) ** 2

function newGame(discipline: Discipline): void {
  const seed = (Math.random() * 2 ** 32) >>> 0
  game = new Game({ discipline, seed })
  aiRng = createRng(seed ^ 0x5bd1e995)
  opponent = $<HTMLSelectElement>("opponent").value as Opponent
  if (tableGroup) scene.remove(tableGroup)
  const t = buildTable(game.table, game.spec)
  tableGroup = t.group
  scene.add(tableGroup)
  setupLights()
  for (const m of balls.values()) scene.remove(m)
  balls.clear()
  const ids = [CUE, ...Array.from({ length: discipline === "8-ball" ? 15 : 9 }, (_, i) => String(i + 1))]
  for (const id of ids) {
    const m = createBall(id, game.params.R)
    balls.set(id, m)
    scene.add(m)
  }
  syncBalls()
  aim.phi = 90
  mode = { kind: "aim" }
  aimLocked = false
  lastNotes = ["Break: cue ball in hand above the head string."]
  setView(1)
  updateHud()
}

function syncBalls(): void {
  for (const [id, m] of balls) {
    const s = game.balls.get(id)
    m.visible = !!s
    if (s) m.position.set(s.r[0], s.r[1], s.r[2])
  }
}

// ---------- Lights ----------

let lights: THREE.Object3D[] = []
function setupLights(): void {
  for (const l of lights) scene.remove(l)
  const { w, l } = game.spec
  // Three lamps over the table, like a tournament light.
  lights = [0.25, 0.5, 0.75].map((f) => {
    const s = new THREE.SpotLight(0xfff4e0, 3.2, 4, Math.PI / 3.2, 0.7, 1.2)
    s.position.set(w / 2, l * f, 1.1)
    s.target.position.set(w / 2, l * f, 0)
    s.castShadow = true
    s.shadow.mapSize.set(1024, 1024)
    s.shadow.bias = -0.0004
    scene.add(s.target)
    return s
  })
  for (const s of lights) scene.add(s)
}

// ---------- Camera ----------

function setView(v: 1 | 2 | 3): void {
  const { w, l } = game.spec
  if (v === 1) {
    camera.position.set(w / 2, -1.5, 1.7)
    controls.target.set(w / 2, l * 0.45, 0)
  } else if (v === 2) {
    camera.position.set(w / 2 + 0.0001, l / 2, 3.4)
    controls.target.set(w / 2, l / 2, 0)
  } else {
    const c = game.balls.get(CUE)
    if (!c) return
    const ph = (aim.phi * Math.PI) / 180
    camera.position.set(c.r[0] - 0.9 * Math.cos(ph), c.r[1] - 0.9 * Math.sin(ph), 0.35)
    controls.target.set(c.r[0] + 0.3 * Math.cos(ph), c.r[1] + 0.3 * Math.sin(ph), 0)
  }
  controls.update()
}

function resize(): void {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
addEventListener("resize", resize)

// ---------- Pointer input ----------

const raycaster = new THREE.Raycaster()
const ndc = new THREE.Vector2()
function pointerTo(e: PointerEvent): void {
  const r = canvas.getBoundingClientRect()
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
  raycaster.setFromCamera(ndc, camera)
}
/** Where the pointer ray meets the plane of the ball centers. */
function onBallPlane(e: PointerEvent): THREE.Vector3 | null {
  pointerTo(e)
  const p = new THREE.Vector3()
  return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 0, 1), -game.params.R), p) ? p : null
}

let rightDown = false
canvas.addEventListener("pointerdown", (e) => {
  if (e.button === 2) {
    rightDown = true
    if (mode.kind === "draw") mode = { kind: "aim" }
    return
  }
  if (e.button !== 0 || mode.kind !== "aim" || game.state.winner !== null || game.state.pending || !humanTurn()) return
  // Ball in hand: grab the cue ball.
  if (game.state.cueBallInHand !== "none") {
    pointerTo(e)
    const cueMesh = balls.get(CUE)!
    if (raycaster.intersectObject(cueMesh).length > 0) {
      const s = game.balls.get(CUE)!
      mode = { kind: "place", last: [s.r[0], s.r[1]] }
      canvas.setPointerCapture(e.pointerId)
      return
    }
  }
  mode = { kind: "draw", startX: e.clientX, startY: e.clientY, pull: 0 }
  canvas.setPointerCapture(e.pointerId)
})

canvas.addEventListener("pointermove", (e) => {
  if (rightDown) return
  if (mode.kind === "aim" && !aimLocked && humanTurn()) {
    const p = onBallPlane(e)
    const c = game.balls.get(CUE)
    if (p && c && Math.hypot(p.x - c.r[0], p.y - c.r[1]) > 2 * game.params.R) {
      aim.phi = (Math.atan2(p.y - c.r[1], p.x - c.r[0]) * 180) / Math.PI
    }
  } else if (mode.kind === "draw") {
    mode.pull = Math.min(MAX_PULL, Math.max(0, (e.clientY - mode.startY) * 0.0012))
    updatePower()
  } else if (mode.kind === "place") {
    const p = onBallPlane(e)
    if (!p) return
    const R = game.params.R
    const m = balls.get(CUE)!
    m.position.set(p.x, p.y, R)
    const ok = !game.placementProblem([p.x, p.y])
    ;(m.material as THREE.MeshPhysicalMaterial).emissive.set(ok ? 0x000000 : 0x661111)
    if (ok) mode.last = [p.x, p.y]
  }
})

canvas.addEventListener("pointerup", (e) => {
  if (e.button === 2) {
    rightDown = false
    return
  }
  if (e.button !== 0) return
  if (mode.kind === "draw") {
    const moved = Math.hypot(e.clientX - mode.startX, e.clientY - mode.startY)
    if (mode.pull > 0.01 && needsCall() && !callComplete()) {
      lastNotes = ["Call a ball and a pocket first (click them), or call Safety (WPA 4.6)."]
      mode = { kind: "aim" }
    } else if (mode.pull > 0.01) {
      const V0 = speedFor(mode.pull)
      mode = { kind: "stroke", pull: mode.pull, V0, t: 0, dur: Math.min(0.15, Math.max(0.04, (mode.pull + IDLE_GAP) / (V0 * 0.6))) }
      aimLocked = false
    } else {
      if (moved < 4 && !pickCall(e)) aimLocked = !aimLocked
      mode = { kind: "aim" }
    }
    updatePower()
    updateHud()
  } else if (mode.kind === "place") {
    const m = balls.get(CUE)!
    ;(m.material as THREE.MeshPhysicalMaterial).emissive.set(0x000000)
    game.placeCueBall(mode.last)
    syncBalls()
    mode = { kind: "aim" }
    updateHud()
  }
})
canvas.addEventListener("contextmenu", (e) => e.preventDefault())

// ---------- Keyboard ----------

addEventListener("keydown", (e) => {
  if ((e.target as HTMLElement).tagName === "SELECT" || (e.target as HTMLElement).tagName === "INPUT") return
  if (!humanTurn() && e.key !== " " && !"123gG".includes(e.key)) return
  const step = e.shiftKey ? 1 : 0.1
  const tip = 0.05
  switch (e.key) {
    case "ArrowLeft":
      aim.phi += step
      break
    case "ArrowRight":
      aim.phi -= step
      break
    case "w":
    case "W":
      setTip(aim.a, aim.b + tip)
      break
    case "s":
    case "S":
      setTip(aim.a, aim.b - tip)
      break
    case "a":
    case "A":
      setTip(aim.a + tip, aim.b)
      break
    case "d":
    case "D":
      setTip(aim.a - tip, aim.b)
      break
    case "r":
    case "R":
      setElevation(aim.theta + 1)
      break
    case "f":
    case "F":
      setElevation(aim.theta - 1)
      break
    case "1":
    case "2":
    case "3":
      setView(Number(e.key) as 1 | 2 | 3)
      break
    case "g":
    case "G":
      showGuide = !showGuide
      break
    case "Escape":
      if (mode.kind === "draw") mode = { kind: "aim" }
      updatePower()
      break
    case " ":
      if (mode.kind === "replay") mode.t = Infinity
      e.preventDefault()
      break
    default:
      return
  }
  updateHud()
})

// ---------- Spin widget and elevation ----------

/** Largest tip offset (fraction of R) before a miscue becomes likely. */
const MAX_TIP = 0.5
const spinCanvas = $<HTMLCanvasElement>("spin")
function setTip(a: number, b: number): void {
  const r = Math.hypot(a, b)
  const k = r > MAX_TIP ? MAX_TIP / r : 1
  aim.a = a * k
  aim.b = b * k
  drawSpin()
}
function drawSpin(): void {
  const g = spinCanvas.getContext("2d")!
  const s = spinCanvas.width
  const c = s / 2
  const rad = s / 2 - 4
  g.clearRect(0, 0, s, s)
  g.fillStyle = "#f4f1e8"
  g.beginPath()
  g.arc(c, c, rad, 0, 2 * Math.PI)
  g.fill()
  g.strokeStyle = "rgba(0,0,0,0.25)"
  g.beginPath()
  g.arc(c, c, rad * MAX_TIP, 0, 2 * Math.PI)
  g.moveTo(c - rad, c)
  g.lineTo(c + rad, c)
  g.moveTo(c, c - rad)
  g.lineTo(c, c + rad)
  g.stroke()
  // a > 0 is left english: draw it on the left as seen from behind the cue.
  g.fillStyle = "#c62828"
  g.beginPath()
  g.arc(c - aim.a * rad, c - aim.b * rad, 6, 0, 2 * Math.PI)
  g.fill()
}
function spinFromPointer(e: PointerEvent): void {
  const r = spinCanvas.getBoundingClientRect()
  const x = ((e.clientX - r.left) / r.width) * 2 - 1
  const y = ((e.clientY - r.top) / r.height) * 2 - 1
  setTip(-x, -y)
  updateHud()
}
spinCanvas.addEventListener("pointerdown", (e) => {
  spinCanvas.setPointerCapture(e.pointerId)
  spinFromPointer(e)
})
spinCanvas.addEventListener("pointermove", (e) => {
  if (spinCanvas.hasPointerCapture(e.pointerId)) spinFromPointer(e)
})
spinCanvas.addEventListener("dblclick", () => setTip(0, 0))

const elevation = $<HTMLInputElement>("elevation")
function setElevation(t: number): void {
  aim.theta = Math.min(Number(elevation.max), Math.max(0, t))
  elevation.value = String(aim.theta)
}
elevation.addEventListener("input", () => {
  aim.theta = Number(elevation.value)
  updateHud()
})

// ---------- HUD ----------

let lastNotes: string[] = []
const status = $("status")
const notes = $("notes")
const decisions = $("decisions")
const pushOut = $<HTMLInputElement>("pushout")
const pushOutLabel = $("pushout-label")
const powerBar = $("power-bar")
const strikeText = $("strike")
const callButtons = $("call")
$<HTMLButtonElement>("call-safety").onclick = () => setCall("safety", true)
$<HTMLButtonElement>("call-clear").onclick = () => setCall(null, false)

const OPTION_TEXT: Record<Option, string> = {
  accept_table: "Accept the table",
  cue_ball_in_kitchen: "Ball in hand (kitchen)",
  rerack_and_break: "Re-rack and break",
  rerack_opponent_breaks: "Re-rack, opponent breaks",
  spot_eight: "Spot the 8",
  shoot: "Shoot",
  pass: "Pass it back",
}

function updatePower(): void {
  const pull = mode.kind === "draw" || mode.kind === "stroke" ? mode.pull : mode.kind === "ai" ? (mode.pull ?? 0) : 0
  powerBar.style.width = `${(100 * pull) / MAX_PULL}%`
  strikeText.textContent =
    `${pull > 0 ? speedFor(pull).toFixed(2) : "—"} m/s · ` +
    `elev ${aim.theta.toFixed(0)}° · tip ${(aim.a * 100).toFixed(0)}/${(aim.b * 100).toFixed(0)} % R`
}

function updateHud(): void {
  const s = game.state
  const p = (i: number) => playerName(i as Player)
  const parts: string[] = [`${game.discipline} · ${p(0)} ${game.score[0]} – ${game.score[1]} ${p(1)}`]
  if (s.winner !== null) parts.push(`${p(s.winner)} wins the rack.`)
  else if (s.pending) parts.push(`${p(s.pending.player)} to choose.`)
  else if (mode.kind === "ai" && mode.phase === "think") parts.push(`${p(s.shooter)} is thinking…`)
  else {
    let line = `${p(s.shooter)} to shoot`
    if (s.isBreak) line += " — break"
    const drag = humanTurn() ? " (drag the cue ball)" : ""
    if (s.cueBallInHand === "kitchen") line += ` · ball in hand above the head string${drag}`
    if (s.cueBallInHand === "table") line += ` · ball in hand${drag}`
    parts.push(line)
    if (game.discipline === "8-ball") {
      parts.push(s.groups ? `${p(0)}: ${s.groups[0]} · ${p(1)}: ${s.groups[1]}` : "Open table")
    } else {
      const lowest = [...game.objectBalls()].sort((x, y) => +x - +y)[0]
      if (lowest) parts.push(`Lowest ball: ${lowest}`)
    }
    if (needsCall()) {
      const text =
        call === "safety"
          ? "Safety"
          : call && (call.ball || call.pocket)
            ? `${call.ball ? `${call.ball}-ball` : "(click a ball)"} → ${call.pocket ? POCKET_NAMES[call.pocket] : "(click a pocket)"}`
            : "none — aim at a ball, or click a ball and a pocket"
      parts.push(`Call: ${text}${call && !callManual ? " (auto)" : ""}`)
    }
    if (aimLocked) parts.push("Aim locked (click to unlock)")
  }
  status.innerHTML = parts.map((x) => `<div>${x}</div>`).join("")
  notes.innerHTML = lastNotes.map((n) => `<li>${n}</li>`).join("")

  decisions.innerHTML = ""
  if (s.pending && mode.kind !== "replay" && humanTurn()) {
    for (const o of s.pending.options) {
      const b = document.createElement("button")
      b.textContent = OPTION_TEXT[o]
      b.onclick = () => {
        const r = game.decide(o)
        lastNotes = r.notes
        syncBalls()
        updateHud()
      }
      decisions.append(b)
    }
  } else if (s.winner !== null && mode.kind !== "replay") {
    const b = document.createElement("button")
    b.textContent = "Next rack"
    b.onclick = () => {
      game.nextRack()
      lastNotes = ["New rack."]
      syncBalls()
      updateHud()
    }
    decisions.append(b)
  }
  callButtons.hidden = !needsCall() || mode.kind === "replay" || !humanTurn()
  pushOutLabel.hidden = !(s.pushOutAvailable && !s.pending && s.winner === null && humanTurn())
  if (pushOutLabel.hidden) pushOut.checked = false
  updatePower()
}

$<HTMLButtonElement>("new").onclick = () => newGame($<HTMLSelectElement>("discipline").value as Discipline)

// ---------- Aim guide ----------

const guideMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
const guideLine = new THREE.Line(new THREE.BufferGeometry(), guideMat)
const objLine = new THREE.Line(new THREE.BufferGeometry(), guideMat)
const ghost = new THREE.Mesh(
  new THREE.RingGeometry(0.0272, 0.0286, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
)
scene.add(guideLine, objLine, ghost)

const callBallMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.034, 0.039, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd54a, side: THREE.DoubleSide }),
)
const callPocketMarker = new THREE.Mesh(
  new THREE.RingGeometry(0.05, 0.058, 48),
  new THREE.MeshBasicMaterial({ color: 0xffd54a, side: THREE.DoubleSide }),
)
scene.add(callBallMarker, callPocketMarker)

function updateCallMarkers(): void {
  const show = needsCall() && call !== null && call !== "safety" && mode.kind !== "replay"
  const ball = show && call !== "safety" && call?.ball ? game.balls.get(call.ball) : undefined
  callBallMarker.visible = !!ball
  if (ball) callBallMarker.position.set(ball.r[0], ball.r[1], 0.002)
  const pocketId = show && call !== null && call !== "safety" ? call.pocket : ""
  const pocket = pocketId ? game.table.pockets.find((p) => p.id === pocketId) : undefined
  callPocketMarker.visible = !!pocket
  if (pocket) callPocketMarker.position.set(pocket.center[0], pocket.center[1], 0.004)
}

function updateGuide(): void {
  const c = game.balls.get(CUE)
  const visible = showGuide && !!c && (mode.kind === "aim" || mode.kind === "draw") && game.state.winner === null && humanTurn()
  guideLine.visible = objLine.visible = ghost.visible = visible
  if (!visible || !c) return
  const R = game.params.R
  const { w, l } = game.spec
  const ph = (aim.phi * Math.PI) / 180
  const dx = Math.cos(ph)
  const dy = Math.sin(ph)
  let best = Infinity
  let hit: string | null = null
  for (const [id, s] of game.balls) {
    if (id === CUE) continue
    const mx = c.r[0] - s.r[0]
    const my = c.r[1] - s.r[1]
    const B = mx * dx + my * dy
    const disc = B * B - (mx * mx + my * my - 4 * R * R)
    if (disc < 0) continue
    const t = -B - Math.sqrt(disc)
    if (t > 0 && t < best) {
      best = t
      hit = id
    }
  }
  // Cushion (ignoring the pocket openings).
  for (const t of [dx > 0 ? (w - R - c.r[0]) / dx : dx < 0 ? (R - c.r[0]) / dx : Infinity, dy > 0 ? (l - R - c.r[1]) / dy : dy < 0 ? (R - c.r[1]) / dy : Infinity]) {
    if (t > 0 && t < best) {
      best = t
      hit = null
    }
  }
  const z = 0.002
  const gx = c.r[0] + best * dx
  const gy = c.r[1] + best * dy
  guideLine.geometry.setFromPoints([new THREE.Vector3(c.r[0], c.r[1], z), new THREE.Vector3(gx, gy, z)])
  ghost.position.set(gx, gy, z)
  objLine.visible = hit !== null
  let auto: Call | null = null
  if (hit) {
    const o = game.balls.get(hit)!
    const ux = o.r[0] - gx
    const uy = o.r[1] - gy
    const n = Math.hypot(ux, uy)
    objLine.geometry.setFromPoints([new THREE.Vector3(o.r[0], o.r[1], z), new THREE.Vector3(o.r[0] + (0.35 * ux) / n, o.r[1] + (0.35 * uy) / n, z)])
    // The obvious call: the ball the guide hits, toward the pocket it heads for.
    if (legalNow().has(hit)) {
      const pocket = pocketToward(game.table, o.r[0], o.r[1], ux, uy)
      if (pocket) auto = { ball: hit, pocket }
    }
  }
  if (needsCall() && !callManual && mode.kind === "aim") setCall(auto, false)
}

// ---------- Frame loop ----------

let lastFrame = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000)
  lastFrame = now
  const R = game.params.R
  const cueBall = game.balls.get(CUE)

  if (mode.kind === "stroke") {
    mode.t += dt
    const f = Math.min(1, mode.t / mode.dur)
    if (cueBall) poseCue(cue, balls.get(CUE)!.position, R, aim.phi, aim.theta, aim.a, aim.b, (mode.pull + IDLE_GAP) * (1 - f))
    if (f >= 1) shoot(mode.V0)
  } else if (mode.kind === "replay") {
    advanceReplay(mode, dt)
  } else if (mode.kind === "ai") {
    advanceAi(mode, dt)
  } else if (mode.kind === "aim" && aiActs()) {
    startAiTurn()
  }

  cue.visible = mode.kind === "aim" || mode.kind === "draw" || mode.kind === "stroke" || (mode.kind === "ai" && mode.phase !== "think")
  if (cue.visible && cueBall && mode.kind !== "stroke") {
    const pull = mode.kind === "draw" ? mode.pull : mode.kind === "ai" ? (mode.pull ?? 0) : 0
    poseCue(cue, new THREE.Vector3(cueBall.r[0], cueBall.r[1], cueBall.r[2]), R, aim.phi, aim.theta, aim.a, aim.b, IDLE_GAP + pull)
  }
  if (game.state.pending || game.state.winner !== null) cue.visible = false
  updateGuide()
  updateCallMarkers()
  controls.update()
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}

function shoot(V0: number): void {
  const record = game.shoot({ V0, phi: aim.phi, theta: aim.theta, a: aim.a, b: aim.b }, { pushOut: pushOut.checked, call: needsCall() ? call : null })
  call = null
  callManual = false
  mode = { kind: "replay", record, t: 0 }
  pushOut.checked = false
  updateHud()
}

function advanceReplay(m: Extract<Mode, { kind: "replay" }>, dt: number): void {
  const prev = m.t
  m.t = Math.min(m.t + dt, m.record.trajectories.duration)
  const step = m.t - prev
  for (const b of m.record.trajectories.balls) {
    const mesh = balls.get(b.id)
    if (!mesh) continue
    const s = stateAtTime(b, m.t)
    mesh.visible = true
    mesh.position.set(s.r[0], s.r[1], s.r[2])
    if (step > 0) spin(mesh, s.w, step)
  }
  if (m.t >= m.record.trajectories.duration) {
    const r = m.record.ruling
    lastNotes = r.notes.length ? r.notes : r.fouls.map((f) => FOUL_TEXT[f])
    if (!lastNotes.length) lastNotes = ["No foul."]
    syncBalls()
    mode = { kind: "aim" }
    updateHud()
  }
}

// ---------- Start ----------

newGame("9-ball")
// Dev-only hook for scripted browser checks.
if (import.meta.env.DEV) Object.assign(globalThis, { __pp: { aim, get game() { return game }, get mode() { return mode.kind }, camera, controls } })
drawSpin()
resize()
requestAnimationFrame(frame)
