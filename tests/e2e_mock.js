// 模拟浏览器环境，验证 worker.js 的 file 解码路径（缩放、OffscreenCanvas、消息流）
const W = 4800, H = 3600; // 模拟 50MB 大图原始尺寸

let drawnAt = null;
globalThis.createImageBitmap = async (file, opts) => {
  if (opts && opts.resizeWidth) {
    return { width: opts.resizeWidth, height: opts.resizeHeight, close() {} };
  }
  return { width: W, height: H, close() {} };
};
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() {
    const { width, height } = this;
    return {
      drawImage(bmp, x, y) { drawnAt = { w: bmp.width, h: bmp.height }; },
      getImageData(x, y, w, h) {
        // 合成 4 个等量大色块 + 1 个透明区
        const d = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < w * h; i++) {
          const px = i % w, py = (i / w) | 0;
          let c;
          if (py < h / 5) c = [0, 0, 0, 0];                    // 全透明，应被跳过
          else if (px < w / 4) c = [220, 30, 30, 255];
          else if (px < w / 2) c = [30, 200, 60, 255];
          else if (px < 3 * w / 4) c = [40, 60, 230, 255];
          else c = [230, 220, 40, 255];
          d.set(c, i * 4);
        }
        return { data: d, width: w, height: h };
      }
    };
  }
};

let messageHandler = null;
globalThis.addEventListener = (ev, fn) => { messageHandler = fn; };
const posted = [];
globalThis.postMessage = (msg) => posted.push(msg);

require('../worker.js');

(async () => {
  messageHandler({ data: { type: 'file', file: { name: 'big.bmp' }, maxDim: 800, maxColors: 8 } });
  await new Promise(r => setTimeout(r, 100));

  const msg = posted[0];
  let pass = true;
  const assert = (name, cond, extra) => {
    console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '  -> ' + extra : ''));
    if (!cond) pass = false;
  };

  assert('消息成功返回', msg && msg.ok === true, JSON.stringify(msg).slice(0, 200));
  const r = msg.result;
  assert('缩放至最长边 800', r.width === 800 && r.height === 600, `${r.width}x${r.height}`);
  assert('drawImage 用缩放后位图', drawnAt && drawnAt.w === 800 && drawnAt.h === 600);
  assert('提取 4 色（透明区被跳过）', r.colors.length === 4, r.colors.length);
  const sum = r.colors.reduce((s, c) => s + c.ratio, 0);
  assert('占比总和=1', Math.abs(sum - 1) < 1e-9, sum);
  assert('各色占比约 25%', r.colors.every(c => Math.abs(c.ratio - 0.25) < 0.01),
    r.colors.map(c => (c.ratio * 100).toFixed(1) + '%').join(','));
  console.log('耗时: ' + r.elapsed.toFixed(1) + 'ms');
  console.log(pass ? '\nE2E_MOCK_ALL_PASS' : '\nE2E_MOCK_FAILED');
  process.exit(pass ? 0 : 1);
})();
