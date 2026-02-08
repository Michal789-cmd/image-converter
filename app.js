const els = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("fileInput"),
  outFormat: document.getElementById("outFormat"),
  formatHint: document.getElementById("formatHint"),
  quality: document.getElementById("quality"),
  qualityVal: document.getElementById("qualityVal"),
  maxSide: document.getElementById("maxSide"),
  jpgBg: document.getElementById("jpgBg"),
  metadataMode: document.getElementById("metadataMode"),
  clearBtn: document.getElementById("clearBtn"),
  convertBtn: document.getElementById("convertBtn"),
  downloadZipBtn: document.getElementById("downloadZipBtn"),
  list: document.getElementById("list"),
};

let queue = [];         // {file}
let results = [];       // {name, blob, mime, note}

function bytes(n) {
  if (n === 0) return "0 B";
  const k = 1024;
  const sizes = ["B","KB","MB","GB"];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(i ? 2 : 0)} ${sizes[i]}`;
}

function supportsMime(mime) {
  const c = document.createElement("canvas");
  // některé prohlížeče nevrátí true/false přímo, tak to zkusíme přes toDataURL
  try {
    const url = c.toDataURL(mime);
    return url.startsWith(`data:${mime}`);
  } catch {
    return false;
  }
}

const OUTPUTS = [
  { ext: "jpg",  mime: "image/jpeg",  label: "JPG (JPEG)" },
  { ext: "png",  mime: "image/png",   label: "PNG" },
  { ext: "webp", mime: "image/webp",  label: "WebP" },
  { ext: "avif", mime: "image/avif",  label: "AVIF (pokud podporováno)" },
];

function refreshFormatOptions() {
  els.outFormat.innerHTML = "";
  for (const o of OUTPUTS) {
    const ok = supportsMime(o.mime);
    const opt = document.createElement("option");
    opt.value = o.ext;
    opt.textContent = ok ? o.label : `${o.label} – nepodporováno prohlížečem`;
    opt.disabled = !ok;
    els.outFormat.appendChild(opt);
  }
  // vyber první podporovaný
  const firstEnabled = [...els.outFormat.options].find(x => !x.disabled);
  if (firstEnabled) els.outFormat.value = firstEnabled.value;

  updateFormatHint();
}

function updateFormatHint() {
  const ext = els.outFormat.value;
  const metaMode = els.metadataMode.value;

  let hint = "";
  if (ext === "jpg") hint = "JPG nepodporuje průhlednost (alfa).";
  if (ext === "avif") hint = "AVIF output záleží na podpoře prohlížeče.";
  if (metaMode === "keep") hint += (hint ? " " : "") + "Ponechání EXIF funguje jen pro JPEG→JPEG.";
  els.formatHint.textContent = hint.trim();
}

function setButtons() {
  const hasQueue = queue.length > 0;
  els.clearBtn.disabled = !hasQueue;
  els.convertBtn.disabled = !hasQueue;
  els.downloadZipBtn.disabled = results.length === 0;
}

function renderList() {
  if (queue.length === 0 && results.length === 0) {
    els.list.classList.add("empty");
    els.list.textContent = "Zatím žádné soubory.";
    return;
  }
  els.list.classList.remove("empty");
  els.list.innerHTML = "";

  for (const item of queue) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div>
        <div class="name">${escapeHtml(item.file.name)}</div>
        <div class="meta">vstup: ${escapeHtml(item.file.type || "unknown")} • ${bytes(item.file.size)}</div>
      </div>
      <div class="right"><span class="badge">čeká</span></div>
    `;
    els.list.appendChild(div);
  }

  for (const r of results) {
    const div = document.createElement("div");
    div.className = "item";
    const note = r.note ? ` • ${escapeHtml(r.note)}` : "";
    div.innerHTML = `
      <div>
        <div class="name">${escapeHtml(r.name)}</div>
        <div class="meta">výstup: ${escapeHtml(r.mime)} • ${bytes(r.blob.size)}${note}</div>
      </div>
      <div class="right">
        <button class="btn" data-download="${escapeHtml(r.name)}">Stáhnout</button>
        <span class="badge">hotovo</span>
      </div>
    `;
    els.list.appendChild(div);
  }

  // download handlers
  els.list.querySelectorAll("button[data-download]").forEach(btn => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-download");
      const r = results.find(x => x.name === name);
      if (r) downloadBlob(r.blob, r.name);
    });
  });
}

