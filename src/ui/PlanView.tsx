import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useActivity } from '../activities/useActivity';
import { CHAIRS, catalogueEntry, itemBlocks, itemLabel } from '../model/catalogue';
import {
  add, clearOpening, dirOfHeading, dist, headingOf, itemCorners, itemToPlan, layoutBounds, mul, nearestWall, norm,
  projectOnSegment, rotate, solidWallRects, sub, uid, wallDir, wallLength, wallNormal, wallPoint,
} from '../model/geometry';
import { chairFootprint } from '../model/pathfinding';
import { useStore } from '../model/store';
import type { Item, Layout, LayoutKey, Opening, Vec2, Wall } from '../model/types';

type Drag =
  | { kind: 'item'; id: string; offset: Vec2 }
  | { kind: 'wall'; id: string; start: Vec2; orig: Wall[] }
  | { kind: 'opening'; id: string }
  | { kind: 'start' | 'end'; offset: Vec2 }
  | { kind: 'pan'; start: Vec2; vb: VB; client: Vec2 }
  | null;

interface VB { x: number; y: number; w: number; h: number }

const snap = (v: number, s = 10) => Math.round(v / s) * s;
const pts = (p: Vec2[]) => p.map((q) => `${q.x},${q.y}`).join(' ');

const fitView = (layout: Layout, aspect: number): VB => {
  const b = layoutBounds(layout);
  const minX = Math.min(b.minX, layout.start.x) - 500, maxX = Math.max(b.maxX, layout.start.x) + 500;
  const minY = Math.min(b.minY, layout.start.y) - 500, maxY = Math.max(b.maxY, layout.start.y) + 500;
  let w = maxX - minX, h = maxY - minY;
  if (w / h > aspect) h = w / aspect; else w = h * aspect;
  return { x: (minX + maxX) / 2 - w / 2, y: (minY + maxY) / 2 - h / 2, w, h };
};

/** cast a ray and return the distance to the first obstacle edge */
const rayCast = (o: Vec2, d: Vec2, polys: Vec2[][]) => {
  let best = Infinity;
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const e = sub(b, a);
    const den = d.x * e.y - d.y * e.x;
    if (Math.abs(den) < 1e-9) continue;
    const ao = sub(a, o);
    const t = (ao.x * e.y - ao.y * e.x) / den;
    const u = (ao.x * d.y - ao.y * d.x) / den;
    if (t > 0.5 && u >= 0 && u <= 1 && t < best) best = t;
  }
  return best;
};

const ItemSymbol = ({ it, fs }: { it: Item; fs: number }) => {
  const hw = it.w / 2, hd = it.d / 2;
  const k = it.kind;
  const detail: JSX.Element[] = [];
  if (k.startsWith('bed')) {
    const n = it.w > 1200 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const pw = Math.min(680, it.w / n - 80);
      const cx = n === 1 ? 0 : (i - 0.5) * (it.w / 2);
      detail.push(<rect key={`p${i}`} x={cx - pw / 2} y={-hd + 90} width={pw} height={380} rx={60} className="sym-soft" />);
    }
    detail.push(<line key="d" x1={-hw} y1={hd - it.d * 0.68} x2={hw} y2={hd - it.d * 0.68} className="sym-line" />);
  } else if (k === 'toilet') {
    detail.push(<rect key="c" x={-hw + 10} y={-hd} width={it.w - 20} height={180} rx={30} className="sym-soft" />);
    detail.push(<ellipse key="b" cx={0} cy={-hd + 440} rx={hw - 20} ry={250} className="sym-soft" />);
  } else if (k === 'basin' || k === 'vanity') {
    detail.push(<ellipse key="b" cx={0} cy={20} rx={hw - 60} ry={hd - 80} className="sym-soft" />);
  } else if (k === 'shower') {
    detail.push(<line key="a" x1={-hw} y1={-hd} x2={hw} y2={hd} className="sym-line" />, <line key="b" x1={hw} y1={-hd} x2={-hw} y2={hd} className="sym-line" />);
    detail.push(<circle key="c" cx={0} cy={0} r={60} className="sym-soft" />);
  } else if (k === 'turning-space') {
    return (
      <g>
        <circle r={it.w / 2} className="turning" />
        <text y={fs * 0.35} className="item-label" fontSize={fs}>⌀ {it.w}</text>
      </g>
    );
  } else if (k === 'grab-rail') {
    return <rect x={-hw} y={-hd} width={it.w} height={it.d} rx={it.d / 2} className="rail" />;
  } else if (k === 'wardrobe' || k === 'kitchen-bench' || k === 'drawers') {
    detail.push(<line key="f" x1={-hw} y1={hd - 40} x2={hw} y2={hd - 40} className="sym-line" />);
  }
  return (
    <g>
      <rect x={-hw} y={-hd} width={it.w} height={it.d} rx={Math.min(40, hw, hd)} className={`item kind-${k} ${itemBlocks(k) ? '' : 'nonblocking'}`} />
      {detail}
      {/* front edge indicator */}
      <line x1={-hw * 0.4} y1={hd} x2={hw * 0.4} y2={hd} className="front-mark" />
    </g>
  );
};

