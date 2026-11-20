/**
 * Physics debug view: replays pooltool fixture shots (or edited strikes)
 * through our engine and draws the table, ball paths, event markers and,
 * optionally, pooltool's own event positions for comparison.
 */
import {
  buildPocketTable,
  POOLTOOL_7FT,
  simulate,
  stateAtTime,
  trajectories,
  type BallParams,
  type BallState,
  type CueStrike,
  type Shot,
  type ShotResult,
  type Trajectories,
} from "@pixelpoolhall/physics"

// ---------------------------------------------------------------- fixtures

interface FixtureShot {
  name: string
  description: string
  balls: { id: string; params: BallParams; rvw: number[][]; s: number }[]
  cue: CueStrike & { ball: string }
  events: { type: string; time: number; ids: string[]; states: Record<string, { rvw: number[][]; s: number }> }[]
}
interface FixtureFile { category: string; shots: FixtureShot[] }

const fixtureModules = import.meta.glob<FixtureFile>("../../../physics/test/fixtures/pooltool/*.json", { import: "default" })
const fixtures: FixtureFile[] = await Promise.all(Object.values(fixtureModules).map((load) => load()))
fixtures.sort((a, b) => a.category.localeCompare(b.category))

const toState = (f: { rvw: number[][]; s: number }): BallState => ({
  r: [f.rvw[0]![0]!, f.rvw[0]![1]!, f.rvw[0]![2]!],
  v: [f.rvw[1]![0]!, f.rvw[1]![1]!, f.rvw[1]![2]!],
  w: [f.rvw[2]![0]!, f.rvw[2]![1]!, f.rvw[2]![2]!],
  s: f.s as BallState["s"],
})

// ---------------------------------------------------------------- state

const table = buildPocketTable(POOLTOOL_7FT)
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const canvas = $<HTMLCanvasElement>("table")
const ctx = canvas.getContext("2d")!
const ui = {
  category: $<HTMLSelectElement>("category"),
  shot: $<HTMLSelectElement>("shot"),
  strike: Object.fromEntries((["V0", "phi", "theta", "a", "b"] as const).map((k) => [k, $<HTMLInputElement>(k)])) as Record<keyof CueStrike, HTMLInputElement>,
  paths: $<HTMLInputElement>("paths"),
  markers: $<HTMLInputElement>("markers"),
  overlay: $<HTMLInputElement>("overlay"),
  time: $<HTMLInputElement>("time"),
  clock: $<HTMLOutputElement>("clock"),
  play: $<HTMLButtonElement>("play"),
  speed: $<HTMLSelectElement>("speed"),
  summary: $<HTMLParagraphElement>("summary"),
  events: $<HTMLOListElement>("events"),
}

let fixture: FixtureShot
let shot: Shot
let result: ShotResult
let traj!: Trajectories
let edited = false
let t = 0
let playing = false

// ---------------------------------------------------------------- simulation

function run() {
  const strike: CueStrike = {
    V0: +ui.strike.V0.value, phi: +ui.strike.phi.value, theta: +ui.strike.theta.value, a: +ui.strike.a.value, b: +ui.strike.b.value,
  }
  edited = (["V0", "phi", "theta", "a", "b"] as const).some((k) => strike[k] !== fixture.cue[k])
  shot = {
    table,
    balls: fixture.balls.map((b) => ({ id: b.id, params: b.params, state: toState(b) })),
    cueBall: fixture.cue.ball,
    strike,
  }
  const start = performance.now()
  result = simulate(shot)
  const ms = performance.now() - start
  traj = trajectories(shot, result)
  t = 0
  ui.summary.textContent = `${result.events.length - 2} events, ${traj.duration.toFixed(3)} s simulated in ${ms.toFixed(2)} ms` +
    (edited ? " · strike edited: pooltool overlay hidden" : ` · pooltool: ${fixture.events.length - 2} events`)
  ui.events.replaceChildren(
    ...result.events.filter((e) => e.type !== "none").map((e) => {
      const li = document.createElement("li")
      li.textContent = `${e.time.toFixed(4)}  ${e.type}  ${e.ids.filter((x) => x !== "cue_stick").join(" ")}`
      li.dataset.time = String(e.time)
      li.addEventListener("click", () => { t = e.time; playing = false; draw() })
      return li
    }),
  )
  draw()
}

