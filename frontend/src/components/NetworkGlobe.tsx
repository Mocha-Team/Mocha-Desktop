import { useEffect, useRef, useState } from "react";
import { buildLandMask, isLand } from "./globe-land";

type V3 = [number, number, number];

const LAND_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";
const DOT_COUNT = 11000;
const OCEAN_COUNT = 2200;
const ARC_SEG = 56;
const TWO_PI = Math.PI * 2;

const NODE_RGB: [number, number, number] = [150, 214, 154];
const EDGE_RGB: [number, number, number] = [232, 201, 138];

interface DemoMarker {
  vec: V3;
  name: string;
  country: string;
  online: boolean;
  share: number;
}

interface DemoArc {
  a: V3;
  b: V3;
  w: number;
  lift: number;
}

function latLonToVec(lat: number, lon: number): V3 {
  const la = (lat * Math.PI) / 180;
  const lo = (lon * Math.PI) / 180;
  return [Math.cos(la) * Math.sin(lo), Math.sin(la), Math.cos(la) * Math.cos(lo)];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function dot3(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function arcColor(t: number, alpha: number): string {
  const r = Math.round(NODE_RGB[0] + (EDGE_RGB[0] - NODE_RGB[0]) * t);
  const g = Math.round(NODE_RGB[1] + (EDGE_RGB[1] - NODE_RGB[1]) * t);
  const b = Math.round(NODE_RGB[2] + (EDGE_RGB[2] - NODE_RGB[2]) * t);
  return `rgba(${r},${g},${b},${alpha.toFixed(3)})`;
}

const NODES: Array<{ lat: number; lon: number; name: string; country: string; share: number }> = [
  { lat: 40, lon: -74, name: "US East", country: "United States", share: 1 },
  { lat: 51, lon: 0, name: "London", country: "United Kingdom", share: 0.8 },
  { lat: 36, lon: 139, name: "Tokyo", country: "Japan", share: 0.7 },
  { lat: 1, lon: 104, name: "Singapore", country: "Singapore", share: 0.65 },
  { lat: 50, lon: 8, name: "Frankfurt", country: "Germany", share: 0.6 },
  { lat: 19, lon: 72, name: "Mumbai", country: "India", share: 0.55 },
  { lat: -23, lon: -46, name: "Sao Paulo", country: "Brazil", share: 0.5 },
  { lat: -33, lon: 151, name: "Sydney", country: "Australia", share: 0.45 },
];

const MARKERS: DemoMarker[] = NODES.map((n) => ({
  vec: latLonToVec(n.lat, n.lon),
  name: n.name,
  country: n.country,
  online: true,
  share: n.share,
}));

const LINKS: Array<[number, number, number]> = [
  [0, 1, 0.9],
  [0, 2, 0.75],
  [1, 3, 0.65],
  [4, 0, 0.55],
  [7, 0, 0.5],
  [5, 1, 0.7],
  [6, 4, 0.45],
];

function buildDemoArcs(): DemoArc[] {
  const arcs: DemoArc[] = [];
  for (const [ia, ib, w] of LINKS) {
    const a = MARKERS[ia].vec;
    const b = MARKERS[ib].vec;
    const omega = Math.acos(Math.min(1, Math.max(-1, dot3(a, b))));
    if (omega < 0.04) continue;
    arcs.push({ a, b, w, lift: 0.14 + (omega / Math.PI) * 0.46 });
  }
  return arcs;
}

const ARCS: DemoArc[] = buildDemoArcs();

export function WelcomeGlobe({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ name: string; country: string; online: boolean } | null>(null);
  const maskRef = useRef<Uint8Array | null>(null);
  const maskVersionRef = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(LAND_URL, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("land fetch failed"))))
      .then((topo) => {
        maskRef.current = buildLandMask(topo);
        maskVersionRef.current += 1;
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const arcs = ARCS;
    const markers = MARKERS;

    let dotX = new Float32Array(0);
    let dotY = new Float32Array(0);
    let dotZ = new Float32Array(0);
    let dotLand = new Uint8Array(0);
    let dotsBuiltFor = -1;

    const DOT_LEVELS = 6;
    const BUCKETS = DOT_LEVELS * 2;
    const bucketLen = new Int32Array(BUCKETS);
    let bucketXY: Float32Array[] = [];

    const buildDots = () => {
      const mask = maskRef.current;
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      const kinds: number[] = [];
      const golden = Math.PI * (3 - Math.sqrt(5));
      const push = (x: number, y: number, z: number, land: boolean) => {
        xs.push(x);
        ys.push(y);
        zs.push(z);
        kinds.push(land ? 1 : 0);
      };
      const sow = (count: number, wantLand: boolean) => {
        for (let i = 0; i < count; i++) {
          const y = 1 - (i / (count - 1)) * 2;
          const r = Math.sqrt(Math.max(0, 1 - y * y));
          const th = golden * i;
          const x = Math.cos(th) * r;
          const z = Math.sin(th) * r;
          if (!mask) {
            if (wantLand) push(x, y, z, true);
            continue;
          }
          const land = isLand(mask, (Math.asin(y) * 180) / Math.PI, (Math.atan2(x, z) * 180) / Math.PI);
          if (land !== wantLand) continue;
          push(x, y, z, wantLand);
        }
      };
      sow(DOT_COUNT, true);
      sow(OCEAN_COUNT, false);
      dotX = Float32Array.from(xs);
      dotY = Float32Array.from(ys);
      dotZ = Float32Array.from(zs);
      dotLand = Uint8Array.from(kinds);
      bucketXY = Array.from({ length: BUCKETS }, () => new Float32Array(Math.max(2, dotX.length) * 2));
      dotsBuiltFor = maskVersionRef.current;
    };
    buildDots();

    let rot = 0.6;
    let tilt = 0.3;
    let targetTilt = 0.3;
    let vel = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let visible = true;
    let raf = 0;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let R = 0;
    let cx = 0;
    let cy = 0;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0) return;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cx = w / 2;
      cy = h / 2;
      R = Math.min(w, h) * 0.37;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    io.observe(canvas);

    let cr = 1;
    let sr = 0;
    let ct = 1;
    let st = 0;
    let px = 0;
    let py = 0;
    let pd = 0;
    let pz = 0;

    const project = (vx: number, vy: number, vz: number) => {
      const x1 = vx * cr + vz * sr;
      const z1 = vz * cr - vx * sr;
      const y2 = vy * ct - z1 * st;
      pz = vy * st + z1 * ct;
      pd = Math.sqrt(x1 * x1 + y2 * y2);
      px = cx + x1 * R;
      py = cy - y2 * R;
    };

    let hoverIdx = -1;

    const placeTip = (idx: number) => {
      const tip = tipRef.current;
      if (!tip || idx < 0) return;
      const m = markers[idx];
      if (!m) return;
      project(m.vec[0], m.vec[1], m.vec[2]);
      if (clamp01(pz / 0.14) <= 0.01) {
        tip.style.opacity = "0";
        return;
      }
      tip.style.opacity = "1";
      tip.style.transform = `translate(-50%, calc(-100% - 14px)) translate(${px.toFixed(1)}px, ${py.toFixed(1)}px)`;
    };

    const setHoverIdx = (idx: number) => {
      if (idx === hoverIdx) return;
      hoverIdx = idx;
      const m = idx >= 0 ? markers[idx] : undefined;
      setHover(m ? { name: m.name, country: m.country, online: m.online } : null);
      canvas.style.cursor = idx >= 0 ? "pointer" : "";
      if (idx < 0 && tipRef.current) tipRef.current.style.opacity = "0";
    };

    const pickMarker = (mx: number, my: number) => {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        project(m.vec[0], m.vec[1], m.vec[2]);
        if (clamp01(pz / 0.14) <= 0.01) continue;
        const r = 2.2 + 2.6 * Math.sqrt(Math.max(0, m.share)) + 9;
        const dx = mx - px;
        const dy = my - py;
        const d = dx * dx + dy * dy;
        if (d <= r * r && d < bestD) {
          best = i;
          bestD = d;
        }
      }
      return best;
    };

    const hoverFromEvent = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const idx = pickMarker(e.clientX - rect.left, e.clientY - rect.top);
      setHoverIdx(idx);
      if (idx >= 0) placeTip(idx);
    };

    const onDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      vel = 0;
      setHoverIdx(-1);
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) {
        if (e.pointerType !== "touch") hoverFromEvent(e);
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      rot += dx * 0.005;
      targetTilt = Math.min(0.85, Math.max(-0.45, targetTilt + dy * 0.003));
      if (reduced) tilt = targetTilt;
      vel = dx * 0.28;
    };
    const onUp = () => {
      dragging = false;
    };
    const onLeave = () => {
      setHoverIdx(-1);
    };

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("pointerleave", onLeave);

    const slerpInto = (a: V3, b: V3, t: number, omega: number, so: number, out: V3) => {
      const k0 = Math.sin((1 - t) * omega) / so;
      const k1 = Math.sin(t * omega) / so;
      out[0] = k0 * a[0] + k1 * b[0];
      out[1] = k0 * a[1] + k1 * b[1];
      out[2] = k0 * a[2] + k1 * b[2];
    };

    const sx = new Float32Array(ARC_SEG + 1);
    const sy = new Float32Array(ARC_SEG + 1);
    const sa = new Float32Array(ARC_SEG + 1);
    const tmp: V3 = [0, 0, 0];

    const drawDots = () => {
      bucketLen.fill(0);
      for (let i = 0; i < dotX.length; i++) {
        project(dotX[i], dotY[i], dotZ[i]);
        if (pz <= 0.01) continue;
        const level = pz >= 1 ? DOT_LEVELS - 1 : (pz * DOT_LEVELS) | 0;
        const b = dotLand[i] * DOT_LEVELS + level;
        const buf = bucketXY[b];
        const n = bucketLen[b];
        buf[n] = px;
        buf[n + 1] = py;
        bucketLen[b] = n + 2;
      }
      for (let b = 0; b < BUCKETS; b++) {
        const n = bucketLen[b];
        if (n === 0) continue;
        const land = b >= DOT_LEVELS;
        const mid = ((b % DOT_LEVELS) + 0.5) / DOT_LEVELS;
        const size = land ? 1.15 + mid * 0.95 : 0.9 + mid * 0.5;
        const half = size / 2;
        const buf = bucketXY[b];
        ctx.beginPath();
        for (let i = 0; i < n; i += 2) ctx.rect(buf[i] - half, buf[i + 1] - half, size, size);
        const alpha = land ? 0.14 + mid * 0.66 : 0.045 + mid * 0.115;
        ctx.fillStyle = land ? `rgba(224,196,134,${alpha.toFixed(3)})` : `rgba(201,168,108,${alpha.toFixed(3)})`;
        ctx.fill();
      }
    };

    const strokeRun = (from: number, to: number, width: number, weight: number) => {
      const ax = sx[from];
      const ay = sy[from];
      const bx = sx[to];
      const by = sy[to];
      if (Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01) return;
      const t0 = from / ARC_SEG;
      const t1 = to / ARC_SEG;
      const grad = ctx.createLinearGradient(ax, ay, bx, by);
      grad.addColorStop(0, arcColor(t0, (from === 0 ? sa[from] : 0) * weight));
      grad.addColorStop(0.5, arcColor((t0 + t1) / 2, sa[(from + to) >> 1] * weight));
      grad.addColorStop(1, arcColor(t1, (to === ARC_SEG ? sa[to] : 0) * weight));
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      for (let i = from + 1; i <= to; i++) ctx.lineTo(sx[i], sy[i]);
      ctx.strokeStyle = grad;
      ctx.lineWidth = width;
      ctx.stroke();
    };

    const drawCometHead = (x: number, y: number, alpha: number) => {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 9);
      glow.addColorStop(0, `rgba(255,236,196,${(0.9 * alpha).toFixed(3)})`);
      glow.addColorStop(0.35, `rgba(232,201,138,${(0.45 * alpha).toFixed(3)})`);
      glow.addColorStop(1, "rgba(232,201,138,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = `rgba(255,246,226,${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, TWO_PI);
      ctx.fill();
    };

    const drawCometTail = (x: number, y: number, alpha: number) => {
      ctx.fillStyle = `rgba(250,226,180,${(alpha * 0.7).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.1, 0, TWO_PI);
      ctx.fill();
    };

    const drawArcs = (time: number) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let k = 0; k < arcs.length; k++) {
        const arc = arcs[k];
        const omega = Math.acos(Math.min(1, Math.max(-1, dot3(arc.a, arc.b))));
        const so = Math.sin(omega);
        if (so < 1e-5) continue;
        for (let i = 0; i <= ARC_SEG; i++) {
          const t = i / ARC_SEG;
          slerpInto(arc.a, arc.b, t, omega, so, tmp);
          const lift = 1 + Math.sin(Math.PI * t) * arc.lift;
          project(tmp[0] * lift, tmp[1] * lift, tmp[2] * lift);
          sx[i] = px;
          sy[i] = py;
          sa[i] = pd >= 1 ? 1 : clamp01((pz + 0.04) / 0.14);
        }
        const width = 0.75 + 1.5 * arc.w;
        const weight = 0.4 + 0.6 * arc.w;
        let start = -1;
        for (let i = 0; i <= ARC_SEG; i++) {
          const on = sa[i] > 0.02;
          if (on && start < 0) start = i;
          if ((!on || i === ARC_SEG) && start >= 0) {
            const end = on ? i : i - 1;
            if (end > start) strokeRun(start, end, width, weight);
            start = -1;
          }
        }
        const pulses = arc.w > 0.55 ? 2 : 1;
        for (let p = 0; p < pulses; p++) {
          const head = (time * (0.16 + 0.22 * arc.w) + k * 0.41 + p * 0.5) % 1;
          for (let tail = 0; tail < 4; tail++) {
            const t = head - tail * 0.022;
            if (t <= 0 || t >= 1) continue;
            const idx = Math.round(t * ARC_SEG);
            const vis = sa[idx];
            if (vis <= 0.04) continue;
            const fade = vis * (1 - tail / 4) * (0.45 + 0.55 * arc.w);
            if (tail === 0) drawCometHead(sx[idx], sy[idx], fade);
            else drawCometTail(sx[idx], sy[idx], fade);
          }
        }
      }
    };

    const drawMarkers = (time: number) => {
      for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        project(m.vec[0], m.vec[1], m.vec[2]);
        const fade = clamp01(pz / 0.14);
        if (fade <= 0.01) continue;
        const r = 2.2 + 2.6 * Math.sqrt(Math.max(0, m.share));
        const x = px;
        const y = py;
        const pulse = (time * 0.42 + i * 0.17) % 1;
        ctx.beginPath();
        ctx.arc(x, y, r + 1.5 + pulse * 11, 0, TWO_PI);
        ctx.strokeStyle = `rgba(150,214,154,${(0.34 * (1 - pulse) * fade).toFixed(3)})`;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 3.4);
        glow.addColorStop(0, `rgba(150,214,154,${(0.5 * fade).toFixed(3)})`);
        glow.addColorStop(1, "rgba(150,214,154,0)");
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, r * 3.4, 0, TWO_PI);
        ctx.fill();
        ctx.fillStyle = hoverIdx === i ? `rgba(210,245,210,${fade.toFixed(3)})` : `rgba(190,240,190,${fade.toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(x, y, hoverIdx === i ? r + 0.8 : r, 0, TWO_PI);
        ctx.fill();
      }
    };

    const draw = (time: number) => {
      if (dotsBuiltFor !== maskVersionRef.current) buildDots();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      cr = Math.cos(rot);
      sr = Math.sin(rot);
      ct = Math.cos(tilt);
      st = Math.sin(tilt);
      const body = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.36, R * 0.05, cx, cy, R);
      body.addColorStop(0, "rgba(201,168,108,0.055)");
      body.addColorStop(0.65, "rgba(201,168,108,0.014)");
      body.addColorStop(1, "rgba(201,168,108,0)");
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TWO_PI);
      ctx.fill();
      drawDots();
      const shade = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.3, R * 0.45, cx, cy, R);
      shade.addColorStop(0, "rgba(0,0,0,0)");
      shade.addColorStop(0.82, "rgba(8,6,4,0.34)");
      shade.addColorStop(1, "rgba(8,6,4,0.62)");
      ctx.fillStyle = shade;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TWO_PI);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TWO_PI);
      ctx.strokeStyle = "rgba(216,186,124,0.26)";
      ctx.lineWidth = 1;
      ctx.stroke();
      drawArcs(time);
      drawMarkers(time);
    };

    let sim = 0;
    let last = performance.now();
    const step = (now: number) => {
      if (reduced) {
        draw(0.35);
        raf = requestAnimationFrame(step);
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      sim += dt;
      tilt += (targetTilt - tilt) * Math.min(1, dt * 6);
      if (!dragging) {
        rot += (0.085 + vel) * dt;
        vel *= Math.pow(0.02, dt);
      }
      if (visible && !document.hidden) draw(sim);
      if (hoverIdx >= 0 && !dragging) {
        const m = markers[hoverIdx];
        if (!m) setHoverIdx(-1);
        else {
          project(m.vec[0], m.vec[1], m.vec[2]);
          if (clamp01(pz / 0.14) <= 0.01) setHoverIdx(-1);
          else placeTip(hoverIdx);
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <div className={`relative aspect-square w-full cursor-grab active:cursor-grabbing ${className}`}>
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        aria-label="Rotating globe showing Mocha storage node locations"
        role="img"
      />
      <div
        ref={tipRef}
        className="pointer-events-none absolute left-0 top-0 z-10 opacity-0 transition-opacity duration-150"
      >
        {hover && (
          <div
            className="flex items-center gap-2 whitespace-nowrap rounded-xl px-3 py-1.5 text-[11px] font-medium backdrop-blur"
            style={{
              background: "var(--surface-elevated)",
              color: "var(--text-secondary)",
              boxShadow: "0 0 0 1px var(--border-visible)",
            }}
          >
            <span
              className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: hover.online ? "var(--success)" : "var(--text-dim)" }}
            />
            <span className="font-semibold" style={{ color: "var(--text-primary)" }}>{hover.name}</span>
            <span style={{ color: "var(--text-muted)" }}>{hover.country}</span>
          </div>
        )}
      </div>
    </div>
  );
}
