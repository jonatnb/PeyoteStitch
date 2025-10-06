// v3.6.0 Debug+
// Helpers
const $ = (sel)=>document.querySelector(sel);

// Status log
const statusEl = document.getElementById('statusLog');
function logStatus(msg){
  if (!statusEl) return;
  const t = new Date().toLocaleTimeString();
  statusEl.textContent += `\n[${t}] ${msg}`;
}

// Debug Data (always visible)
const debugEl = document.getElementById('debugOut');
const copyBtn = document.getElementById('btnCopyDebug');
let debugState = {
  loader: '—',
  file: { name: '—', type: '—', size: 0 },
  image: { w: 0, h: 0, ar: 0 },
  drew: { orig: false, crop: false, bead: false },
  device: {
    dpr: (window.devicePixelRatio||1),
    ua: navigator.userAgent,
    iOS: /iPad|iPhone|iPod/.test(navigator.userAgent),
    safari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
  },
  touch: { x: null, y: null }
};
function updateDebugData(){
  if (!debugEl) return;
  const f = debugState.file;
  const i = debugState.image;
  const d = debugState.device;
  const t = debugState.touch;
  const fmtSize = (s)=> s ? (s>=1e6 ? (s/1e6).toFixed(2)+' MB' : (s/1e3).toFixed(1)+' KB') : '0';
  const lines = [
    `Loader: ${debugState.loader}`,
    `File: ${f.name} (${f.type}, ${fmtSize(f.size)})`,
    `Image: ${i.w}×${i.h} (AR ${(i.ar||0).toFixed(3)})`,
    `Drawn → Original:${debugState.drew.orig?'✅':'—'}  Crop:${debugState.drew.crop?'✅':'—'}  Bead:${debugState.drew.bead?'✅':'—'}`,
    `devicePixelRatio: ${d.dpr}`,
    `iOS: ${d.iOS} • Safari: ${d.safari}`,
    `Touch last: ${t.x!==null?`(${Math.round(t.x)}, ${Math.round(t.y)})`:'—'}`
  ];
  debugEl.textContent = lines.join('\n');
}
function setDebugLoader(name){ debugState.loader = name; updateDebugData(); }
function setDebugFile(f){ if (!f) return; debugState.file = { name: f.name||'—', type: f.type||'—', size: f.size||0 }; updateDebugData(); }
function setDebugImage(img){ if (!img) return; debugState.image = { w: img.width||0, h: img.height||0, ar: img.width? (img.width/img.height):0 }; updateDebugData(); }
function markDrew(key, val){ debugState.drew[key] = !!val; updateDebugData(); }
function setTouch(x,y){ debugState.touch = {x,y}; updateDebugData(); }
copyBtn && copyBtn.addEventListener('click', ()=>{
  if (!debugEl) return;
  const txt = debugEl.textContent || '';
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(()=>{ copyBtn.textContent='Copied!'; setTimeout(()=>copyBtn.textContent='Copy',1200); });
  } else {
    const r=document.createRange(); r.selectNodeContents(debugEl);
    const s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
  }
});
updateDebugData();

// Elements
const els = {
  file: $("#file"),
  btnGen: $("#btnGenerate"),
  btnResetCrop: $("#btnResetCrop"),
  lockCropAspect: $("#lockCropAspect"),
  cropAspectLabel: $("#cropAspectLabel"),
  beadW: $("#beadW"),
  beadH: $("#beadH"),
  crosshairToggle: $("#crosshairToggle"),
  origPreview: $("#origPreview"),
  fileInfo: $("#fileInfo"),
  cropThumb: $("#cropThumb"),
  loupe: $("#loupe"),
  beadSim: $("#beadSim"),
  cropCanvas: $("#cropCanvas")
};

let sourceImg = null;
let cropImg = null; // alias to source
let viewScale = 1;
let crop = {x:80,y:40,w:440,h:280};
let dragMode = null, isDragging=false, dragOX=0, dragOY=0;
let lastPointer = null;

const cropCtx = els.cropCanvas.getContext("2d", { willReadFrequently:true });
const cropThumbCtx = els.cropThumb.getContext("2d", { willReadFrequently:true });
const loupeCtx = els.loupe.getContext("2d", { willReadFrequently:true });
const beadSimCtx = els.beadSim.getContext("2d", { willReadFrequently:true });

