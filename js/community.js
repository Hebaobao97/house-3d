/* ============================================================
   community.js —— 小区体量 + 7 号楼 + 南湖 + 园林

   依赖：site.js（H3.site）、materials.js（H3.mkTex）
   所有几何都在"世界坐标"：原点 = 7-2903 户平面中心，X 东、Z 南、Y 上。
   楼栋统一按 site.rotDeg 旋转（南立面朝 南偏西 15°）

   v2 变化：
     · 水面从矩形平面改成**按公示图岸线闭合的多边形**（S.lakePoly）
     · 草地改成"地块红线多边形"，不再压在水上
     · 楼栋按公示图逐块量测的坐标落位
   ============================================================ */
(function () {
  const H3 = (window.H3 = window.H3 || {});
  const S = H3.site;
  const P = H3.plan;

  const D2R = Math.PI / 180;
  const ROT = S.rotDeg * D2R;

  /* ---------------- 噪声（确定性） ---------------- */
  function rng(seed0) {
    let s = seed0;
    return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  }

  /* ---------------- 材质 ---------------- */

  function facadeTex(cols, rows, opt) {
    const o = opt || {};
    const a = o.a || '#e8e4da', b = o.b || '#cfc9bc', w = o.win || '#8fa8b8';
    return H3.mkTex(64 * cols, 64 * rows, (ctx, cw, chh) => {
      ctx.fillStyle = a; ctx.fillRect(0, 0, cw, chh);
      const cwid = cw / cols, rht = chh / rows;
      ctx.fillStyle = b;
      for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rht, cw, rht * 0.16);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * cwid + cwid * 0.16, y = r * rht + rht * 0.30;
          const ww = cwid * 0.68, wh = rht * 0.50;
          const g = ctx.createLinearGradient(x, y, x + ww, y + wh);
          g.addColorStop(0, w); g.addColorStop(1, o.win2 || '#b8cad6');
          ctx.fillStyle = g; ctx.fillRect(x, y, ww, wh);
          ctx.strokeStyle = 'rgba(70,70,64,0.35)'; ctx.lineWidth = 1.5;
          ctx.strokeRect(x, y, ww, wh);
          ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.stroke();
        }
      }
    });
  }

  const MAT = {};

  function initMats() {
    MAT.roof = new THREE.MeshStandardMaterial({ color: 0x9a938a, roughness: 0.85, envMapIntensity: 0.22 });
    MAT.podium = new THREE.MeshStandardMaterial({ color: 0xc4bdaf, roughness: 0.9, envMapIntensity: 0.24 });

    MAT.grass = new THREE.MeshStandardMaterial({
      map: H3.mkTex(512, 512, (ctx, w, h) => {
        ctx.fillStyle = '#7d9261'; ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) {
          const x = Math.random() * w, y = Math.random() * h;
          const v = Math.random();
          ctx.fillStyle = v > 0.6 ? 'rgba(120,142,92,0.55)' : 'rgba(96,116,74,0.5)';
          ctx.beginPath(); ctx.arc(x, y, 2 + Math.random() * 14, 0, 6.283); ctx.fill();
        }
      }, 22, 22),
      roughness: 1,
      /* ★ envMapIntensity 必须压低：场景 environment 是一张很亮的天空渐变，
         满强度打下来，7d9261 的草皮会渲成 #eceee4 的"白纸"。
         29F 往下看时它正好铺在近景湖面旁边，看上去像一块斜插进湖里的白板。 */
      envMapIntensity: 0.18
    });
    /* ★ 纯色材质在 2.6 的总光强下会被冲成白纸：0x8fa370 × 2.6 = (358,407,280)，全 clamp。
       草坪只能压到 0x687c4e 才在 ACES + exposure 0.92 下还剩下「草绿」。 */
    MAT.lawn = new THREE.MeshStandardMaterial({ color: 0x687c4e, roughness: 1, envMapIntensity: 0.14 });
    MAT.road = new THREE.MeshStandardMaterial({ color: 0x4b4a47, roughness: 0.95, envMapIntensity: 0.3 });
    MAT.path = new THREE.MeshStandardMaterial({ color: 0xb8b0a0, roughness: 0.95, envMapIntensity: 0.25 });
    /* 岸带：29F 往下看，它紧贴水面，过曝时会变成一条白边把湖"框"住 */
    MAT.shoreSand = new THREE.MeshStandardMaterial({ color: 0xa89f88, roughness: 0.95, envMapIntensity: 0.2 });

    MAT.tree = new THREE.MeshStandardMaterial({ color: 0x5d7548, roughness: 0.92, envMapIntensity: 0.2 });
    MAT.treeDark = new THREE.MeshStandardMaterial({ color: 0x4a5f38, roughness: 0.92, envMapIntensity: 0.2 });
    MAT.trunk = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 0.95 });

    MAT.tree.map = H3.mkTex(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#6b8250'; ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i++) {
        const v = Math.random();
        ctx.fillStyle = v > 0.5 ? 'rgba(84,104,60,0.55)' : 'rgba(126,148,92,0.45)';
        ctx.beginPath();
        ctx.arc(Math.random() * w, Math.random() * h, 2 + Math.random() * 9, 0, 6.283);
        ctx.fill();
      }
    }, 1, 1);
    MAT.treeDark.map = MAT.tree.map;

    /* 立面：高层 / 洋房 / 低层配套，各自一套贴图 */
    MAT.texTower = facadeTex(10, 40, { a: '#d2cbbf', b: '#b6ad9f', win: '#6d8aa1', win2: '#9db4c3' });
    MAT.texVilla = facadeTex(4, 4, { a: '#dcd4c7', b: '#c2b8a9', win: '#7993a4', win2: '#a6bcc9' });
    MAT.texLow = facadeTex(3, 2, { a: '#d2cab9', b: '#bcb3a1', win: '#829aa8' });

    /* ★★ three r137 + renderer.outputEncoding = sRGBEncoding 时，
       MeshStandardMaterial 的纯色 color 会被当成**线性值**直接使用，
       输出阶段再做一次 gamma（^1/2.2）—— 于是 0x8fa370 的草坪
       显示出来是 (200,215,180) 的"白纸"，纯色屋顶也全发白。
       带 map 的材质不受影响（贴图会被标成 sRGB 自动处理），
       所以出现了"有贴图的草地是绿的、纯色的草坪是白的"这种诡异对比。
       统一在末尾把纯色材质转成线性，颜色值就能按设计稿直接写。 */
    for (const k in MAT) {
      const m = MAT[k];
      if (m && m.isMeshStandardMaterial && m.color && !m.map) {
        m.color.convertSRGBToLinear();
      }
    }
  }

  /* ---------------- 工具 ---------------- */

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    return m;
  }

  /* 把 [x,z] 折线做成水平多边形几何（y 固定）。
     Shape 用的是二维 (x, y)，这里取 (x, z) 直接喂进 shape，
     再 rotateX(-90°) 把 shape 平面的 y 轴转到世界 −Z ——
     结果是几何形状与 (x,z) 一一对应，不用手工翻符号，也不会自交。 */
  function polyGeo(pts, y, uvScale) {
    /* ★ 坐标映射（实测，别再推）：
         shape.xy = (x, z)；ShapeGeometry 的 (px,py) → 三维 (px, py, 0)；
         rotateX(−90°) 把 +Y 转到 −Z，所以 (x, z) 必须喂成 (x, −z)。
       绕向：喂完之后必须是**逆时针**，rotateX(−90°) 后法线才是 +Y。
       纠正绕向只能**倒序点序**，绝不能 scale(1,-1,1)：那等于 z 全镜像，
       实测湖面被搬到了地块北边去。 */
    const p = pts.map(q => [q[0], -q[1]]);
    if (THREE.ShapeUtils.isClockWise(p)) p.reverse();
    const shape = new THREE.Shape();
    p.forEach((q, i) => {
      if (i === 0) shape.moveTo(q[0], q[1]);
      else shape.lineTo(q[0], q[1]);
    });
    shape.closePath();
    const g = new THREE.ShapeGeometry(shape, 1);
    g.rotateX(-Math.PI / 2);
    g.translate(0, y, 0);
    /* ★ UV 重算：ShapeGeometry 的 uv 直接取顶点坐标（世界米数 ÷ 1），
       在 200 m 尺度的地块上 uv 会跑到 200 以上。贴图有 22×22 次重复，
       采样点被甩到远处只剩一片平色（看起来就是「整块草地纯白」）；
       水面/道路同理。这里按 uvScale（m 每贴图周期）重铺，取模保住 0–1。 */
    if (uvScale) {
      const pa = g.attributes.position, uv = g.attributes.uv;
      for (let i = 0; i < pa.count; i++) {
        uv.setXY(i,
          ((pa.getX(i) / uvScale) % 1 + 1) % 1,
          ((pa.getZ(i) / uvScale) % 1 + 1) % 1);
      }
      uv.needsUpdate = true;
    }
    g.computeVertexNormals();
    return g;
  }

  /* 一栋楼体量。返回 Group（已定位、已旋转） */
  function slabBuilding(o) {
    const fh = o.floorH || 3.0;
    const H = o.floors * fh + (o.podium ? o.podium : 0);
    const g = new THREE.Group();
    g.position.set(o.x, 0, o.z);
    /* ★ 每栋自带朝向：塔楼沿东界斜列（rotDeg 69.3），洋房正交（0）。
       以前统一用全局 ROT，洋房也被拧了 15°，跟公示图一对比整片歪掉。 */
    g.rotation.y = -((o.rot === undefined ? S.rotDeg : o.rot) * D2R);

    let y0 = 0;
    if (o.podium) {
      g.add(box(o.w + 1.6, o.podium, o.d + 1.6, MAT.podium, 0, o.podium / 2, 0));
      y0 = o.podium;
    }

    const texHost = o.type === 'villa' ? MAT.texVilla : (o.type === 'low' ? MAT.texLow : MAT.texTower);
    const bodyMat = new THREE.MeshStandardMaterial({
      map: texHost, roughness: o.type === 'villa' ? 0.9 : 0.87, envMapIntensity: 0.3
    });
    g.add(box(o.w, H - y0, o.d, bodyMat, 0, y0 + (H - y0) / 2, 0));
    g.add(box(o.w + 0.7, 0.5, o.d + 0.7, MAT.roof, 0, H + 0.25, 0));

    if (o.floors >= 30) {
      g.add(box(o.w * 0.42, 2.6, o.d * 0.42, MAT.roof, 0, H + 1.6, 0));
    } else if (o.type === 'villa') {
      /* 洋房：深色坡屋顶（公示图上能看出深色屋脊），用四坡锥 */
      const r = new THREE.Mesh(
        new THREE.ConeGeometry(0.72, 1, 4),
        new THREE.MeshStandardMaterial({ color: 0x7d5a4c, roughness: 0.92 })
      );
      r.rotation.y = Math.PI / 4;
      /* ★ ConeGeometry(0.72,1,4) 的底半径是 0.72，要让它正好盖住楼宽 w：
         radius × scale × 2 = w  →  scale = w / 1.44 = w × 0.694。
         写成 w*1.02 时锥底直径是楼宽的 1.47 倍，屋檐会伸出去一大圈。 */
      r.scale.set(o.w * 0.694, 3.2, o.d * 0.694);
      r.position.y = H + 1.6;
      g.add(r);
    }

    g.userData = { h: H, floors: o.floors, id: o.id };
    return g;
  }

  /* ---------------- ① 地面：地块红线内 ---------------- */
  function buildGround(g) {
    /* 草地只铺在地块红线内，湖面区域自然空出来 */
    const ground = new THREE.Mesh(polyGeo(S.boundary, -0.02, 18), MAT.grass);
    ground.receiveShadow = false;
    g.add(ground);
    H3.groundMeshes = [ground];

    /* ---- 远处大地：一整块实心方片 ----
       ★★ 位置必须**低于湖底**（湖面 −5、湖底 −6.2，这里取 −8）。
         之前放在 −0.4 时，这块 18 km 的绿毯正好盖在水面之上 ——
         从 29F 往外看整个南湖被一块"灰白地面"顶掉，只剩一片牛奶色，
         而材质、法线、雾全是好的，排查了半天才发现是遮挡问题。
       地块草地 (S.boundary) 与湖面 (S.lakePoly) 各自盖在它上面。

       ★★ 半径必须**小于**湖面外缘（S.lakePoly 的扇形半径 16000）。
         原来是 9000，结果是 9 km 以外的远方陆地整块消失，29F 朝西南看
         水面尽头直接接上天空球，肉眼可见一条"海天硬分界"。
         改成 26000 后，远端陆地一直铺到雾里，边界被雾吃掉。 */
    const R = 26000;
    /* ★ 顶点顺序必须自己给成"sh.xy 平面上顺时针"：
       ShapeGeometry 的 (px,py) → (px,py,0)，rotateX(−90°) 把 +Y 送到 −Z。
       sh.xy 逆时针 → 法线朝 +Y → 转完就朝 −Z，整块地面变成一堵竖墙
       （实测包围盒 y 从 −92 跨到 9000，画面里"地面消失、只剩天空"）。
       所以这里**不要**去纠 shape 的绕向，而是倒着写这 4 个点。 */
    const sh = new THREE.Shape();
    sh.moveTo(-R, -R); sh.lineTo(-R, R); sh.lineTo(R, R); sh.lineTo(R, -R); sh.closePath();
    const farGeo = new THREE.ShapeGeometry(sh);
    farGeo.rotateX(-Math.PI / 2);
    /* 远处大地：颜色压深、envMapIntensity 压低。
       场景 environment 是一张很亮的天空渐变，standard 材质在它下面
       会同被顶到接近纯白（实测 0x8b9070 渲出来是 #eceee4），
       于是湖外那一圈陆地变成"白纸"，比水面还抢眼。 */
    const far = new THREE.Mesh(farGeo,
      new THREE.MeshStandardMaterial({
        color: 0x515c42, roughness: 1, metalness: 0, envMapIntensity: 0.25
      }));
    far.position.y = -8;
    g.add(far);
    return ground;
  }

  /* ---------------- ② 南湖：按真实岸线的多边形水面 ---------------- */
  function buildLake(g) {
    const waveTex = H3.mkTex(512, 512, (ctx, w, h) => {
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const v = 128
            + 40 * Math.sin((x * 0.13 + y * 0.05) + Math.sin(y * 0.031) * 3)
            + 30 * Math.sin((x * 0.047 - y * 0.11) + Math.cos(x * 0.017) * 2.5)
            + 18 * Math.sin((x * 0.29 + y * 0.23));
          const i = (y * w + x) * 4;
          img.data[i] = 128; img.data[i + 1] = 128; img.data[i + 2] = v; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    }, 60, 60);

    const waterY = S.lakeAbs - S.groundAbs;    // 湖面相对小区地面（−5 m）

    /* 水面 */
    const water = new THREE.Mesh(
      polyGeo(S.lakePoly, waterY),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x6fa8bd).convertSRGBToLinear(),
        roughness: 0.46,
        metalness: 0.0,
        envMapIntensity: 0.22,      /* 场景 environment 是一张很亮的天空渐变，
                                       满强度打在水面上会把南湖照成一锅牛奶 */
        normalMap: waveTex,
        normalScale: new THREE.Vector2(0.10, 0.10),
        transparent: true,
        opacity: 0.97
      })
    );
    water.receiveShadow = false;
    g.add(water);
    H3.water = water;

    /* 湖水底面（比水面低 1.2 m）。颜色要深：水面 opacity 0.97 近乎不透明，
       底色只负责透出来一点点，太浅会让整湖发灰发白 */
    const bed = new THREE.Mesh(polyGeo(S.lakePoly, waterY - 1.2),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(0x4a7c8c).convertSRGBToLinear(), roughness: 1 }));
    bed.receiveShadow = false;
    g.add(bed);

    /* 岸线：沿 S.shoreline 铺一条 6 m 宽的硬质滨湖步道（只在小区这一侧，
       因为只有这一段是量出来的真实岸线；其余是示意）。
       ★ 红线已在岸线内 10 m，步道只能取 6 m，否则会顶到绿化带外面去。 */
    const sh = S.shoreline;
    const bandW = 6;
    const pos = [], idx = [];
    for (let i = 0; i < sh.length; i++) {
      const a = sh[Math.max(0, i - 1)], b = sh[Math.min(sh.length - 1, i + 1)];
      const tx = b[0] - a[0], tz = b[1] - a[1];
      const L = Math.hypot(tx, tz) || 1;
      /* 指向地块内的法线 = shoreFrame.n 取反（shoreFrame.n 已验算指向水侧） */
      const nx = tz / L, nz = -tx / L;
      pos.push(sh[i][0], 0.05, sh[i][1]);
      pos.push(sh[i][0] + nx * bandW, 0.05, sh[i][1] + nz * bandW);
    }
    for (let i = 0; i < sh.length - 1; i++) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    bg.setIndex(idx);
    bg.computeVertexNormals();
    const band = new THREE.Mesh(bg, MAT.shoreSand);
    band.receiveShadow = false;
    g.add(band);

    return water;
  }

  /* ---------------- ③ 道路 ---------------- */
  function buildRoads(g) {
    for (const rd of S.roads) {
      const pts = rd.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
        const len = Math.hypot(x2 - x1, z2 - z1);
        const ang = Math.atan2(z2 - z1, x2 - x1);
        const m = box(len, 0.16, rd.w, MAT.road, (x1 + x2) / 2, 0.06, (z1 + z2) / 2);
        m.rotation.y = -ang;
        g.add(m);
      }
      /* 路口补圆角，免得直角豁口 */
      for (const p of pts) {
        const c = new THREE.Mesh(new THREE.CircleGeometry(rd.w / 2, 10), MAT.road);
        c.rotation.x = -Math.PI / 2;
        c.position.set(p[0], 0.06, p[1]);
        g.add(c);
      }
    }
  }

  /* ---------------- ④ 园林 ---------------- */

  function inPoly(x, z, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
      if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) c = !c;
    }
    return c;
  }

  function segDist(x, z, x1, z1, x2, z2) {
    const dx = x2 - x1, dz = z2 - z1;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
    return Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t));
  }

  function buildGreenery(g) {
    const crownGeo = new THREE.IcosahedronGeometry(1, 1);
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1, 6);
    const COUNT = 980;
    const crowns = new THREE.InstancedMesh(crownGeo, MAT.tree, COUNT);
    const crowns2 = new THREE.InstancedMesh(crownGeo, MAT.treeDark, COUNT);
    const trunks = new THREE.InstancedMesh(trunkGeo, MAT.trunk, COUNT);
    const dummy = new THREE.Object3D();
    const rnd = rng(20240919);

    /* 采样范围：地块外接框 */
    const xs = S.boundary.map(p => p[0]), zs = S.boundary.map(p => p[1]);
    const x0 = Math.min(...xs) - 10, x1 = Math.max(...xs) + 6;
    const z0 = Math.min(...zs) - 10, z1 = Math.max(...zs) + 6;

    let n = 0, n2 = 0, nt = 0, guard = 0;
    while (n + n2 < COUNT && guard < 30000) {
      guard++;
      const x = x0 + rnd() * (x1 - x0);
      const z = z0 + rnd() * (z1 - z0);
      if (!inPoly(x, z, S.boundary)) continue;                       // 必须在地块内
      if (x * x + z * z < 441) continue;                              // 让开 7# 本体（外接圆 21 m）

      let bad = false;
      for (const b of S.buildings) {                                  // 让开楼栋
        if (b[0] === '7#') continue;
        const dx = x - b[1], dz = z - b[2];
        /* 塔楼斜列（69.3°）、洋房正交（0）—— 逐栋取朝向，不能再用全局 ROT */
        const th = b[6] * D2R;
        const c = Math.cos(th), s = Math.sin(th);
        const lx = dx * c + dz * s, lz = -dx * s + dz * c;
        if (Math.abs(lx) < b[3] / 2 + 5 && Math.abs(lz) < b[4] / 2 + 5) { bad = true; break; }
      }
      if (!bad) for (const rd of S.roads) {                           // 让开道路
        for (let i = 0; i < rd.pts.length - 1; i++) {
          const a = rd.pts[i], b = rd.pts[i + 1];
          if (segDist(x, z, a[0], a[1], b[0], b[1]) < rd.w / 2 + 3) { bad = true; break; }
        }
        if (bad) break;
      }
      if (!bad) {                                                     // 让开湖岸
        for (let i = 0; i < S.shoreline.length - 1; i++) {
          const a = S.shoreline[i], b = S.shoreline[i + 1];
          if (segDist(x, z, a[0], a[1], b[0], b[1]) < 16) { bad = true; break; }
        }
      }
      if (bad) continue;

      const s = 1.8 + rnd() * 1.7;
      dummy.position.set(x, s * 1.25, z);
      dummy.scale.set(s, s * (0.85 + rnd() * 0.4), s);
      dummy.rotation.y = rnd() * 6.283;
      dummy.updateMatrix();
      if (rnd() > 0.45) crowns.setMatrixAt(n++, dummy.matrix);
      else crowns2.setMatrixAt(n2++, dummy.matrix);

      dummy.position.set(x, s * 0.55, z);
      dummy.scale.set(1, s * 1.1, 1);
      dummy.rotation.y = 0;
      dummy.updateMatrix();
      trunks.setMatrixAt(nt++, dummy.matrix);
    }
    crowns.count = n; crowns2.count = n2; trunks.count = nt;
    crowns.instanceMatrix.needsUpdate = true;
    crowns2.instanceMatrix.needsUpdate = true;
    trunks.instanceMatrix.needsUpdate = true;
    g.add(crowns); g.add(crowns2); g.add(trunks);
    H3.treeCount = n + n2;

    /* 中央大草坪 —— 7# 正南的景观带
       ★ v7：原点再次西移（790,322 → 770,330），而且楼栋全部重排。这里干脆
         不再用 DX/DZ 平移，直接把草坪/园路写成**世界坐标**：草坪落在
         7# 南面 z 32–172、x −62–74 这块唯一的空地里 —— 东侧要给 13#
         （世界 x 41–80，z 114–128）让开，所以东半部只铺到 z≈100。 */
    const lawnPts = [[-55, 42], [-20, 34], [18, 32], [52, 38], [74, 68],
                     [68, 100], [30, 104], [26, 168], [-18, 172],
                     [-58, 152], [-68, 100], [-64, 68]];
    const lawn = new THREE.Mesh(polyGeo(lawnPts, 0.02), MAT.lawn);
    g.add(lawn);

    /* 草坪斑块 */
    const patchMat = new THREE.MeshStandardMaterial({ color: 0x6f8557, roughness: 1 });
    const r2 = rng(881);
    for (let i = 0; i < 24; i++) {
      const x = x0 + r2() * (x1 - x0), z = z0 + r2() * (z1 - z0);
      if (!inPoly(x, z, S.boundary)) continue;
      const w = 18 + r2() * 34, d = 12 + r2() * 22;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), patchMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = r2() * 3.14;
      m.position.set(x, 0.01, z);
      g.add(m);
    }

    /* 园路：从 7# 南门出发，串起中央草坪与洋房组团 */
    const paths = [
      [[-10, 15], [-6, 55], [-4, 95], [-6, 140], [2, 170]],
      [[-50, 60], [-52, 100], [-48, 145]],
      [[-4, 95], [-20, 98], [-40, 102]],
      [[0, 150], [-18, 155], [-36, 152]]
    ];
    for (const pl of paths) {
      const curve = new THREE.CatmullRomCurve3(pl.map(p => new THREE.Vector3(p[0], 0.03, p[1])));
      const geo = new THREE.TubeGeometry(curve, 44, 1.5, 6, false);
      const m = new THREE.Mesh(geo, MAT.path);
      m.scale.y = 0.06;
      m.position.y = 0.02;
      g.add(m);
    }
  }

  /* ---------------- ⑤ 7 号楼（本楼，精建） ---------------- */
  function buildMyTower(g) {
    const T = new THREE.Group();
    T.rotation.y = -ROT;

    const W = S.towerFootW, D = S.towerFootD, H = S.top;

    const tex = facadeTex(12, Math.round(S.N), { a: '#e3ded2', b: '#c6bfb0', win: '#7f9db0', win2: '#a8c2d0' });
    const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.86 });
    T.add(box(W, H, D, bodyMat, 0, H / 2, 0));

    const PAR = 1.3;
    T.add(box(W + 1.2, PAR, D + 1.2, MAT.roof, 0, H + PAR / 2, 0));
    T.add(box(W * 0.35, 4.6, D * 0.4, MAT.podium, -W * 0.12, H + 2.3, 0));

    const y0 = S.myTop, y1 = S.myRoof;
    const ux = S.unitOffsetX;
    const bandMat = new THREE.MeshBasicMaterial({ color: 0xc4552a, fog: false });
    T.add(box(S.unitW + 1.2, 0.34, D + 0.5, bandMat, ux, y0 + 0.18, 0));
    T.add(box(S.unitW + 1.2, 0.34, D + 0.5, bandMat, ux, y1 - 0.18, 0));

    T.add(box(W + 0.8, 0.16, D + 0.8, MAT.podium, 0, y0 + 0.06, 0));
    T.add(box(W + 0.8, 0.16, D + 0.8, MAT.podium, 0, y1 - 0.06, 0));

    const balMat = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x9fc0d6, roughness: 0.1, metalness: 0.3, transparent: true, opacity: 0.35
    });
    /* 南向阳台：每户一个，贴在局部 −Z 面（旋转后朝 南偏西 195°，正对湖） */
    for (let i = 0; i < S.units.length; i++) {
      const cx = S.unitOffsetX + (i - 1) * S.unitW;
      const bz = -D / 2 - 0.65;
      T.add(box(S.unitW * 0.72, 0.16, 1.3, balMat, cx, y0 + 0.08, bz));
      T.add(box(S.unitW * 0.72, 1.05, 0.05, glassMat, cx, y0 + 0.62, bz - 0.62));
      T.add(box(0.05, 1.05, 1.3, glassMat, cx - S.unitW * 0.36, y0 + 0.62, bz));
      T.add(box(0.05, 1.05, 1.3, glassMat, cx + S.unitW * 0.36, y0 + 0.62, bz));
    }

    /* 北侧公共连廊（局部 +Z，旋转后朝 北偏东 15°） */
    const corrZ = D / 2 + 1.4;
    const corrMat = new THREE.MeshStandardMaterial({ color: 0xd9d3c6, roughness: 0.9 });
    for (let i = 0; i < S.units.length; i++) {
      const cx = S.unitOffsetX + (i - 1) * S.unitW;
      T.add(box(S.unitW - 0.2, 0.14, 2.6, corrMat, cx, y0 + 0.02, corrZ));
      T.add(box(S.unitW - 0.2, 1.15, 0.07, glassMat, cx, y0 + 0.6, corrZ + 1.25));
    }

    g.add(T);
    H3.myTowerGroup = T;
    return T;
  }

  /* ---------------- ⑥ 周边楼栋 ----------------
     ★ v7：层高/架空层统一从 site.js 取（S.floorH / S.podium），
       这样"楼高 = 层数×层高 + 架空"只有一处定义：
         高层 3.00+4.0 → 55F 169 m（公开 169.55）、39F 121 m（公开 119）、
                         42F 130 m（公开 128）
         洋房/叠墅 3.10 → 8F 24.8 m、6F 18.6 m、4F 12.4 m */
  function buildBuildings(g) {
    let n = 0;
    for (const b of S.buildings) {
      const [id, x, z, w, d, floors, rot, type] = b;
      if (id === '7#') continue;                 // 7# 由 buildMyTower 精建
      g.add(slabBuilding({
        id: id, x: x, z: z, w: w, d: d, floors: floors, type: type, rot: rot,
        floorH: type === 'villa' ? S.floorH.villa : S.floorH.tower,
        podium: floors >= 30 ? S.podium : 0
      }));
      n++;
    }
    H3.buildingCount = n + 1;
  }

  /* ---------------- 主入口 ---------------- */
  function buildCommunity(scene) {
    initMats();
    const g = new THREE.Group();
    g.name = 'community';

    buildGround(g);
    buildLake(g);
    buildRoads(g);
    buildGreenery(g);
    buildBuildings(g);
    buildMyTower(g);

    g.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

    scene.add(g);
    H3.community = g;
    return g;
  }

  H3.buildCommunity = buildCommunity;
  H3.cmFacadeTex = facadeTex;
})();
