// Catmull-Rom spline through tracking anchors (uniform, ends clamped).
// The one copy: the browser preview imports it, and the server's exporter and
// tools/spacing-report.js load it with import() — so preview === export.
// anchors: [{ t, x, y }] sorted by t; returns { x, y } at time t.
export function splineAt(anchors, t) {
  const n = anchors.length;
  if (n === 1) return { x: anchors[0].x, y: anchors[0].y };
  if (t <= anchors[0].t) return { x: anchors[0].x, y: anchors[0].y };
  if (t >= anchors[n - 1].t) return { x: anchors[n - 1].x, y: anchors[n - 1].y };
  let i = 0;
  while (i < n - 2 && anchors[i + 1].t < t) i++;
  const p1 = anchors[i], p2 = anchors[i + 1];
  const p0 = anchors[Math.max(0, i - 1)], p3 = anchors[Math.min(n - 1, i + 2)];
  const u = (t - p1.t) / (p2.t - p1.t || 1);
  const u2 = u * u, u3 = u2 * u;
  const cr = (a, b, c, d) =>
    0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
  return { x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y) };
}