// Palette
let delicaFull = window.delicaFull || [];
async function loadDelicaPalette(){
  try{
    const r = await fetch("palettes/delica_full.json", {cache:"no-cache"});
    if (r.ok){
      const data = await r.json();
      delicaFull = window.delicaFull = data;
      drawBeadSim();
      logStatus("Palette loaded.");
      return;
    }
  }catch(e){}
  logStatus("Using inline fallback palette.");
}
loadDelicaPalette();

// Image loader helpers
function loadImage(url){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = ()=>res(img);
    img.onerror = ()=>rej(new Error("Image load failed"));
    img.src = url;
  });
}
async function robustLoadFile(file){
  if (!file) throw new Error("No file");
  const name = (file.name||'').toLowerCase();
  if (name.endsWith(".heic") || name.endsWith(".heif")){
    logStatus("Detected HEIC/HEIF – if load fails, take a screenshot (PNG) or export JPEG.");
  }
  // 1) createImageBitmap
  try{
    if ('createImageBitmap' in window){
      logStatus("Trying createImageBitmap..."); setDebugLoader('createImageBitmap');
      const bmp = await createImageBitmap(file);
      const maxDim = 2400;
      const scale = Math.min(1, maxDim/Math.max(bmp.width, bmp.height));
      const tw = Math.max(1, Math.round(bmp.width*scale));
      const th = Math.max(1, Math.round(bmp.height*scale));
      const can = document.createElement('canvas'); can.width=tw; can.height=th;
      const c = can.getContext('2d', { willReadFrequently:true });
      c.imageSmoothingEnabled = true;
      c.drawImage(bmp,0,0,tw,th);
      const dataURL = can.toDataURL('image/jpeg', 0.92);
      const img = await loadImage(dataURL);
      return {img, url:dataURL};
    }
  }catch(e){ logStatus("createImageBitmap failed."); }
  // 2) FileReader
  try{
    logStatus("Trying FileReader..."); setDebugLoader('FileReader');
    const dataURL = await new Promise((res,rej)=>{
      const reader = new FileReader();
      reader.onload = ()=>res(reader.result);
      reader.onerror = ()=>rej(new Error("FileReader failed"));
      reader.readAsDataURL(file);
    });
    const img = await loadImage(dataURL);
    return {img, url:dataURL};
  }catch(e){ logStatus("FileReader failed."); }
  // 3) Blob URL fallback
  try{
    logStatus("Trying Blob URL..."); setDebugLoader('BlobURL');
    const blobURL = URL.createObjectURL(file);
    const img = await loadImage(blobURL);
    return {img, url:blobURL};
  }catch(e){ logStatus("Blob URL failed."); }
  throw new Error("All loaders failed");
}

function getCanvasPos(e){
  const rect = els.cropCanvas.getBoundingClientRect();
  const scaleX = els.cropCanvas.width / rect.width;
  const scaleY = els.cropCanvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  return {mx, my};
}

function handlePoints(){
  const midX = crop.x + crop.w/2, midY = crop.y + crop.h/2;
  return [
    {name:'nw', x: crop.x, y: crop.y},
    {name:'ne', x: crop.x+crop.w, y: crop.y},
    {name:'sw', x: crop.x, y: crop.y+crop.h},
    {name:'se', x: crop.x+crop.w, y: crop.y+crop.h},
    {name:'n', x: midX, y: crop.y},
    {name:'s', x: midX, y: crop.y+crop.h},
    {name:'w', x: crop.x, y: midY},
    {name:'e', x: crop.x+crop.w, y: midY},
  ];
}
function hitHandle(mx,my){
  const rCorner = 22, edgeBand = 20;
  const corners = [
    {name:'nw', x: crop.x, y: crop.y},
    {name:'ne', x: crop.x+crop.w, y: crop.y},
    {name:'sw', x: crop.x, y: crop.y+crop.h},
    {name:'se', x: crop.x+crop.w, y: crop.y+crop.h},
  ];
  for (const c of corners){
    const dx = mx - c.x, dy = my - c.y;
    if (dx*dx + dy*dy <= rCorner*rCorner) return c.name;
  }
  if (my >= crop.y+edgeBand && my <= crop.y+crop.h-edgeBand){
    if (Math.abs(mx - crop.x) <= edgeBand) return 'w';
    if (Math.abs(mx - (crop.x+crop.w)) <= edgeBand) return 'e';
  }
  if (mx >= crop.x+edgeBand && mx <= crop.x+crop.w-edgeBand){
    if (Math.abs(my - crop.y) <= edgeBand) return 'n';
    if (Math.abs(my - (crop.y+crop.h)) <= edgeBand) return 's';
  }
  return null;
}

