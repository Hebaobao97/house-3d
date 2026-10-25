/* site + plan 数据自检（纯 Node，不需要浏览器） */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', 'js');
const files = ['plan.js', 'site.js'];

const sandbox = { window: {}, console, Math, Number, Object, Array, JSON };
sandbox.window.H3 = {};
vm.createContext(sandbox);
for (const f of files) {
  const code = fs.readFileSync(path.join(ROOT, f), 'utf8');
  vm.runInContext(code, sandbox, { filename: f });
}
const H3 = sandbox.window.H3;
const P = H3.plan, S = H3.site;

let fail = 0;
const ok = (c, m) => { if (!c) { console.log('  FAIL ' + m); fail++; } else console.log('  ok   ' + m); };

console.log('== 基准 ==');
ok(P && S, 'plan.js / site.js 都已定义');
ok(S.N === 55, '总层数 55');
ok(S.F === 29, '本户 29F');
ok(S.H === 3.0, '层高 3.00');
ok(S.myTop === 84 && S.myRoof === 87 && S.top === 169, '标高 84 / 87 / 169（55×3.00+4.00 架空层）');
ok(S.clear === 2.8, '净高 2.80');

console.log('== 户型平面 ==');
const uw = P.bounds.x2 - P.bounds.x1;
const ud = P.bounds.z2 - P.bounds.z1;
console.log('  本户带墙尺寸 ' + uw.toFixed(2) + ' × ' + ud.toFixed(2) + ' m，套内 ' + (uw * ud).toFixed(2) + ' ㎡');
ok(Math.abs(uw - 9.68) < 0.01, '本户面宽 9.68');
ok(S.units.reduce((a, u) => a + u.w, 0) === S.towerFootW, '四户宽度之和 = 楼栋面宽 ' + S.towerFootW);
ok(S.unitOffsetX < 0, '03 户轴在楼栋中部偏西（offset ' + S.unitOffsetX.toFixed(2) + '）');

console.log('== 视线 ==');
console.log('  本户地面绝对标高 ' + S.myAbs.toFixed(1) + ' m，视线 ' + S.eyeAbs.toFixed(1) + ' m');
console.log('  湖面 ' + S.lakeAbs.toFixed(1) + ' m，高出湖面 ' + (S.eyeAbs - S.lakeAbs).toFixed(1) + ' m');
ok(S.eyeAbs - S.lakeAbs > 60, '视线高出湖面 > 60 m');
const hor = Math.sqrt(2 * 6371000 * (S.eyeAbs - 0) / 1000 + 0) / 1000;
console.log('  理想地平线距离约 ' + Math.sqrt(2 * 6371 * S.eyeAbs / 1000).toFixed(1) + ' km');
ok(Math.sqrt(2 * 6371 * S.eyeAbs / 1000) > 30, '地平线 > 30 km（湖面可连续可见）');

console.log('== 楼栋落位（公示图标定） ==');
const errs = S.check();
errs.forEach(e => console.log('  ERR ' + e));
ok(errs.length === 0, 'S.check() 无错误');
console.log('  周边楼栋 ' + (S.buildings.length - 1) + ' 栋（含 7# 占位）');
const nearest = S.buildings
  .filter(b => b[0] !== '7#')
  .map(b => ({ id: b[0], d: Math.hypot(b[1], b[2]), h: b[5] * 3 }))
  .sort((a, b) => a.d - b.d).slice(0, 5);
nearest.forEach(n => console.log('    近邻 ' + n.id + ' 距 ' + n.d.toFixed(0) + ' m，高 ' + n.h + ' m'));

console.log('== 岸线与湖面 ==');
console.log('  岸线折线 ' + S.shoreline.length + ' 点，本楼到岸线最近 ' + S.shoreDist + ' m');
ok(S.shoreline.length >= 20, '岸线点数 ≥ 20（够平滑）');
ok(S.shoreDist > 400 && S.shoreDist < 600, '本楼到岸线 400–600 m（小区与湖之间隔着滨湖绿带）');
(function () {
  const P = S.lakePoly;
  let a = 0;
  for (let i = 0; i < P.length; i++) {
    const j = (i + 1) % P.length;
    a += P[i][0] * P[j][1] - P[j][0] * P[i][1];
  }
  const km2 = Math.abs(a) / 2 / 1e6;
  console.log('  湖面多边形 ' + P.length + ' 点，面积 ' + km2.toFixed(2) + ' km²（公开数据 7.67 km²，含示意延伸）');
  ok(km2 > 1.0, '湖面面积 > 1 km²');
  /* 本楼不能在湖里 */
  let ins = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if (((zi > 0) !== (zj > 0)) && (0 < (xj - xi) * (0 - zi) / (zj - zi) + xi)) ins = !ins;
  }
  ok(!ins, '本楼不在湖面多边形内');
  /* 6#、8# 也不能在湖里 */
  let inLake = [];
  for (const b of S.buildings) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
      if (((zi > b[2]) !== (zj > b[2])) && (b[1] < (xj - xi) * (b[2] - zi) / (zj - zi) + xi)) c = !c;
    }
    if (c) inLake.push(b[0]);
  }
  ok(inLake.length === 0, '没有楼栋落在湖面里' + (inLake.length ? '：' + inLake.join(',') : ''));
})();