function escapeHtml(str) {
  return (str || "").replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[s]));
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function addFiles(fileList) {
  const files = [...fileList];
  for (const f of files) queue.push({ file: f });
  setButtons();
  renderList();
}

async function fileToImageBitmapSmart(file) {
  const name = file.name.toLowerCase();
  const ext = name.includes(".") ? name.split(".").pop() : "";
  const type = (file.type || "").toLowerCase();

  // HEIC/HEIF
  if (ext === "heic" || ext === "heif" || type.includes("heic") || type.includes("heif")) {
    if (!window.heic2any) throw new Error("Knihovna heic2any není dostupná.");
    const convertedBlob = await window.heic2any({
      blob: file,
      toType: "image/png", // decode → PNG
      quality: 1
    });
    const b = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
    return await createImageBitmap(b);
  }

  // TIFF
  if (ext === "tif" || ext === "tiff" || type.includes("tiff")) {
    if (!window.UTIF) throw new Error("Knihovna UTIF není dostupná.");
    const buf = await file.arrayBuffer();
    const ifds = UTIF.decode(buf);
    UTIF.decodeImages(buf, ifds);
    const first = ifds[0];
    const rgba = UTIF.toRGBA8(first);
    const w = first.width, h = first.height;
    const imgData = new ImageData(new Uint8ClampedArray(rgba), w, h);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    canvas.getContext("2d").putImageData(imgData, 0, 0);
    return await createImageBitmap(canvas);
  }

  // ICO
  if (ext === "ico" || type.includes("icon")) {
    if (!window.ico) throw new Error("Knihovna icojs není dostupná.");
    const buf = await file.arrayBuffer();
    const images = await window.ico.parse(buf, "image/png");
    // vezmeme největší
    images.sort((a,b) => (b.width*b.height) - (a.width*a.height));
    const pngBlob = new Blob([images[0].buffer], { type: "image/png" });
    return await createImageBitmap(pngBlob);
  }

  // default – prohlížeč
  return await createImageBitmap(file);
}

function drawToCanvas(bitmap, maxSide) {
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  let dstW = srcW, dstH = srcH;
  const m = Number(maxSide || 0);
  if (m > 0 && Math.max(srcW, srcH) > m) {
    if (srcW >= srcH) {
      dstW = m;
      dstH = Math.round(srcH * (m / srcW));
    } else {
      dstH = m;
      dstW = Math.round(srcW * (m / srcH));
    }
  }

  const canvas = document.createElement("canvas");
  canvas.width = dstW; canvas.height = dstH;
  const ctx = canvas.getContext("2d", { alpha: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  return canvas;
}

function parseRgb(str) {
  const parts = (str || "").split(",").map(x => Number(x.trim()));
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return [255,255,255];
  return parts;
}

async function canvasToBlob(canvas, mime, quality, jpgBgRgb) {
  // pokud jde do JPG a je alfa, nejdřív slož na pozadí
  if (mime === "image/jpeg") {
    const bg = document.createElement("canvas");
    bg.width = canvas.width; bg.height = canvas.height;
    const bctx = bg.getContext("2d", { alpha: false });
    const [r,g,b] = jpgBgRgb;
    bctx.fillStyle = `rgb(${r},${g},${b})`;
    bctx.fillRect(0,0,bg.width,bg.height);
    bctx.drawImage(canvas, 0, 0);
    canvas = bg;
  }

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("Nepodařilo se vytvořit blob (možná nepodporovaný formát)."));
      resolve(blob);
    }, mime, quality);
  });
}

