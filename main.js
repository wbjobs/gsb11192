/* 主线程：文件选择、解码调度、调色板渲染、复制 */
(function () {
  'use strict';

  var MAX_DIM = 800;      // 分析前缩放到的最长边（统计占比不受影响）
  var MAX_COLORS = 8;

  var fileInput = document.getElementById('fileInput');
  var dropZone = document.getElementById('dropZone');
  var statusEl = document.getElementById('status');
  var previewEl = document.getElementById('preview');
  var previewImg = document.getElementById('previewImg');
  var metaEl = document.getElementById('meta');
  var paletteEl = document.getElementById('palette');
  var copyAllBtn = document.getElementById('copyAll');
  var resultSection = document.getElementById('result');

  var worker = new Worker('worker.js');
  var currentColors = [];
  var busy = false;

  // 检测 worker 内解码能力（OffscreenCanvas + createImageBitmap）
  var canDecodeInWorker = typeof OffscreenCanvas !== 'undefined';

  worker.onmessage = function (e) {
    var msg = e.data;
    busy = false;
    if (!msg.ok) {
      setStatus('提取失败：' + msg.error, true);
      return;
    }
    renderResult(msg.result);
  };
  worker.onerror = function (e) {
    busy = false;
    setStatus('Worker 错误：' + (e.message || '未知错误'), true);
  };

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
    fileInput.value = '';
  });

  dropZone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', function () {
    dropZone.classList.remove('dragover');
  });
  dropZone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });
  dropZone.addEventListener('click', function () { fileInput.click(); });

  copyAllBtn.addEventListener('click', function () {
    var text = currentColors.map(function (c) { return c.hex; }).join(', ');
    copyText(text, copyAllBtn);
  });

  function handleFile(file) {
    if (busy) { setStatus('正在处理上一张图片，请稍候…'); return; }
    if (!/^image\//.test(file.type)) {
      setStatus('请选择图片文件（当前：' + (file.type || '未知类型') + '）', true);
      return;
    }
    busy = true;
    resultSection.hidden = true;
    setStatus('正在解码并提取 ' + file.name + '（' + formatSize(file.size) + '）…');

    // 预览用 object URL，不占用额外解码
    previewImg.src = URL.createObjectURL(file);
    previewEl.hidden = false;

    if (canDecodeInWorker) {
      // 全部工作在 worker：解码、缩放、量化
      worker.postMessage({ type: 'file', file: file, maxDim: MAX_DIM, maxColors: MAX_COLORS });
    } else {
      // 回退：主线程 canvas 解码，量化仍在 worker（Transferable 零拷贝）
      decodeOnMainThread(file).then(function (img) {
        worker.postMessage(
          { type: 'pixels', data: img.data.buffer, width: img.width, height: img.height, maxColors: MAX_COLORS },
          [img.data.buffer]
        );
      }).catch(function (err) {
        busy = false;
        setStatus('解码失败：' + err, true);
      });
    }
  }

  function decodeOnMainThread(file) {
    return createImageBitmap(file).then(function (bmp) {
      var scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
      var w = Math.max(1, Math.round(bmp.width * scale));
      var h = Math.max(1, Math.round(bmp.height * scale));
      var canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      var ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
      return ctx.getImageData(0, 0, w, h);
    });
  }

  function renderResult(result) {
    if (!result.colors.length) {
      setStatus('图片完全透明，没有可提取的颜色。', true);
      return;
    }
    setStatus('完成：分析 ' + result.width + '×' + result.height +
      ' 像素，耗时 ' + result.elapsed.toFixed(0) + ' ms');

    currentColors = result.colors.map(function (c) {
      return {
        r: c.r, g: c.g, b: c.b,
        hex: rgbToHex(c.r, c.g, c.b),
        ratio: c.ratio
      };
    });

    metaEl.textContent = '共 ' + currentColors.length + ' 色 · 占比基于全部非透明像素统计';
    paletteEl.innerHTML = '';
    currentColors.forEach(function (c) {
      paletteEl.appendChild(buildCard(c));
    });
    resultSection.hidden = false;
  }

  function buildCard(c) {
    var card = document.createElement('div');
    card.className = 'card';

    var swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.backgroundColor = c.hex;

    var bar = document.createElement('div');
    bar.className = 'bar';
    var fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = (c.ratio * 100).toFixed(2) + '%';
    fill.style.backgroundColor = c.hex;
    bar.appendChild(fill);

    var info = document.createElement('div');
    info.className = 'info';
    info.innerHTML =
      '<div class="row"><span class="label">HEX</span><code>' + c.hex + '</code>' +
      '<button class="copy" data-v="' + c.hex + '">复制</button></div>' +
      '<div class="row"><span class="label">RGB</span><code>' + c.r + ', ' + c.g + ', ' + c.b + '</code>' +
      '<button class="copy" data-v="rgb(' + c.r + ', ' + c.g + ', ' + c.b + ')">复制</button></div>' +
      '<div class="row"><span class="label">占比</span><code>' + (c.ratio * 100).toFixed(2) + '%</code></div>';

    card.appendChild(swatch);
    card.appendChild(bar);
    card.appendChild(info);

    info.addEventListener('click', function (e) {
      var btn = e.target.closest('.copy');
      if (btn) copyText(btn.getAttribute('data-v'), btn);
    });
    return card;
  }

  function copyText(text, btn) {
    function done() {
      var old = btn.textContent;
      btn.textContent = '已复制';
      btn.classList.add('copied');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('copied'); }, 1200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    } else {
      fallbackCopy(text);
      done();
    }
  }

  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function setStatus(msg, isError) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', !!isError);
  }

  function rgbToHex(r, g, b) {
    return '#' + [r, g, b].map(function (v) {
      return v.toString(16).padStart(2, '0');
    }).join('').toUpperCase();
  }

  function formatSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }
})();