const LiveChair = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const built = useActivity(layoutKey);
  const time = useStore((s) => s.time);
  const chair = useStore((s) => s.project.activity.chair);
  const type = useStore((s) => s.project.activity.type);
  if (type === 'imported') return null;
  const C = CHAIRS[chair];
  const c = built.chair(time);
  const p = built.person(time);
  const fp = chairFootprint(c, C.width, C.length);
  const tip = add(c, rotate({ x: 0, y: C.length / 2 + 150 }, c.heading));
  const h = built.helper?.(time);
  return (
    <g pointerEvents="none">
      <polygon points={pts(fp)} className="live-chair" />
      <line x1={c.x} y1={c.y} x2={tip.x} y2={tip.y} className="live-arrow" />
      <circle cx={p.x} cy={p.y} r={170} className="live-person" />
      {h && <circle cx={h.x} cy={h.y} r={230} className="live-helper" />}
    </g>
  );
};

export const PlanView = ({ layoutKey }: { layoutKey: LayoutKey }) => {
  const layout = useStore((s) => s.project.layouts[layoutKey]);
  const selection = useStore((s) => s.selection);
  const tool = useStore((s) => s.tool);
  const settings = useStore((s) => s.project.activity);
  const notes = useStore((s) => s.project.notes);
  const set = useStore((s) => s.set);
  const updateLayout = useStore((s) => s.updateLayout);
  const checkpoint = useStore((s) => s.checkpoint);
  const built = useActivity(layoutKey);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vb, setVb] = useState<VB>({ x: -500, y: -500, w: 5000, h: 5000 });
  const [drag, setDrag] = useState<Drag>(null);
  const [draw, setDraw] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [calib, setCalib] = useState<Vec2[]>([]);
  const pointers = useRef(new Map<number, Vec2>());
  const pinch = useRef<{ d: number; vb: VB } | null>(null);

  const fit = useCallback(() => {
    const el = wrapRef.current;
    const aspect = el ? el.clientWidth / Math.max(1, el.clientHeight) : 1;
    setVb(fitView(layout, aspect));
  }, [layout]);
  // fit when the room structure changes size substantially
  const structKey = `${layout.walls.length}:${Math.round(layoutBounds({ ...layout, items: [] }).maxX / 500)}:${Math.round(layoutBounds({ ...layout, items: [] }).maxY / 500)}`;
  useEffect(() => { fit(); }, [structKey, layoutKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const toPlan = (e: { clientX: number; clientY: number }): Vec2 => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const r = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: r.x, y: r.y };
  };

  const fs = vb.w / 55; // label font size in mm

  // ----- pointer handlers
  const onWheel = (e: React.WheelEvent) => {
    const p = toPlan(e);
    const k = Math.exp(e.deltaY * 0.0012);
    setVb((v) => ({ x: p.x - (p.x - v.x) * k, y: p.y - (p.y - v.y) * k, w: v.w * k, h: v.h * k }));
  };

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation();
    if (tool !== 'select') return;
    svgRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (d && d.kind !== 'pan') checkpoint();
    setDrag(d);
  };

  const onBgDown = (e: React.PointerEvent) => {
    const p = toPlan(e);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    svgRef.current?.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: dist(a, b), vb };
      setDrag(null);
      return;
    }
    if (tool === 'draw-room') {
      const q = snapDraw(p);
      if (draw.length >= 3 && dist(q, draw[0]) < vb.w / 60) {
        finishDraw(draw);
      } else setDraw([...draw, q]);
      return;
    }
    if (tool === 'calibrate') {
      const next = [...calib, p];
      if (next.length === 2) {
        const measured = dist(next[0], next[1]);
        const ans = window.prompt(`You picked two points ${Math.round(measured)} mm apart (at the current scale).\nWhat is the real distance between them, in millimetres?`, String(Math.round(measured)));
        const real = ans ? parseFloat(ans) : NaN;
        if (real > 0 && layout.background) {
          const k = real / measured;
          updateLayout((l) => {
            if (!l.background) return;
            l.background.scale *= k;
            // keep the first picked point fixed
            l.background.x = next[0].x - (next[0].x - l.background.x) * k;
            l.background.y = next[0].y - (next[0].y - l.background.y) * k;
          });
        }
        setCalib([]);
        set({ tool: 'select' });
      } else setCalib(next);
      return;
    }
    if (tool === 'pin-note') {
      set({ pendingPin: { x: Math.round(p.x), y: Math.round(p.y) }, tool: 'select', panel: 'notes' });
      return;
    }
    set({ selection: null });
    setDrag({ kind: 'pan', start: p, vb, client: { x: e.clientX, y: e.clientY } });
  };

  const snapDraw = (p: Vec2) => {
    let q = { x: snap(p.x, 50), y: snap(p.y, 50) };
    const last = draw[draw.length - 1];
    if (last) {
      const d = sub(q, last);
      if (Math.abs(d.x) < Math.abs(d.y) * 0.18) q = { x: last.x, y: q.y };
      else if (Math.abs(d.y) < Math.abs(d.x) * 0.18) q = { x: q.x, y: last.y };
    }
    return q;
  };

  const finishDraw = (poly: Vec2[]) => {
    const walls: Wall[] = poly.map((a, i) => ({ id: uid('wall'), a, b: poly[(i + 1) % poly.length], thickness: 110 }));
    updateLayout((l) => {
      l.walls = walls;
      l.openings = [];
    });
    setDraw([]);
    set({ tool: 'select' });
  };

  const onMove = (e: React.PointerEvent) => {
    const p = toPlan(e);
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const k = pinch.current.d / Math.max(1, dist(a, b));
      const v0 = pinch.current.vb;
      const cx = v0.x + v0.w / 2, cy = v0.y + v0.h / 2;
      setVb({ x: cx - (v0.w * k) / 2, y: cy - (v0.h * k) / 2, w: v0.w * k, h: v0.h * k });
      return;
    }
    if (tool === 'draw-room') setCursor(snapDraw(p));
    else if (tool === 'calibrate') setCursor(p);
    if (!drag) return;
    if (drag.kind === 'pan') {
      const svg = svgRef.current!;
      const scale = drag.vb.w / svg.clientWidth;
      setVb({ ...drag.vb, x: drag.vb.x - (e.clientX - drag.client.x) * scale, y: drag.vb.y - (e.clientY - drag.client.y) * scale });
      return;
    }
    if (drag.kind === 'item') {
      updateLayout((l) => {
        const it = l.items.find((i) => i.id === drag.id);
        if (!it) return;
        it.x = snap(p.x - drag.offset.x);
        it.y = snap(p.y - drag.offset.y);
        // snap wall-mounted items against the nearest wall
        const cat = catalogueEntry(it.kind);
        if (cat?.wallMounted && !e.altKey) {
          const nw = nearestWall(l, { x: it.x, y: it.y });
          if (nw) {
            const gap = nw.distance - nw.wall.thickness / 2 - it.d / 2;
            if (Math.abs(gap) < 180) {
              let n = wallNormal(nw.wall);
              if ((it.x - nw.point.x) * n.x + (it.y - nw.point.y) * n.y < 0) n = mul(n, -1);
              it.rotation = Math.round(headingOf(n));
              const c = add(nw.point, mul(n, nw.wall.thickness / 2 + it.d / 2));
              it.x = Math.round(c.x); it.y = Math.round(c.y);
            }
          }
        }
      }, { commit: false, key: layoutKey });
    } else if (drag.kind === 'wall') {
      updateLayout((l) => {
        const orig = drag.orig.find((w) => w.id === drag.id)!;
        const n = wallNormal(orig);
        const delta = snap((p.x - drag.start.x) * n.x + (p.y - drag.start.y) * n.y);
        const mv = mul(n, delta);
        l.walls = drag.orig.map((w) => {
          const nw = { ...w, a: { ...w.a }, b: { ...w.b } };
          for (const end of ['a', 'b'] as const) {
            if (dist(w[end], orig.a) < 2 || dist(w[end], orig.b) < 2) nw[end] = add(w[end], mv);
          }
          return nw;
        });
      }, { commit: false, key: layoutKey });
    } else if (drag.kind === 'opening') {
      updateLayout((l) => {
        const o = l.openings.find((x) => x.id === drag.id);
        const w = o && l.walls.find((x) => x.id === o.wallId);
        if (!o || !w) return;
        const L = wallLength(w);
        const t = projectOnSegment(p, w.a, w.b).t * L;
        o.offset = snap(Math.max(o.width / 2 + 50, Math.min(L - o.width / 2 - 50, t)));
      }, { commit: false, key: layoutKey });
    } else if (drag.kind === 'start' || drag.kind === 'end') {
      updateLayout((l) => {
        const q = { x: snap(p.x - drag.offset.x), y: snap(p.y - drag.offset.y) };
        if (drag.kind === 'start') l.start = { ...l.start, ...q };
        else l.end = q;
      }, { commit: false, key: layoutKey });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    setDrag(null);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDraw([]); setCalib([]); set({ tool: 'select' }); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [set]);

  // ----- derived drawing data
  const wallRects = useMemo(() => solidWallRects(layout), [layout]);
  const selectedItem = selection?.type === 'item' ? layout.items.find((i) => i.id === selection.id) : undefined;
  const clearances = useMemo(() => {
    if (!selectedItem || selectedItem.kind === 'turning-space') return [];
    const polys = [...wallRects, ...layout.items.filter((i) => i.id !== selectedItem.id && itemBlocks(i.kind) && i.kind !== 'grab-rail').map(itemCorners)];
    const out: { a: Vec2; b: Vec2; d: number }[] = [];
    const hw = selectedItem.w / 2, hd = selectedItem.d / 2;
    for (const [lx, ly, dx, dy] of [[hw, 0, 1, 0], [-hw, 0, -1, 0], [0, hd, 0, 1], [0, -hd, 0, -1]]) {
      const a = itemToPlan(selectedItem, { x: lx, y: ly });
      const dir = rotate({ x: dx, y: dy }, selectedItem.rotation);
      const d = rayCast(a, dir, polys);
      if (d < 4000 && d > 5) out.push({ a, b: add(a, mul(dir, d)), d: Math.round(d) });
    }
    return out;
  }, [selectedItem, wallRects, layout.items]);

  const C = CHAIRS[settings.chair];
  const route = settings.type !== 'imported' ? built.route : undefined;
  const prints = useMemo(() => {
    if (!route || !settings.showSweptPath) return [];
    const out: Vec2[][] = [];
    let last = -1e9;
    for (const s of route.samples) {
      if (s.dist - last < 200) continue;
      last = s.dist;
      out.push(chairFootprint(s, C.width, C.length));
    }
    return out;
  }, [route, settings.showSweptPath, C.width, C.length]);

  const startTip = add(layout.start, mul(dirOfHeading(layout.start.heading), 450));
  const bg = layout.background;
  const layoutNotes = notes.filter((n) => n.layout === layoutKey && n.pin);

  const doorSymbol = (o: Opening, w: Wall) => {
    const d = wallDir(w);
    const n = mul(wallNormal(w), o.swingSide);
    const s = wallPoint(w, o.offset - o.width / 2);
    const e = wallPoint(w, o.offset + o.width / 2);
    const sel = selection?.type === 'opening' && selection.id === o.id;
    const common = { onPointerDown: (ev: React.PointerEvent) => { set({ selection: { type: 'opening', id: o.id } }); startDrag(ev, { kind: 'opening', id: o.id }); } };
    const thick = w.thickness;
    const gap = [add(s, mul(wallNormal(w), thick / 2)), add(e, mul(wallNormal(w), thick / 2)), add(e, mul(wallNormal(w), -thick / 2)), add(s, mul(wallNormal(w), -thick / 2))];
    const mid = wallPoint(w, o.offset);
    const lbl = add(mid, mul(n, -thick / 2 - fs * 1.1));
    if (o.kind === 'window') {
      return (
        <g key={o.id} {...common} className={`opening ${sel ? 'selected' : ''}`}>
          <polygon points={pts(gap)} className="window-gap" />
          <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="window-line" />
        </g>
      );
    }
    const hinge = o.hinge === 'start' ? s : e;
    const other = o.hinge === 'start' ? e : s;
    const leaf = o.width - 60;
    const openTip = add(hinge, mul(n, leaf));
    const closedTip = add(hinge, mul(norm(sub(other, hinge)), leaf));
    const v1 = sub(openTip, hinge), v2 = sub(closedTip, hinge);
    const sweep = v1.x * v2.y - v1.y * v2.x > 0 ? 1 : 0;
    void d;
    return (
      <g key={o.id} {...common} className={`opening ${sel ? 'selected' : ''}`}>
        <polygon points={pts(gap)} className="door-gap" />
        {o.kind === 'door' && (
          <>
            <line x1={hinge.x} y1={hinge.y} x2={openTip.x} y2={openTip.y} className="door-leaf" />
            <path d={`M ${openTip.x} ${openTip.y} A ${leaf} ${leaf} 0 0 ${sweep} ${closedTip.x} ${closedTip.y}`} className="door-arc" />
          </>
        )}
        {o.kind === 'sliding-door' && <line x1={s.x} y1={s.y} x2={e.x} y2={e.y} className="door-leaf" transform={`translate(${n.x * 40} ${n.y * 40})`} />}
        <text x={lbl.x} y={lbl.y} fontSize={fs * 0.8} className="dim-label" textAnchor="middle">
          {o.kind === 'opening' ? `${o.width} opening` : `~${clearOpening(o)} clear`}
        </text>
      </g>
    );
  };

  const cursorCls = tool === 'select' ? (drag?.kind === 'pan' ? 'grabbing' : '') : 'crosshair';

  return (
    <div className="plan-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        className={`plan ${cursorCls}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={onWheel}
        onPointerDown={onBgDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        role="application"
        aria-label="Floor plan editor. Drag furniture, walls and doors to change the layout."
      >
        <defs>
          <pattern id="grid" width="500" height="500" patternUnits="userSpaceOnUse">
            <path d="M 500 0 L 0 0 0 500" fill="none" stroke="#dde2e6" strokeWidth={vb.w / 1200} />
          </pattern>
        </defs>
        <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#grid)" />
        {bg && <image href={bg.dataUrl} x={bg.x} y={bg.y} width={bg.pxWidth * bg.scale} height={bg.pxHeight * bg.scale} opacity={bg.opacity} preserveAspectRatio="none" pointerEvents="none" />}

        {/* floor fill */}
        {layout.walls.length > 2 && (layout.walls.every((w, i) => dist(w.b, layout.walls[(i + 1) % layout.walls.length].a) < 2)
          ? <polygon points={pts(layout.walls.map((w) => w.a))} className="floor-fill" pointerEvents="none" />
          : (() => { const b = layoutBounds({ ...layout, items: [] }); return <rect x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} className="floor-fill" pointerEvents="none" />; })())}

        {/* swept path */}
        {prints.map((p, i) => <polygon key={i} points={pts(p)} className="swept" pointerEvents="none" />)}
        {route && <polyline points={pts(route.samples.filter((_, i) => i % 4 === 0))} className="route" pointerEvents="none" />}
        {built.parking && <polygon points={pts(chairFootprint(built.parking, C.width, C.length))} className="parking" pointerEvents="none" />}

        {/* items */}
        {layout.items.map((it) => {
          const sel = selection?.type === 'item' && selection.id === it.id;
          return (
            <g
              key={it.id}
              transform={`translate(${it.x} ${it.y}) rotate(${it.rotation})`}
              className={`item-g ${sel ? 'selected' : ''} ${it.id === built.target?.id ? 'target' : ''}`}
              onPointerDown={(e) => {
                set({ selection: { type: 'item', id: it.id } });
                const p = toPlan(e);
                startDrag(e, { kind: 'item', id: it.id, offset: sub(p, { x: it.x, y: it.y }) });
              }}
            >
              <ItemSymbol it={it} fs={fs} />
            </g>
          );
        })}
        {layout.items.map((it) => (it.kind === 'turning-space' || it.kind === 'grab-rail' ? null : (
          <text key={`l${it.id}`} x={it.x} y={it.y + fs * 0.35} fontSize={fs * (it.w < 600 || it.d < 500 ? 0.7 : 0.9)} className="item-label" pointerEvents="none">
            {itemLabel(it.kind, it.label)}
          </text>
        )))}

        {/* walls */}
        {wallRects.map((r, i) => <polygon key={i} points={pts(r)} className="wall-solid" pointerEvents="none" />)}
        {layout.walls.map((w) => {
          const sel = selection?.type === 'wall' && selection.id === w.id;
          const n = wallNormal(w);
          const L = wallLength(w);
          const mid = wallPoint(w, L / 2);
          const lbl = add(mid, mul(n, w.thickness / 2 + fs * 1.3));
          return (
            <g key={w.id}>
              <line
                x1={w.a.x} y1={w.a.y} x2={w.b.x} y2={w.b.y}
                className={`wall-hit ${sel ? 'selected' : ''}`}
                strokeWidth={Math.max(w.thickness, vb.w / 90)}
                onPointerDown={(e) => {
                  set({ selection: { type: 'wall', id: w.id } });
                  startDrag(e, { kind: 'wall', id: w.id, start: toPlan(e), orig: layout.walls.map((x) => ({ ...x, a: { ...x.a }, b: { ...x.b } })) });
                }}
              />
              <text x={lbl.x} y={lbl.y} fontSize={fs * 0.8} className="dim-label" textAnchor="middle" pointerEvents="none">
                {Math.round(L - w.thickness)}
              </text>
            </g>
          );
        })}
        {layout.openings.map((o) => {
          const w = layout.walls.find((x) => x.id === o.wallId);
          return w ? doorSymbol(o, w) : null;
        })}

        {/* clearance dimensions for the selected item */}
        {clearances.map((c, i) => {
          const m = mul(add(c.a, c.b), 0.5);
          return (
            <g key={i} pointerEvents="none">
              <line x1={c.a.x} y1={c.a.y} x2={c.b.x} y2={c.b.y} className="clear-line" />
              <rect x={m.x - fs * 1.6} y={m.y - fs * 0.6} width={fs * 3.2} height={fs * 1.2} rx={fs * 0.3} className="clear-bg" />
              <text x={m.x} y={m.y + fs * 0.35} fontSize={fs * 0.85} className="clear-text" textAnchor="middle">{c.d}</text>
            </g>
          );
        })}

        {/* contacts */}
        {route?.contacts.map((c, i) => <circle key={i} cx={c.at.x} cy={c.at.y} r={220} className="contact" pointerEvents="none" />)}

        {settings.type !== 'imported' && <LiveChair layoutKey={layoutKey} />}

        {/* start / end markers */}
        <g className="marker start" onPointerDown={(e) => { set({ selection: { type: 'start' } }); startDrag(e, { kind: 'start', offset: sub(toPlan(e), layout.start) }); }}>
          <circle cx={layout.start.x} cy={layout.start.y} r={fs * 1.2} />
          <line x1={layout.start.x} y1={layout.start.y} x2={startTip.x} y2={startTip.y} />
          <text x={layout.start.x} y={layout.start.y + fs * 0.35} fontSize={fs * 0.9} textAnchor="middle">S</text>
        </g>
        {settings.type === 'navigate' && (
          <g className="marker end" onPointerDown={(e) => { set({ selection: { type: 'end' } }); startDrag(e, { kind: 'end', offset: sub(toPlan(e), layout.end) }); }}>
            <circle cx={layout.end.x} cy={layout.end.y} r={fs * 1.2} />
            <text x={layout.end.x} y={layout.end.y + fs * 0.35} fontSize={fs * 0.9} textAnchor="middle">E</text>
          </g>
        )}

        {/* note pins */}
        {layoutNotes.map((n) => (
          <g key={n.id} className={`pin ${n.category}`} pointerEvents="none">
            <circle cx={n.pin!.x} cy={n.pin!.y} r={fs * 0.9} />
            <text x={n.pin!.x} y={n.pin!.y + fs * 0.3} fontSize={fs * 0.8} textAnchor="middle">{notes.indexOf(n) + 1}</text>
          </g>
        ))}

        {/* drawing tool preview */}
        {tool === 'draw-room' && draw.length > 0 && (
          <g pointerEvents="none">
            <polyline points={pts(cursor ? [...draw, cursor] : draw)} className="draw-line" />
            {draw.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={fs * 0.4} className="draw-pt" />)}
            {cursor && (
              <text x={cursor.x + fs} y={cursor.y - fs} fontSize={fs} className="dim-label">
                {Math.round(dist(cursor, draw[draw.length - 1]))} mm
              </text>
            )}
          </g>
        )}
        {tool === 'calibrate' && calib.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={fs * 0.5} className="draw-pt" />)}
        {tool === 'calibrate' && calib.length === 1 && cursor && <line x1={calib[0].x} y1={calib[0].y} x2={cursor.x} y2={cursor.y} className="draw-line" />}
      </svg>

      <div className="plan-tools">
        <button onClick={() => setVb((v) => ({ x: v.x + v.w * 0.1, y: v.y + v.h * 0.1, w: v.w * 0.8, h: v.h * 0.8 }))} aria-label="Zoom in">＋</button>
        <button onClick={() => setVb((v) => ({ x: v.x - v.w * 0.125, y: v.y - v.h * 0.125, w: v.w * 1.25, h: v.h * 1.25 }))} aria-label="Zoom out">－</button>
        <button onClick={fit}>Fit</button>
      </div>
      {tool !== 'select' && (
        <div className="tool-banner">
          {tool === 'draw-room' && 'Click each corner of the room. Click the first corner again to finish. (Esc to cancel)'}
          {tool === 'calibrate' && 'Click two points on the plan whose real distance you know (e.g. the ends of a dimension line).'}
          {tool === 'pin-note' && 'Click on the plan where the note applies.'}
        </div>
      )}
      <div className="plan-legend">
        <span><i className="lg route" /> route</span>
        {settings.showSweptPath && <span><i className="lg swept" /> space used by chair</span>}
        <span><i className="lg contact" /> possible contact</span>
        <span>Numbers in mm</span>
      </div>
    </div>
  );
};
