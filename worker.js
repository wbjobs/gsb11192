/*
 * 调色板提取 Worker
 * 核心：RGB 5bit/通道 直方图 (TypedArray) + 贪心聚类 + 加权平均求精
 * 透明像素：alpha=0 跳过；0<alpha<255 按比例合成到白底
 */
(function (global) {
  'use strict';

  var BIN_SHIFT = 3;          // 8bit -> 5bit
  var BIN_COUNT = 1 << 5;     // 32
  var HIST_SIZE = BIN_COUNT * BIN_COUNT * BIN_COUNT; // 32768

  function binCenter(v) {
    // bin 中心映射回 0-255
    return (v << BIN_SHIFT) + (1 << (BIN_SHIFT - 1));
  }

  /**
   * @param {Uint8ClampedArray} data RGBA 像素
   * @param {number} maxColors 目标最大颜色数
   * @returns {{colors: Array, totalPixels: number, sampledPixels: number}}
   */
  function extractPalette(data, maxColors) {
    var hist = new Uint32Array(HIST_SIZE);
    var total = 0;
    var i, r, g, b, a;

    for (i = 0; i + 3 < data.length; i += 4) {
      a = data[i + 3];
      if (a === 0) continue; // 全透明像素不计入
      r = data[i]; g = data[i + 1]; b = data[i + 2];
      if (a < 255) {
        // 半透明像素合成到白底，保证透明通道结果合理
        r = (r * a + 255 * (255 - a) + 127) / 255 | 0;
        g = (g * a + 255 * (255 - a) + 127) / 255 | 0;
        b = (b * a + 255 * (255 - a) + 127) / 255 | 0;
      }
      hist[((r >> BIN_SHIFT) << 10) | ((g >> BIN_SHIFT) << 5) | (b >> BIN_SHIFT)]++;
      total++;
    }

    if (total === 0) {
      return { colors: [], totalPixels: 0, sampledPixels: 0 };
    }

    // 收集非空 bin 并按计数降序
    var bins = [];
    for (i = 0; i < HIST_SIZE; i++) {
      if (hist[i] > 0) {
        bins.push(i);
      }
    }
    bins.sort(function (x, y) { return hist[y] - hist[x]; });

    // 贪心选取聚类中心：按占比从高到低，跳过与已选中心过近的 bin。
    // 若中心数不足 5，逐步放宽距离阈值重试（保证普通图片能出 5-8 色）。
    var thresholds = [64, 48, 32, 16];
    var centers = null;
    for (var t = 0; t < thresholds.length; t++) {
      centers = pickCenters(bins, hist, maxColors, thresholds[t]);
      if (centers.length >= Math.min(5, bins.length) || centers.length >= maxColors) break;
    }

    // 将每个 bin 指派到最近中心，按 bin 中心颜色加权求均值与占比
    var k = centers.length;
    var sumR = new Float64Array(k);
    var sumG = new Float64Array(k);
    var sumB = new Float64Array(k);
    var counts = new Float64Array(k);

    for (i = 0; i < bins.length; i++) {
      var bin = bins[i];
      var br = binCenter((bin >> 10) & 31);
      var bg = binCenter((bin >> 5) & 31);
      var bb = binCenter(bin & 31);
      var best = 0, bestDist = Infinity;
      for (var c = 0; c < k; c++) {
        var dr = br - centers[c].r;
        var dg = bg - centers[c].g;
        var db = bb - centers[c].b;
        var d = dr * dr + dg * dg + db * db;
        if (d < bestDist) { bestDist = d; best = c; }
      }
      var w = hist[bin];
      sumR[best] += br * w;
      sumG[best] += bg * w;
      sumB[best] += bb * w;
      counts[best] += w;
    }

    var colors = [];
    for (i = 0; i < k; i++) {
      if (counts[i] === 0) continue;
      colors.push({
        r: Math.round(sumR[i] / counts[i]),
        g: Math.round(sumG[i] / counts[i]),
        b: Math.round(sumB[i] / counts[i]),
        ratio: counts[i] / total
      });
    }
    colors.sort(function (x, y) { return y.ratio - x.ratio; });

    return { colors: colors, totalPixels: total, sampledPixels: total };
  }

  function pickCenters(bins, hist, maxColors, minDist) {
    var centers = [];
    var minDist2 = minDist * minDist;
    for (var i = 0; i < bins.length && centers.length < maxColors; i++) {
      var bin = bins[i];
      var r = binCenter((bin >> 10) & 31);
      var g = binCenter((bin >> 5) & 31);
      var b = binCenter(bin & 31);
      var ok = true;
      for (var c = 0; c < centers.length; c++) {
        var dr = r - centers[c].r;
        var dg = g - centers[c].g;
        var db = b - centers[c].b;
        if (dr * dr + dg * dg + db * db < minDist2) { ok = false; break; }
      }
      if (ok) centers.push({ r: r, g: g, b: b });
    }
    return centers;
  }

  var api = { extractPalette: extractPalette };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // Node 测试用
  }

  // Worker 环境消息处理
  if (typeof global.postMessage === 'function' && typeof global.addEventListener === 'function') {
    global.addEventListener('message', function (e) {
      var msg = e.data;
      if (msg.type === 'file') {
        // 在 worker 内解码 + 缩放 + 提取，主线程完全不阻塞
        handleFile(msg);
      } else {
        // 主线程已完成解码，直接处理像素
        try {
          var t0 = performance.now();
          var data = new Uint8ClampedArray(msg.data);
          var result = extractPalette(data, msg.maxColors || 8);
          result.elapsed = performance.now() - t0;
          result.width = msg.width;
          result.height = msg.height;
          global.postMessage({ ok: true, result: result });
        } catch (err) {
          global.postMessage({ ok: false, error: String(err && err.message || err) });
        }
      }
    });
  }

  function handleFile(msg) {
    var t0 = performance.now();
    createImageBitmap(msg.file).then(function (bmp) {
      var scale = Math.min(1, msg.maxDim / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * scale));
      var h = Math.max(1, Math.round(bmp.height * scale));
      bmp.close();
      // 解码阶段直接缩放，避免巨型位图占内存（50MB 大图安全）
      return createImageBitmap(msg.file, {
        resizeWidth: w, resizeHeight: h, resizeQuality: 'high'
      }).then(function (small) {
        var canvas = new OffscreenCanvas(w, h);
        var ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(small, 0, 0);
        small.close();
        var img = ctx.getImageData(0, 0, w, h);
        var t1 = performance.now();
        var result = extractPalette(img.data, msg.maxColors || 8);
        result.elapsed = performance.now() - t0;
        result.quantizeElapsed = performance.now() - t1;
        result.width = w;
        result.height = h;
        global.postMessage({ ok: true, result: result });
      });
    }).catch(function (err) {
      global.postMessage({ ok: false, error: String(err && err.message || err) });
    });
  }
})(typeof self !== 'undefined' ? self : globalThis);
