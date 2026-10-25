/* ============================================================
   tower.js —— 楼宇剖面 / 自家楼层定位 / 视野分析
   参数来自窗口配置：层高 3.00 m，总 55 层，本户 29 层
   单位：米。坐标系与户型一致：X 向东，Z 向南；楼体以本户平面为中心
   ============================================================ */
(function () {
  const H3 = (window.H3 = window.H3 || {});
  const P = H3.plan;

  const T = {
    H: 3.00,          // 层高
    N: 55,            // 总层数
    F: 29,            // 本户楼层（1 起算）
    PLOT: 30,         // 楼体平面地基偏移（垂直剖面里表示"在本层以下"）
  };
  T.slab = 0.20;                      // 楼板厚
  T.clear = T.H - T.slab;             // 净高 2.80
  T.myTop = (T.F - 1) * T.H;          // 本层地面标高 = 84.00
  T.top = T.N * T.H;                  // 建筑总高 = 165.00
  T.eye = T.myTop + 1.50;             // 坐姿/站姿视线标高 ≈ 85.50
  T.myRoof = T.myTop + T.H;           // 本层天花标高 = 87.00
  H3.tower = T;

  let grp = null;

  /* ---------------- 小工具 ---------------- */
  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    return m;
  }
  function edge(w, h, d, x, y, z, color, op) {
    const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d));
    const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      color: color, transparent: true, opacity: op === undefined ? 0.32 : op
    }));
    l.position.set(x, y, z);
    return l;
  }
  function label(text, color, w) {
    try {
      const c = document.createElement('canvas');
      c.width = 512; c.height = 128;
      const g = c.getContext('2d');
      if (!g || !g.fillText) return null;
      g.clearRect(0, 0, 512, 128);
      g.fillStyle = color || '#f0e6d8';
      g.font = '600 64px "Segoe UI", Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, 256, 66);
      const tex = new THREE.CanvasTexture(c);
      if (tex.minFilter !== undefined) tex.minFilter = THREE.LinearFilter;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.96
      }));
      const s = w || 2.6;
      sp.scale.set(s, s * 0.25, 1);
      sp.renderOrder = 998;
      return sp;
    } catch (e) { return null; }
  }
  /* 以"世界"坐标放置（内部转换为 root 局部坐标） */
  function at(obj, x, y, z) {
    obj.position.set(x - P.cx, y, z - P.cz);
    return obj;
  }

  /* ---------------- 立面纹理：开窗网格 ---------------- */
  function facadeTex(cols, rows, opt) {
    opt = opt || {};
    return H3.mkTex(512, 1024, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, opt.a || '#e7e3da');
      g.addColorStop(1, opt.b || '#cdc7ba');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      const cw = w / cols, rh = h / rows;
      const mx = cw * 0.16, my = rh * 0.18;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cw + mx, y = r * rh + my;
          const ww = cw - mx * 2, wh = rh - my * 2;
          const gg = ctx.createLinearGradient(x, y, x + ww, y + wh);
          gg.addColorStop(0, opt.gl || '#8fa4b4');
          gg.addColorStop(1, opt.gl2 || '#5b7185');
          ctx.fillStyle = gg;
          ctx.fillRect(x, y, ww, wh);
          ctx.fillStyle = 'rgba(255,255,255,0.16)';
          ctx.fillRect(x, y, ww * 0.42, wh);
          // 竖向分格
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x + ww / 2 - 1, y, 2, wh);
        }
        // 楼板线
        ctx.fillStyle = 'rgba(60,55,48,0.10)';
        ctx.fillRect(0, r * rh, w, Math.max(1, rh * 0.05));
      }
      // 竖向明暗
      const sh = ctx.createLinearGradient(0, 0, w, 0);
      sh.addColorStop(0, 'rgba(0,0,0,0.10)');
      sh.addColorStop(0.35, 'rgba(0,0,0,0)');
      sh.addColorStop(1, 'rgba(0,0,0,0.14)');
      ctx.fillStyle = sh; ctx.fillRect(0, 0, w, h);
    });
  }

  /* ---------------- 主构建 ---------------- */
  function buildTower(scene) {
    const g = new THREE.Group();
    g.name = 'tower';
    grp = g;
    scene.add(g);

    const matBody = new THREE.MeshStandardMaterial({
      map: facadeTex(6, 26), roughness: 0.82, metalness: 0.02, color: 0xffffff
    });
    const matBody2 = new THREE.MeshStandardMaterial({
      map: facadeTex(4, 26, { a: '#e2ded4', b: '#c6c0b2' }), roughness: 0.82, metalness: 0.02
    });
    const matMy = new THREE.MeshStandardMaterial({ color: 0xf1ece1, roughness: 0.5, metalness: 0.03 });
    const matGlass = new THREE.MeshStandardMaterial({
      color: 0x9fc0d6, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.42
    });
    const matRib = new THREE.MeshStandardMaterial({ color: 0xb9b2a4, roughness: 0.7 });

    // 平面尺寸（以本户为中心，向四周外扩成整栋标准层）
    const WX = 26, DZ = 24, CX = P.cx, CZ = P.cz;

    /* ---- ① 主楼体（本层以下 / 以上 用两张窗口纹理） ---- */
    const belowH = T.myTop;                    // 84
    const aboveH = T.top - T.myRoof;           // 78
    const b1 = box(WX, belowH, DZ, matBody, 0, belowH / 2, 0);
    b1.castShadow = false; b1.receiveShadow = false;
    g.add(b1);
    const b2 = box(WX, aboveH, DZ, matBody, 0, T.myRoof + aboveH / 2, 0);
    b2.castShadow = false; b2.receiveShadow = false;
    g.add(b2);

    // 楼体竖向线条（竖向节奏）
    for (const sx of [-1, 1]) {
      g.add(box(0.7, T.top, 0.7, matRib, sx * (WX / 2 - 0.35), T.top / 2, DZ / 2 - 0.35));
      g.add(box(0.7, T.top, 0.7, matRib, sx * (WX / 2 - 0.35), T.top / 2, -DZ / 2 + 0.35));
    }

    /* ---- ② 本层（29F）：整层凸出 0.5 m，暖白 + 玻璃 ---- */
    const y0 = T.myTop, y1 = T.myRoof;
    const my = box(WX + 1.0, T.H - 0.06, DZ + 1.0, matMy, 0, (y0 + y1) / 2, 0);
    g.add(my);
    // 本层腰线
    for (const yy of [y0 + 0.09, y1 - 0.09]) {
      g.add(box(WX + 1.16, 0.09, DZ + 1.16, matRib, 0, yy, 0));
    }
    // 本层窗（四面各一条，外推 0.04 m 避免与本层体量共面闪烁）
    const winH = 1.65, winY = y0 + 1.02, wOff = 0.04;
    for (const s of [1, -1]) {
      g.add(box(WX - 1.2, winH, 0.06, matGlass, 0, winY, s * ((DZ + 1.0) / 2 + wOff)));
      g.add(box(0.06, winH, DZ - 1.2, matGlass, s * ((WX + 1.0) / 2 + wOff), winY, 0));
    }
    /* 本层南立面挂一块竖直「户型图」飘板：层高只有 3 m 装不下平面，改为立在楼层外侧 */
    const BB = P.bounds;
    const BW = BB.x2 - BB.x1, BD = BB.z2 - BB.z1;
    const PS = 13.0 / BW;                 // 飘板宽 13 m
    const PW = 13.0, PH = BD * PS;
    const planTex = H3.mkTex(1400, Math.round(1400 * PH / PW), (ctx, w, h) => {
      ctx.fillStyle = '#fdfbf6';
      ctx.fillRect(0, 0, w, h);
      var pad = w * 0.05;
      var sx = (w - pad * 2) / BW, sz = (h - pad * 2) / BD;
      var X = function (v) { return pad + (v - BB.x1) * sx; };
      var Z = function (v) { return pad + (v - BB.z1) * sz; };
      // 标题栏
      ctx.fillStyle = '#d9531f';
      ctx.fillRect(0, 0, w, h * 0.055);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(w * 0.030) + 'px sans-serif';
      ctx.fillText('29F  ·  本户平面', pad * 0.8, h * 0.028);
      // 房间底色
      for (const r of P.rooms) {
        ctx.fillStyle = r.id === 'living' ? 'rgba(217,100,44,0.24)' : 'rgba(96,124,152,0.18)';
        ctx.fillRect(X(r.x1), Z(r.z1), (r.x2 - r.x1) * sx, (r.z2 - r.z1) * sz);
      }
      // 墙体：按厚度描粗线
      ctx.lineCap = 'square';
      for (const wl of P.walls) {
        var th = (wl.t || 0.2) * sx;
        ctx.strokeStyle = wl.ext ? '#2f2b26' : '#544c40';
        ctx.lineWidth = Math.max(4, th);
        ctx.beginPath();
        ctx.moveTo(X(wl.a[0]), Z(wl.a[1]));
        ctx.lineTo(X(wl.b[0]), Z(wl.b[1]));
        ctx.stroke();
      }
      ctx.fillStyle = '#4a4238'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.round(w * 0.034) + 'px sans-serif';
      for (const r of P.rooms) {
        ctx.fillText(r.name, X((r.x1 + r.x2) / 2), Z((r.z1 + r.z2) / 2));
      }
      // 窗洞：沿墙画白色断口 + 细线
      ctx.strokeStyle = '#ffffff'; ctx.lineCap = 'butt';
      for (const wl of P.walls) {
        if (!wl.op) continue;
        var ax = wl.a[0], az = wl.a[1], bx = wl.b[0], bz = wl.b[1];
        var len = Math.hypot(bx - ax, bz - az); if (!len) continue;
        var ux = (bx - ax) / len, uz = (bz - az) / len;
        for (const o of wl.op) {
          if (o.kind === 'door') continue;
          var p1x = ax + ux * o.s, p1z = az + uz * o.s;
          var p2x = ax + ux * o.e, p2z = az + uz * o.e;
          ctx.lineWidth = Math.max(4, (wl.t || 0.2) * sx) + 1;
          ctx.beginPath(); ctx.moveTo(X(p1x), Z(p1z)); ctx.lineTo(X(p2x), Z(p2z)); ctx.stroke();
          ctx.strokeStyle = '#7fa0bb'; ctx.lineWidth = Math.max(2, sx * 0.05);
          ctx.beginPath(); ctx.moveTo(X(p1x), Z(p1z)); ctx.lineTo(X(p2x), Z(p2z)); ctx.stroke();
          ctx.strokeStyle = '#ffffff';
        }
      }
    });
    const planBoard = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshBasicMaterial({ map: planTex, fog: false, side: THREE.DoubleSide }));
    // 挂在南立面外侧，竖向中心对齐本层
    planBoard.position.set(0, (y0 + y1) / 2, (DZ + 1.0) / 2 + 2.2);
    g.add(planBoard);
    // 飘板边框
    g.add(edge(PW + 0.28, PH + 0.28, 0.12, 0, (y0 + y1) / 2, (DZ + 1.0) / 2 + 2.2, 0xd9531f, 0.85));
    // 连接杆
    for (const sx of [-PW / 2 + 0.5, PW / 2 - 0.5]) {
      g.add(box(0.14, 0.14, 2.2, matRib, sx, y1 - 0.2, (DZ + 1.0) / 2 + 1.1));
    }
    // 本层高亮描边
    g.add(edge(WX + 1.0, T.H - 0.06, DZ + 1.0, 0, (y0 + y1) / 2, 0, 0xd9784f, 0.9));

    /* 本层标示带：远景下一层只有几个像素，靠这两条外挑橙带定位 */
    const matBand = new THREE.MeshBasicMaterial({ color: 0xd9531f, fog: false });
    g.add(box(WX + 3.4, 0.55, DZ + 3.4, matBand, 0, y0 + 0.26, 0));
    g.add(box(WX + 3.4, 0.55, DZ + 3.4, matBand, 0, y1 - 0.26, 0));

    /* ---- ③ 垂直运输核（南侧） ---- */
    const CORE_W = 5.6, CORE_D = 4.2, CORE_Z = DZ / 2 + CORE_D / 2 - 0.6;
    const core = box(CORE_W, T.top, CORE_D, matBody2, -4.5, T.top / 2, CORE_Z);
    core.castShadow = false; core.receiveShadow = false;
    g.add(core);
    // 楼梯间与电梯厅
    g.add(edge(CORE_W, T.top, CORE_D, -4.5, T.top / 2, CORE_Z, 0x8a8378, 0.22));
    g.add(box(CORE_W + 0.9, 0.5, CORE_D + 0.9, matRib, -4.5, T.top + 0.25, CORE_Z));   // 核顶

    /* ---- ④ 屋顶：女儿墙 + 电梯机房 + 水箱 ---- */
    const PAR = 1.2;
    for (const [w, d, x, z] of [
      [WX + 2.0, 0.5, 0, DZ / 2 + 0.75], [WX + 2.0, 0.5, 0, -DZ / 2 - 0.75],
      [0.5, DZ + 2.0, WX / 2 + 0.75, 0], [0.5, DZ + 2.0, -WX / 2 - 0.75, 0]
    ]) {
      g.add(box(w, PAR, d, matMy, x, T.top + PAR / 2, z));
    }
    g.add(edge(WX + 2.0, PAR, DZ + 2.0, 0, T.top + PAR / 2, 0, 0x8a8378, 0.25));
    g.add(box(6.4, 4.2, 5.0, matBody2, -4.5, T.top + 0.2 + 2.1, CORE_Z));              // 机房
    g.add(box(3.2, 2.6, 3.2, matRib, 5.5, T.top + 0.2 + 1.3, -4.0));                   // 消防水箱
    g.add(box(0.9, 5.0, 0.9, matRib, 7.0, T.top + 0.2 + 2.5, 3.0));                    // 天线柱

    /* ---- ⑤ 地面 / 场地 ---- */
    const groundTex = H3.mkTex(512, 512, (ctx, w, h) => {
      const grd = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, '#e9e5db');
      grd.addColorStop(0.55, '#ddd8cc');
      grd.addColorStop(1, '#cfc9bc');
      ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);
    });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(120, 72),
      new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    ground.visible = false;          /* 只有切到"整栋楼"视角才开，见 main.js setTower */
    g.add(ground);
    /* 这块 240 m 见方的地台挂在整栋楼的根组 g 上（不是 grp），
       setTower(false) 收的是 grp —— 所以在小区视角里它一直留在原点、
       y≈0（= 绝对 108 m，29F 楼板高度），把鸟瞰图右下角涂成一片白。 */
    g.userData.basePlate = ground;

    /* ---- ⑥ 高度标尺（东南侧，竖直面立在 z = 南边界外） ---- */
    const RX = WX / 2 + 5.0;
    const ruler = new THREE.Group();
    ruler.position.set(0, 0, DZ / 2 + 2.0);
    const rsegs = [];
    const rp = (a, b, c, d) => rsegs.push(a, b, 0, c, d, 0);
    rp(RX, 0, RX, T.top + 2);
    rp(RX - 0.9, 0, RX + 0.9, 0);                       // ±0.000
    for (let f = 0; f <= T.N; f += 5) {
      const y = f * T.H;
      const long = (f % 10 === 0);
      rp(RX - (long ? 1.1 : 0.6), y, RX, y);
      const lb = label(f + 'F', f === 0 ? '#9a9388' : '#6d675e', 2.2);
      if (lb) { lb.position.set(RX + 1.6, y, 0); ruler.add(lb); }
    }
    // 本层与总高加重
    rp(RX - 1.4, T.myTop, RX, T.myTop);
    rp(RX - 1.4, T.top, RX, T.top);
    const rgeo = new THREE.BufferGeometry();
    rgeo.setAttribute('position', new THREE.Float32BufferAttribute(rsegs, 3));
    ruler.add(new THREE.LineSegments(rgeo, new THREE.LineBasicMaterial({ color: 0x9a9388, transparent: true, opacity: 0.8 })));
    for (const [y, txt, col] of [
      [0, '±0.000', '#8d867b'],
      [T.myTop, '29F  +84.000', '#c2683a'],
      [T.top, '55F  +165.000', '#6d675e']
    ]) {
      const lb = label(txt, col, 4.6);
      if (lb) { lb.position.set(RX + 5.0, y + (y === 0 ? 1.0 : 0.9), 0); ruler.add(lb); }
    }
    /* 三档标高做实心刻度块，远景里也看得见 */
    const tickMat = new THREE.MeshBasicMaterial({ color: 0x8d867b, fog: false });
    const tickMatMy = new THREE.MeshBasicMaterial({ color: 0xc2683a, fog: false });
    ruler.add(box(1.1, 0.45, 0.45, tickMat, RX - 0.55, 0, 0));
    ruler.add(box(1.5, 0.55, 0.55, tickMatMy, RX - 0.75, T.myTop, 0));
    ruler.add(box(1.5, 0.55, 0.55, tickMat, RX - 0.75, T.top, 0));
    g.add(ruler);

    /* ---- ⑦ 本层视线引出线（东立面 → 标尺） ---- */
    {
      const sg = [
        (WX / 2 + 0.5) - CX, T.eye, (DZ / 2 + 2.0) - CZ, RX - CX, T.eye, (DZ / 2 + 2.0) - CZ,
        (WX / 2 + 0.5) - CX, T.myTop, (DZ / 2 + 2.0) - CZ, RX - CX, T.myTop, (DZ / 2 + 2.0) - CZ
      ];
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(sg, 3));
      const ln = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({
        color: 0xc2683a, dashSize: 0.9, gapSize: 0.6, transparent: true, opacity: 0.95
      }));
      ln.computeLineDistances();
      g.add(ln);
      const eyeLb = label('29F 视线  +85.5 m', '#c2683a', 4.2);
      if (eyeLb) { eyeLb.position.set(RX - CX + 1.0, T.eye - 0.9, (DZ / 2 + 2.0) - CZ); g.add(eyeLb); }
    }

    /* ---- ⑧ 本层标注 ---- */
    const myLb = label('我家 29F', '#c2683a', 3.4);
    if (myLb) {
      myLb.position.set(WX / 2 + 3.6 - CX, y0 + T.H / 2, -DZ / 2 - 1.8);
      g.add(myLb);
    }

    /* ---- ⑨ 天际线参考：周边 3 栋（示意，非实测；压到背景里不抢主体） ---- */
    const around = [
      [-64, 52, 18, 18, -62], [58, 66, 20, 16, -58], [18, 40, 16, 22, -96]
    ];
    for (const [x, hh, ww, dd, zz] of around) {
      const m = new THREE.MeshStandardMaterial({
        map: facadeTex(Math.max(4, Math.round(ww / 3)), Math.max(8, Math.round(hh / 12)), { a: '#e2ded4', b: '#cdc7ba' }),
        roughness: 0.9, transparent: true, opacity: 0.55
      });
      const b = box(ww, hh, dd, m, x - CX, hh / 2, zz);
      b.castShadow = false; b.receiveShadow = false;
      g.add(b);
    }

    // 全组不参与阴影计算，避免 165 m 体量把室内光吃掉
    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    T.grp = g;
    return g;
  }

  /* ---------------- 视野：地平线与最近可视地面 ---------------- */
  T.info = function () {
    const eye = T.eye;
    const flat = Math.sqrt(2 * 6371000 * eye) / 1000;           // km
    // 俯角 45° 时视线打到的地面距离
    const d45 = eye;
    // 俯角 30°
    const d30 = eye / Math.tan(30 * Math.PI / 180);
    return { eye, flat, d45, d30 };
  };


  /* ---------------- 立面楼层条（DOM） ---------------- */
  function buildStrip() {
    const el = document.getElementById('floorStrip');
    if (!el) return;
    const rows = [];
    for (let f = T.N; f >= 1; f--) {
      const cls = ['fr'];
      if (f === T.F) cls.push('me');
      else if (f > T.F) cls.push('up');
      else cls.push('dn');
      if (f % 5 === 0) cls.push('mark');
      rows.push('<div class="' + cls.join(' ') + '"><i>' + f + 'F</i><b></b></div>');
    }
    el.innerHTML = rows.join('');
  }

  H3.buildTowerStrip = buildStrip;

  H3.buildTower = buildTower;
})();