function drawCropper(){
  markDrew('crop', !!cropImg);
  cropCtx.clearRect(0,0,els.cropCanvas.width,els.cropCanvas.height);
  if (!cropImg) return;
  // Fit image to canvas
  const s = Math.min(els.cropCanvas.width / cropImg.width, els.cropCanvas.height / cropImg.height);
  viewScale = s;
  const vw = cropImg.width * s;
  const vh = cropImg.height * s;
  const offX = Math.floor((els.cropCanvas.width - vw)/2);
  const offY = Math.floor((els.cropCanvas.height - vh)/2);
  els.cropCanvas._offX = offX; els.cropCanvas._offY = offY;
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.drawImage(cropImg, 0,0, cropImg.width, cropImg.height, offX, offY, vw, vh);

  // Darken outside
  cropCtx.save();
  cropCtx.fillStyle = "rgba(0,0,0,0.35)";
  cropCtx.beginPath();
  cropCtx.rect(0,0,els.cropCanvas.width,els.cropCanvas.height);
  cropCtx.rect(crop.x, crop.y, crop.w, crop.h);
  cropCtx.fill("evenodd");
  cropCtx.restore();

  // Border
  cropCtx.strokeStyle = "#22c55e";
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(crop.x+0.5, crop.y+0.5, crop.w, crop.h);

  // Handles (big circular)
  const handles = handlePoints();
  cropCtx.fillStyle = "#22c55e";
  handles.forEach(p=>{
    cropCtx.beginPath(); cropCtx.arc(p.x, p.y, 9, 0, Math.PI*2); cropCtx.fill();
    cropCtx.strokeStyle="#15803d"; cropCtx.lineWidth=1; cropCtx.stroke();
  });

  // Crosshair (optional)
  if ($("#crosshairToggle").checked && lastPointer){
    cropCtx.save(); cropCtx.strokeStyle="#ef4444"; cropCtx.fillStyle="#ef4444";
    cropCtx.beginPath(); cropCtx.arc(lastPointer.mx, lastPointer.my, 4, 0, Math.PI*2); cropCtx.fill();
    cropCtx.beginPath(); cropCtx.moveTo(lastPointer.mx-8, lastPointer.my); cropCtx.lineTo(lastPointer.mx+8, lastPointer.my);
    cropCtx.moveTo(lastPointer.mx, lastPointer.my-8); cropCtx.lineTo(lastPointer.mx, lastPointer.my+8);
    cropCtx.stroke(); cropCtx.restore();
  }

  updateCropThumb();
}

function cropRegion(){
  // Convert crop rect (canvas space) back to image pixel region
  const offX = els.cropCanvas._offX||0, offY = els.cropCanvas._offY||0;
  const sx = Math.max(0, Math.round((crop.x - offX)/viewScale));
  const sy = Math.max(0, Math.round((crop.y - offY)/viewScale));
  const sw = Math.max(1, Math.round(crop.w / viewScale));
  const sh = Math.max(1, Math.round(crop.h / viewScale));
  return {sx,sy,sw,sh};
}

