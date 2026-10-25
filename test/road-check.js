/* 道路 vs 楼栋 净距检查（纯 Node） */
const fs=require('fs'),path=require('path'),vm=require('vm');
const sandbox={window:{},console,Math,Number,Object,Array,JSON};
vm.createContext(sandbox);
for(const f of ['plan.js','site.js']){
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','js',f),'utf8'),sandbox,{filename:f});
}
const S=sandbox.window.H3.site;
const D2R=Math.PI/180;
function distToSeg(x,z,x1,z1,x2,z2){
  const dx=x2-x1,dz=z2-z1,L2=dx*dx+dz*dz||1;
  const t=Math.max(0,Math.min(1,((x-x1)*dx+(z-z1)*dz)/L2));
  return Math.hypot(x-(x1+dx*t),z-(z1+dz*t));
}
let worst=[];
for(const b of S.buildings){
  const [id,x,z,w,d,fl,rot]=b;
  const half=Math.hypot(w,d)/2;
  for(const rd of S.roads){
    let best=1e9;
    for(let i=0;i<rd.pts.length-1;i++){
      const a=rd.pts[i],c=rd.pts[i+1];
      /* 沿线段取样，算到楼栋 OBB 的距离 */
      for(let t=0;t<=1;t+=0.05){
        const px=a[0]+(c[0]-a[0])*t, pz=a[1]+(c[1]-a[1])*t;
        const dx=px-x,dz=pz-z;
        const th=rot*D2R, co=Math.cos(th), si=Math.sin(th);
        const lx=dx*co+dz*si, lz=-dx*si+dz*co;
        const ox=Math.max(Math.abs(lx)-w/2,0), oz=Math.max(Math.abs(lz)-d/2,0);
        const dist=Math.hypot(ox,oz)-rd.w/2;
        if(dist<best) best=dist;
      }
    }
    if(best<1) worst.push({id:rd.name,g:+best.toFixed(1)});
  }
}
console.log('道路与楼栋净距 <1 m 的组合：',worst.length);
worst.sort((a,b)=>a.g-b.g).slice(0,15).forEach(o=>console.log('  '+o.id+' × '+o.g.toFixed(1)+' m'));
process.exit(worst.length?1:0);
