# 图片主色调提取

纯静态页面，选择本地图片后在浏览器内提取 5–8 色主色调色板，展示每个颜色的 HEX、RGB 与占比，点击色块复制 HEX。

## 运行

需要通过 HTTP 访问（Web Worker 不能用 file:// 加载）：

```bash
cd palette-extractor
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 技术方案

- **Canvas + OffscreenCanvas**：在 Worker 内解码并缩放图片，长边超过 400px 先降采样，50MB 大图也能在 3 秒内完成
- **Web Worker**：解码、像素统计全部在 Worker 执行，主线程不卡
- **TypedArray**：`Uint32Array` 直方图（5bit/通道，32768 桶）+ 每桶 RGB 加权和，一次遍历完成统计，桶内取精确均值无色差
- **Clipboard API**：`navigator.clipboard.writeText` 复制 HEX，非安全上下文自动降级 `execCommand`

## 边界处理

- **超大图片**：先缩放到 400px 内再统计，内存与时间恒定
- **透明通道**：全透明像素跳过；半透明像素按白底合成后统计
- **纯色图片**：返回单色色板，不报错
- **灰度图片**：正常输出灰度主色
- **占比**：各色像素数 / 有效像素总数，按占比降序，近似色（RGB 距离 < 28）加权合并
