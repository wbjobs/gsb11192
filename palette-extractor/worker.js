'use strict';

// 在 Worker 中完成解码、缩放与颜色统计，主线程全程不参与重计算。

const MAX_SAMPLE_SIDE = 400;   // 采样边长上限：50MB 大图先缩放，保证 3 秒内完成
const MAX_COLORS = 8;
const MERGE_DIST_SQ = 3 * 28 * 28; // RGB 距离阈值，近似色合并到同一主色

self.onmessage = async (event) => {
  const blob = event.data.blob;
  try {
    const bitmap = await createImageBitmap(blob);
    const { width, height } = bitmap;

    const scale = Math.min(1, MAX_SAMPLE_SIDE / Math.max(width, height));
    const sampleW = Math.max(1, Math.round(width * scale));
    const sampleH = Math.max(1, Math.round(height * scale));

    const canvas = new OffscreenCanvas(sampleW, sampleH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
    bitmap.close();

    const imageData = ctx.getImageData(0, 0, sampleW, sampleH);
    const palette = extractPalette(imageData.data);

    self.postMessage({
      ok: true,
      width,
      height,
      sampledPixels: sampleW * sampleH,
      palette,
    });
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.message || err) });
  }
};

// 5bit/通道直方图（Uint32Array）+ 近似色加权合并，输出按占比降序的主色。
function extractPalette(pixels) {
  const hist = new Uint32Array(1 << 15); // r5 g5 b5
  const sumR = new Uint32Array(1 << 15);
  const sumG = new Uint32Array(1 << 15);
  const sumB = new Uint32Array(1 << 15);
  const count = pixels.length >> 2;
  let total = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (alpha === 0) continue; // 全透明像素无颜色信息，跳过
    let r = pixels[i];
    let g = pixels[i + 1];
    let b = pixels[i + 2];
    if (alpha !== 255) {
      // 半透明像素按白色底合成，避免透明 PNG 统计出错误的暗色
      r = Math.round((r * alpha + 255 * (255 - alpha)) / 255);
      g = Math.round((g * alpha + 255 * (255 - alpha)) / 255);
      b = Math.round((b * alpha + 255 * (255 - alpha)) / 255);
    }
    const idx = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    hist[idx]++;
    sumR[idx] += r;
    sumG[idx] += g;
    sumB[idx] += b;
    total++;
  }

  if (total === 0) return [];

  // 收集非空桶并按计数降序
  const buckets = [];
  for (let idx = 0; idx < hist.length; idx++) {
    const c = hist[idx];
    if (c === 0) continue;
    buckets.push({
      r: sumR[idx] / c,
      g: sumG[idx] / c,
      b: sumB[idx] / c,
      count: c,
    });
  }
  buckets.sort((a, b2) => b2.count - a.count);

  // 贪心选取主色：与已选颜色过近的桶按计数加权合并进去
  const selected = [];
  for (const bucket of buckets) {
    if (selected.length >= MAX_COLORS) break;
    let target = null;
    for (const sel of selected) {
      const dr = bucket.r - sel.r;
      const dg = bucket.g - sel.g;
      const db = bucket.b - sel.b;
      if (dr * dr + dg * dg + db * db < MERGE_DIST_SQ) { target = sel; break; }
    }
    if (target) {
      const n = target.count + bucket.count;
      target.r = (target.r * target.count + bucket.r * bucket.count) / n;
      target.g = (target.g * target.count + bucket.g * bucket.count) / n;
      target.b = (target.b * target.count + bucket.b * bucket.count) / n;
      target.count = n;
    } else {
      selected.push({ r: bucket.r, g: bucket.g, b: bucket.b, count: bucket.count });
    }
  }

  selected.sort((a, b2) => b2.count - a.count);

  return selected.map((s) => {
    const r = Math.round(s.r);
    const g = Math.round(s.g);
    const b = Math.round(s.b);
    return {
      r, g, b,
      hex: '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(),
      percent: s.count / total * 100,
    };
  });
}