function selectShot() {
  const file = fixtures.find((f) => f.category === ui.category.value)!
  fixture = file.shots.find((s) => s.name === ui.shot.value) ?? file.shots[0]!
  for (const k of ["V0", "phi", "theta", "a", "b"] as const) ui.strike[k].value = String(fixture.cue[k])
  ui.shot.title = fixture.description
  run()
}

function fillShots() {
  const file = fixtures.find((f) => f.category === ui.category.value)!
  ui.shot.replaceChildren(...file.shots.map((s) => new Option(s.name, s.name)))
  selectShot()
}

// ---------------------------------------------------------------- drawing

const BALL_COLORS: Record<string, string> = {
  cue: "#f8f8f2", "1": "#f2c400", "2": "#1f4fd1", "3": "#d62828", "4": "#6a1b9a", "5": "#f07c00", "6": "#1b7a3a", "7": "#7b2d12",
  "8": "#111111", "9": "#f2c400", "10": "#1f4fd1", "11": "#d62828", "12": "#6a1b9a", "13": "#f07c00", "14": "#1b7a3a", "15": "#7b2d12",
}
const EVENT_COLORS: Record<string, string> = {
  stick_ball: "#ffffff", ball_ball: "#ff4d4d", ball_linear_cushion: "#4da3ff", ball_circular_cushion: "#c77dff", ball_pocket: "#000000",
}
const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

/** Table frame (x across, y along) → canvas, drawn landscape with y to the right. */
function view() {
  const margin = 0.08
  const L = POOLTOOL_7FT.l
  const W = POOLTOOL_7FT.w
  const dpr = window.devicePixelRatio || 1
  const cw = canvas.clientWidth * dpr
  const ch = canvas.clientHeight * dpr
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  const k = Math.min(cw / (L + 2 * margin), ch / (W + 2 * margin))
  const ox = (cw - k * L) / 2
  const oy = (ch - k * W) / 2
  return { k, px: (x: number, y: number): [number, number] => [ox + y * k, oy + (W - x) * k] }
}