function updateCropThumb(){
  if (!cropImg || !cropThumbCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const tw = els.cropThumb.width, th = els.cropThumb.height;
  cropThumbCtx.clearRect(0,0,tw,th);
  cropThumbCtx.fillStyle = "#f8fafc"; cropThumbCtx.fillRect(0,0,tw,th);
  cropThumbCtx.imageSmoothingEnabled = true;
  const scale = Math.min(tw/sw, th/sh);
  const dw = Math.max(1, Math.round(sw*scale));
  const dh = Math.max(1, Math.round(sh*scale));
  const dx = Math.floor((tw - dw)/2);
  const dy = Math.floor((th - dh)/2);
  cropThumbCtx.drawImage(cropImg, sx,sy,sw,sh, dx,dy, dw,dh);

  // Loupe
  const lW = els.loupe.width, lH = els.loupe.height;
  loupeCtx.clearRect(0,0,lW,lH);
  loupeCtx.fillStyle = "#f8fafc"; loupeCtx.fillRect(0,0,lW,lH);
  const centerX = sx + sw/2, centerY = sy + sh/2;
  const zoom = 3;
  const srcW = Math.max(1, Math.round(lW / zoom));
  const srcH = Math.max(1, Math.round(lH / zoom));
  const sxx = Math.max(0, Math.min(Math.round(centerX - srcW/2), cropImg.width - srcW));
  const syy = Math.max(0, Math.min(Math.round(centerY - srcH/2), cropImg.height - srcH));
  loupeCtx.imageSmoothingEnabled = false;
  loupeCtx.drawImage(cropImg, sxx,syy,srcW,srcH, 0,0, lW,lH);

  // Bead sim
  drawBeadSim();
}

// Color matching helpers (sRGB → Lab for ΔE)
function srgbToLin(c){ c/=255; return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); }
function rgbToXyz(r,g,b){
  r=srgbToLin(r); g=srgbToLin(g); b=srgbToLin(b);
  const x=r*0.4124+g*0.3576+b*0.1805, y=r*0.2126+g*0.7152+b*0.0722, z=r*0.0193+g*0.1192+b*0.9505;
  return [x,y,z];
}
function xyzToLab(x,y,z){
  const xr=x/0.95047, yr=y/1.00000, zr=z/1.08883;
  const f=t=> t>0.008856? Math.pow(t,1/3):(7.787*t+16/116);
  const fx=f(xr), fy=f(yr), fz=f(zr);
  return [116*fy-16, 500*(fx-fy), 200*(fy-fz)];
}
function rgbToLab(r,g,b){ const [x,y,z]=rgbToXyz(r,g,b); return xyzToLab(x,y,z); }
function deltaE(a,b){ const dL=a[0]-b[0], dA=a[1]-b[1], dB=a[2]-b[2]; return Math.sqrt(dL*dL+dA*dA+dB*dB); }
const hex2rgbCache = new Map();
function hexToRgb(hex){
  if (hex2rgbCache.has(hex)) return hex2rgbCache.get(hex);
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [204,204,204];
  const out = [parseInt(m[1],16), parseInt(m[2],16), parseInt(m[3],16)];
  hex2rgbCache.set(hex,out); return out;
}
const labCache = new Map();
function cachedHexToLab(hex){
  if (labCache.has(hex)) return labCache.get(hex);
  const [r,g,b]=hexToRgb(hex); const lab=rgbToLab(r,g,b); labCache.set(hex,lab); return lab;
}

