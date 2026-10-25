/* ============================================================
   main.js —— 渲染 / 交互 / UI
   ============================================================ */
(function () {
  const H3 = window.H3;
  const P = H3.plan, M = H3.mat;

  /* ---------------- 基础三件套 ---------------- */
  const canvas = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();

  /* 环境反射（渐变天空） */
  (function () {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, '#eaf1f7');
    g.addColorStop(0.48, '#f6f2ea');
    g.addColorStop(0.52, '#e2ddd2');
    g.addColorStop(1, '#cfcac0');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
  })();

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 40000);
  camera.position.set(9.8, 15.2, 12.6);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.target.set(-0.2, 0.3, -0.2);
  controls.minDistance = 2.2;
  controls.maxDistance = 62;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.screenSpacePanning = false;
  controls.zoomSpeed = 0.85;

  /* ---------------- 楼宇参数（层高/层数/本户楼层） ---------------- */
  const TW = H3.tower;

  /* ---------------- 场景 ---------------- */
  H3.build(scene);
  /* ★ v4 关键修复：户型组必须跟着 7# 转。
     户型与墙体是按 DXF 的轴对齐坐标建的（局部 −Z = 客厅大窗那一侧），
     而小区里的 7# 楼体是 rotation.y = −rotDeg 摆的。之前没人给这一组装
     转角，于是户型"反着装"在楼里 —— 客厅窗朝向小区北侧，
     隔着 30 m 就是 6# 的山墙，窗外永远是一面幕墙。
     这里按同一个 rotDeg 转一次，让 az() 里那套"局部法向 → 世界方位"
     的换算真正成立（局部 −Z → 方位 195° = 南偏西 15° = 正对南湖）。 */
  H3.GROUPS.root.rotation.y = -H3.site.rotDeg * Math.PI / 180;
  /* 点光源是按户型局部坐标（0…9.2 / 0…11.5）写的，必须挂在只做居中的 pivot 上，
     挂 root 的话会再被旋转一次、整体甩出房间。 */
  const LIGHTS = H3.buildLights(scene, H3.GROUPS.pivot || H3.GROUPS.root);
  H3.LIGHTS = LIGHTS;

  /* ---------------- 小区世界：天空 / 南湖 / 园林 / 周边楼栋 ---------------- */
  /* 户型的"0 标高"是 29F 楼板面 = 绝对 84.00 m（黄海高程）。
     要往下放 84 m 才能落在小区地面上。整组包在"世界容器"里统一沉降。
     ★★ 这个位移必须等于 site.js 的 myTop（84），**不是** myAbs（108）。
        写成 myAbs 时整片小区会被压到地下 24 m —— 从 29F 望出去，
         湖面是一块盖到窗户上沿的青色板，草地只剩一条细边。 */
  const worldG = new THREE.Group();
  worldG.name = 'world';
  worldG.position.y = -H3.site.myTop;
  scene.add(worldG);

  H3.views.buildSky(scene, { top: '#4e83bd', hor: '#cdd9e3', ground: '#b6b0a2' });
  H3.buildCommunity(worldG);
  H3.views.buildSkyline(worldG);
  H3.views.setVisibility(scene, 'clear');

  /* 小区世界常驻可见：室内漫游时从窗里看出去就是它。
     只有切到"整栋 55F"（tower.js 自带一套完整的楼体）时才需要收掉，
     否则两套 7 号楼会重叠打架。 */
  let worldOn = true;
  function setWorld(on) {
    worldOn = on;
    worldG.visible = on;
    H3.worldOn = on;
    /* 户型导览那 46 m 场地圆盘：小区在的时候必须收掉，否则盖住草地 */
    if (H3.ground) H3.ground.visible = !on;
  }
  H3.setWorld = setWorld;
  setWorld(true);
  /* 小区世界在，轨道最远距离必须放开到能看全地块 */
  controls.maxDistance = 1200;

  /* 收集全部材质，用于昼夜环境光强度切换 */
  const allMats = [];
  (function () {
    const seen = new Set();
    H3.GROUPS.root.traverse(o => {
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach(m => {
        if (!m || seen.has(m.uuid)) return;
        seen.add(m.uuid);
        if (m.envMapIntensity === undefined) m.envMapIntensity = 1;
        allMats.push(m);
      });
    });
  })();
  const baseEnv = allMats.map(m => m.envMapIntensity);
  function setEnvFactor(f) {
    allMats.forEach((m, i) => { m.envMapIntensity = baseEnv[i] * f; });
  }

  /* 小区世界的材质（夜间要一起压暗；湖水另算） */
  const worldMats = [];
  (function () {
    const seen = new Set();
    worldG.traverse(o => {
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      arr.forEach(m => {
        if (!m || seen.has(m.uuid)) return;
        if (m === (H3.water && H3.water.material)) return;   // 水面单独调色
        seen.add(m.uuid);
        const c = m.color ? m.color.getHex() : 0xffffff;
        worldMats.push({ m: m, hex: c });
      });
    });
  })();
  function setWorldNight(on) {
    for (const w of worldMats) {
      if (!w.m.color) continue;
      w.m.color.setHex(on ? 0x2f3742 : w.hex);
    }
    if (H3.water && H3.water.material) {
      /* 必须和 community.js 里的日景参数一致，否则切一次夜景再切回来，
         水面就会带着 44646f/0.42 的老参数 —— 那套参数在明亮 environment 下
         会把整个南湖渲染成一片惨白 */
      H3.water.material.color.setHex(on ? 0x22323b : 0x6fa8bd);
      H3.water.material.metalness = on ? 0.62 : 0.0;
    }
    if (H3.skyline) {
      H3.skyline.children.forEach(b => {
        if (b.material && b.material.color) b.material.color.setHex(on ? 0x2a323a : (b.material.userData.day || 0x9aa7ae));
      });
    }
  }

  /* ---------------- 楼宇开关 ---------------- */
  let towerOn = false;
  H3.buildTower(scene);
  if (TW.grp) TW.grp.visible = false;
  if (H3.buildTowerStrip) H3.buildTowerStrip();

  function setTower(on) {
    towerOn = on;
    if (TW.grp) TW.grp.visible = on;
    /* 三套"7 号楼"表达方式，同一时刻只能出现一套：
       ① 户型精装（GROUPS.root，原点在本层楼板面）
       ② tower.js 的整栋 165 m 楼体（整栋 55F / 本层 29F 视角用）
       ③ community.js 的真实楼栋群 + 南湖（小区 / 漫游用）
       ② 和 ③ 都占着原点 0~165 m 的空间，① 正好嵌在其中，
       三者叠在一起就会互相穿帮、深度打架。 */
    if (H3.GROUPS.root) H3.GROUPS.root.visible = !on;
    setWorld(!on);
    /* 楼层条只在楼宇视角下出现，普通室内/俯瞰视角保持界面干净 */
    const fb = document.getElementById('floorsBox');
    if (fb) fb.classList.toggle('on', !!on);
    /* 整栋 165 m 体量在，室内就没法看了：自动开剖切 + 关天花 */
    if (on) {
      if (!cutOn) { setCut(true); const c = document.getElementById('tCut'); if (c) c.checked = true; }
      if (H3.ground) H3.ground.visible = false;
      if (TW.grp && TW.grp.parent && TW.grp.parent.userData.basePlate) {
        TW.grp.parent.userData.basePlate.visible = true;
      }
      renderer.toneMappingExposure = 1.0;
      /* 楼宇视角需要拉远到 300 m 以上，放开轨道限制 */
      controls.maxDistance = 900;
      controls.maxPolarAngle = Math.PI * 0.9;
    } else {
      if (H3.ground) H3.ground.visible = false;   // 小区接管地面
      /* 整栋楼的 240 m 地台也要一起收（见 tower.js 的 basePlate 注释） */
      if (TW.grp && TW.grp.parent && TW.grp.parent.userData.basePlate) {
        TW.grp.parent.userData.basePlate.visible = false;
      }
      renderer.toneMappingExposure = 0.78;
      controls.maxDistance = 1200;
      controls.maxPolarAngle = Math.PI * 0.495;
    }
    if (H3.syncMyTower) H3.syncMyTower();
  }
  H3.setTower = setTower;

  /* ---------------- 尺寸 ---------------- */
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ---------------- 剖切 ---------------- */
  /* 窗外景模式下剖切面会临时抬到 2.30 m（见 setOutMode），
     这里给新开剖切的场景一个"标准值"，避免继承残留的高位 */
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.38);
  let cutOn = false;
  function setCut(on) {
    cutOn = on;
    if (!on) cutPlane.constant = 1.38;
    H3.wallMats.forEach(m => {
      m.clippingPlanes = on ? [cutPlane] : null;
      m.needsUpdate = true;
    });
    H3.GROUPS.ceiling.visible = on ? false : ceilOn;
    if (on) { document.body.classList.add('cut'); } else { document.body.classList.remove('cut'); }
  }

  /* ---------------- 标签 ---------------- */
  const labelLayer = document.getElementById('labels');
  const labels = [];
  P.rooms.forEach(r => {
    const el = document.createElement('div');
    el.className = 'room-label';
    el.innerHTML = '<span class="dot"></span><b>' + r.name + '</b><i>' + r.area.toFixed(1) + '㎡</i>';
    labelLayer.appendChild(el);
    labels.push({
      el, id: r.id,
      pos: new THREE.Vector3((r.x1 + r.x2) / 2 - P.cx, 1.35, (r.z1 + r.z2) / 2 - P.cz)
    });
  });

  let labelsOn = true;
  const _v = new THREE.Vector3();
  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    for (const L of labels) {
      if (!labelsOn) { L.el.style.display = 'none'; continue; }
      _v.copy(L.pos).project(camera);
      const visible = _v.z < 1 && Math.abs(_v.x) < 1.15 && Math.abs(_v.y) < 1.15;
      if (!visible) { L.el.style.display = 'none'; continue; }
      L.el.style.display = 'flex';
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      const dist = camera.position.distanceTo(L.pos);
      const fade = Math.max(0, Math.min(1, (dist - 3) / 5));
      L.el.style.transform = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px)';
      L.el.style.opacity = 0.35 + 0.65 * fade;
      L.el.style.zIndex = Math.round(1000 - dist * 10);
    }
  }

  /* ---------------- 小区标签（楼栋号 / 南湖 / 本户） ---------------- */
  /* 只在镜头拉远到小区尺度时出现：近到能看清墙的时候满屏楼号是噪点 */
  const cmLabels = [];
  (function () {
    const add = (txt, x, z, y, cls, sub) => {
      const el = document.createElement('div');
      el.className = 'cm-label' + (cls ? ' ' + cls : '');
      el.innerHTML = '<b>' + txt + '</b>' + (sub ? '<i>' + sub + '</i>' : '');
      el.style.display = 'none';
      labelLayer.appendChild(el);
      cmLabels.push({ el: el, pos: new THREE.Vector3(x, y, z) });
    };
    /* 周边楼栋：标签放在楼体上方 6 m，俯视时不压住立面。
       ★ y 用"户内标高"：世界容器整体下沉 myTop，所以 y = 楼高 − myTop
       ★ 房子越多越碍眼：只给 400 m 内的楼、且只给高层挂编号 */
    for (const b of H3.site.buildings) {
      const [id, x, z, bw, bd, fl, rot, type] = b;
      if (id === '7#') continue;
      const hh = fl * (type === 'villa' ? 3.1 : 3.0) + (fl >= 30 ? 4 : 0);
      if (Math.hypot(x, z) > 420) continue;
      if (fl < 10) continue;
      add(id, x, z, hh - H3.site.myTop + 6, 'b');
    }
    /* 我家：单独立一个高亮标签，卡在 29F 楼板之上、约 100 m 高处，
       既在大楼面上看得见，又不会糊在别家楼顶上 */
    add('我家 7-2903', 0, 0, -H3.site.myTop + 96, 'me', '29F · 111 ㎡ · 03 户');
    /* 南湖：贴在湖面 +4 m（湖心大致在小区西南 1.5 km） */
    /* ★ 用 lakeLabel（沿岸线中点法向推出来的），不是 lake.cx/cz —— 那两个字段
       早在 site.js 重写时就不存在了，这里曾抛 TypeError 直接把整个 main.js 打断，
       表现是画面白屏、H3.dbg 根本没挂上。 */
    add('南 湖', H3.site.lakeLabel[0], H3.site.lakeLabel[1],
      H3.site.lakeAbs - H3.site.groundAbs + 4, 'lake',
      '岸线距本楼约 ' + H3.site.shoreDist + ' m');
    H3.cmLabels = cmLabels;
  })();

  function updateCmLabels() {
    /* 判定"小区尺度"：相机离地超过 120 m，或离本楼水平距离超过 150 m。
       相机 y 已经活在同一套"户内标高"里（0 = 29F 楼板面 = 绝对 108），
       所以直接比，不要再加 myTop。 */
    const alt = camera.position.y;
    const horiz = Math.hypot(camera.position.x, camera.position.z);
    const big = alt > 120 || horiz > 150;
    for (const L of cmLabels) {
      if (!big || walk.on || towerOn || !worldOn) { L.el.style.display = 'none'; continue; }
      _v.copy(L.pos).project(camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.02 || Math.abs(_v.y) > 1.02) { L.el.style.display = 'none'; continue; }
      L.el.style.display = 'flex';
      const x = (_v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      const d = camera.position.distanceTo(L.pos);
      L.el.style.transform = 'translate(-50%,-50%) translate(' + x + 'px,' + y + 'px)';
      L.el.style.opacity = Math.max(0.12, Math.min(1, 1 - (d - 60) / 900));
      L.el.style.zIndex = Math.round(900 - d * 0.2);
    }
  }

  /* ---------------- 相机动画 ---------------- */
  const anim = { t: 0, dur: 0, from: new THREE.Vector3(), to: new THREE.Vector3(), ft: new THREE.Vector3(), tt: new THREE.Vector3(), on: false };
  function flyTo(pos, target, dur) {
    anim.from.copy(camera.position);
    anim.to.copy(pos);
    anim.ft.copy(controls.target);
    anim.tt.copy(target);
    anim.t = 0;
    anim.dur = dur || 0.85;
    anim.on = true;
  }
  function apply(pos, target, instant, fov) {
    /* 轨道控制器有 maxDistance，切到小区级视角前必须先放开，
       否则相机会被硬拉回 62 m 内（这正是"看着不像小区"的原因） */
    const need = pos.distanceTo(target);
    if (need + 5 > controls.maxDistance) controls.maxDistance = need * 1.6 + 60;
    if (pos.y > 60 && controls.maxPolarAngle < Math.PI * 0.6) controls.maxPolarAngle = Math.PI * 0.88;
    if (fov && camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    if (instant) {
      anim.on = false;
      camera.position.copy(pos);
      controls.target.copy(target);
      controls.update();
    } else flyTo(pos, target);
  }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ---------------- 视角 ---------------- */
  /* 主场景原点 = 本户平面中心 = 绝对标高 84 m 的空中。
     所以所有"小区级"视角的 y 都要加 S.myTop，否则会落在楼体内部。 */
  /* 户型组现在整体转了 rotDeg（见 build 之后那行），所有"按户型局部坐标
     摆的机位"都要先转回世界坐标，否则镜头会横着飞出去 195°。 */
  const ROT_R = -H3.site.rotDeg * Math.PI / 180;
  const RC = Math.cos(ROT_R), RS = Math.sin(ROT_R);
  const loc2world = (x, z) => new THREE.Vector3(x * RC + z * RS, 0, -x * RS + z * RC);
  const l2w = (x, y, z) => { const v = loc2world(x, z); v.y = y; return v; };

  const MTOP = H3.site.myTop;
  const HOME_P = new THREE.Vector3(11.2, 16.4, 13.8);
  const HOME_T = new THREE.Vector3(-0.1, 0.3, 0.1);

  /* ---------- 窗外景专用：关闭室内遮挡 ---------- */
  /* 视点贴在窗内 0.55 m，相机原点仍然在墙体包围盒里：
     ① 天花会挡掉"往上看天"的部分 → 关天花
     ② 近平面 0.1 m 会切到墙体内表面 → 临时放宽到 0.45 m（窗内退距 0.55，仍有余量）
     ③ 顶棚剖切面默认在 1.38 m 高；窗外景希望"站在窗前平视"，
        所以临时把剖切面提到 2.30 m（窗顶 2.35 之下，只切掉墙头，不动视野） */
  const CUT_HIGH = 2.30;
  let outMode = false;
  function setOutMode(on) {
    outMode = on;
    if (on) {
      if (!cutOn) { setCut(true); const c = document.getElementById('tCut'); if (c) c.checked = true; }
      cutPlane.constant = CUT_HIGH;
      if (H3.GROUPS.ceiling) H3.GROUPS.ceiling.visible = false;
      if (camera.near !== 0.45) { camera.near = 0.45; camera.updateProjectionMatrix(); }
    } else {
      cutPlane.constant = 1.38;
      if (camera.near !== 0.1) { camera.near = 0.1; camera.updateProjectionMatrix(); }
    }
  }
  H3.setOutMode = setOutMode;

  /* ---------- 户型层开关 ---------- */
  /* 户型模型（墙/地/家具/导览圆盘）都活在"户内标高"里，导览圆盘足有 92 m 直径、
     就贴在 0 标高（= 绝对 108 m）。切到小区级视角时如果不收掉，
     这块白盘子会横在 29F 高度上，把下半张画面涂白 —— 之前鸟瞰/湖景
     "东侧一大块白"就是它。 */
  /* ★ 社区里那栋精建的 7# 楼体（community.js buildMyTower）正好把本户包在正中间：
     户型层一显示，人就站在一堵 165 m 高的外立面里头 —— 首屏全是幕墙，
     这就是"看不到户型图"的原因。所以两者互斥：显示户型就收掉自有楼体，
     收掉户型（鸟瞰 / 湖景 / 7 号楼外观）再放回来。 */
  function syncMyTower() {
    const interior = H3.GROUPS.root && H3.GROUPS.root.visible && !towerOn;
    if (H3.myTowerGroup) H3.myTowerGroup.visible = !interior;
  }
  H3.syncMyTower = syncMyTower;

  function setHouseLayer(on) {
    if (H3.GROUPS.root) H3.GROUPS.root.visible = on;
    if (H3.ground) H3.ground.visible = on && !worldOn;   /* 导览台地：小区在时不显示 */
    syncMyTower();
    /* 大台地不在这里管：整栋楼那块 240 m 圆盘在 tower.js 里自带隐藏，
       户型导览那块 92 m 圆盘看 H3.ground（上面一行）。
       ★ 千万别用 traverse + CircleGeometry 一刀切 —— 社区里 50 个树冠也是
         CircleGeometry，会被一起打掉，整片林子只剩树干。 */
    document.body.classList.toggle('cm', !on);
  }
  H3.setHouseLayer = setHouseLayer;
  syncMyTower();   /* 首屏就要生效：户型层默认显示，自有楼体默认收掉 */

  /* 退出"整栋模式"：楼体复位的唯一入口（复选框一起同步，别让界面骗人） */
  function enterInterior() {
    if (!towerOn) return;
    setTower(false);
    const t = document.getElementById('tTower');
    if (t) t.checked = false;
  }
  H3.enterInterior = enterInterior;

  const VIEWS = {
    /* ★ 室内视角统一走这里：先把"整栋模式"退掉再摆机位。
       否则从"整栋 55F / 本层 29F"切回全景时，tower.js 那套 165 m 楼体
       仍然竖在原地，镜头就卡在楼体内部 —— 界面上什么户型都看不到。 */
    overview: (inst) => { enterInterior(); setHouseLayer(true); setOutMode(false); apply(HOME_P, HOME_T, inst, 42); },
    top: (inst) => { enterInterior(); setHouseLayer(true); setOutMode(false); apply(new THREE.Vector3(0.00, 52.0, 0.30), new THREE.Vector3(0, 0, 0.30), inst, 15.0); },
    front: (inst) => { enterInterior(); setHouseLayer(true); setOutMode(false); apply(new THREE.Vector3(0, 4.8, 17.2), new THREE.Vector3(0, 1.0, 0), inst, 42); },
    corner: (inst) => { enterInterior(); setHouseLayer(true); setOutMode(false); apply(new THREE.Vector3(-12.6, 10.6, 12.8), new THREE.Vector3(0, 0.4, 0), inst, 42); },
    /* 整栋（55F × 3.00 m = 165 m） */
    /* 整栋 55F：165 m 高，竖直方向要装下整楼 + 屋顶构件 */
    tower: (inst) => {
      setHouseLayer(true);
      setOutMode(false);
      apply(new THREE.Vector3(232, TW.top * 0.50, 176),
        new THREE.Vector3(0, TW.top * 0.48, 0), inst, 42);
    },
    /* 本层特写：南向斜 25°，整层 + 户型飘板完整入画 */
    floor: (inst) => {
      setTower(true);
      const tb = document.getElementById('tTower'); if (tb) tb.checked = true;
      setOutMode(false);
      apply(new THREE.Vector3(-40, TW.myTop + 15, 92),
        new THREE.Vector3(0, TW.myTop - 1, 6), inst, 38);
    },

    /* ===== 小区级视角 ===== */
    /* ★ 这三个视角必须先 setTower(false)：
       tower.js 的整栋楼自带一块 120 m 半径的地台（CircleGeometry），
       它挂在原点、y≈0，也就是 29F 楼板高度上。忘了收掉就是一块
       240 m 见方的白板横在镜头前 —— 鸟瞰和湖景全被它顶掉，只看到白色。 */
    /* 7 号楼外立面：站在西南 150 m、+26 m 高处往上看 —— 能看清 44×16 m 的体量 */
    bldg: (inst) => {
      setTower(false);
      setHouseLayer(false);
      setOutMode(false);
      /* 7# 长轴沿南北偏 15°，站在西南 150 m、+26 m 高，能同时看到南立面和西端墙 */
      apply(new THREE.Vector3(-104, MTOP + 26, 104),
        new THREE.Vector3(0, MTOP + 40, 0), inst, 40);
    },
    /* 小区鸟瞰：南侧湖面上空，整个地块 + 南岸线入画
       ★ v3 坐标已改：湖在**南**（z>0），不在西南。
         地块红线 bbox：x −225…+172、z −115…+456；
         南岸线 z 453…556；31 栋楼 z −69…+431。 */
    site: (inst) => {
      setTower(false);
      setHouseLayer(false);
      setOutMode(false);
      /* 机位：湖面上空、地块东南侧，朝北偏西回望，视线压到岸线。
         ★ v5 调机位：v3/v4 用的是 (150, 340, 1050) → (-20, −30, 360)，
           俯角 −28°、画框 780 m 见方，测得画面里 **72% 是空地**、建筑只占 5%
           （原点从 809,315 挪到 818,347 之后整片地块在画框里又小了一号）。
           现在抬高到 620 m、拉近 330 m，俯角 −54°，建筑占 13%、水 11% —— 
           楼栋关系一眼能看全，岸线仍压在下缘。
         ★ 别把 target 抬到地块中心：试过 (90, MTOP+190, 830)→(-46, MTOP-30, 170)，
           机位悬在水面正上方却朝北平视，水面全落在画面下缘之外，一滴湖都看不见。 */
      /* ★ v7：原点移到 7# 新位置 (770,330) 后地块 bbox 变成
         x −194…+259、z −96…+574（含岸线）。机位按"红线 + 岸线"
         全部 139 个点投影求解，取俯角 54°、机位 (30,680,780)、
         靶点 (25,0,280)：红线+岸线落在画面 x 0.30–0.72 / y 0.24–0.96，
         北端 7# 在上缘、临湖叠墅与南湖水面压在下缘。 */
      apply(new THREE.Vector3(30, 680, 780),
        new THREE.Vector3(25, 0, 280), inst, 46);
    },
    /* 南向湖景：29F 本户窗口视高，朝南看出去 —— 就是"从窗里能看到的景色" */
    lake: (inst) => {
      /* ★ 顺序要紧：setTower(false) 内部会调 setWorld(true) 把小区拉回来，
         所以必须先 tower 后 houseLayer，否则户型精装那套墙体会留在原地
         ——实测画面前景会横着一面米白色的外墙板。 */
      setTower(false);
      setHouseLayer(false);
      setOutMode(false);
      /* ★ v3 重定：湖在**正南**（z ≈ +470 起），不在西南。
         29F 楼板绝对标高 84 m；机位放在本户平面中心、眼高 +1.6 m。
         视线压向 (z≈760) 的湖心，俯角约 4°：
           近景 = 中央草坪与洋房坡屋顶（z 245…431）
           中景 = 滨湖绿带 + 岸线（z 453…556）
           远景 = 南湖水面，对岸天际线收在画面上缘
         85 m 视高、470 m 到岸的几何决定了湖面只占画面高度约 15%，
         这是真实比例；想看得更"满"只能抬高机位，那就不是窗景了。 */
      /* ★ v7：视线必须沿**外墙法向 195°**（南偏西 15°），否则拍到的
         不是"从客厅窗看出去"的景 —— 户型是斜着插在楼体里的。
         从 (0,85.6,26) 沿 195° 走 734 m：Δx = −734·tan15° ≈ −197。 */
      /* ★ v7 再调：俯角从 4° 压到 9°，天空由 45% 降到约 30%，
         湖面占比提高 —— 原来画面将近一半是空天，看不出"湖景"。 */
      apply(new THREE.Vector3(0, MTOP + 1.6, 26),
        new THREE.Vector3(-197, MTOP - 125, 760), inst, 55);
    },

    room: (id, inst) => {
      enterInterior();
      setHouseLayer(true);
      const r = P.rooms.find(x => x.id === id);
      if (!r) return;
      const p = r.cam
        ? l2w(r.cam[0][0] - P.cx, r.cam[0][1], r.cam[0][2] - P.cz)
        : l2w((r.x1 + r.x2) / 2 - P.cx, 2.4, (r.z1 + r.z2) / 2 - P.cz);
      const t = r.cam
        ? l2w(r.cam[1][0] - P.cx, r.cam[1][1], r.cam[1][2] - P.cz)
        : l2w((r.x1 + r.x2) / 2 - P.cx, 0.8, (r.z1 + r.z2) / 2 - P.cz);
      apply(p, t, inst, r.fov || 56);
    },

    /* ---- 窗外景：站在本户窗口往外看（就是用户要的"漫游时看到的景色"） ----
       spot = living-s | living-w | living-e | master | bed2 | corr
       视点放在窗内 0.55 m，眼高取窗台与窗顶之间，朝窗洞外法线看出去 */
    outside: (name, inst) => {
      enterInterior();
      setHouseLayer(true);
      const s = OUT_SPOTS[name || 'living-s'];
      if (!s) return;
      setTower(false);
      setOutMode(true);
      apply(s.p, s.t, inst, s.fov || 62);
    }
  };

  /* ---------------- 窗外视点表 ---------------- */
  /* 由窗洞几何直接算出：位置 = 窗中点沿内法线退 0.55 m
     目标 = 窗中点沿外法线推 400 m（远到能把湖面和天际线框进来）
     ★ 这里直接用 plan.js 的局部坐标（nx,nz）算内侧/外侧，
       → target 永远是"窗外正对着那一块"，不随楼栋旋转而偏。 */
  const OUT_SPOTS = (function () {
    const px = P.cx, pz = P.cz;         // 户型中心（主场景原点偏移）
    const list = H3.views.buildWindowList();
    const spots = {};

    /* 挑窗：按"朝哪个面"挑，不看局部坐标符号 —— 局部 +Z 经 15° 旋转后指向南偏东，
       所以户型里 z 最大的那面实际朝 **南偏东 165°**；
       z 最小的那面实际朝 **南偏西 195°**，是主景面。
       用世界方位角判面，比看 nz 正负稳。 */
    const az = (w) => {
      const a = H3.views.TOWARD_DEG * Math.PI / 180;
      /* ★ 楼体 rotation.y = −rotDeg，所以"局部法向 → 世界方向"要用 +rotDeg 转：
           wx = nx·cosθ − nz·sinθ ,  wz = nx·sinθ + nz·cosθ
         v3 修复了两处错：① 两个 sin 项符号写反（等于按 −θ 转，方位整体镜像），
         ② atan2 用了 (wx, wz)，0 落在 +Z 上，南北颠倒 —— 结果 south 段
         （168–210）一扇窗都选不到，living-s / bed2 根本没生成，
         界面上点"客厅窗"什么都不发生。 */
      const wx = w.nx * Math.cos(a) - w.nz * Math.sin(a);
      const wz = w.nx * Math.sin(a) + w.nz * Math.cos(a);
      return (Math.atan2(wx, -wz) * 180 / Math.PI + 360) % 360;   // 0=北 90=东 180=南
    };
    const byAz = (lo, hi) => list
      .filter(w => { const d = az(w); return lo < hi ? (d >= lo && d <= hi) : (d >= lo || d <= hi); })
      .sort((a, b) => b.w - a.w);
    const south = byAz(168, 210);     // 主景面：南偏西 195° 的两开间
    const north = byAz(300, 60);      // 公共连廊一侧（北偏东 15°）
    const west = list.filter(w => w.nx < -0.5).sort((a, b) => b.w - a.w);   // 餐厅西飘窗

    const mk = (name, w, fov, back) => {
      if (!w) return;
      const ins = back === undefined ? 0.55 : back;
      const eyeY = Math.min(w.top - 0.35, Math.max(w.sill + 0.55, 1.35));
      spots[name] = {
        /* 视点：窗中点往室内退 —— 局部坐标里就是 -n */
        p: l2w(w.x - px - w.nx * ins, eyeY, w.z - pz - w.nz * ins),
        /* 目标：窗中点往窗外推 400 m */
        t: l2w(w.x - px + w.nx * 400, eyeY, w.z - pz + w.nz * 400),
        fov: fov || 62
      };
    };
    if (south[0]) mk('living-s', south[0], 64);   // 主景面最大开间
    if (south[1]) mk('bed2', south[1], 60);       // 主景面第二开间
    if (north[0]) mk('corr', north[0], 58);       // 公共连廊一侧最大开间
    if (west[0]) mk('dining-w', west[0], 60);     // 餐厅西飘窗

    /* 主景面要往下压一点：29F 俯看园林与湖面，
       目标点压 26 m / 400 m ≈ 3.7° 俯角，画面下 1/3 是园林、中段是湖 */
    for (const k of ['living-s', 'bed2']) {
      if (spots[k]) spots[k].t.y = spots[k].p.y - 26;
    }
    return spots;
  })();
  H3.outSpots = OUT_SPOTS;
  /* 调试：把视点表打到控制台，方便对照窗洞 */
  if (H3.dbgReady !== false) window.__SPOTS = OUT_SPOTS;

  /* ---------------- 状态开关 ---------------- */
  let ceilOn = false;
  H3.GROUPS.ceiling.visible = false;

  let furnOn = true;
  let nightOn = false;

  function setCeiling(on) {
    ceilOn = on;
    H3.GROUPS.ceiling.visible = on && !cutOn;
  }
  function setFurniture(on) {
    furnOn = on;
    H3.GROUPS.furniture.visible = on;
    H3.GROUPS.walls.visible = true;
  }
  function setDims(on) {
    if (H3.GROUPS.dims) H3.GROUPS.dims.visible = on;
  }
  function setNight(on) {
    nightOn = on;
    document.body.classList.toggle('night', on);
    if (on) {
      LIGHTS.hemi.color.setHex(0x2b3d57);
      LIGHTS.hemi.groundColor.setHex(0x0a0d12);
      LIGHTS.hemi.intensity = 0.16;
      LIGHTS.sun.color.setHex(0xa8c2e0);
      LIGHTS.sun.intensity = 0.10;
      LIGHTS.fill.intensity = 0;
      LIGHTS.lights.forEach(l => { l.intensity = l.userData.on * 4.6; });
      setEnvFactor(0.10);
      M.bulb.emissiveIntensity = 4.2;
      M.led.emissiveIntensity = 3.0;
      M.screen.emissiveIntensity = 1.9;
      if (H3.ground) H3.ground.material.color.setHex(0x4a4f4c);
      setWorldNight(true);
      renderer.toneMappingExposure = 1.15;
    } else {
      LIGHTS.hemi.color.setHex(0xf2f6ff);
      LIGHTS.hemi.groundColor.setHex(0xc8bfae);
      LIGHTS.hemi.intensity = 0.27;
      LIGHTS.sun.color.setHex(0xffeed4);
      LIGHTS.sun.intensity = 1.12;
      LIGHTS.fill.intensity = 0.20;
      LIGHTS.lights.forEach(l => { l.intensity = 0; });
      setEnvFactor(1);
      M.bulb.emissiveIntensity = 2.2;
      M.led.emissiveIntensity = 1.4;
      M.screen.emissiveIntensity = 1.0;
      if (H3.ground) H3.ground.material.color.setHex(0xffffff);
      setWorldNight(false);
      renderer.toneMappingExposure = 0.78;
    }
  }
  function setLabels(on) {
    labelsOn = on;
    labels.forEach(L => { if (!on) L.el.style.display = 'none'; });
  }

  /* ---------------- 漫游模式 ---------------- */
  const walk = {
    on: false, yaw: 0, pitch: 0, keys: {},
    pos: new THREE.Vector3(), saved: null, base: 1.62
  };
  const WALK_START = new THREE.Vector3(0.95 - P.cx, 0, 10.05 - P.cz);

  /* 漫游时的窗外景：站在窗后 1.1 m，眼高 1.55（贴近平时的站立视高），
     水平看出去 —— 这才像"我站在自己家里往窗外看"。
     比 outside: 视点更靠里，所以窗框、窗台、阳台都会入画，尺度感更真。 */
  const WALK_WIN = (function () {
    const m = {};
    for (const k in H3.outSpots) {
      const s = H3.outSpots[k];
      const dx = s.t.x - s.p.x, dz = s.t.z - s.p.z;
      const L = Math.hypot(dx, dz) || 1;
      const ux = dx / L, uz = dz / L;
      m[k] = {
        x: s.p.x - ux * 1.1,
        z: s.p.z - uz * 1.1,
        /* 相机看向 -Z：yaw 满足 (-sin yaw, -cos yaw) = (ux, uz) */
        yaw: Math.atan2(-ux, -uz),
        /* 俯角按 29F 的实际几何算：视线到园林 40 m 远处的俯角约 18°，
           这里取 16°，画面下沿刚好落在楼前草坪、上沿留足天空 */
        pitch: k === 'corr' || k === 'dining-w' ? -0.02 : -0.28
      };
    }
    return m;
  })();
  H3.walkWin = WALK_WIN;

  /* 漫游中按窗景键：瞬移到对应窗前并转头 */
  const WALK_ORDER = ['living-s', 'bed2', 'corr', 'dining-w'];
  function walkTo(name) {
    const s = WALK_WIN[name];
    if (!s) return false;
    walk.pos.set(s.x, 0, s.z);
    walk.yaw = s.yaw;
    walk.pitch = s.pitch;
    camera.position.set(s.x, walk.base, s.z);
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
    return true;
  }
  H3.walkTo = walkTo;

  function enterWalk() {
    walk.on = true;
    walk.saved = { pos: camera.position.clone(), target: controls.target.clone() };
    walk.pos.copy(WALK_START);
    walk.yaw = Math.PI; walk.pitch = -0.04;
    // 面向室内（+Z 方向 => yaw = PI）
    controls.enabled = false;
    document.body.classList.add('walking');
    /* 漫游时人眼 1.62 m：剖切面必须高于人眼，否则"自己站在剖切面上"，
       天花板以下全被切掉，窗外景也连带被切。 */
    setCut(true);
    cutPlane.constant = 2.62;
    const ck = document.getElementById('tCut');
    if (ck) ck.checked = true;
    document.getElementById('walkTip').classList.add('show');
    renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  }
  function exitWalk() {
    walk.on = false;
    controls.enabled = true;
    document.body.classList.remove('walking');
    document.getElementById('walkTip').classList.remove('show');
    if (document.pointerLockElement) document.exitPointerLock();
    if (walk.saved) {
      camera.position.copy(walk.saved.pos);
      controls.target.copy(walk.saved.target);
      controls.update();
    }
  }
  document.addEventListener('pointerlockchange', () => {
    if (walk.on && !document.pointerLockElement) exitWalk();
  });
  document.addEventListener('mousemove', e => {
    if (!walk.on || !document.pointerLockElement) return;
    walk.yaw -= e.movementX * 0.0022;
    walk.pitch -= e.movementY * 0.0018;
    walk.pitch = Math.max(-1.1, Math.min(1.1, walk.pitch));
  });
  window.addEventListener('keydown', e => {
    if (e.code === 'Escape' && walk.on) exitWalk();
    walk.keys[e.code] = true;
    /* 漫游中 7 8 9 0 = 站到各扇窗前看景（不用低头找按钮） */
    if (walk.on) {
      const map = { Digit7: 0, Digit8: 1, Digit9: 2, Digit0: 3 };
      if (e.code in map) { const n = WALK_ORDER[map[e.code]]; if (n) walkTo(n); }
      if (e.code === 'KeyQ') walkTo('dining-w');
    }
  });
  window.addEventListener('keyup', e => { walk.keys[e.code] = false; });

  function blocked(x, z) {
    const r = 0.24;
    for (const c of H3.COLLIDERS) {
      if (x > c.x1 - r && x < c.x2 + r && z > c.z1 - r && z < c.z2 + r) return true;
    }
    return false;
  }

  function stepWalk(dt) {
    const k = walk.keys;
    let f = 0, s = 0;
    if (k['KeyW'] || k['ArrowUp']) f += 1;
    if (k['KeyS'] || k['ArrowDown']) f -= 1;
    if (k['KeyD'] || k['ArrowRight']) s += 1;
    if (k['KeyA'] || k['ArrowLeft']) s -= 1;
    if (!f && !s) { camera.position.copy(walk.pos); return; }
    const spd = (k['ShiftLeft'] ? 3.0 : 1.65) * dt;
    const l = Math.hypot(f, s) || 1;
    const fx = -Math.sin(walk.yaw), fz = -Math.cos(walk.yaw);
    const rx = Math.cos(walk.yaw), rz = -Math.sin(walk.yaw);
    let nx = walk.pos.x + (fx * f + rx * s) / l * spd;
    let nz = walk.pos.z + (fz * f + rz * s) / l * spd;
    if (!blocked(nx, walk.pos.z)) walk.pos.x = nx;
    if (!blocked(walk.pos.x, nz)) walk.pos.z = nz;
    // 限制在户型范围内
    walk.pos.x = Math.max(-P.cx + 0.25, Math.min(P.cx - 0.25, walk.pos.x));
    walk.pos.z = Math.max(-P.cz + 0.25, Math.min(P.cz - 0.25, walk.pos.z));
    camera.position.set(walk.pos.x, walk.base, walk.pos.z);
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
  }

  /* ---------------- 生成房间列表 ---------------- */
  (function buildRoomList() {
    const list = document.getElementById('roomList');
    const order = ['living', 'master', 'dining', 'kitchen', 'bath2', 'bed2', 'bath1', 'balcony'];
    for (const id of order) {
      const r = P.rooms.find(x => x.id === id);
      if (!r) continue;
      const b = document.createElement('button');
      b.setAttribute('data-room', id);
      b.innerHTML = r.name + '<i>' + (r.x2 - r.x1).toFixed(2) + ' × ' + (r.z2 - r.z1).toFixed(2) + ' m</i>';
      list.appendChild(b);
    }
  })();

  document.getElementById('panelToggle').addEventListener('click', () => {
    document.body.classList.toggle('collapsed');
  });

  /* ---------------- UI 绑定 ---------------- */
  document.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const v = btn.getAttribute('data-view');
      /* 形如 outside:living-s，冒号后是参数 */
      const i = v.indexOf(':');
      const key = i > 0 ? v.slice(0, i) : v;
      const arg = i > 0 ? v.slice(i + 1) : undefined;
      if (VIEWS[key]) VIEWS[key](arg);
      document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      /* 窗外景 / 小区视角：显示能见度面板 */
      const vb = document.getElementById('viewBar');
      if (vb) {
        const on = key === 'outside' || key === 'site' || key === 'lake' || key === 'bldg';
        vb.classList.toggle('on', on);
        if (key === 'outside') {
          const names = { 'living-s': '客厅窗 · 主景面', bed2: '主卧窗 · 主景面', corr: '连廊窗 · 公共侧', 'dining-w': '餐厅西飘窗' };
          const el = document.getElementById('vbSpot');
          if (el) el.textContent = names[arg] || arg;
        } else if (key === 'site') {
          const el = document.getElementById('vbSpot'); if (el) el.textContent = '小区鸟瞰';
        } else if (key === 'bldg') {
          const el = document.getElementById('vbSpot'); if (el) el.textContent = '7 号楼';
        } else if (key === 'lake') {
          const el = document.getElementById('vbSpot'); if (el) el.textContent = '南向湖景';
        }
      }
      if (key === 'site' || key === 'lake' || key === 'bldg') setTower(false);
    });
  });
  document.querySelectorAll('[data-room]').forEach(btn => {
    btn.addEventListener('click', () => {
      VIEWS.room(btn.getAttribute('data-room'));
      document.querySelectorAll('[data-room]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => fn(el.checked));
  };
  bind('tCut', v => setCut(v));
  bind('tCeil', v => setCeiling(v));
  bind('tFurn', v => setFurniture(v));
  bind('tLabel', v => setLabels(v));
  bind('tDims', v => setDims(v));
  bind('tNight', v => setNight(v));
  bind('tTower', v => {
    setTower(v);
    if (v) VIEWS.tower(); else VIEWS.overview();
  });
  document.getElementById('btnWalk').addEventListener('click', () => {
    if (walk.on) exitWalk(); else enterWalk();
  });

  /* ---------------- 能见度 ---------------- */
  document.querySelectorAll('[data-vis]').forEach(btn => {
    btn.addEventListener('click', () => {
      const k = btn.getAttribute('data-vis');
      H3.views.setVisibility(scene, k);
      document.querySelectorAll('[data-vis]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  /* ---------------- 主循环 ---------------- */
  const clock = new THREE.Clock();
  let firstFrame = true;

  function tick() {
    requestAnimationFrame(tick);
    const dt = Math.min(clock.getDelta(), 0.05);

    if (anim.on) {
      anim.t += dt / anim.dur;
      const k = easeInOut(Math.min(1, anim.t));
      camera.position.lerpVectors(anim.from, anim.to, k);
      controls.target.lerpVectors(anim.ft, anim.tt, k);
      if (anim.t >= 1) anim.on = false;
    }

    if (walk.on) stepWalk(dt);
    else controls.update();

    updateLabels();
    updateCmLabels();
    renderer.render(scene, camera);

    if (firstFrame) {
      firstFrame = false;
      const ld = document.getElementById('loading');
      if (ld) { ld.classList.add('done'); setTimeout(() => ld.remove(), 700); }
    }
  }
  tick();

  /* 键盘：1-4 快捷视角，5 整栋，6 本层，7 小区，8 窗外景 */
  window.addEventListener('keydown', e => {
    if (walk.on) return;
    if (e.key === '1') VIEWS.overview();
    if (e.key === '2') VIEWS.top();
    if (e.key === '3') VIEWS.corner();
    if (e.key === '4') VIEWS.front();
    if (e.key === '5') { setTower(true); const t5 = document.getElementById('tTower'); if (t5) t5.checked = true; VIEWS.tower(); }
    if (e.key === '6') { setTower(true); const t6 = document.getElementById('tTower'); if (t6) t6.checked = true; VIEWS.floor(); }
    if (e.key === '7') { setTower(false); VIEWS.site(); }
    if (e.key === '8') { VIEWS.outside('living-s'); }
  });

  H3.resetView = () => VIEWS.overview();
  /* 调试句柄 */
  H3.dbg = { camera, controls, scene, renderer, TW, VIEWS, setTower, P, THREE };

  /* URL 参数：?view=top / room:master / corner / front / tower / floor · &cut=1 · &night=1 · &tower=1 */
  (function () {
    const q = new URLSearchParams(location.search);
    if (q.get('tower') === '1') { setTower(true); const t = document.getElementById('tTower'); if (t) t.checked = true; }
    const v = q.get('view');
    if (v) {
      if (v.indexOf('room:') === 0) VIEWS.room(v.slice(5), true);
      else if (v.indexOf('outside:') === 0) VIEWS.outside(v.slice(8), true);
      else if (VIEWS[v]) VIEWS[v](true);
    }
    if (q.get('vis')) {
      H3.views.setVisibility(scene, q.get('vis'));
      const b = document.querySelector('[data-vis="' + q.get('vis') + '"]');
      if (b) { document.querySelectorAll('[data-vis]').forEach(x => x.classList.remove('active')); b.classList.add('active'); }
    }
    if (q.get('cut') === '1') { setCut(true); const c = document.getElementById('tCut'); if (c) c.checked = true; }
    if (q.get('night') === '1') { setNight(true); const n = document.getElementById('tNight'); if (n) n.checked = true; }
    if (q.get('dims') === '1') { setDims(true); const d = document.getElementById('tDims'); if (d) d.checked = true; }
  })();
})();
