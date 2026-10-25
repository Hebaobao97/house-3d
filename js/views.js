/* ============================================================
   views.js —— 窗外景色系统
   ① 室内窗洞对接：确认每个窗洞外能看到什么（数据校验）
   ② 天空 / 大气 / 能见度
   ③ 远景天际线（对岸）
   ④ 湖面波光与倒影色调
   ============================================================ */
(function () {
  const H3 = (window.H3 = window.H3 || {});
  const S = H3.site;
  const P = H3.plan;

  /* 7 号楼朝向：南偏西 15°，所以"正南方向"要整体旋转 15° */
  const TOWARD_DEG = S.rotDeg;

  /* ---------------- 窗洞清单（从 plan.js 的墙 op 里提取） ---------------- */

  /* 每扇窗的外向法线：由它所在墙的方向决定 */
  function wallNormal(wl) {
    const dx = wl.b[0] - wl.a[0], dz = wl.b[1] - wl.a[1];
    const len = Math.hypot(dx, dz);
    // 墙的方向向右转 90° 得到法线，再根据是外墙朝外取符号
    let nx = -dz / len, nz = dx / len;
    // 让法线指向远离户型中心
    const cx = (P.bounds.x1 + P.bounds.x2) / 2;
    const cz = (P.bounds.z1 + P.bounds.z2) / 2;
    const mx = (wl.a[0] + wl.b[0]) / 2, mz = (wl.a[1] + wl.b[1]) / 2;
    if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
    return { nx, nz };
  }

  function buildWindowList() {
    const list = [];
    for (const wl of P.walls) {
      if (!wl.op) continue;
      /* 阳台栏板上的"窗"只是栏板玻璃，不是采光窗，排除掉 */
      if (wl.balcony || wl.barrier) continue;
      const { nx, nz } = wallNormal(wl);
      const dx = wl.b[0] - wl.a[0], dz = wl.b[1] - wl.a[1];
      const len = Math.hypot(dx, dz);
      const ux = dx / len, uz = dz / len;
      for (const o of wl.op) {
        if (o.kind !== 'win') continue;
        const mid = (o.s + o.e) / 2;
        const px = wl.a[0] + ux * mid, pz = wl.a[1] + uz * mid;
        list.push({
          w: o.e - o.s, sill: o.sill, top: o.top,
          x: px, z: pz, nx, nz,
          /* 世界方位：世界坐标 X 东、Z 南，但整个户型要随 7 号楼旋转 rotDeg。
             楼体 rotation.y = -ROT，向量旋转矩阵取 +ROT（与 main.js 的 OUT_SPOTS 一致）。 */
          facing: (function () {
            const a = TOWARD_DEG * Math.PI / 180;
            const wx = nx * Math.cos(a) - nz * Math.sin(a);
            const wz = nx * Math.sin(a) + nz * Math.cos(a);
            const deg = (Math.atan2(wx, -wz) * 180 / Math.PI + 360) % 360;   // 0=北 90=东 180=南
            return (deg > 135 && deg < 225) ? '南'
              : (deg > 45 && deg <= 135) ? '东'
                : (deg > 225 && deg < 315) ? '西' : '北';
          })()
        });
      }
    }
    return list;
  }

  /* ---------------- 天空 ---------------- */
  function buildSky(scene, opt) {
    const o = opt || {};
    const topCol = o.top || '#5f8fc4';
    const horCol = o.hor || '#cfdbe4';
    const groundCol = o.ground || '#b9b3a4';

    const geo = new THREE.SphereGeometry(14000, 32, 20);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        top: { value: new THREE.Color(topCol) },
        hor: { value: new THREE.Color(horCol) },
        gnd: { value: new THREE.Color(groundCol) }
      },
      vertexShader: `
        varying vec3 vP;
        void main() {
          vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        uniform vec3 top; uniform vec3 hor; uniform vec3 gnd;
        varying vec3 vP;
        void main() {
          float h = normalize(vP).y;
          vec3 c;
          if (h > 0.0) {
            float t = pow(clamp(h, 0.0, 1.0), 0.55);
            c = mix(hor, top, t);
          } else {
            float t = pow(clamp(-h, 0.0, 1.0), 0.5);
            c = mix(hor, gnd, t);
          }
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    scene.add(sky);
    H3.sky = sky;

    // 太阳光晕贴片（朝太阳方向的软盘）
    const sunDir = new THREE.Vector3(-0.32, 0.62, 0.72).normalize();
    const sunPos = sunDir.clone().multiplyScalar(12000);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: H3.mkTex(256, 256, (ctx, w, h) => {
        const g2 = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        g2.addColorStop(0, 'rgba(255,252,240,1)');
        g2.addColorStop(0.12, 'rgba(255,245,215,0.85)');
        g2.addColorStop(0.4, 'rgba(255,236,190,0.22)');
        g2.addColorStop(1, 'rgba(255,236,190,0)');
        ctx.fillStyle = g2; ctx.fillRect(0, 0, w, h);
      }),
      transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending
    }));
    halo.position.copy(sunPos);
    halo.scale.set(2600, 2600, 1);
    scene.add(halo);
    H3.sunHalo = halo;

    return sky;
  }

  /* ---------------- 大气：雾 + 能见度 ---------------- */

  const VIS = {
    /* ★ near 必须给到"从 29F 往外看的第一层水面"以外（岸线 168 m、湖心 1.5 km），
       否则 900 m 就开始起雾，1.5 km 外的湖面被冲成 60% 的雾色 ——
       实测 29F 湖景就是"深青→灰白"一条硬带子，看着像湖被截断。
       ★ far 必须大于"远处大地"那片方片的尺寸（community.js 里 R = 26000），
       否则 26 km 外陆地边缘会以一条硬线切在天空上（实测在水天之间横一条
       淡黄色带），而不是被雾吃掉。 */
    clear: { far: 42000, near: 2600, col: '#cfdbe4' },
    haze: { far: 20000, near: 1500, col: '#d6d9d6' },
    foggy: { far: 4200, near: 600, col: '#dfe0dc' }
  };

  function setVisibility(scene, key) {
    const v = VIS[key] || VIS.clear;
    if (!scene.fog) scene.fog = new THREE.Fog(0xffffff, v.near, v.far);
    scene.fog.color.set(v.col);
    scene.fog.near = v.near;
    scene.fog.far = v.far;
    if (H3.sky) H3.sky.material.uniforms.hor.value.set(v.col);
    H3.vis = key;
  }

  /* ---------------- 远景天际线（对岸） ---------------- */

  function buildSkyline(scene) {
    /* 南湖：水域 7.67 km²、岸线 23 km，"呈东西分布，北岸较曲折"（B 公开）。
       本户 29F 视线高出湖面 90 m，理想地平线 37 km，
       所以对岸实际是"2–4 km 外的城市轮廓 + 更远处的低山"。
       方位按世界坐标铺：西（270°）到南（180°）到东南（130°）都是水面。 */
    const g = new THREE.Group();
    g.name = 'skyline';

    const matNear = new THREE.MeshBasicMaterial({ color: 0x9aa7ae, fog: true });
    const matFar = new THREE.MeshBasicMaterial({ color: 0xaeb9bf, fog: true });
    matNear.userData.day = 0x9aa7ae;
    matFar.userData.day = 0xaeb9bf;

    let seed = 7717;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

    /* 方位角：0=北，90=东，180=南，270=西 */
    const segs = [
      /* 西南对岸（掠过湖面，最远处） */
      { a0: 200, a1: 250, r0: 3200, r1: 4200, hMin: 14, hMax: 46, mat: matNear },
      /* 正西 / 西南偏西的湖对岸城区 */
      { a0: 250, a1: 300, r0: 2800, r1: 3800, hMin: 12, hMax: 52, mat: matNear },
      /* 东南对岸（南湖东南部街区） */
      { a0: 130, a1: 175, r0: 2600, r1: 3400, hMin: 12, hMax: 44, mat: matNear },
      /* 远山：西—南—东南一大圈，压得很低 */
      { a0: 120, a1: 310, r0: 6200, r1: 8200, hMin: 26, hMax: 80, mat: matFar }
    ];

    for (const s of segs) {
      const step = 0.8;
      for (let a = s.a0; a < s.a1; a += step) {
        const ang = a * Math.PI / 180;
        const r = s.r0 + rnd() * (s.r1 - s.r0);
        const x = Math.sin(ang) * r;
        const z = -Math.cos(ang) * r;      // 方位角 0=北 → z 负；180=南 → z 正
        const h = s.hMin + rnd() * (s.hMax - s.hMin);
        const w = 30 + rnd() * 70;
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 26), s.mat);
        b.position.set(x, h / 2 + (S.lakeAbs - S.groundAbs), z);
        b.rotation.y = -ang + rnd() * 0.4;
        g.add(b);
      }
    }
    scene.add(g);
    H3.skyline = g;
    return g;
  }

  /* ---------------- 校核：每扇窗到底看到了什么 ---------------- */

  function auditWindows() {
    const wins = buildWindowList();
    const rows = [];
    for (const w of wins) {
      // 把窗的外法线转到世界坐标（户型要随楼旋转）
      const c = Math.cos(TOWARD_DEG * Math.PI / 180), s = Math.sin(TOWARD_DEG * Math.PI / 180);
      const wx = w.nx * c + w.nz * s;
      const wz = -w.nx * s + w.nz * c;
      const bearing = (Math.atan2(wx, wz) * 180 / Math.PI + 360) % 360;   // 0=北 90=东 180=南
      let dir;
      if (bearing > 135 && bearing < 225) dir = '南';
      else if (bearing > 45 && bearing <= 135) dir = '东';
      else if (bearing > 225 && bearing < 315) dir = '西';
      else dir = '北';
      rows.push({
        facing: dir, bearing: bearing.toFixed(0),
        w: w.w.toFixed(2), sill: w.sill, top: w.top,
        x: w.x, z: w.z,
        /* 能看到的景：南/西 → 草坪与湖；北 → 连廊；东 → 邻户 */
        view: dir === '南' ? '中央草坪 → 洋房屋顶 → 南湖水面 → 对岸天际线'
          : dir === '西' ? '越过 6# 西侧 → 桂湖路绿带 → 湖湾'
            : dir === '北' ? '公共连廊（有顶棚）→ 6# / 8# 楼体'
              : '邻户外墙（分户墙，实际无窗或侧向采光）'
      });
    }
    return rows;
  }

  /* ---------------- 窗洞净高的常用判定：能不能"站着看出去" ---------------- */
  /* 窗台 ≤ 0.60 m 的落地/大飘窗，站着平视可以直接看到地平线；
     窗台 0.95 m 的高窗（卫生间）只能俯视近处园林。这句话写进 UI 提示里。 */
  function sillClass(sill) {
    return sill <= 0.60 ? '落地' : (sill <= 0.90 ? '低台' : '高台');
  }

  H3.views = {
    buildSky, setVisibility, buildSkyline, auditWindows, buildWindowList,
    sillClass, VIS, TOWARD_DEG
  };
})();
