// Peyote Pattern Maker — v3.4 (Locked to Delica FULL)
const $ = (sel) => document.querySelector(sel);
const canvas = $("#preview");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const els = {
  file: $("#file"),
  beadWidth: $("#beadWidth"),
  beadHeight: $("#beadHeight"),
  autoWidth: $("#autoWidth"),
  autoHeight: $("#autoHeight"),
  lockAspect: $("#lockAspect"),
  kColors: $("#kColors"),
  mapMode: $("#mapMode"),
  cellPx: $("#cellPx"),
  showGrid: $("#showGrid"),
  brickOffset: $("#brickOffset"),
  generate: $("#btnGenerate"),
  dlPNG: $("#btnDownloadPNG"),
  dlJSON: $("#btnDownloadJSON"),
  dlCSV: $("#btnDownloadCSV"),
  legend: $("#legend"),
  // Preview + crop
  origPreview: $("#origPreview"),
  fileInfo: $("#fileInfo"),
  cropThumb: $("#cropThumb"),
  cropCanvas: $("#cropCanvas"),
  btnResetCrop: $("#btnResetCrop"),
  lockCropAspect: $("#lockCropAspect"),
  cropAspectLabel: $("#cropAspectLabel"),
  debugTouch: $("#debugTouch"),
  loupe: $("#loupe"),
  beadSim: $("#beadSim"),
};

let sourceImg = null;

let lastPointer = null;


async function loadFileImage(file){
  // Try createImageBitmap for performance if available
  try {
    if ('createImageBitmap' in window && file && file.type && file.type.startsWith('image/')){
      const bmp = await createImageBitmap(file);
      // Downscale very large images to max dimension 2400px for iOS memory
      const maxDim = 2400;
      let w = bmp.width, h = bmp.height;
      const scale = Math.min(1, maxDim / Math.max(w, h));
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const can = document.createElement('canvas');
      can.width = tw; can.height = th;
      const c2 = can.getContext('2d', { willReadFrequently:true });
      c2.imageSmoothingEnabled = true;
      c2.drawImage(bmp, 0,0, tw,th);
      const dataURL = can.toDataURL('image/jpeg', 0.9);
      const img = await loadImage(dataURL);
      return { img, dataURL };
    }
  } catch(e){ /* continue to FileReader fallback */ }

  // Fallback: FileReader → DataURL
  const dataURL = await new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
  // Optional downscale if huge
  const temp = await loadImage(dataURL);
  const maxDim = 2400;
  let w = temp.width, h = temp.height;
  if (Math.max(w,h) > maxDim){
    const scale = maxDim / Math.max(w,h);
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const can = document.createElement('canvas');
    can.width = tw; can.height = th;
    const c2 = can.getContext('2d', { willReadFrequently:true });
    c2.imageSmoothingEnabled = true;
    c2.drawImage(temp, 0,0, tw,th);
    const downURL = can.toDataURL('image/jpeg', 0.9);
    const img = await loadImage(downURL);
    return { img, dataURL: downURL };
  }
  return { img: temp, dataURL };
}

let lastGrid = null;
let delicaFull = [];