function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x width
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  const t = document.createElement('canvas'); t.width=targetW; t.height=targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  const beads = (window.delicaFull||[]).map(b=>({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best= '#cccccc', bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead.hex; }
    }
    return best;
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle="#ffffff"; beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled=false;
  const r = Math.floor(cellPx*0.25);
  for (let y=0;y<targetH;y++){
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr=data[idx], gg=data[idx+1], bb=data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx;
      const py = oy + y*cellPx;
      // bead cell
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
  markDrew('bead', true);
}
function roundRect(ctx, x,y,w,h,r,fill,stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

// Crop logic
function startDrag(e){
  const {mx, my} = getCanvasPos(e);
  const handle = hitHandle(mx,my);
  const inside = (mx>crop.x && mx<crop.x+crop.w && my>crop.y && my<crop.y+crop.h);
  if (!handle && !inside) return; // allow scroll
  e.preventDefault();
  try{ els.cropCanvas.setPointerCapture(e.pointerId); }catch(_){}
  dragMode = handle ? handle : 'move';
  dragOX = mx; dragOY = my;
  isDragging = true;
}
function updateDrag(mx,my){
  if (!isDragging) return;
  const dx = mx - dragOX, dy = my - dragOY;
  dragOX = mx; dragOY = my;
  if (dragMode==='move'){
    crop.x += dx; crop.y += dy;
  }else{
    if (dragMode.includes('n')){ crop.y += dy; crop.h -= dy; }
    if (dragMode.includes('s')){ crop.h += dy; }
    if (dragMode.includes('w')){ crop.x += dx; crop.w -= dx; }
    if (dragMode.includes('e')){ crop.w += dx; }
  }
  // Aspect lock
  if (els.lockCropAspect.checked){
    const bw = Math.max(1, parseInt(els.beadW.value||'90',10));
    const bh = Math.max(1, parseInt(els.beadH.value||'50',10));
    const targetAR = bw/bh;
    if (crop.w/crop.h > targetAR){
      crop.w = Math.round(crop.h * targetAR);
    } else {
      crop.h = Math.round(crop.w / targetAR);
    }
  }
  // Clamp
  crop.w = Math.max(20, Math.min(crop.w, els.cropCanvas.width - crop.x));
  crop.h = Math.max(20, Math.min(crop.h, els.cropCanvas.height - crop.y));
  crop.x = Math.max(0, Math.min(crop.x, els.cropCanvas.width - crop.w));
  crop.y = Math.max(0, Math.min(crop.y, els.cropCanvas.height - crop.h));

  drawCropper();
}
function endDrag(e){
  isDragging = false;
  try{ if (e && e.pointerId) els.cropCanvas.releasePointerCapture(e.pointerId); }catch(_){}
}

els.cropCanvas.addEventListener('pointerdown', (e)=>{
  const {mx,my} = getCanvasPos(e);
  const handle = hitHandle(mx,my);
  const inside = (mx>crop.x && mx<crop.x+crop.w && my>crop.y && my<crop.y+crop.h);
  if (!handle && !inside){ return; } // allow scroll
  startDrag(e);
});
window.addEventListener('pointermove', (e)=>{
  const {mx,my} = getCanvasPos(e);
  lastPointer = {mx,my};
  setTouch(mx,my);
  if (isDragging) updateDrag(mx,my);
  updateLoupeFromPoint(mx,my);
  if (!isDragging) drawCropper();
});
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

function updateLoupeFromPoint(mx,my){
  // just refresh thumbnails; center sample handled in updateCropThumb
  updateCropThumb();
}

// Reset crop
function resetCrop(){
  if (!cropImg) return;
  const s = Math.min(els.cropCanvas.width / cropImg.width, els.cropCanvas.height / cropImg.height);
  const vw = cropImg.width * s, vh = cropImg.height * s;
  const offX = Math.floor((els.cropCanvas.width - vw)/2);
  const offY = Math.floor((els.cropCanvas.height - vh)/2);
  const w = Math.floor(vw*0.7), h = Math.floor(vh*0.7);
  crop = {x: offX + Math.floor((vw - w)/2), y: offY + Math.floor((vh - h)/2), w, h};
  drawCropper();
}

// Load into cropper
function loadIntoCropper(img){
  cropImg = img;
  resetCrop();
  const bw = Math.max(1, parseInt(els.beadW.value||'90',10));
  const bh = Math.max(1, parseInt(els.beadH.value||'50',10));
  els.cropAspectLabel.textContent = `Aspect locked to ${bw}:${bh} beads`;
  drawCropper();
}

// Generate (placeholder hook for final render)
els.btnGen.addEventListener('click', ()=>{
  drawCropper(); // already live
  logStatus("Generated preview.");
});

// Reset crop
els.btnResetCrop.addEventListener('click', ()=>{
  resetCrop();
});

// React to bead size changes
function onBeadAspectChange(){
  const bw = Math.max(1, parseInt(els.beadW.value||'90',10));
  const bh = Math.max(1, parseInt(els.beadH.value||'50',10));
  els.cropAspectLabel.textContent = `Aspect locked to ${bw}:${bh} beads`;
  if (els.lockCropAspect.checked) resetCrop();
  drawCropper();
}
els.beadW.addEventListener('change', onBeadAspectChange);
els.beadH.addEventListener('change', onBeadAspectChange);
els.lockCropAspect.addEventListener('change', onBeadAspectChange);

// File input
els.file.addEventListener('change', async (e)=>{
  const f = e.target.files && e.target.files[0];
  if (!f){ logStatus("No file chosen."); return; }
  setDebugFile(f);
  try{
    const {img, url} = await robustLoadFile(f);
    sourceImg = img; setDebugImage(img);
    if (els.origPreview){ els.origPreview.src = url; markDrew('orig', true); }
    loadIntoCropper(sourceImg);
    drawBeadSim();
    logStatus("Image loaded and UI ready.");
  }catch(err){
    logStatus("Failed to load image: "+err.message);
    alert("Could not load image. If this is an HEIC photo, try a screenshot (PNG) or export JPEG.");
    console.error(err);
  }
});

// Initial draw
drawCropper();