function draw() {
  const { k, px } = view()
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  // Felt: polygon through the rail segments is overkill; fill the playing surface plus pocket mouths.
  ctx.fillStyle = css("--felt")
  const [x0, y0] = px(POOLTOOL_7FT.w, 0)
  ctx.fillRect(x0, y0, POOLTOOL_7FT.l * k, POOLTOOL_7FT.w * k)
  for (const p of table.pockets) {
    const [x, y] = px(p.center[0], p.center[1])
    ctx.beginPath(); ctx.arc(x, y, p.radius * k, 0, 2 * Math.PI); ctx.fillStyle = "#050505"; ctx.fill()
  }
  ctx.strokeStyle = "#e9d8a6"; ctx.lineWidth = 2
  for (const c of table.linear) {
    ctx.beginPath(); ctx.moveTo(...px(c.p1[0], c.p1[1])); ctx.lineTo(...px(c.p2[0], c.p2[1])); ctx.stroke()
  }
  for (const c of table.circular) {
    const [x, y] = px(c.center[0], c.center[1])
    ctx.beginPath(); ctx.arc(x, y, c.radius * k, 0, 2 * Math.PI); ctx.stroke()
  }

  if (ui.paths.checked) {
    ctx.lineWidth = 1.5
    for (const b of traj.balls) {
      ctx.strokeStyle = (BALL_COLORS[b.id] ?? "#ccc") + "99"
      ctx.beginPath()
      const steps = Math.max(2, Math.ceil(traj.duration / 0.004))
      for (let i = 0; i <= steps; i++) {
        const s = stateAtTime(b, (traj.duration * i) / steps)
        if (s.r[2] < 0) break
        const [x, y] = px(s.r[0], s.r[1])
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
      }
      ctx.stroke()
    }
  }

  if (ui.markers.checked) {
    for (const e of result.events) {
      for (const st of Object.values(e.states)) {
        if (st.r[2] < 0) continue
        const [x, y] = px(st.r[0], st.r[1])
        ctx.beginPath()
        ctx.arc(x, y, EVENT_COLORS[e.type] ? 4 : 2, 0, 2 * Math.PI)
        ctx.fillStyle = EVENT_COLORS[e.type] ?? "#bbbbbb"
        ctx.fill()
      }
    }
  }

  if (ui.overlay.checked && !edited) {
    ctx.lineWidth = 1.5
    for (const e of fixture.events) {
      for (const st of Object.values(e.states)) {
        if (st.rvw[0]![2]! < 0 || !EVENT_COLORS[e.type]) continue
        const [x, y] = px(st.rvw[0]![0]!, st.rvw[0]![1]!)
        ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.strokeStyle = EVENT_COLORS[e.type]!; ctx.stroke()
      }
    }
  }

  for (const b of traj.balls) {
    const s = stateAtTime(b, t)
    if (s.r[2] < 0) continue
    const [x, y] = px(s.r[0], s.r[1])
    const r = b.params.R * k
    ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
    ctx.fillStyle = BALL_COLORS[b.id] ?? "#ccc"; ctx.fill()
    ctx.lineWidth = 1; ctx.strokeStyle = "#000000aa"; ctx.stroke()
    if (+b.id >= 9) { ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, 2 * Math.PI); ctx.fillStyle = "#f8f8f2"; ctx.fill() }
    if (b.id !== "cue") {
      ctx.fillStyle = "#111"; ctx.font = `${Math.max(8, r * 0.9)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle"
      ctx.fillText(b.id, x, y)
    }
  }

  ui.clock.value = `${t.toFixed(3)} s`
  ui.time.value = String(traj.duration > 0 ? Math.round((t / traj.duration) * 1000) : 0)
  for (const li of ui.events.children) (li as HTMLElement).classList.toggle("current", Math.abs(+(li as HTMLElement).dataset.time! - t) < 1e-9)
}

// ---------------------------------------------------------------- wiring

let last = 0
function tick(now: number) {
  if (playing) {
    t = Math.min(traj.duration, t + ((now - last) / 1000) * +ui.speed.value)
    if (t >= traj.duration) { playing = false; ui.play.textContent = "Play" }
    draw()
  }
  last = now
  requestAnimationFrame(tick)
}

// Deep link: #category/shot@time, e.g. #break/9ball-V7.0-x0.0@0.3
const [, hashCategory, hashShot, hashTime] = /^#([^/]+)\/([^@]+)(?:@([\d.]+))?$/.exec(decodeURIComponent(location.hash)) ?? []
const updateHash = () => history.replaceState(null, "", `#${ui.category.value}/${ui.shot.value}`)
ui.category.replaceChildren(...fixtures.map((f) => new Option(f.category, f.category)))
ui.category.value = fixtures.some((f) => f.category === hashCategory) ? hashCategory! : "cut"
ui.category.addEventListener("change", () => { fillShots(); updateHash() })
ui.shot.addEventListener("change", () => { selectShot(); updateHash() })
for (const input of Object.values(ui.strike)) input.addEventListener("change", run)
for (const c of [ui.paths, ui.markers, ui.overlay]) c.addEventListener("change", draw)
ui.time.addEventListener("input", () => { t = (+ui.time.value / 1000) * traj.duration; playing = false; ui.play.textContent = "Play"; draw() })
ui.play.addEventListener("click", () => {
  if (t >= traj.duration) t = 0
  playing = !playing
  ui.play.textContent = playing ? "Pause" : "Play"
})
window.addEventListener("resize", draw)
fillShots()
if (hashShot && fixtures.find((f) => f.category === ui.category.value)!.shots.some((x) => x.name === hashShot)) {
  ui.shot.value = hashShot
  selectShot()
  if (hashTime) { t = Math.min(traj.duration, +hashTime); draw() }
}
requestAnimationFrame(tick)
