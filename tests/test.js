/* Node 端核心逻辑测试：node test.js */
const { extractPalette } = require('../worker.js');

let failures = 0;
function check(name, cond, extra) {
  if (cond) { console.log('PASS  ' + name); }
  else { failures++; console.log('FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function makeData(pixels) {
  const d = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach((p, i) => d.set(p, i * 4));
  return d;
}

// 1. 纯色图片：不报错，单色，占比 100%
{
  const px = Array.from({ length: 10000 }, () => [200, 30, 40, 255]);
  const r = extractPalette(makeData(px), 8);
  check('纯色图片返回 1 色', r.colors.length === 1, JSON.stringify(r.colors));
  check('纯色占比 100%', Math.abs(r.colors[0].ratio - 1) < 1e-9);
  const c = r.colors[0];
  check('纯色颜色正确', Math.abs(c.r - 200) <= 4 && Math.abs(c.g - 30) <= 4 && Math.abs(c.b - 40) <= 4,
    `${c.r},${c.g},${c.b}`);
}

// 2. 双色 50/50：占比准确
{
  const px = [];
  for (let i = 0; i < 5000; i++) px.push([255, 0, 0, 255]);
  for (let i = 0; i < 5000; i++) px.push([0, 0, 255, 255]);
  const r = extractPalette(makeData(px), 8);
  check('双色返回 2 色', r.colors.length === 2, r.colors.length);
  check('双色占比各 50%', r.colors.every(c => Math.abs(c.ratio - 0.5) < 0.01),
    r.colors.map(c => c.ratio.toFixed(3)).join(','));
}

// 3. 全透明图片：不报错，返回空
{
  const px = Array.from({ length: 100 }, () => [10, 20, 30, 0]);
  const r = extractPalette(makeData(px), 8);
  check('全透明返回空调色板', r.colors.length === 0);
}

// 4. 半透明红色（alpha≈128）应合成到白底 -> 偏粉
{
  const px = Array.from({ length: 5000 }, () => [255, 0, 0, 128]);
  const r = extractPalette(makeData(px), 8);
  const c = r.colors[0];
  check('半透明合成白底', c && c.r > 240 && c.g > 110 && c.g < 150 && c.b > 110 && c.b < 150,
    c && `${c.r},${c.g},${c.b}`);
}

// 5. 灰度渐变：所有颜色 R=G=B
{
  const px = [];
  for (let v = 0; v < 256; v += 8) {
    for (let i = 0; i < 300; i++) px.push([v, v, v, 255]);
  }
  const r = extractPalette(makeData(px), 8);
  check('灰度图所有颜色 R=G=B', r.colors.every(c => c.r === c.g && c.g === c.b),
    JSON.stringify(r.colors.slice(0, 3)));
  check('灰度图占比总和=1', Math.abs(r.colors.reduce((s, c) => s + c.ratio, 0) - 1) < 1e-9);
}

// 6. 彩色照片风格：5-8 色，占比总和=1
{
  const px = [];
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const clusters = [[220, 40, 40], [40, 200, 60], [30, 60, 220], [230, 210, 50], [200, 60, 200], [240, 240, 240]];
  for (let i = 0; i < 60000; i++) {
    const base = clusters[(rand() * clusters.length) | 0];
    px.push([
      base[0] + (rand() * 30 - 15) | 0,
      base[1] + (rand() * 30 - 15) | 0,
      base[2] + (rand() * 30 - 15) | 0, 255
    ]);
  }
  const r = extractPalette(makeData(px), 8);
  check('彩色图返回 5-8 色', r.colors.length >= 5 && r.colors.length <= 8, r.colors.length);
  check('彩色图占比总和=1', Math.abs(r.colors.reduce((s, c) => s + c.ratio, 0) - 1) < 1e-9);
  check('彩色图按占比降序', r.colors.every((c, i, a) => i === 0 || a[i - 1].ratio >= c.ratio));
}

// 7. 性能：800x800 = 64 万像素
{
  const n = 800 * 800;
  const d = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < d.length; i++) d[i] = (i * 2654435761) >>> 24;
  const t0 = performance.now();
  extractPalette(d, 8);
  const ms = performance.now() - t0;
  check('64 万像素提取 < 3000ms (实际 ' + ms.toFixed(1) + 'ms)', ms < 3000);
}

console.log(failures ? `\n${failures} 个测试失败` : '\n全部测试通过');
process.exit(failures ? 1 : 0);