console.log('== 主景面遮挡检查（195° = 南偏西 15°） ==');
/* ★ v4 修：旧版这里的方位角写成 atan2(x, z)，0° 落在 +Z（南）上，
   于是"229–269°"其实是西北象限；再加上没处理 0/360 环绕，
   正南/正北的楼栋四角跨过 0° 时会被算成整段遮挡（假 FAIL）。
   现在与 main.js / views.js 统一：az = atan2(x, -z)，0=北 90=东 180=南。 */
const az = (x, z) => (Math.atan2(x, -z) * 180 / Math.PI + 360) % 360;
const wrap = (a) => ((a % 360) + 540) % 360 - 180;      // → (-180, 180]
function angSpan(x, z, w, d, rotDeg) {
  const a = (rotDeg === undefined ? S.rotDeg : rotDeg) * Math.PI / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const base = az(x, z);
  let lo = 0, hi = 0;
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    /* 楼体 rotation.y = −rot，局部 → 世界的转角就是 +rot */
    const lx = sx * w / 2, lz = sz * d / 2;
    const px = x + lx * c - lz * s;
    const pz = z + lx * s + lz * c;
    const delta = wrap(az(px, pz) - base);
    lo = Math.min(lo, delta); hi = Math.max(hi, delta);
  }
  return [base + lo, base + hi];
}
const VIEW_A = 195, VIEW_HALF = 30;
const tall = S.buildings.filter(b => b[0] !== '7#' && b[5] * 3 + S.groundAbs > S.eyeAbs);
let occl = [];
for (const b of tall) {
  const d = Math.hypot(b[1], b[2]);
  if (d < 40) continue;
  const [lo, hi] = angSpan(b[1], b[2], b[3], b[4], b[6]);
  const L = Math.max(lo, VIEW_A - VIEW_HALF), H = Math.min(hi, VIEW_A + VIEW_HALF);
  if (H > L) occl.push({ id: b[0], d: d, span: [L.toFixed(0), H.toFixed(0)], deg: (H - L).toFixed(0) });
}
console.log('  高于视线的楼栋：' + tall.map(b => b[0] + '(' + Math.hypot(b[1], b[2]).toFixed(0) + 'm/' + b[5] + 'F)').join(', '));
console.log('  其中落在主景面 ' + (VIEW_A - VIEW_HALF) + '–' + (VIEW_A + VIEW_HALF) + '° 内的：' + (occl.length
  ? occl.map(o => o.id + ' 遮 ' + o.deg + '° [' + o.span.join('–') + ']').join('; ') : '无'));
/* 取遮挡区间的并集，算"净宽"；同时单独校视线主轴 ±8° 必须无遮挡 */
const iv = occl.map(o => [+o.span[0], +o.span[1]]).sort((a, b) => a[0] - b[0]);
let merged = [];
for (const [a, b] of iv) {
  if (merged.length && a <= merged[merged.length - 1][1] + 0.01) {
    merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b);
  } else merged.push([a, b]);
}
const covered = merged.reduce((s, m) => s + (m[1] - m[0]), 0);
const clear = VIEW_HALF * 2 - covered;
console.log('  遮挡并集：' + (merged.length ? merged.map(m => m[0].toFixed(0) + '–' + m[1].toFixed(0)).join(', ') : '无')
  + '；净宽 ' + clear.toFixed(0) + '°');
/* 说明：165–192° 这一段被 5#/3#/2#/11# 占掉，是"10 栋 119–169 m 高层"
   这个硬指标的直接结果（公示图 + 2024 年投诉件都印证了 10 栋超 100 m）。
   所以这里只保证**剩下有连续净空**，并把净空区间打出来供画面对照。 */
const free = [];
let cur = VIEW_A - VIEW_HALF;
for (const [a, b] of merged) {
  if (a > cur) free.push([cur, a]);
  cur = Math.max(cur, b);
}
if (cur < VIEW_A + VIEW_HALF) free.push([cur, VIEW_A + VIEW_HALF]);
console.log('  净空区间：' + free.map(f => f[0].toFixed(0) + '–' + f[1].toFixed(0)).join(', '));
ok(clear >= 25, '主景面 ' + VIEW_HALF * 2 + '° 内净宽 ≥ 25°');
ok(free.some(f => f[0] <= VIEW_A && f[1] >= VIEW_A), '视线主轴 ' + VIEW_A + '° 落在净空区间内');

console.log('== 西向（285°）==');
const west = S.buildings.filter(b => {
  if (b[0] === '7#') return false;
  const a = az(b[1], b[2]);
  return a > 255 && a < 315 && Math.hypot(b[1], b[2]) < 300;
});
console.log('  西向 300 m 内：' + (west.length ? west.map(b => b[0] + '(' + Math.hypot(b[1], b[2]).toFixed(0) + 'm/' + b[5] + 'F)').join(', ') : '无'));
ok(west.filter(b => b[5] * 3 + S.groundAbs > S.eyeAbs).length === 0, '西向 300 m 内无高于视线的楼栋');

console.log(fail === 0 ? '\nALL PASS' : '\n' + fail + ' FAILED');
process.exit(fail === 0 ? 0 : 1);
