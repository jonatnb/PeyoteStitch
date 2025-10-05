// Peyote Pattern Maker — LOCKED to Delica FULL — fixed Delica 11/0 sizing
const $ = (sel) => document.querySelector(sel);
const canvas = $("#preview");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

const els = {
  file: $("#file"),
  beadWidth: $("#beadWidth"),
  beadHeight: $("#beadHeight"),
  kColors: $("#kColors"),
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
let delicaFull = null;
const labCache = new Map();

// Load FULL palette (prefilled; user can replace the JSON file later)
fetch("palettes/delica_full.json").then(r=>r.json()).then(js=>{ delicaFull = js; });

els.file.addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  sourceImg = await loadImage(URL.createObjectURL(f));
  updateFinalSize();
});

els.generate.addEventListener("click", async () => {
  if (!sourceImg) { alert("Please choose an image first."); return; }
  if (!Array.isArray(delicaFull) || delicaFull.length === 0){
    alert("Full palette not loaded. Check palettes/delica_full.json");
    return;
  }
  const beadW = clamp(parseInt(els.beadWidth.value,10) || 80, 8, 400);
  const beadHIn = parseInt(els.beadHeight.value,10) || 0;
  const k = clamp(parseInt(els.kColors.value,10) || 12, 2, 32);
  const cell = clamp(parseInt(els.cellPx.value,10) || 14, 6, 30);
  const offset = !!els.brickOffset.checked;

  let beadH = beadHIn;
  if (beadH <= 0) {
    const ar = sourceImg.height / sourceImg.width;
    beadH = Math.max(8, Math.round(beadW * ar));
  }

  // 1) Quantize to K colors at bead resolution
  const grid = rasterToGrid(sourceImg, beadW, beadH, k);

  // 2) Map each palette color to nearest Delica (Lab ΔE)
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
  grid.mapping = { brand: "delica_full", entries };
  lastGrid = grid;

  // 3) Render + legend + enable exports
  renderGrid(grid, cell, offset, !!els.showGrid.checked);
  buildLegend(grid);
  els.dlPNG.disabled = false;
  els.dlJSON.disabled = false;
  els.dlCSV.disabled = false;
  updateFinalSize();
});

els.dlPNG.addEventListener("click", () => {
  if (!lastGrid) return;
  const png = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = png;
  a.download = "peyote_pattern.png";
  a.click();
});

els.dlJSON.addEventListener("click", () => {
  if (!lastGrid) return;
  const data = JSON.stringify(lastGrid, null, 2);
  const blob = new Blob([data], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "peyote_pattern.json";
  a.click();
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

function loadImage(url) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

function rasterToGrid(img, beadW, beadH, kColors){
  const tmp = document.createElement("canvas");
  tmp.width = beadW;
  tmp.height = beadH;
  const tctx = tmp.getContext("2d", { willReadFrequently: true });
  tctx.imageSmoothingEnabled = true;
  tctx.drawImage(img, 0, 0, beadW, beadH);
  const data = tctx.getImageData(0,0,beadW,beadH).data;

  const pixels = [];
  for (let i=0;i<data.length;i+=4){
    const a = data[i+3];
    if (a<10){ pixels.push([255,255,255]); continue; }
    pixels.push([data[i], data[i+1], data[i+2]]);
  }

  const {palette, labels} = kmeansQuant(pixels, kColors, 10);
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
  const centroids = [];
  const used = new Set();
  while (centroids.length<k){
    const idx = Math.floor(Math.random()*pixels.length);
    if (used.has(idx)) continue;
    used.add(idx);
    centroids.push(pixels[idx].slice());
  }
  let labels = new Array(pixels.length).fill(0);
  for (let it=0; it<iters; it++){
    for (let i=0;i<pixels.length;i++){
      let best=-1, bestd=1e12;
      const [r,g,b] = pixels[i];
      for (let c=0;c<centroids.length;c++){
        const [cr,cg,cb] = centroids[c];
        const d = (r-cr)*(r-cr)+(g-cg)*(g-cg)+(b-cb)*(b-cb);
        if (d<bestd){ bestd=d; best=c; }
      }
      labels[i]=best;
    }
    const acc = Array.from({length:k},()=>[0,0,0,0]);
    for (let i=0;i<pixels.length;i++){
      const c = labels[i];
      const a = acc[c];
      const p = pixels[i];
      a[0]+=p[0]; a[1]+=p[1]; a[2]+=p[2]; a[3]++;
    }
    for (let c=0;c<k;c++){
      const a=acc[c];
      if (a[3]>0){
        centroids[c]=[a[0]/a[3], a[1]/a[3], a[2]/a[3]];
      }
    }
  }
  return { palette: centroids, labels };
}

// ---- Color: sRGB -> Lab + ΔE (with hex -> Lab cache) ----
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

function hexToLab(hex){
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return rgbToLab(r,g,b);
}

function cachedHexToLab(hex){
  let lab = labCache.get(hex);
  if (!lab){
    lab = hexToLab(hex);
    labCache.set(hex, lab);
  }
  return lab;
}

function deltaE(l1, l2){
  const dL = l1.L - l2.L;
  const da = l1.a - l2.a;
  const db = l1.b - l2.b;
  return Math.sqrt(dL*dL + da*da + db*db);
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
  const palName = 'Delica (FULL)';

  container.innerHTML = `
    <h3>Legend — ${palName}</h3>
    <p>${grid.w} × ${grid.h} beads • ${grid.palette.length} colors • ${total} beads</p>
    <div id="legendList"></div>
  `;
  const list = container.querySelector("#legendList");

  rows.forEach(({idx, hex, count, code, name, deltaE})=>{
    const div = document.createElement("div");
    div.className = "legend-row";
    const right = code ? `${code} — ${name} (ΔE ${deltaE}) • ${count}` : `${count}`;
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

function rgbToHex(r,g,b){
  return "#" + [r,g,b].map(v=>v.toString(16).padStart(2,"0")).join("");
}

// ---- Finished size (fixed Delica 11/0 ~1.6×1.3mm) ----
const shrinkPctEl = $("#shrinkPct");
const shrinkLabelEl = $("#shrinkLabel");
const finalSizeEl = $("#finalSize");

function mmToIn(mm){ return mm/25.4; }

function updateFinalSize(){
  const bw = 1.6; // mm
  const bh = 1.3; // mm
  const shrink = (parseInt(shrinkPctEl.value||"0",10))/100;
  const wBeads = clamp(parseInt(els.beadWidth.value,10)||80, 8, 400);
  const hBeads = (parseInt(els.beadHeight.value,10)||0) > 0 ? clamp(parseInt(els.beadHeight.value,10),8,400) : Math.round(wBeads * (sourceImg ? sourceImg.height/sourceImg.width : 1));

  let widthMM = wBeads * bw;
  let heightMM = hBeads * bh;
  if (shrink>0){
    widthMM *= (1 - shrink);
    heightMM *= (1 - shrink);
  }
  const widthIN = mmToIn(widthMM);
  const heightIN = mmToIn(heightMM);
  finalSizeEl.textContent = `Final size: ${widthMM.toFixed(1)} × ${heightMM.toFixed(1)} mm  (${widthIN.toFixed(2)} × ${heightIN.toFixed(2)} in)`;
}

[shrinkPctEl, els.beadWidth, els.beadHeight].forEach(el=> el.addEventListener("input", updateFinalSize));
shrinkPctEl.addEventListener("input", ()=>{ shrinkLabelEl.textContent = shrinkPctEl.value + "%"; });
updateFinalSize();
