export const RASTER_W = 1024
export const RASTER_H = 512

interface TopoGeometry {
  type: string
  arcs: number[][] | number[][][]
}

interface TopoTopology {
  transform: { scale: [number, number]; translate: [number, number] }
  objects: { land: { geometries: TopoGeometry[] } }
  arcs: number[][][]
}

type Ring = [number, number][]

function decodePolygons(topo: TopoTopology): Ring[][] {
  const { scale, translate } = topo.transform
  const arcs = topo.arcs.map(arc => {
    let x = 0
    let y = 0
    return arc.map(([dx, dy]) => {
      x += dx
      y += dy
      return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as [number, number]
    })
  })
  const out: Ring[][] = []
  for (const geom of topo.objects.land.geometries) {
    const polys = geom.type === 'Polygon' ? [geom.arcs as number[][]] : (geom.arcs as number[][][])
    for (const poly of polys) {
      const rings: Ring[] = []
      for (const ring of poly) {
        const pts: Ring = []
        ring.forEach((idx, j) => {
          const seq = idx >= 0 ? arcs[idx] : [...arcs[~idx]].reverse()
          pts.push(...(j > 0 ? seq.slice(1) : seq))
        })
        if (pts.length > 2) rings.push(pts)
      }
      if (rings.length > 0) out.push(rings)
    }
  }
  return out
}

function unwrap(ring: Ring): Ring {
  const out: Ring = [ring[0]]
  let prev = ring[0][0]
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0]
    while (lon - prev > 180) lon -= 360
    while (prev - lon > 180) lon += 360
    out.push([lon, ring[i][1]])
    prev = lon
  }
  if (Math.abs(out[out.length - 1][0] - out[0][0]) > 350) {
    const pole = out.reduce((sum, p) => sum + p[1], 0) / out.length < 0 ? -90 : 90
    out.push([out[out.length - 1][0], pole], [out[0][0], pole])
  }
  return out
}

export function buildLandMask(topo: unknown): Uint8Array | null {
  const canvas = document.createElement('canvas')
  canvas.width = RASTER_W
  canvas.height = RASTER_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  ctx.fillStyle = '#fff'
  for (const poly of decodePolygons(topo as TopoTopology)) {
    const rings = poly.map(unwrap)
    let lo = Infinity
    let hi = -Infinity
    for (const ring of rings) {
      for (const p of ring) {
        if (p[0] < lo) lo = p[0]
        if (p[0] > hi) hi = p[0]
      }
    }
    for (const off of [-360, 0, 360]) {
      if (hi + off < -180 || lo + off > 180) continue
      ctx.beginPath()
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const x = ((ring[i][0] + off + 180) / 360) * RASTER_W
          const y = ((90 - ring[i][1]) / 180) * RASTER_H
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
      }
      ctx.fill('evenodd')
    }
  }

  const pixels = ctx.getImageData(0, 0, RASTER_W, RASTER_H).data
  const mask = new Uint8Array(RASTER_W * RASTER_H)
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3] > 40 ? 1 : 0
  return mask
}

export function isLand(mask: Uint8Array, lat: number, lon: number): boolean {
  const x = Math.min(RASTER_W - 1, Math.max(0, ((lon + 180) / 360) * RASTER_W) | 0)
  const y = Math.min(RASTER_H - 1, Math.max(0, ((90 - lat) / 180) * RASTER_H) | 0)
  return mask[y * RASTER_W + x] === 1
}
