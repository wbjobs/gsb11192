# 图片主色调提取 · 调色板生成

纯前端本地工具：选择本地图片后提取主色调，生成 5–8 色调色板，展示每个颜色的 HEX / RGB / 占比，并支持一键复制。只做提取和展示，不做编辑、不做压缩。

## 运行

静态文件，无需构建。由于使用了 Web Worker，需通过 HTTP 访问（不能直接用 `file://` 打开）：

```bash
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 使用

1. 点击或拖拽选择本地图片（JPG / PNG / WebP / GIF / BMP 等）。
2. 自动在后台提取主色调，展示调色板：色块、占比条、HEX、RGB、占比百分比。
3. 点击每项「复制」复制单个值，或「复制全部 HEX」一次复制整个调色板。

## 技术方案

- **Canvas 解码**：`createImageBitmap` 解码时在 GPU/解码层直接缩放到最长边 800px，50MB 大图不会创建巨型位图，内存安全；占比统计基于缩放后全部像素，统计精度不受影响。
- **Web Worker**：解码、缩放、量化全部在 worker 内完成（`OffscreenCanvas`），主线程零阻塞；不支持 `OffscreenCanvas` 的浏览器自动回退为主线程 canvas 解码 + `Transferable` 零拷贝传递像素，量化仍在 worker。
- **TypedArray 量化**：RGBA 像素经 `Uint8ClampedArray` 扫描，5bit/通道直方图（`Uint32Array(32768)`）→ 贪心选取聚类中心（不足 5 色时自动放宽距离阈值）→ 按 bin 加权平均求精颜色并统计占比。
- **Clipboard API**：`navigator.clipboard.writeText`，非安全上下文自动回退 `execCommand('copy')`。

## 边界情况

- **超大图片（50MB+）**：解码阶段即缩放，不占用大内存；提取耗时远小于 3 秒。
- **透明通道**：`alpha=0` 像素跳过；半透明像素按比例合成到白底后再统计；全透明图片给出明确提示，不报错。
- **纯色图片**：返回单色、占比 100%，不报错。
- **灰度图片**：正常处理，调色板均为 R=G=B 的灰色。
- **性能**：64 万像素量化约 10ms（见测试），总耗时主要在图片解码。

## 测试

```bash
node tests/test.js       # 量化核心：纯色/双色占比/透明/灰度/5-8色/性能
node tests/e2e_mock.js   # worker 解码路径：缩放、OffscreenCanvas、消息流、占比
```

`tests/` 下附透明、灰度、纯色测试图，可在页面上直接选用验证。
