/**
 * SVG geometry → the path operators a PDF understands (move, line, cubic,
 * close). Used to draw the diagram as vectors: edge paths come straight from
 * React Flow, icons from the glyph SVGs on the canvas.
 *
 *   parseSvgPath('M0,0 C10,0 10,10 20,10')  // [{ op: 'M', … }, { op: 'C', … }]
 */

export type PathSeg =
  | { op: 'M'; x: number; y: number }
  | { op: 'L'; x: number; y: number }
  | { op: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { op: 'Z' };

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const COMMAND = /[MmLlHhVvCcSsQqTtAaZz]/;

/** segments of an elliptical arc (SVG endpoint form), as cubic béziers */
function arcToCubics(
  x0: number,
  y0: number,
  rxIn: number,
  ryIn: number,
  angle: number,
  large: boolean,
  sweep: boolean,
  x: number,
  y: number,
): PathSeg[] {
  if (x0 === x && y0 === y) return [];
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) return [{ op: 'L', x, y }];
  const phi = (angle * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  // SVG spec F.6.5: endpoint → center parameterization
  const dx = (x0 - x) / 2;
  const dy = (y0 - y) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x0 + x) / 2;
  const cy = sin * cxp + cos * cyp + (y0 + y) / 2;
  const angleOf = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dt = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;

  const parts = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9));
  const step = dt / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (t: number) => {
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    return { x: cx + cos * ex - sin * ey, y: cy + sin * ex + cos * ey };
  };
  const tangent = (t: number) => {
    const ex = -rx * Math.sin(t);
    const ey = ry * Math.cos(t);
    return { x: cos * ex - sin * ey, y: sin * ex + cos * ey };
  };
  const out: PathSeg[] = [];
  let t = t1;
  for (let i = 0; i < parts; i++) {
    const a = point(t);
    const ta = tangent(t);
    const b = i === parts - 1 ? { x, y } : point(t + step);
    const tb = tangent(t + step);
    out.push({
      op: 'C',
      x1: a.x + k * ta.x,
      y1: a.y + k * ta.y,
      x2: b.x - k * tb.x,
      y2: b.y - k * tb.y,
      x: b.x,
      y: b.y,
    });
    t += step;
  }
  return out;
}

