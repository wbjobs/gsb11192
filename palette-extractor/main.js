'use strict';

const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const dropText = document.getElementById('dropText');
const result = document.getElementById('result');
const preview = document.getElementById('preview');
const meta = document.getElementById('meta');
const paletteEl = document.getElementById('palette');
const statusEl = document.getElementById('status');

let worker = null;
let previewUrl = null;
let busy = false;

fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
  fileInput.value = '';
});

['dragenter', 'dragover'].forEach((name) =>
  dropzone.addEventListener(name, (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  })
);
['dragleave', 'drop'].forEach((name) =>
  dropzone.addEventListener(name, (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
  })
);
dropzone.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleFile(file);
});

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = 'status' + (cls ? ' ' + cls : '');
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    setStatus('请选择图片文件', 'error');
    return;
  }
  if (busy) return; // 上一次提取仍在进行，避免并发堆积
  busy = true;

  setStatus('正在提取主色调…');
  dropText.textContent = file.name + '（' + formatSize(file.size) + '）';

  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(file);
  preview.src = previewUrl;

  if (worker) worker.terminate();
  worker = new Worker('worker.js');
  const started = performance.now();

  worker.onmessage = (event) => {
    busy = false;
    worker.terminate();
    worker = null;
    const data = event.data;
    if (!data.ok) {
      setStatus('提取失败：' + data.error, 'error');
      return;
    }
    const elapsed = ((performance.now() - started) / 1000).toFixed(2);
    renderPalette(data.palette);
    meta.innerHTML =
      '尺寸：' + data.width + ' × ' + data.height + ' px<br>' +
      '文件大小：' + formatSize(file.size) + '<br>' +
      '采样像素：' + data.sampledPixels.toLocaleString() + '<br>' +
      '耗时：' + elapsed + ' s';
    if (data.palette.length === 0) {
      setStatus('图片完全透明，没有可提取的颜色', 'error');
    } else {
      setStatus('提取完成，共 ' + data.palette.length + ' 色，用时 ' + elapsed + ' 秒', 'ok');
    }
    result.hidden = false;
  };

  worker.onerror = (err) => {
    busy = false;
    setStatus('提取失败：' + (err.message || '未知错误'), 'error');
  };

  worker.postMessage({ blob: file });
}

function renderPalette(palette) {
  paletteEl.innerHTML = '';
  for (const color of palette) {
    const rgbCss = 'rgb(' + color.r + ', ' + color.g + ', ' + color.b + ')';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'swatch';
    btn.title = '点击复制 ' + color.hex;

    const textColor = isLight(color.r, color.g, color.b) ? '#222' : '#fff';
    btn.innerHTML =
      '<div class="color" style="background:' + rgbCss + ';color:' + textColor + '">' +
        color.percent.toFixed(1) + '%</div>' +
      '<div class="info">' +
        '<div class="hex">' + color.hex + '</div>' +
        '<div>RGB(' + color.r + ', ' + color.g + ', ' + color.b + ')</div>' +
      '</div>';

    btn.addEventListener('click', () => copyHex(color.hex, btn));
    paletteEl.appendChild(btn);
  }
}

function isLight(r, g, b) {
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

async function copyHex(hex, btn) {
  try {
    await navigator.clipboard.writeText(hex);
  } catch (_) {
    // 剪贴板 API 不可用（非安全上下文）时的降级方案
    const ta = document.createElement('textarea');
    ta.value = hex;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const hexEl = btn.querySelector('.hex');
  const original = hexEl.textContent;
  hexEl.textContent = '已复制 ' + hex;
  setTimeout(() => { hexEl.textContent = original; }, 900);
}

function formatSize(bytes) {
  if (bytes >= 1 << 20) return (bytes / (1 << 20)).toFixed(1) + ' MB';
  if (bytes >= 1 << 10) return (bytes / (1 << 10)).toFixed(1) + ' KB';
  return bytes + ' B';
}