// Immediate fallback palette so previews always have color
window.delicaFull = window.delicaFull || [
  {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
  {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
  {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
  {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
  {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
  {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
];


// Robust palette load (tries multiple paths, sets window.delicaFull)
async function loadDelicaPalette(){
  const paths = ["palettes/delica_full.json", "delica_full.json"];
  for (const p of paths){
    try{
      const r = await fetch(p, {cache:"no-cache"});
      if (r.ok){
        const data = await r.json();
        delicaFull = data; window.delicaFull = data;
        try { drawBeadSim(); } catch(e){}
        return;
      }
    }catch(e){}
  }
  // Fallback minimal palette so bead view still renders
  delicaFull = window.delicaFull = [
    {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
    {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
    {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
    {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
    {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
    {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
  ];
  try { drawBeadSim(); } catch(e){}
}

window.delicaFull = delicaFull;
const labCache = new Map();

// ---- Preview elements ----
const cropThumbCtx = els.cropThumb.getContext("2d", { willReadFrequently:true });
const loupeCtx = els.loupe.getContext("2d", { willReadFrequently:true });
const beadSimCtx = els.beadSim.getContext("2d", { willReadFrequently:true });

// ---- Cropper state ----
const cropCtx = els.cropCanvas.getContext("2d", { willReadFrequently:true });
let cropImg = null;
let viewScale = 1;
let crop = { x:0, y:0, w:0, h:0 };
let dragMode = null; // 'move' or 'nw','ne','sw','se'
let dragOX = 0, dragOY = 0;
let isDragging = false;
let loupePos = null; // {x,y} in image coords relative to original image

function getCanvasPos(e){
  const rect = els.cropCanvas.getBoundingClientRect();
  const scaleX = els.cropCanvas.width / rect.width;
  const scaleY = els.cropCanvas.height / rect.height;
  const mx = (e.clientX - rect.left) * scaleX;
  const my = (e.clientY - rect.top) * scaleY;
  return {mx, my};
}


// Load palette
loadDelicaPalette();

// File handling
els.file.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const { img, dataURL } = await loadFileImage(f);
    sourceImg = img;
    if (els.origPreview) els.origPreview.src = dataURL;
    if (els.fileInfo) els.fileInfo.textContent = `${sourceImg.width}×${sourceImg.height} px • AR ${(sourceImg.width/sourceImg.height).toFixed(3)}`;
    loadIntoCropper(sourceImg); drawBeadSim();
    updateCropThumb();
    
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize();
  } catch (e) {
    if (els.fileInfo) els.fileInfo.textContent = 'Image failed to load. Try a smaller JPEG/PNG.';
    alert('Could not load image. Try a JPEG/PNG under ~8MB.');
    console.error(e);
  }
});

// Auto toggles mutual exclusion
if (els.autoWidth && els.autoHeight){
  els.autoWidth.addEventListener('change', ()=>{ if (els.autoWidth.checked) els.autoHeight.checked=false; updateCropAspectLabel(); 
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize(); });
  els.autoHeight.addEventListener('change', ()=>{ if (els.autoHeight.checked) els.autoWidth.checked=false; updateCropAspectLabel(); 
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize(); });
}
[els.beadWidth, els.beadHeight].forEach(el=> el && el.addEventListener('input', ()=>{ 
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize(); updateCropAspectLabel(); if (els.lockCropAspect && els.lockCropAspect.checked) fitCropToAspect(); }));

// Generate button
els.generate.addEventListener("click", async () => {
  if (!sourceImg) { alert("Please choose an image first."); return; }
  if (!Array.isArray(delicaFull) || delicaFull.length===0){ alert("Full palette not loaded."); return; }

  const dims = computeBeadSize();
  const beadW = dims.w, beadH = dims.h;
  const k = clamp(parseInt(els.kColors.value,10) || 12, 2, 64);
  const cell = clamp(parseInt(els.cellPx.value,10) || 14, 6, 30);
  const offset = !!(els.brickOffset && els.brickOffset.checked);
  const mapMode = els.mapMode ? els.mapMode.value : "palette_fit";

  const cropOpt = cropRegion();
  let grid = null;

  if (mapMode === "direct_to_palette"){
    grid = rasterToGrid(sourceImg, beadW, beadH, Math.min(k, beadW*beadH), cropOpt);
    const beads = delicaFull.map(b=> ({...b, lab: cachedHexToLab(b.hex)}));
    const entriesMap = new Map();
    for (let i=0;i<grid.cells.length;i++){
      const c = grid.cells[i];
      const lab = rgbToLab(c.r, c.g, c.b);
      let best=null, bestD=1e9;
      for (const bead of beads){
        const d = deltaE(lab, bead.lab);
        if (d<bestD){ bestD=d; best=bead; }
      }
      const rr = parseInt(best.hex.slice(1,3),16);
      const gg = parseInt(best.hex.slice(3,5),16);
      const bb = parseInt(best.hex.slice(5,7),16);
      grid.cells[i].r = rr; grid.cells[i].g = gg; grid.cells[i].b = bb;
      const key = best.hex;
      if (!entriesMap.has(key)){
        entriesMap.set(key, { match:{code:best.code,name:best.name,hex:best.hex}, deltaE: parseFloat(bestD.toFixed(2)) });
      }
    }
    finalizeFromSnapped(grid, entriesMap);
  } else if (mapMode === "quantize_then_map") {
    grid = rasterToGrid(sourceImg, beadW, beadH, k, cropOpt);
    const beads = delicaFull.map(b=> ({...b, lab: cachedHexToLab(b.hex)}));
    const entries = [];
    const mappedPalette = grid.palette.map(rgb=>{
      const lab = rgbToLab(rgb.r, rgb.g, rgb.b);
      let best=null, bestD=1e9;
      for (const bead of beads){
        const d = deltaE(lab, bead.lab);
        if (d<bestD){ bestD=d; best=bead; }
      }
      entries.push({ rgb, match: { code:best.code, name:best.name, hex:best.hex }, deltaE: parseFloat(bestD.toFixed(2)) });
      const rr = parseInt(best.hex.slice(1,3),16);
      const gg = parseInt(best.hex.slice(3,5),16);
      const bb = parseInt(best.hex.slice(5,7),16);
      return { r:rr, g:gg, b:bb };
    });
    for (let i=0;i<grid.cells.length;i++){
      const pidx = grid.cells[i].p;
      const mp = mappedPalette[pidx];
      grid.cells[i].r = mp.r; grid.cells[i].g = mp.g; grid.cells[i].b = mp.b;
    }
    grid.palette = mappedPalette;
    grid.mapping = { brand:"delica_full", entries };
  } else {
    // Palette-fit
    grid = rasterToGrid(sourceImg, beadW, beadH, Math.min(k, beadW*beadH), cropOpt);
    const { chosen, chosenEntries } = paletteFit(grid, k);
    const chosenRGB = chosen.map(c => hexToRgbObj(c.hex));
    const chosenLabs = chosen.map(c => cachedHexToLab(c.hex));
    for (let i=0;i<grid.cells.length;i++){
      const c = grid.cells[i];
      const idx = nearestIndexLab(rgbToLab(c.r,c.g,c.b), chosenLabs);
      const rr = chosenRGB[idx].r, gg = chosenRGB[idx].g, bb = chosenRGB[idx].b;
      grid.cells[i].r = rr; grid.cells[i].g = gg; grid.cells[i].b = bb;
      grid.cells[i].p = idx;
    }
    const counts = new Array(chosen.length).fill(0);
    for (let i=0;i<grid.cells.length;i++) counts[ grid.cells[i].p ]++;
    grid.counts = counts;
    grid.palette = chosenRGB;
    grid.mapping = { brand:"delica_full", entries: chosenEntries };
  }

  lastGrid = grid;
  renderGrid(grid, cell, offset, !!(els.showGrid && els.showGrid.checked));
  buildLegend(grid);
  els.dlPNG.disabled = false;
  els.dlJSON.disabled = false;
  els.dlCSV.disabled = false;
  
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize();
});

// Downloads
els.dlPNG.addEventListener("click", () => {
  if (!lastGrid) return;
  const png = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = png; a.download = "peyote_pattern.png"; a.click();
});
els.dlJSON.addEventListener("click", () => {
  if (!lastGrid) return;
  const data = JSON.stringify(lastGrid, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "peyote_pattern.json"; a.click();
  URL.revokeObjectURL(url);
});
els.dlCSV.addEventListener("click", () => {
  if (!lastGrid) return;
  const rows = legendRows(lastGrid);
  const header = "index,hex,count,code,name,deltaE\n";
  const body = rows.map(r => [r.idx+1, r.hex, r.count, r.code||"", csvEscape(r.name||""), r.deltaE??""].join(",")).join("\n");
  downloadBlob(header+body, "text/csv", "peyote_legend.csv");
});

function csvEscape(s){ return '"' + (s.replaceAll('"','""')) + '"'; }
function downloadBlob(text, mime, name){
  const blob = new Blob([text], {type: mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

// ---- Compute bead size (no stretch by default) ----
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function computeBeadSize(){
  const autoW = els.autoWidth && els.autoWidth.checked;
  const autoH = els.autoHeight && els.autoHeight.checked;
  const lockAspect = !els.lockAspect || els.lockAspect.checked;
  let w = parseInt(els.beadWidth.value,10) || 0;
  let h = parseInt(els.beadHeight.value,10) || 0;
  const haveImg = !!sourceImg;
  const ar = haveImg ? (sourceImg.height / sourceImg.width) : 1;

  if (autoW && autoH){
    w = 90; h = Math.max(8, Math.round(w * ar));
  } else if (autoW){
    if (!h || h<8) h = 90;
    w = Math.max(8, Math.round(h / ar));
  } else if (autoH){
    if (!w || w<8) w = 90;
    h = Math.max(8, Math.round(w * ar));
  } else {
    if (lockAspect){
      if (w && !h){ h = Math.max(8, Math.round(w * ar)); }
      else if (h && !w){ w = Math.max(8, Math.round(h / ar)); }
      else if (w && h){ h = Math.max(8, Math.round(w * ar)); }
      else { w = 90; h = Math.max(8, Math.round(w * ar)); }
    } else {
      if (!w) w = 90;
      if (!h) h = Math.max(8, Math.round(w * ar));
    }
  }
  return { w:clamp(w,8,400), h:clamp(h,8,400) };
}

// ---- Cropper ----

function canvasToImage(mx, my){
  const offX = els.cropCanvas._offX||0, offY = els.cropCanvas._offY||0;
  const ix = Math.max(0, Math.min(Math.round((mx - offX)/viewScale), cropImg ? cropImg.width : 0));
  const iy = Math.max(0, Math.min(Math.round((my - offY)/viewScale), cropImg ? cropImg.height : 0));
  return {ix, iy};
}
function updateLoupeFromPoint(mx, my){
  if (!cropImg) return;
  const p = canvasToImage(mx, my);
  loupePos = { x: p.ix, y: p.iy };
  updateCropThumb(); // triggers loupe redraw
}

function loadIntoCropper(img){
  cropImg = img;
  const maxW = els.cropCanvas.width, maxH = els.cropCanvas.height;
  const ar = img.width / img.height;
  let drawW = maxW, drawH = Math.round(maxW / ar);
  if (drawH > maxH){ drawH = maxH; drawW = Math.round(maxH * ar); }
  viewScale = drawW / img.width;
  const offX = Math.floor((maxW - drawW)/2);
  const offY = Math.floor((maxH - drawH)/2);
  els.cropCanvas._offX = offX; els.cropCanvas._offY = offY;
  const cw = Math.floor(drawW*0.7);
  const ch = Math.floor(drawH*0.7);
  crop = { x: offX + Math.floor((drawW - cw)/2), y: offY + Math.floor((drawH - ch)/2), w: cw, h: ch };
  if (els.lockCropAspect && els.lockCropAspect.checked) fitCropToAspect();
  drawCropper(); drawBeadSim();
}
function resetCrop(){
  if (!cropImg) return;
  els.lockCropAspect && (els.lockCropAspect.checked = false);
  loadIntoCropper(cropImg);
}
els.btnResetCrop.addEventListener("click", resetCrop);
els.lockCropAspect.addEventListener("change", ()=>{ fitCropToAspect(); drawCropper(); drawBeadSim(); });

function beadAspect(){
  const dims = computeBeadSize();
  const ar = dims.w / dims.h; // bead width : height
  els.cropAspectLabel.textContent = els.lockCropAspect.checked ? `Aspect locked to ${dims.w}:${dims.h} beads` : "";
  return ar;
}
function updateCropAspectLabel(){ beadAspect(); }

function fitCropToAspect(){
  if (!cropImg) return;
  const targetAR = beadAspect(); // width/height
  const offX = els.cropCanvas._offX||0, offY = els.cropCanvas._offY||0;
  const maxW = Math.round(cropImg.width * viewScale);
  const maxH = Math.round(cropImg.height * viewScale);
  // Start from current center, adjust size to match targetAR without leaving the image box
  const cx = crop.x + crop.w/2, cy = crop.y + crop.h/2;
  let w = crop.w, h = Math.max(20, Math.round(w / targetAR));
  if (h > maxH){ h = maxH; w = Math.round(h * targetAR); }
  if (w > maxW){ w = maxW; h = Math.round(w / targetAR); }
  // Clamp to canvas bounds
  let x = Math.round(cx - w/2), y = Math.round(cy - h/2);
  x = Math.max(offX, Math.min(offX + maxW - w, x));
  y = Math.max(offY, Math.min(offY + maxH - h, y));
  crop = { x, y, w, h };
  updateCropThumb();
}

function drawCropper(){
  if (!cropImg) { cropCtx.clearRect(0,0,els.cropCanvas.width,els.cropCanvas.height); return; }
  const drawW = Math.round(cropImg.width * viewScale);
  const drawH = Math.round(cropImg.height * viewScale);
  const offX = els.cropCanvas._offX||0, offY = els.cropCanvas._offY||0;
  cropCtx.clearRect(0,0,els.cropCanvas.width,els.cropCanvas.height);
  cropCtx.imageSmoothingEnabled = true;
  cropCtx.drawImage(cropImg, offX, offY, drawW, drawH);
  cropCtx.fillStyle = "rgba(0,0,0,0.35)";
  cropCtx.beginPath();
  cropCtx.rect(0,0,els.cropCanvas.width,els.cropCanvas.height);
  cropCtx.rect(crop.x, crop.y, crop.w, crop.h);
  cropCtx.fill("evenodd");
  cropCtx.strokeStyle = "#22c55e";
  cropCtx.lineWidth = 2;
  cropCtx.strokeRect(crop.x+1, crop.y+1, crop.w-2, crop.h-2);
  const handles = handlePoints();
  cropCtx.fillStyle = "#22c55e";
  handles.forEach(p => { cropCtx.beginPath(); cropCtx.arc(p.x, p.y, 9, 0, Math.PI*2); cropCtx.fill(); cropCtx.strokeStyle = '#15803d'; cropCtx.lineWidth = 1; cropCtx.stroke(); });
  if (els.debugTouch && els.debugTouch.checked && lastPointer){
    cropCtx.save();
    cropCtx.strokeStyle = '#ef4444'; cropCtx.fillStyle = '#ef4444';
    cropCtx.beginPath(); cropCtx.arc(lastPointer.mx, lastPointer.my, 4, 0, Math.PI*2); cropCtx.fill();
    cropCtx.beginPath(); cropCtx.moveTo(lastPointer.mx-8, lastPointer.my); cropCtx.lineTo(lastPointer.mx+8, lastPointer.my);
    cropCtx.moveTo(lastPointer.mx, lastPointer.my-8); cropCtx.lineTo(lastPointer.mx, lastPointer.my+8);
    cropCtx.stroke(); cropCtx.restore();
  }
  updateCropThumb();
}
function updateCropThumb(){
  if (!cropImg || !cropThumbCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  // --- Crop preview (contain) ---
  const tw = cropThumb.width, th = cropThumb.height;
  cropThumbCtx.clearRect(0,0,tw,th);
  cropThumbCtx.fillStyle = '#f8fafc';
  cropThumbCtx.fillRect(0,0,tw,th);
  cropThumbCtx.imageSmoothingEnabled = true;
  const scale = Math.min(tw / sw, th / sh);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  const dx = Math.floor((tw - dw)/2);
  const dy = Math.floor((th - dh)/2);
  cropThumbCtx.drawImage(cropImg, sx,sy,sw,sh, dx,dy, dw,dh);
  // --- Loupe (zoom) ---
  const lW = els.loupe.width, lH = els.loupe.height;
  loupeCtx.clearRect(0,0,lW,lH);
  loupeCtx.fillStyle = '#f8fafc'; loupeCtx.fillRect(0,0,lW,lH);
  const zoom = 3; // 3x zoom
  loupeCtx.imageSmoothingEnabled = false; // crisp
  const centerX = loupePos ? loupePos.x : (sx + sw/2);
  const centerY = loupePos ? loupePos.y : (sy + sh/2);
  const srcW = Math.max(1, Math.round(lW / zoom));
  const srcH = Math.max(1, Math.round(lH / zoom));
  const sxx = Math.max(0, Math.min(Math.round(centerX - srcW/2), cropImg.width - srcW));
  const syy = Math.max(0, Math.min(Math.round(centerY - srcH/2), cropImg.height - srcH));
  loupeCtx.drawImage(cropImg, sxx,syy,srcW,srcH, 0,0, lW,lH);
  // --- Bead Sim (quick) ---
  drawBeadSim();
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
function hitHandle(mx, my){
  const rCorner = 22; // generous corner radius for touch
  const edgeBand = 20; // px distance to count as touching an edge
  // Corner checks
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
  // Edge checks (exclude corners so edges don't override them)
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
  // also allow edge dragging with a tolerance band
  const tol = 12;
  if (Math.abs(my - crop.y) <= tol && mx>=crop.x && mx<=crop.x+crop.w) return 'n';
  if (Math.abs(my - (crop.y+crop.h)) <= tol && mx>=crop.x && mx<=crop.x+crop.w) return 's';
  if (Math.abs(mx - crop.x) <= tol && my>=crop.y && my<=crop.y+crop.h) return 'w';
  if (Math.abs(mx - (crop.x+crop.w)) <= tol && my>=crop.y && my<=crop.y+crop.h) return 'e';
  return null;
}

els.cropCanvas.addEventListener('pointerdown', (e)=>{
  const rect = els.cropCanvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left);
  const my = (e.clientY - rect.top);
  const handle = hitHandle(mx, my);
  const inside = (mx>crop.x && mx<crop.x+crop.w && my>crop.y && my<crop.y+crop.h);
  if (!handle && !inside){
    return; // allow scroll
  }
  e.preventDefault();
  try { els.cropCanvas.setPointerCapture(e.pointerId); } catch(_) {}
  // cache the mode so edges don't flicker as finger moves
  dragMode = handle ? handle : 'move';
  dragOX = mx; dragOY = my;
  isDragging = true;
  window.addEventListener('pointermove', onDrag, {passive:true});
  window.addEventListener('pointerup', endDrag, {passive:true});
  window.addEventListener('pointercancel', endDrag, {passive:true});
});

els.cropCanvas.addEventListener('pointermove', (e)=>{ const p = getCanvasPos(e); lastPointer = p; updateLoupeFromPoint(p.mx, p.my); drawCropper(); });
function startDrag(e){
  const rect = els.cropCanvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left);
  const my = (e.clientY - rect.top);
  const handle = hitHandle(mx, my);
  if (handle){ dragMode = handle; }
  else if (mx>crop.x && mx<crop.x+crop.w && my>crop.y && my<crop.y+crop.h){ dragMode='move'; }
  else { dragMode = null; return; }
  dragOX = mx; dragOY = my;
  window.addEventListener('pointermove', onDrag, {passive:true});
  window.addEventListener('pointerup', endDrag, {passive:true});
  window.addEventListener('pointercancel', endDrag, {passive:true});
}
function onDrag(e){ if (!isDragging) return; const p = getCanvasPos(e); updateDrag(p.mx, p.my); }
function updateDrag(mx, my){
  const dx = mx - dragOX, dy = my - dragOY;
  dragOX = mx; dragOY = my;
  if (dragMode === 'move'){
    crop.x = Math.max(0, Math.min(els.cropCanvas.width - crop.w, crop.x + dx));
    crop.y = Math.max(0, Math.min(els.cropCanvas.height - crop.h, crop.y + dy));
  } else if (dragMode){
    if (dragMode.includes('n')){ crop.y += dy; crop.h -= dy; }
    if (dragMode.includes('s')){ crop.h += dy; }
    if (dragMode.includes('w')){ crop.x += dx; crop.w -= dx; }
    if (dragMode.includes('e')){ crop.w += dx; }
    // min size & bounds
    crop.w = Math.max(20, Math.min(crop.w, els.cropCanvas.width - crop.x));
    crop.h = Math.max(20, Math.min(crop.h, els.cropCanvas.height - crop.y));
    if (els.lockCropAspect && els.lockCropAspect.checked){
      fitCropToAspect();
    }
  }
  drawCropper(); drawBeadSim();
}

// Loupe reactive to pointer/touch
els.cropCanvas.addEventListener('mousemove', (e)=>{
  const rect = els.cropCanvas.getBoundingClientRect();
  updateLoupeFromPoint(e.clientX - rect.left, e.clientY - rect.top);
});
els.cropCanvas.addEventListener('touchmove', (e)=>{
  if (!e.touches || !e.touches.length) return;
  const t = e.touches[0];
  const rect = els.cropCanvas.getBoundingClientRect();
  updateLoupeFromPoint(t.clientX - rect.left, t.clientY - rect.top);
  e.preventDefault();
}, {passive:false});

function endDrag(e){ isDragging = false; try{ if (e && e.pointerId) els.cropCanvas.releasePointerCapture(e.pointerId); }catch(_){}
  window.removeEventListener('mousemove', onDrag);
  window.removeEventListener('mouseup', endDrag);
  window.removeEventListener('touchmove', onDragTouch);
  window.removeEventListener('touchend', endDrag);
}
function cropRegion(){
  if (!cropImg) return { sx:0, sy:0, sw:1, sh:1 };
  const offX = els.cropCanvas._offX||0, offY = els.cropCanvas._offY||0;
  const sx = Math.max(0, Math.round((crop.x - offX) / viewScale));
  const sy = Math.max(0, Math.round((crop.y - offY) / viewScale));
  const sw = Math.max(1, Math.round(crop.w / viewScale));
  const sh = Math.max(1, Math.round(crop.h / viewScale));
  return { sx, sy, sw, sh };
}

// ---- Color + mapping helpers ----
function rgbToLab(r,g,b){
  const [R,G,B] = [r,g,b].map(v => {
    v /= 255;
    return v <= 0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4);
  });
  const X = (R*0.4124 + G*0.3576 + B*0.1805) / 0.95047;
  const Y = (R*0.2126 + G*0.7152 + B*0.0722);
  const Z = (R*0.0193 + G*0.1192 + B*0.9505) / 1.08883;
  function f(t){ return t > 0.008856 ? Math.cbrt(t) : (7.787*t + 16/116); }
  const fx = f(X), fy = f(Y), fz = f(Z);
  const L = 116*fy - 16;
  const a = 500*(fx - fy);
  const b2 = 200*(fy - fz);
  return {L,a,b:b2};
}
function deltaE(l1, l2){
  const dL = l1.L - l2.L;
  const da = l1.a - l2.a;
  const db = l1.b - l2.b;
  return Math.sqrt(dL*dL + da*da + db*db);
}
function hexToRgbObj(hex){ return { r:parseInt(hex.slice(1,3),16), g:parseInt(hex.slice(3,5),16), b:parseInt(hex.slice(5,7),16) }; }
function rgbToHex(r,g,b){ return "#" + [r,g,b].map(v=>v.toString(16).padStart(2,"0")).join(""); }
function cachedHexToLab(hex){
  let lab = labCache.get(hex);
  if (!lab){
    const c = hexToRgbObj(hex);
    lab = rgbToLab(c.r, c.g, c.b);
    labCache.set(hex, lab);
  }
  return lab;
}
function nearestIndexLab(lab, labs){
  let best=0, bestD=1e9;
  for (let i=0;i<labs.length;i++){
    const d = deltaE(lab, labs[i]);
    if (d<bestD){ bestD=d; best=i; }
  }
  return best;
}

// Rasterization + K-means
function loadImage(url) { return new Promise((res, rej) => { const img = new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=url; }); }
function rasterToGrid(img, beadW, beadH, kColors, cropOpt){
  const tmp = document.createElement("canvas");
  tmp.width = beadW; tmp.height = beadH;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.imageSmoothingEnabled = true;
  if (cropOpt){ const {sx,sy,sw,sh} = cropOpt; tctx.drawImage(img, sx,sy,sw,sh, 0,0, beadW,beadH); }
  else { tctx.drawImage(img, 0, 0, beadW, beadH); }
  const data = tctx.getImageData(0,0,beadW,beadH).data;
  const pixels = [];
  for (let i=0;i<data.length;i+=4){
    const a=data[i+3]; if (a<10){ pixels.push([255,255,255]); continue; }
    pixels.push([data[i],data[i+1],data[i+2]]);
  }
  const {palette, labels} = kmeansQuant(pixels, Math.min(kColors, beadW*beadH), 10);
  const cells = new Array(beadW*beadH);
  const counts = new Array(palette.length).fill(0);
  for (let i=0;i<labels.length;i++){
    const pidx = labels[i];
    const color = palette[pidx];
    cells[i] = { r:color[0]|0, g:color[1]|0, b:color[2]|0, p:pidx };
    counts[pidx]++;
  }
  return { w:beadW, h:beadH, cells, palette:palette.map(([r,g,b])=>({r:Math.round(r),g:Math.round(g),b:Math.round(b)})), counts };
}
function kmeansQuant(pixels, k, iters=8){
  if (k<=0) k=1;
  const centroids = [];
  const used = new Set();
  while (centroids.length<k){
    const idx = Math.floor(Math.random()*pixels.length);
    if (used.has(idx)) continue;
    used.add(idx); centroids.push(pixels[idx].slice());
  }
  let labels = new Array(pixels.length).fill(0);
  for (let it=0; it<iters; it++){
    for (let i=0;i<pixels.length;i++){
      let best=-1, bestd=1e12; const [r,g,b]=pixels[i];
      for (let c=0;c<centroids.length;c++){
        const [cr,cg,cb]=centroids[c];
        const d=(r-cr)*(r-cr)+(g-cg)*(g-cg)+(b-cb)*(b-cb);
        if (d<bestd){ bestd=d; best=c; }
      }
      labels[i]=best;
    }
    const acc = Array.from({length:k},()=>[0,0,0,0]);
    for (let i=0;i<pixels.length;i++){
      const c = labels[i]; const a=acc[c]; const p=pixels[i];
      a[0]+=p[0]; a[1]+=p[1]; a[2]+=p[2]; a[3]++;
    }
    for (let c=0;c<k;c++){
      const a=acc[c];
      if (a[3]>0){ centroids[c]=[a[0]/a[3], a[1]/a[3], a[2]/a[3]]; }
    }
  }
  return { palette: centroids, labels };
}

// Palette-fit
function paletteFit(grid, k){
  const step = Math.ceil(grid.cells.length/5000);
  const samp = [];
  for (let i=0;i<grid.cells.length;i+=step){
    const c = grid.cells[i]; samp.push(rgbToLab(c.r,c.g,c.b));
  }
  const pal = delicaFull.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  const anchorsHex = anchorListFromGrid(grid);
  const chosen = []; const chosenIdx = new Set();
  for (const hx of anchorsHex){
    const idx = pal.findIndex(b => b.hex.toUpperCase()===hx.toUpperCase());
    if (idx>=0 && !chosenIdx.has(idx)){ chosenIdx.add(idx); chosen.push(pal[idx]); if (chosen.length>=k) break; }
  }
  function totalCost(list){
    const labs = list.map(x=>x.lab);
    let cost = 0;
    for (let s=0;s<samp.length;s++){
      let m = 1e9;
      for (let j=0;j<labs.length;j++){
        const d = deltaE(samp[s], labs[j]);
        if (d<m) m=d;
      }
      cost += m;
    }
    return cost;
  }
  while (chosen.length < k){
    let best=null, bestC=null;
    for (let i=0;i<pal.length;i++){
      if (chosenIdx.has(i)) continue;
      const trial = chosen.concat([pal[i]]);
      const c = totalCost(trial);
      if (bestC===null || c<bestC){ best=pal[i]; bestC=c; }
    }
    if (!best) break;
    chosenIdx.add(pal.indexOf(best)); chosen.push(best);
  }
  const chosenEntries = chosen.map((c)=>({ rgb: hexToRgbObj(c.hex), match:{code:c.code, name:c.name, hex:c.hex}, deltaE:0 }));
  return { chosen, chosenEntries };
}
function anchorListFromGrid(grid){
  const arr = [];
  const step = Math.ceil((grid.cells.length)/4000);
  let cntWhite=0,cntBlack=0,cntYellow=0,cntGreen=0,cntBlue=0, total=0;
  for (let i=0;i<grid.cells.length;i+=step){
    const c = grid.cells[i]; total++;
    const maxv = Math.max(c.r,c.g,c.b), minv = Math.min(c.r,c.g,c.b);
    if (maxv>230 && minv>200) cntWhite++;
    if (maxv<30) cntBlack++;
    const hsv = rgbToHsv(c.r,c.g,c.b);
    if (hsv.s>0.4 && hsv.h>50 && hsv.h<70) cntYellow++;
    if (hsv.s>0.35 && hsv.h>80 && hsv.h<160) cntGreen++;
    if (hsv.s>0.35 && hsv.h>190 && hsv.h<250) cntBlue++;
  }
  const has = (x)=> x/total > 0.02;
  if (has(cntWhite)) arr.push("#FFFFFF");
  if (has(cntBlack)) arr.push("#000000");
  if (has(cntYellow)) arr.push("#F2C100");
  if (has(cntGreen)) arr.push("#2FA53A");
  if (has(cntBlue)) arr.push("#1C62D1");
  return arr;
}
function rgbToHsv(r,g,b){
  r/=255; g/=255; b/=255;
  const max=Math.max(r,g,b), min=Math.min(r,g,b);
  const d=max-min;
  let h=0;
  if (d !== 0){
    switch(max){
      case r: h=(g-b)/d + (g<b?6:0); break;
      case g: h=(b-r)/d + 2; break;
      case b: h=(r-g)/d + 4; break;
    }
    h *= 60;
  }
  const s = max===0?0:d/max;
  const v = max;
  return {h, s, v};
}

// Rendering & Legend
function renderGrid(grid, cellPx, peyoteOffset=true, showGrid=true){
  const pad = 20;
  const w = grid.w, h=grid.h;
  const totalW = pad*2 + (w*cellPx);
  const totalH = pad*2 + h*cellPx;
  canvas.width = totalW;
  canvas.height = totalH;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0,0,totalW,totalH);
  const lineColor="#444";
  ctx.lineWidth = 0.5;
  for (let y=0;y<h;y++){
    const offsetX = peyoteOffset && (y%2===1) ? cellPx/2 : 0;
    for (let x=0;x<w;x++){
      const idx = y*w + x;
      const c = grid.cells[idx];
      const px = pad + offsetX + x*cellPx;
      const py = pad + y*cellPx;
      ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
      ctx.fillRect(px, py, cellPx, cellPx);
      if (showGrid){
        ctx.strokeStyle = lineColor;
        ctx.strokeRect(px+0.25, py+0.25, cellPx-0.5, cellPx-0.5);
      }
    }
  }
}
function legendRows(grid){
  const rows = grid.palette.map((p,i)=>{
    const hex = rgbToHex(p.r,p.g,p.b);
    const count = grid.counts[i] ?? 0;
    let code=null, name=null, deltaEVal=null;
    if (grid.mapping && grid.mapping.entries && grid.mapping.entries[i]){
      const m = grid.mapping.entries[i];
      code = m.match.code; name = m.match.name; deltaEVal = m.deltaE;
    }
    return { idx:i, hex, count, code, name, deltaE: deltaEVal };
  });
  rows.sort((a,b)=> b.count - a.count);
  return rows;
}
function buildLegend(grid){
  const container = els.legend;
  const rows = legendRows(grid);
  const total = grid.counts.reduce((a,b)=>a+b,0);
  container.innerHTML = `
    <h3>Legend — Delica (FULL)</h3>
    <p>${grid.w} × ${grid.h} beads • ${grid.palette.length} colors • ${total} beads</p>
    <div id="legendList"></div>
  `;
  const list = container.querySelector("#legendList");
  rows.forEach(({idx, hex, count, code, name, deltaE})=>{
    const div = document.createElement("div");
    div.className = "legend-row";
    const right = code ? `${code} — ${name} ${typeof deltaE==='number' ? `(ΔE ${deltaE})` : ''} • ${count}` : `${count}`;
    div.innerHTML = `
      <div class="legend-left">
        <span class="swatch" style="background:${hex}"></span>
        <span class="code">#${idx+1}</span>
        <span class="small">${hex}</span>
      </div>
      <div class="small">${right}</div>
    `;
    list.appendChild(div);
  });
}

// Size readout (fixed Delica 11/0 ~1.6×1.3mm)
const shrinkPctEl = $("#shrinkPct");
const shrinkLabelEl = $("#shrinkLabel");
const finalSizeEl = $("#finalSize");
function mmToIn(mm){ return mm/25.4; }
function updateFinalSize(){
  const bw = 1.6, bh = 1.3;
  const shrink = (parseInt((shrinkPctEl && shrinkPctEl.value)||"0",10))/100;
  const dims = computeBeadSize();
  let widthMM = dims.w * bw;
  let heightMM = dims.h * bh;
  if (shrink>0){ widthMM*=(1-shrink); heightMM*=(1-shrink); }
  const widthIN = mmToIn(widthMM);
  const heightIN = mmToIn(heightMM);
  if (finalSizeEl){ finalSizeEl.textContent = `Final size: ${widthMM.toFixed(1)} × ${heightMM.toFixed(1)} mm  (${widthIN.toFixed(2)} × ${heightIN.toFixed(2)} in)`; }
  updateCropAspectLabel();
}
shrinkPctEl && shrinkPctEl.addEventListener("input", ()=>{ if (shrinkLabelEl) shrinkLabelEl.textContent = shrinkPctEl.value + "%"; 
function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize(); });

function drawBeadSim(){
  if (!cropImg || !beadSimCtx) return;
  const {sx,sy,sw,sh} = cropRegion();
  const W = els.beadSim.width, H = els.beadSim.height;
  beadSimCtx.clearRect(0,0,W,H);
  // target grid ~50x (auto aspect)
  const targetW = 50;
  const targetH = Math.max(8, Math.round(targetW * (sh/sw)));
  // sample to a temp canvas
  const t = document.createElement('canvas'); t.width = targetW; t.height = targetH;
  const tctx = t.getContext('2d', { willReadFrequently:true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(cropImg, sx,sy,sw,sh, 0,0, targetW, targetH);
  const data = tctx.getImageData(0,0,targetW,targetH).data;
  // map each pixel to nearest delica color (ΔE in Lab)
  let beadsBase = Array.isArray(window.delicaFull) ? window.delicaFull : [];
  if (!beadsBase || beadsBase.length===0){
    beadsBase = [
      {"code":"DB-0001","name":"Opaque White","hex":"#FFFFFF"},
      {"code":"DB-0002","name":"Opaque Black","hex":"#000000"},
      {"code":"DB-0724","name":"Opaque Yellow","hex":"#F2C100"},
      {"code":"DB-0792","name":"Opaque Cobalt Blue","hex":"#204B9B"},
      {"code":"DB-0206","name":"Matte Opaque Green","hex":"#5DBB74"},
      {"code":"DB-0209","name":"Matte Opaque Brown","hex":"#6D4C41"}
    ];
  }
  const beads = beadsBase.map(b => ({...b, lab: cachedHexToLab(b.hex)}));
  function nearestHex(r,g,b){
    const lab = rgbToLab(r,g,b);
    let best=null, bestD=1e9;
    for (const bead of beads){
      const d = deltaE(lab, bead.lab);
      if (d<bestD){ bestD=d; best=bead; }
    }
    return best ? best.hex : '#cccccc';
  }
  const cellPx = Math.min(10, Math.max(4, Math.floor(Math.min(W/targetW, H/targetH))));
  const ox = Math.floor((W - cellPx*targetW)/2);
  const oy = Math.floor((H - cellPx*targetH)/2);
  beadSimCtx.fillStyle = '#ffffff';
  beadSimCtx.fillRect(0,0,W,H);
  beadSimCtx.imageSmoothingEnabled = false;
  const r = Math.floor(cellPx*0.25); // corner radius
  for (let y=0;y<targetH;y++){
    const rowOffset = 0; // straight grid for preview
    for (let x=0;x<targetW;x++){
      const idx = (y*targetW + x)*4;
      const rr = data[idx], gg = data[idx+1], bb = data[idx+2];
      const hex = nearestHex(rr,gg,bb);
      const px = ox + x*cellPx + rowOffset;
      const py = oy + y*cellPx;
      // rounded bead
      beadSimCtx.fillStyle = hex;
      roundRect(beadSimCtx, px+1, py+1, cellPx-2, cellPx-2, r, true, false);
      // subtle edge
      beadSimCtx.strokeStyle = '#00000022';
      beadSimCtx.strokeRect(px+0.5, py+0.5, cellPx-1, cellPx-1);
    }
  }
}
function roundRect(ctx, x, y, w, h, r, fill, stroke){
  r = Math.min(r, Math.floor(Math.min(w,h)/2));
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  if (fill) ctx.fill();
  if (stroke) ctx.stroke();
}

updateFinalSize();