/** Parse SVG path data. Malformed input stops the parse; what was read so far is kept. */
export function parseSvgPath(d: string): PathSeg[] {
  const out: PathSeg[] = [];
  let i = 0;
  const skip = () => {
    while (i < d.length && (d[i] === ',' || d[i] === ' ' || d[i] === '\n' || d[i] === '\t' || d[i] === '\r')) i++;
  };
  const num = (): number | undefined => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) return undefined;
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean | undefined => {
    skip();
    const c = d[i];
    if (c !== '0' && c !== '1') return undefined;
    i++;
    return c === '1';
  };
  const hasNumber = () => {
    skip();
    return i < d.length && !COMMAND.test(d[i]);
  };

  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  // reflection points for S / T
  let lastCubic: { x: number; y: number } | null = null;
  let lastQuad: { x: number; y: number } | null = null;

  while (true) {
    skip();
    if (i >= d.length) break;
    const cmd = d[i];
    if (!COMMAND.test(cmd)) break;
    i++;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') {
      out.push({ op: 'Z' });
      cx = sx;
      cy = sy;
      lastCubic = lastQuad = null;
      continue;
    }
    let first = true;
    do {
      const ox = rel ? cx : 0;
      const oy = rel ? cy : 0;
      let ok = true;
      switch (C) {
        case 'M':
        case 'L': {
          const x = num();
          const y = num();
          if (x === undefined || y === undefined) {
            ok = false;
            break;
          }
          cx = ox + x;
          cy = oy + y;
          if (C === 'M' && first) {
            out.push({ op: 'M', x: cx, y: cy });
            sx = cx;
            sy = cy;
          } else {
            out.push({ op: 'L', x: cx, y: cy });
          }
          lastCubic = lastQuad = null;
          break;
        }
        case 'H':
        case 'V': {
          const v = num();
          if (v === undefined) {
            ok = false;
            break;
          }
          if (C === 'H') cx = (rel ? cx : 0) + v;
          else cy = (rel ? cy : 0) + v;
          out.push({ op: 'L', x: cx, y: cy });
          lastCubic = lastQuad = null;
          break;
        }
        case 'C':
        case 'S': {
          let x1: number | undefined;
          let y1: number | undefined;
          if (C === 'C') {
            x1 = num();
            y1 = num();
            if (x1 !== undefined && y1 !== undefined) {
              x1 += ox;
              y1 += oy;
            }
          } else {
            x1 = lastCubic ? 2 * cx - lastCubic.x : cx;
            y1 = lastCubic ? 2 * cy - lastCubic.y : cy;
          }
          const x2 = num();
          const y2 = num();
          const x = num();
          const y = num();
          if ([x1, y1, x2, y2, x, y].some((v) => v === undefined)) {
            ok = false;
            break;
          }
          const seg = { op: 'C' as const, x1: x1!, y1: y1!, x2: ox + x2!, y2: oy + y2!, x: ox + x!, y: oy + y! };
          out.push(seg);
          lastCubic = { x: seg.x2, y: seg.y2 };
          lastQuad = null;
          cx = seg.x;
          cy = seg.y;
          break;
        }
        case 'Q':
        case 'T': {
          let qx: number | undefined;
          let qy: number | undefined;
          if (C === 'Q') {
            qx = num();
            qy = num();
            if (qx !== undefined && qy !== undefined) {
              qx += ox;
              qy += oy;
            }
          } else {
            qx = lastQuad ? 2 * cx - lastQuad.x : cx;
            qy = lastQuad ? 2 * cy - lastQuad.y : cy;
          }
          const x = num();
          const y = num();
          if ([qx, qy, x, y].some((v) => v === undefined)) {
            ok = false;
            break;
          }
          const ex = ox + x!;
          const ey = oy + y!;
          // quadratic → cubic: control points 2/3 of the way to the quad control
          out.push({
            op: 'C',
            x1: cx + ((qx! - cx) * 2) / 3,
            y1: cy + ((qy! - cy) * 2) / 3,
            x2: ex + ((qx! - ex) * 2) / 3,
            y2: ey + ((qy! - ey) * 2) / 3,
            x: ex,
            y: ey,
          });
          lastQuad = { x: qx!, y: qy! };
          lastCubic = null;
          cx = ex;
          cy = ey;
          break;
        }
        case 'A': {
          const rx = num();
          const ry = num();
          const rot = num();
          const large = flag();
          const sweep = flag();
          const x = num();
          const y = num();
          if ([rx, ry, rot, large, sweep, x, y].some((v) => v === undefined)) {
            ok = false;
            break;
          }
          const ex = ox + x!;
          const ey = oy + y!;
          out.push(...arcToCubics(cx, cy, rx!, ry!, rot!, large!, sweep!, ex, ey));
          cx = ex;
          cy = ey;
          lastCubic = lastQuad = null;
          break;
        }
      }
      if (!ok) return out;
      first = false;
    } while (hasNumber());
  }
  return out;
}

const n = (v: string | null | undefined, fallback = 0) => {
  const x = v === null || v === undefined ? NaN : parseFloat(v);
  return Number.isFinite(x) ? x : fallback;
};

/**
 * Path data for a basic SVG shape element (`circle`, `rect`, `line`, …) given
 * its attributes; undefined for anything that draws no outline.
 */
