// Peyote Pattern Maker — v3 (Locked to Delica FULL) with Palette-fit mode
const $ = (sel) => document.querySelector(sel);
const canvas = $("#preview");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const els = {
  file: $("#file"),
  beadWidth: $("#beadWidth"),
  beadHeight: $("#beadHeight"),
  autoWidth: $("#autoWidth"),
  autoHeight: $("#autoHeight"),
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
};

let sourceImg = null;
let lastGrid = null;
let delicaFull = [];
const labCache = new Map();

fetch("palettes/delica_full.json").then(r=>r.json()).then(js=>{ delicaFull = js; });

els.file.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  sourceImg = await loadImage(URL.createObjectURL(f));
  updateFinalSize();
});

if (els.autoWidth && els.autoHeight){
  els.autoWidth.addEventListener('change', ()=>{ if (els.autoWidth.checked) els.autoHeight.checked=false; updateFinalSize(); });
  els.autoHeight.addEventListener('change', ()=>{ if (els.autoHeight.checked) els.autoWidth.checked=false; updateFinalSize(); });
}
[els.beadWidth, els.beadHeight].forEach(el=> el && el.addEventListener('input', updateFinalSize));

els.generate.addEventListener("click", async () => {
  if (!sourceImg) { alert("Please choose an image first."); return; }
  if (!Array.isArray(delicaFull) || delicaFull.length===0){ alert("Full palette not loaded."); return; }

  const dims = computeBeadSize();
  const beadW = dims.w, beadH = dims.h;
  const k = clamp(parseInt(els.kColors.value,10) || 12, 2, 64);
  const cell = clamp(parseInt(els.cellPx.value,10) || 14, 6, 30);
  const offset = !!(els.brickOffset && els.brickOffset.checked);
  const mapMode = els.mapMode ? els.mapMode.value : "palette_fit";

  let grid = null;

  if (mapMode === "direct_to_palette"){
    // Downsample then snap each cell directly to nearest Delica (no K-means)
    grid = rasterToGrid(sourceImg, beadW, beadH, Math.min(k, beadW*beadH));
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
    // Original flow: K-means to K colors, then map those K to nearest Delica
    grid = rasterToGrid(sourceImg, beadW, beadH, k);
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
    // v3: PALETTE-FIT — choose k actual Delica colors that best cover the image
    grid = rasterToGrid(sourceImg, beadW, beadH, Math.min(k, beadW*beadH)); // just to get bead-sized pixels
    const { chosen, chosenEntries } = paletteFit(grid, k);
    // Map each cell to nearest chosen color
    const chosenRGB = chosen.map(c => hexToRgbObj(c.hex));
    for (let i=0;i<grid.cells.length;i++){
      const c = grid.cells[i];
      const idx = nearestIndexLab(rgbToLab(c.r,c.g,c.b), chosen.map(c=>cachedHexToLab(c.hex)));
      const rr = chosenRGB[idx].r, gg = chosenRGB[idx].g, bb = chosenRGB[idx].b;
      grid.cells[i].r = rr; grid.cells[i].g = gg; grid.cells[i].b = bb;
      grid.cells[i].p = idx;
    }
    // Build palette/counts
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
  updateFinalSize();
});

// ---- Helpers shared across modes ----
function finalizeFromSnapped(grid, entriesMap){
  const mapIdx = new Map(); const palette=[]; const counts=[];
  for (let i=0;i<grid.cells.length;i++){
    const h = rgbToHex(grid.cells[i].r, grid.cells[i].g, grid.cells[i].b);
    if (!mapIdx.has(h)){ mapIdx.set(h, palette.length); palette.push(hexToRgbObj(h)); counts.push(0); }
    const pi = mapIdx.get(h); grid.cells[i].p = pi; counts[pi]++;
  }
  grid.palette = palette;
  grid.counts = counts;
  const entries = grid.palette.map(p => {
    const hex = rgbToHex(p.r,p.g,p.b);
    const info = entriesMap.get(hex) || { match:{code:'',name:'',hex}, deltaE:0 };
    return { rgb:p, ...info };
  });
  grid.mapping = { brand: 'delica_full', entries };
}

function paletteFit(grid, k){
  // 1) Sample pixels (Lab) for speed
  const samples = [];
  for (let i=0;i<grid.cells.length;i+= Math.ceil(grid.cells.length/5000) ){
    const c = grid.cells[i]; samples.push(rgbToLab(c.r,c.g,c.b));
  }
  const samp = samples;

  // 2) Build palette Lab cache
  const pal = delicaFull.map(b => ({...b, lab: cachedHexToLab(b.hex)}));

  // 3) Anchor detection (white, black, yellow, green, blue) — if present in image, seed them
  const anchorsHex = anchorListFromGrid(grid);
  const chosen = [];
  const chosenIdx = new Set();
  for (const hx of anchorsHex){
    const idx = pal.findIndex(b => b.hex.toUpperCase()===hx.toUpperCase());
    if (idx>=0 && !chosenIdx.has(idx)){
      chosenIdx.add(idx); chosen.push(pal[idx]);
      if (chosen.length>=k) break;
    }
  }

  // 4) Greedy facility-location: add beads that most reduce total distance
  function totalCost(list){
    const labs = list.map(x=>x.lab);
    const mins = samp.map(s => {
      let m = 1e9;
      for (const L of labs){
        const d = deltaE(s, L);
        if (d<m) m=d;
      }
      return m;
    });
    return mins.reduce((a,b)=>a+b,0);
  }
  let bestCost = chosen.length? totalCost(chosen): Infinity;
  while (chosen.length < k){
    let best=null, bestC=null;
    for (let i=0;i<pal.length;i++){
      if (chosenIdx.has(i)) continue;
      const trial = chosen.concat([pal[i]]);
      const c = totalCost(trial);
      if (bestC===null || c<bestC){ best=pal[i]; bestC=c; }
    }
    if (!best) break;
    chosen.push(best); chosenIdx.add(pal.indexOf(best)); bestCost=bestC;
  }

  // 5) Return chosen plus mapping entries (ΔE from an average of nearest region)
  const chosenEntries = chosen.map((c)=>({ rgb: hexToRgbObj(c.hex), match:{code:c.code, name:c.name, hex:c.hex}, deltaE:0 }));
  return { chosen, chosenEntries };
}

function anchorListFromGrid(grid){
  // quick HSV presence-based anchors
  const arr = [];
  const step = Math.ceil((grid.cells.length)/4000);
  let cntWhite=0,cntBlack=0,cntYellow=0,cntGreen=0,cntBlue=0, total=0;
  for (let i=0;i<grid.cells.length;i+=step){
    const c = grid.cells[i]; total++;
    const maxv = Math.max(c.r,c.g,c.b), minv = Math.min(c.r,c.g,c.b);
    if (maxv>230 && minv>200) cntWhite++;
    if (maxv<30) cntBlack++;
    // HSV approx
    const hsv = rgbToHsv(c.r,c.g,c.b);
    if (hsv.s>0.4 && hsv.h>50 && hsv.h<70) cntYellow++;
    if (hsv.s>0.35 && hsv.h>80 && hsv.h<160) cntGreen++;
    if (hsv.s>0.35 && hsv.h>190 && hsv.h<250) cntBlue++;
  }
  const has = (x)=> x/total > 0.02; // >2% presence
  if (has(cntWhite)) arr.push("#FFFFFF");
  if (has(cntBlack)) arr.push("#000000");
  if (has(cntYellow)) arr.push("#F2C100");
  if (has(cntGreen)) arr.push("#2FA53A");
  if (has(cntBlue)) arr.push("#1C62D1");
  return arr;
}

// ---- Rasterization & K-means ----
function loadImage(url) {
  return new Promise((res, rej) => { const img = new Image(); img.onload=()=>res(img); img.onerror=rej; img.src=url; });
}
function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }
function computeBeadSize(){
  const autoW = els.autoWidth && els.autoWidth.checked;
  const autoH = els.autoHeight && els.autoHeight.checked;
  let w = parseInt(els.beadWidth.value,10) || 0;
  let h = parseInt(els.beadHeight.value,10) || 0;
  const haveImg = !!sourceImg;
  const ar = haveImg ? (sourceImg.height / sourceImg.width) : 1;
  if (autoW && autoH){ w=90; h=Math.max(8,Math.round(w*ar)); }
  else if (autoW){ if (!h||h<8) h=90; w=Math.max(8,Math.round(h/ar)); }
  else if (autoH){ if (!w||w<8) w=90; h=Math.max(8,Math.round(w*ar)); }
  else { if (!w) w=90; if (!h) h=Math.max(8,Math.round(w*ar)); }
  return { w:clamp(w,8,400), h:clamp(h,8,400) };
}
function rasterToGrid(img, beadW, beadH, kColors){
  const tmp = document.createElement("canvas");
  tmp.width = beadW; tmp.height = beadH;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(img, 0, 0, beadW, beadH);
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

// ---- Color conversions & ΔE ----
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
  if (!lab){ lab = rgbToLab(hexToRgbObj(hex).r, hexToRgbObj(hex).g, hexToRgbObj(hex).b); labCache.set(hex, lab); }
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

// ---- Rendering & Legend ----
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

// Finished size (fixed Delica 11/0 ~1.6×1.3mm)
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
  if (finalSizeEl){
    finalSizeEl.textContent = `Final size: ${widthMM.toFixed(1)} × ${heightMM.toFixed(1)} mm  (${widthIN.toFixed(2)} × ${heightIN.toFixed(2)} in)`;
  }
}
shrinkPctEl && shrinkPctEl.addEventListener("input", ()=>{ if (shrinkLabelEl) shrinkLabelEl.textContent = shrinkPctEl.value + "%"; updateFinalSize(); });
updateFinalSize();