function tryPreserveJpegExif(originalFile, outputBlob, metadataMode, outExt) {
  // Zachování EXIF jen pro JPEG→JPEG a jen pokud uživatel chce "keep"
  const isJpegIn = (originalFile.type || "").toLowerCase().includes("jpeg") ||
                  originalFile.name.toLowerCase().match(/\.(jpe?g)$/);
  const isJpegOut = outExt === "jpg" || outExt === "jpeg";

  if (metadataMode !== "keep" || !isJpegIn || !isJpegOut) {
    return { blob: outputBlob, note: metadataMode === "keep" ? "EXIF zachování jen pro JPEG→JPEG" : "" };
  }
  if (!window.piexif) {
    return { blob: outputBlob, note: "piexifjs není dostupný → EXIF nezachován" };
  }

  // piexifjs pracuje s dataURL (sice ne ideální pro velké soubory, ale funguje)
  return new Promise(async (resolve) => {
    try {
      const inDataUrl = await fileToDataURL(originalFile);
      const outDataUrl = await blobToDataURL(outputBlob);

      const exifObj = window.piexif.load(inDataUrl);
      const exifBytes = window.piexif.dump(exifObj);
      const inserted = window.piexif.insert(exifBytes, outDataUrl);

      const fixedBlob = dataURLToBlob(inserted);
      resolve({ blob: fixedBlob, note: "EXIF zachováno (JPEG→JPEG)" });
    } catch (e) {
      resolve({ blob: outputBlob, note: "EXIF se nepodařilo zachovat" });
    }
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL) {
  const [head, data] = dataURL.split(",");
  const mime = head.match(/data:(.*?);base64/)?.[1] || "application/octet-stream";
  const bin = atob(data);
  const arr = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function convertAll() {
  results = [];
  setButtons();
  renderList();

  const outExt = els.outFormat.value;
  const outMime = OUTPUTS.find(x => x.ext === outExt)?.mime;
  const q = Number(els.quality.value) / 100;
  const maxSide = Number(els.maxSide.value || 0);
  const metadataMode = els.metadataMode.value;
  const jpgBgRgb = parseRgb(els.jpgBg.value);

  for (const item of queue) {
    const f = item.file;

    try {
      const bitmap = await fileToImageBitmapSmart(f);
      const canvas = drawToCanvas(bitmap, maxSide);

      // Kvalita: pro PNG ignorováno, pro JPG/WebP/AVIF použito
      const blob = await canvasToBlob(canvas, outMime, q, jpgBgRgb);

      const baseName = f.name.replace(/\.[^.]+$/, "");
      const outName = `${baseName}.${outExt}`;

      // metadata
      const { blob: finalBlob, note } = await tryPreserveJpegExif(f, blob, metadataMode, outExt);

      results.push({ name: outName, blob: finalBlob, mime: outMime, note });

    } catch (e) {
      results.push({
        name: `${f.name}.ERROR.txt`,
        blob: new Blob([`Chyba při převodu: ${String(e?.message || e)}`], { type: "text/plain" }),
        mime: "text/plain",
        note: "chyba"
      });
    }

    renderList();
  }

  // po konverzi vyprázdníme frontu
  queue = [];
  setButtons();
  renderList();
}

async function downloadZip() {
  if (!window.JSZip) return;

  const zip = new JSZip();
  for (const r of results) {
    zip.file(r.name, r.blob);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  downloadBlob(blob, "converted_images.zip");
}

// UI events
refreshFormatOptions();
setButtons();
renderList();

els.quality.addEventListener("input", () => {
  els.qualityVal.textContent = els.quality.value;
});

els.outFormat.addEventListener("change", updateFormatHint);
els.metadataMode.addEventListener("change", updateFormatHint);

els.fileInput.addEventListener("change", (e) => addFiles(e.target.files));

els.dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  els.dropzone.classList.add("dragover");
});
els.dropzone.addEventListener("dragleave", () => els.dropzone.classList.remove("dragover"));
els.dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  els.dropzone.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
});
els.dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") els.fileInput.click();
});

els.clearBtn.addEventListener("click", () => {
  queue = [];
  results = [];
  setButtons();
  renderList();
});

els.convertBtn.addEventListener("click", convertAll);
els.downloadZipBtn.addEventListener("click", downloadZip);

// enable ZIP button when results exist
const _oldSetButtons = setButtons;
setButtons = function() {
  _oldSetButtons();
  els.downloadZipBtn.disabled = results.length === 0;
};