export function shapePathData(tag: string, attr: (name: string) => string | null): string | undefined {
  switch (tag) {
    case 'path':
      return attr('d') ?? undefined;
    case 'circle':
    case 'ellipse': {
      const cx = n(attr('cx'));
      const cy = n(attr('cy'));
      const rx = tag === 'circle' ? n(attr('r')) : n(attr('rx'));
      const ry = tag === 'circle' ? rx : n(attr('ry'));
      if (rx <= 0 || ry <= 0) return undefined;
      return `M${cx - rx},${cy} A${rx},${ry} 0 1 0 ${cx + rx},${cy} A${rx},${ry} 0 1 0 ${cx - rx},${cy} Z`;
    }
    case 'rect': {
      const x = n(attr('x'));
      const y = n(attr('y'));
      const w = n(attr('width'));
      const h = n(attr('height'));
      if (w <= 0 || h <= 0) return undefined;
      let rx = attr('rx') === null ? n(attr('ry')) : n(attr('rx'));
      let ry = attr('ry') === null ? rx : n(attr('ry'));
      rx = Math.min(rx, w / 2);
      ry = Math.min(ry, h / 2);
      if (rx <= 0 || ry <= 0) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
      return [
        `M${x + rx},${y}`,
        `H${x + w - rx}`,
        `A${rx},${ry} 0 0 1 ${x + w},${y + ry}`,
        `V${y + h - ry}`,
        `A${rx},${ry} 0 0 1 ${x + w - rx},${y + h}`,
        `H${x + rx}`,
        `A${rx},${ry} 0 0 1 ${x},${y + h - ry}`,
        `V${y + ry}`,
        `A${rx},${ry} 0 0 1 ${x + rx},${y}`,
        'Z',
      ].join(' ');
    }
    case 'line':
      return `M${n(attr('x1'))},${n(attr('y1'))} L${n(attr('x2'))},${n(attr('y2'))}`;
    case 'polyline':
    case 'polygon': {
      const pts = (attr('points') ?? '').trim().split(/[\s,]+/).map(Number);
      if (pts.length < 4 || pts.some((p) => !Number.isFinite(p))) return undefined;
      const pairs: string[] = [];
      for (let k = 0; k + 1 < pts.length; k += 2) pairs.push(`${k === 0 ? 'M' : 'L'}${pts[k]},${pts[k + 1]}`);
      return pairs.join(' ') + (tag === 'polygon' ? ' Z' : '');
    }
    default:
      return undefined;
  }
}

/** the point at `t` (0–1) along the last cubic of a path — edge label anchors */
export function pointOnPath(segs: PathSeg[], t: number): { x: number; y: number } | undefined {
  let start: { x: number; y: number } | undefined;
  let last: { from: { x: number; y: number }; seg: Extract<PathSeg, { op: 'C' }> } | undefined;
  let lineEnd: { from: { x: number; y: number }; to: { x: number; y: number } } | undefined;
  let cur: { x: number; y: number } | undefined;
  for (const s of segs) {
    if (s.op === 'M') {
      start = cur = { x: s.x, y: s.y };
    } else if (s.op === 'L' && cur) {
      lineEnd = { from: cur, to: { x: s.x, y: s.y } };
      last = undefined;
      cur = { x: s.x, y: s.y };
    } else if (s.op === 'C' && cur) {
      last = { from: cur, seg: s };
      lineEnd = undefined;
      cur = { x: s.x, y: s.y };
    } else if (s.op === 'Z' && start) {
      cur = start;
    }
  }
  if (last) {
    const { from: p0, seg } = last;
    const u = 1 - t;
    return {
      x: u * u * u * p0.x + 3 * u * u * t * seg.x1 + 3 * u * t * t * seg.x2 + t * t * t * seg.x,
      y: u * u * u * p0.y + 3 * u * u * t * seg.y1 + 3 * u * t * t * seg.y2 + t * t * t * seg.y,
    };
  }
  if (lineEnd) return { x: lineEnd.from.x + (lineEnd.to.x - lineEnd.from.x) * t, y: lineEnd.from.y + (lineEnd.to.y - lineEnd.from.y) * t };
  return cur;
}

/** end point of a path and the direction it arrives from (unit vector), for arrowheads */
export function pathEnd(segs: PathSeg[]): { x: number; y: number; dx: number; dy: number } | undefined {
  let prev: { x: number; y: number } | undefined;
  let cur: { x: number; y: number } | undefined;
  let dir: { x: number; y: number } | undefined;
  for (const s of segs) {
    if (s.op === 'M') {
      cur = { x: s.x, y: s.y };
    } else if (s.op === 'L' || s.op === 'C') {
      prev = cur;
      // tangent at the end: from the last control point that differs from the end
      const from = s.op === 'C' ? [{ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }, prev].find((p) => p && (p.x !== s.x || p.y !== s.y)) : prev;
      if (from) dir = { x: s.x - from.x, y: s.y - from.y };
      cur = { x: s.x, y: s.y };
    }
  }
  if (!cur || !dir) return undefined;
  const len = Math.hypot(dir.x, dir.y) || 1;
  return { x: cur.x, y: cur.y, dx: dir.x / len, dy: dir.y / len };
}
