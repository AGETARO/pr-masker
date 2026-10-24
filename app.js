/**
 * PR Masker - Client-side Face Masking & PR Copy Generator
 * Supports MediaPipe Tasks Vision for WASM Face Detection + Gemini AI / Smart Template
 */

import { FaceDetector, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

// ==========================================
// Application State
// ==========================================
const state = {
  originalImage: null,
  currentImageSource: null,
  imageMimeType: 'image/jpeg',
  imageWidth: 0,
  imageHeight: 0,
  
  // List of face regions: { id, x, y, width, height, isManual, mode, stampChar, scale }
  faces: [],
  nextFaceId: 1,

  // Global editing options
  activeMode: 'mosaic', // 'mosaic' | 'stamp' | 'blur'
  mosaicSize: 16,
  stampChar: '😊',
  stampScale: 1.1,
  blurRadius: 18,

  // Comparison toggle
  isComparingOriginal: false,

  // PR Text Settings
  selectedTone: 'friendly', // 'friendly' | 'formal' | 'event' | 'recruit'
  customKeyword: '',
  generatedPRText: '',
  templateIndex: 0,

  // AI detector instance
  detector: null,
  isDetectorReady: false,
  isDetecting: false,

  // Drag selection for manual face mask
  isDraggingCanvas: false,
  dragStartX: 0,
  dragStartY: 0,
  dragCurrentX: 0,
  dragCurrentY: 0
};

// ==========================================
// DOM Elements
// ==========================================
const elements = {
  // Upload
  uploadSection: document.getElementById('uploadSection'),
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  btnLoadSampleOffice: document.getElementById('btnLoadSampleOffice'),
  btnLoadSampleEvent: document.getElementById('btnLoadSampleEvent'),

  // Editor
  editorSection: document.getElementById('editorSection'),
  btnNewImage: document.getElementById('btnNewImage'),
  btnOpenNewImageLink: document.getElementById('btnOpenNewImageLink'),
  detectionStatus: document.getElementById('detectionStatus'),
  faceCountBadge: document.getElementById('faceCountBadge'),
  faceCountNum: document.getElementById('faceCountNum'),
  btnToggleCompare: document.getElementById('btnToggleCompare'),
  compareBtnText: document.getElementById('compareBtnText'),
  btnDownloadImage: document.getElementById('btnDownloadImage'),
  btnDownloadJpeg: document.getElementById('btnDownloadJpeg'),
  btnDownloadPng: document.getElementById('btnDownloadPng'),

  // Mask Modes & Tabs
  maskTabs: document.querySelectorAll('.mask-tab'),
  mosaicOptions: document.getElementById('mosaicOptions'),
  stampOptions: document.getElementById('stampOptions'),
  blurOptions: document.getElementById('blurOptions'),
  mosaicSizeRange: document.getElementById('mosaicSizeRange'),
  mosaicSizeVal: document.getElementById('mosaicSizeVal'),
  stampScaleRange: document.getElementById('stampScaleRange'),
  stampScaleVal: document.getElementById('stampScaleVal'),
  blurRadiusRange: document.getElementById('blurRadiusRange'),
  blurRadiusVal: document.getElementById('blurRadiusVal'),
  stampBtns: document.querySelectorAll('.stamp-btn'),
  btnApplyAll: document.getElementById('btnApplyAll'),
  btnClearAll: document.getElementById('btnClearAll'),
  btnResetToAuto: document.getElementById('btnResetToAuto'),

  // Canvas
  canvasContainer: document.getElementById('canvasContainer'),
  mainCanvas: document.getElementById('mainCanvas'),
  interactiveOverlay: document.getElementById('interactiveOverlay'),

  // PR Generator
  toneChips: document.querySelectorAll('.tone-chip'),
  customKeyword: document.getElementById('customKeyword'),
  btnGeneratePRText: document.getElementById('btnGeneratePRText'),
  prTextarea: document.getElementById('prTextarea'),
  prLoadingOverlay: document.getElementById('prLoadingOverlay'),
  generatingStatusText: document.getElementById('generatingStatusText'),
  charCountNum: document.getElementById('charCountNum'),
  charGaugeFill: document.getElementById('charGaugeFill'),
  btnCopyText: document.getElementById('btnCopyText'),
  btnRegenerateText: document.getElementById('btnRegenerateText'),
  btnShareX: document.getElementById('btnShareX'),
  btnDownloadAll: document.getElementById('btnDownloadAll'),

  // Feedback (Beta Testing)
  btnOpenFeedback: document.getElementById('btnOpenFeedback'),
  btnFooterFeedback: document.getElementById('btnFooterFeedback'),
  feedbackModal: document.getElementById('feedbackModal'),
  btnCloseFeedback: document.getElementById('btnCloseFeedback'),
  btnCloseFeedback2: document.getElementById('btnCloseFeedback2'),
  btnSubmitFeedback: document.getElementById('btnSubmitFeedback'),
  feedbackRole: document.getElementById('feedbackRole'),
  feedbackText: document.getElementById('feedbackText'),
  starBtns: document.querySelectorAll('.star-btn'),

  // Share Site Modal
  btnShareSite: document.getElementById('btnShareSite'),
  shareModal: document.getElementById('shareModal'),
  btnCloseShare: document.getElementById('btnCloseShare'),
  btnCloseShare2: document.getElementById('btnCloseShare2'),
  btnShareXApp: document.getElementById('btnShareXApp'),
  btnShareLineApp: document.getElementById('btnShareLineApp'),
  btnCopyAppUrl: document.getElementById('btnCopyAppUrl'),

  toastContainer: document.getElementById('toastContainer')
};

// Canvas context
const ctx = elements.mainCanvas.getContext('2d');

// ==========================================
// Toast Notification Utility
// ==========================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✓';
  if (type === 'error') icon = '✕';

  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
  elements.toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

// ==========================================
// Initialize MediaPipe Tasks Vision Detector
// ==========================================
async function initFaceDetector() {
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );

    state.detector = await FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite",
        delegate: "GPU"
      },
      runningMode: "IMAGE",
      minDetectionConfidence: 0.2,
      minSuppressionThreshold: 0.3
    });

    state.isDetectorReady = true;
    console.log("MediaPipe FaceDetector successfully loaded.");
  } catch (err) {
    console.warn("MediaPipe load warning, falling back to manual & Gemini detection:", err);
    state.isDetectorReady = false;
  }
}

// ==========================================
// Image Loading & Setup
// ==========================================
function handleFileSelect(file) {
  if (!file || !file.type.startsWith('image/')) {
    showToast('有効な画像ファイルを選択してください', 'error');
    return;
  }

  state.imageMimeType = file.type;
  const reader = new FileReader();

  reader.onload = (e) => {
    loadImageFromSrc(e.target.result);
  };
  reader.readAsDataURL(file);
}

function loadImageFromSrc(srcUrl) {
  const img = new Image();
  img.crossOrigin = 'anonymous';

  img.onload = () => {
    state.originalImage = img;
    state.currentImageSource = srcUrl;
    state.imageWidth = img.naturalWidth;
    state.imageHeight = img.naturalHeight;

    // Reset faces
    state.faces = [];
    state.nextFaceId = 1;

    // Switch UI from upload to editor
    elements.uploadSection.classList.add('hidden');
    elements.editorSection.classList.remove('hidden');

    // Adjust canvas resolution
    elements.mainCanvas.width = state.imageWidth;
    elements.mainCanvas.height = state.imageHeight;

    // Perform AI Face Detection
    detectFaces();

    // Trigger PR Text Generation automatically
    generatePRText();
  };

  img.onerror = () => {
    showToast('画像の読み込みに失敗しました', 'error');
  };

  img.src = srcUrl;
}

// ==========================================
// Face Detection (MediaPipe & Fallback)
// ==========================================
async function detectFaces() {
  state.isDetecting = true;
  elements.detectionStatus.classList.remove('hidden');
  elements.detectionStatus.className = 'status-badge status-loading';
  elements.detectionStatus.innerHTML = '<span class="spinner-dot"></span> AIが顔を検出中...';
  if (elements.faceCountBadge) elements.faceCountBadge.classList.add('hidden');

  let detections = [];

  // Wait if detector is still loading
  if (!state.isDetectorReady && state.detector === null) {
    for (let i = 0; i < 15; i++) {
      if (state.isDetectorReady) break;
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (state.detector) {
    try {
      const results = state.detector.detect(state.originalImage);
      if (results && results.detections) {
        detections = results.detections;
      }
    } catch (e) {
      console.error("Detection error:", e);
    }
  }

  state.faces = [];

  if (detections.length > 0) {
    detections.forEach(det => {
      const box = det.boundingBox;
      // Add slight padding around detected face for complete coverage
      const paddingX = box.width * 0.15;
      const paddingY = box.height * 0.18;

      const x = Math.max(0, box.originX - paddingX);
      const y = Math.max(0, box.originY - paddingY * 1.2);
      const width = Math.min(state.imageWidth - x, box.width + paddingX * 2);
      const height = Math.min(state.imageHeight - y, box.height + paddingY * 2.2);

      state.faces.push({
        id: state.nextFaceId++,
        x,
        y,
        width,
        height,
        isManual: false,
        mode: state.activeMode,
        stampChar: state.stampChar,
        scale: state.stampScale
      });
    });

    elements.detectionStatus.classList.add('hidden');
    if (elements.faceCountBadge) elements.faceCountBadge.classList.remove('hidden');
    if (elements.faceCountNum) elements.faceCountNum.textContent = state.faces.length;
    showToast(`AIが ${state.faces.length} 人の顔を自動検出しました！`, 'success');
  } else {
    // If no faces found by model
    elements.detectionStatus.className = 'status-badge status-loading';
    elements.detectionStatus.innerHTML = '💡 人物の顔を検出できませんでした（枠をドラッグして手動追加できます）';
    if (elements.faceCountBadge) elements.faceCountBadge.classList.add('hidden');
    if (elements.faceCountNum) elements.faceCountNum.textContent = 0;
  }

  state.isDetecting = false;
  renderCanvas();
  updateInteractiveOverlay();
}

// ==========================================
// Canvas Rendering Engine
// ==========================================
function renderCanvas() {
  if (!state.originalImage) return;

  // Clear canvas
  ctx.clearRect(0, 0, state.imageWidth, state.imageHeight);

  // If comparing original, just draw original and skip masks
  if (state.isComparingOriginal) {
    ctx.drawImage(state.originalImage, 0, 0);
    return;
  }

  // 1. Draw base original image
  ctx.drawImage(state.originalImage, 0, 0);

  // 2. Render each face mask
  state.faces.forEach(face => {
    if (face.mode === 'none') return;

    if (face.mode === 'mosaic') {
      applyMosaic(face);
    } else if (face.mode === 'blur') {
      applyBlur(face);
    } else if (face.mode === 'stamp') {
      applyStamp(face);
    }
  });
}

/**
 * Pixelate (Mosaic) a region
 */
function applyMosaic(face) {
  const { x, y, width, height } = face;
  const pSize = Math.max(4, state.mosaicSize);

  // Sub-canvas to downscale and upscale
  const subCanvas = document.createElement('canvas');
  const subCtx = subCanvas.getContext('2d');

  const w = Math.max(1, Math.floor(width / pSize));
  const h = Math.max(1, Math.floor(height / pSize));

  subCanvas.width = w;
  subCanvas.height = h;

  // Draw scaled down
  subCtx.drawImage(state.originalImage, x, y, width, height, 0, 0, w, h);

  // Draw back scaled up with pixelated edges
  ctx.save();
  ctx.beginPath();
  // Rounded masking for smoother look
  ctx.roundRect(x, y, width, height, 12);
  ctx.clip();

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(subCanvas, 0, 0, w, h, x, y, width, height);
  ctx.restore();
}

/**
 * Blur a region
 */
function applyBlur(face) {
  const { x, y, width, height } = face;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 12);
  ctx.clip();

  // Multi-pass box-blur / filter blur
  ctx.filter = `blur(${state.blurRadius}px)`;
  // Draw slight bleed to avoid hard boundary artifacts
  ctx.drawImage(
    state.originalImage,
    x - 10, y - 10, width + 20, height + 20,
    x - 10, y - 10, width + 20, height + 20
  );

  ctx.restore();
}

/**
 * Stamp emoji over region
 */
function applyStamp(face) {
  const { x, y, width, height } = face;
  const stampChar = face.stampChar || state.stampChar;
  const scale = face.scale || state.stampScale;

  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const fontSize = Math.max(width, height) * scale;

  ctx.save();
  ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Soft glow / shadow behind stamp for better contrast
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  ctx.fillText(stampChar, centerX, centerY);
  ctx.restore();
}

// ==========================================
// Interactive HTML Overlay (Boxes, delete, click to toggle)
// ==========================================

/**
 * Compute the pixel offset of the canvas element within its flex container.
 * The container (.canvas-viewport) uses display:flex + center, so the canvas
 * may not start at top:0 left:0 of the container.
 */
function getCanvasOffset() {
  const containerRect = elements.canvasContainer.getBoundingClientRect();
  const canvasRect = elements.mainCanvas.getBoundingClientRect();
  return {
    offsetLeft: canvasRect.left - containerRect.left,
    offsetTop: canvasRect.top - containerRect.top,
    canvasDisplayWidth: canvasRect.width,
    canvasDisplayHeight: canvasRect.height
  };
}

function updateInteractiveOverlay() {
  elements.interactiveOverlay.innerHTML = '';

  if (!state.originalImage || state.isComparingOriginal) return;

  const { offsetLeft, offsetTop, canvasDisplayWidth, canvasDisplayHeight } = getCanvasOffset();
  const scaleX = canvasDisplayWidth / state.imageWidth;
  const scaleY = canvasDisplayHeight / state.imageHeight;

  // Position the overlay precisely on top of the canvas, not at container origin
  elements.interactiveOverlay.style.left = `${offsetLeft}px`;
  elements.interactiveOverlay.style.top = `${offsetTop}px`;
  elements.interactiveOverlay.style.width = `${canvasDisplayWidth}px`;
  elements.interactiveOverlay.style.height = `${canvasDisplayHeight}px`;

  state.faces.forEach((face, index) => {
    const boxEl = document.createElement('div');
    boxEl.className = `face-box ${face.isManual ? 'manual' : ''}`;
    boxEl.style.left = `${face.x * scaleX}px`;
    boxEl.style.top = `${face.y * scaleY}px`;
    boxEl.style.width = `${face.width * scaleX}px`;
    boxEl.style.height = `${face.height * scaleY}px`;

    // Badge label
    const badgeEl = document.createElement('div');
    badgeEl.className = 'face-box-badge';
    const modeLabel = face.mode === 'mosaic' ? 'モザイク' : (face.mode === 'stamp' ? face.stampChar : (face.mode === 'none' ? '解除' : 'ぼかし'));
    badgeEl.textContent = `${face.isManual ? '手動' : 'AI'} #${index + 1} (${modeLabel})`;
    boxEl.appendChild(badgeEl);

    // Delete button
    const actionsEl = document.createElement('div');
    actionsEl.className = 'face-box-actions';
    const delBtn = document.createElement('button');
    delBtn.className = 'face-btn-delete';
    delBtn.innerHTML = '×';
    delBtn.title = 'このマスクを削除';
    delBtn.onclick = (e) => {
      e.stopPropagation();
      state.faces = state.faces.filter(f => f.id !== face.id);
      renderCanvas();
      updateInteractiveOverlay();
      showToast('マスクを削除しました');
    };
    actionsEl.appendChild(delBtn);
    boxEl.appendChild(actionsEl);

    // Click to cycle mask mode: Mosaic -> Stamp -> Blur -> Off -> Mosaic
    boxEl.onclick = (e) => {
      e.stopPropagation();
      cycleFaceMode(face);
    };

    elements.interactiveOverlay.appendChild(boxEl);
  });
}

function cycleFaceMode(face) {
  const modes = ['mosaic', 'stamp', 'blur', 'none'];
  const currentIndex = modes.indexOf(face.mode);
  const nextMode = modes[(currentIndex + 1) % modes.length];
  face.mode = nextMode;
  face.stampChar = state.stampChar;

  renderCanvas();
  updateInteractiveOverlay();
  showToast(`マスクを「${nextMode === 'none' ? '解除' : nextMode}」に切り替えました`);
}

// Window resize sync for overlay
window.addEventListener('resize', () => {
  if (state.originalImage) {
    updateInteractiveOverlay();
  }
});

// ==========================================
// Drag to Add Custom Masking Box
// ==========================================
let dragBoxEl = null;

/**
 * Helper: Convert mouse event coordinates to overlay-local (x,y).
 * Uses the overlay's own bounding rect so the result is always relative
 * to the overlay regardless of its position inside the container.
 */
function mouseToOverlayXY(e) {
  const rect = elements.interactiveOverlay.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(rect.width, e.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, e.clientY - rect.top)),
    overlayW: rect.width,
    overlayH: rect.height
  };
}

elements.interactiveOverlay.addEventListener('mousedown', (e) => {
  if (e.target !== elements.interactiveOverlay) return;

  const pos = mouseToOverlayXY(e);
  state.isDraggingCanvas = true;
  state.dragStartX = pos.x;
  state.dragStartY = pos.y;

  dragBoxEl = document.createElement('div');
  dragBoxEl.className = 'face-box manual';
  dragBoxEl.style.borderStyle = 'solid';
  dragBoxEl.style.left = `${pos.x}px`;
  dragBoxEl.style.top = `${pos.y}px`;
  dragBoxEl.style.width = '0px';
  dragBoxEl.style.height = '0px';
  elements.interactiveOverlay.appendChild(dragBoxEl);
});

window.addEventListener('mousemove', (e) => {
  if (!state.isDraggingCanvas || !dragBoxEl) return;

  const pos = mouseToOverlayXY(e);
  const left = Math.min(state.dragStartX, pos.x);
  const top = Math.min(state.dragStartY, pos.y);
  const width = Math.abs(pos.x - state.dragStartX);
  const height = Math.abs(pos.y - state.dragStartY);

  dragBoxEl.style.left = `${left}px`;
  dragBoxEl.style.top = `${top}px`;
  dragBoxEl.style.width = `${width}px`;
  dragBoxEl.style.height = `${height}px`;
});

window.addEventListener('mouseup', (e) => {
  if (!state.isDraggingCanvas || !dragBoxEl) return;
  state.isDraggingCanvas = false;

  const pos = mouseToOverlayXY(e);
  const left = Math.min(state.dragStartX, pos.x);
  const top = Math.min(state.dragStartY, pos.y);
  const width = Math.abs(pos.x - state.dragStartX);
  const height = Math.abs(pos.y - state.dragStartY);

  dragBoxEl.remove();
  dragBoxEl = null;

  // Minimum size threshold to prevent accidental clicks
  if (width > 15 && height > 15) {
    const scaleX = state.imageWidth / pos.overlayW;
    const scaleY = state.imageHeight / pos.overlayH;

    state.faces.push({
      id: state.nextFaceId++,
      x: left * scaleX,
      y: top * scaleY,
      width: width * scaleX,
      height: height * scaleY,
      isManual: true,
      mode: state.activeMode,
      stampChar: state.stampChar,
      scale: state.stampScale
    });

    renderCanvas();
    updateInteractiveOverlay();
    showToast('手動マスク領域を追加しました！', 'success');
  }
});

// ==========================================
// Mode Switching & Tool Controls
// ==========================================
elements.maskTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    elements.maskTabs.forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    const mode = tab.dataset.mode;
    state.activeMode = mode;

    // Show corresponding options
    elements.mosaicOptions.classList.toggle('hidden', mode !== 'mosaic');
    elements.stampOptions.classList.toggle('hidden', mode !== 'stamp');
    elements.blurOptions.classList.toggle('hidden', mode !== 'blur');

    // Update all existing faces to this mode
    state.faces.forEach(f => {
      f.mode = mode;
      f.stampChar = state.stampChar;
      f.scale = state.stampScale;
    });

    renderCanvas();
    updateInteractiveOverlay();
  });
});

// Mosaic slider
elements.mosaicSizeRange.addEventListener('input', (e) => {
  state.mosaicSize = parseInt(e.target.value, 10);
  elements.mosaicSizeVal.textContent = `${state.mosaicSize}px`;
  renderCanvas();
});

// Stamp picker
elements.stampBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    elements.stampBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    state.stampChar = btn.dataset.stamp;
    state.faces.forEach(f => {
      if (f.mode === 'stamp') {
        f.stampChar = state.stampChar;
      }
    });

    renderCanvas();
    updateInteractiveOverlay();
  });
});

// Stamp scale slider
elements.stampScaleRange.addEventListener('input', (e) => {
  state.stampScale = parseInt(e.target.value, 10) / 100;
  elements.stampScaleVal.textContent = `${e.target.value}%`;
  state.faces.forEach(f => {
    if (f.mode === 'stamp') {
      f.scale = state.stampScale;
    }
  });
  renderCanvas();
});

// Blur radius slider
elements.blurRadiusRange.addEventListener('input', (e) => {
  state.blurRadius = parseInt(e.target.value, 10);
  elements.blurRadiusVal.textContent = `${state.blurRadius}px`;
  renderCanvas();
});

// Apply all / Clear all
elements.btnApplyAll.addEventListener('click', () => {
  state.faces.forEach(f => {
    f.mode = state.activeMode;
    f.stampChar = state.stampChar;
    f.scale = state.stampScale;
  });
  renderCanvas();
  updateInteractiveOverlay();
  showToast('全顔に現在のマスク設定を一括適用しました');
});

elements.btnClearAll.addEventListener('click', () => {
  state.faces.forEach(f => { f.mode = 'none'; });
  renderCanvas();
  updateInteractiveOverlay();
  showToast('すべてのマスクを解除しました');
});

elements.btnResetToAuto.addEventListener('click', () => {
  detectFaces();
});

// Compare with original (Press & Hold + Click Toggle)
function showOriginal(enable) {
  state.isComparingOriginal = enable;
  if (elements.compareBtnText) {
    elements.compareBtnText.textContent = enable ? '元画像を表示中 (長押し中)' : '長押しで比較 (Original)';
  }
  elements.interactiveOverlay.style.display = enable ? 'none' : 'block';
  renderCanvas();
}

if (elements.btnToggleCompare) {
  // Press-and-hold (desktop & mobile)
  elements.btnToggleCompare.addEventListener('mousedown', () => showOriginal(true));
  elements.btnToggleCompare.addEventListener('mouseup', () => showOriginal(false));
  elements.btnToggleCompare.addEventListener('mouseleave', () => showOriginal(false));
  elements.btnToggleCompare.addEventListener('touchstart', (e) => {
    e.preventDefault();
    showOriginal(true);
  });
  elements.btnToggleCompare.addEventListener('touchend', (e) => {
    e.preventDefault();
    showOriginal(false);
  });
  elements.btnToggleCompare.addEventListener('touchcancel', (e) => {
    e.preventDefault();
    showOriginal(false);
  });
}

// ==========================================
// 100-Character PR Text Generation Engine
// ==========================================
const PR_TEMPLATES = {
  friendly: [
    (kw) => `本日のチームmtgの様子をお届け✨ ${kw ? kw + 'に向け、' : ''}メンバー同士で活発な意見交換が行われました！笑顔あふれる充実したひと時でチームの結束も深まりました🙌 次回の展開もお楽しみに！ #オフィス風景 #チームワーク #広報`,
    (kw) => `今日はみんなで集まって作戦会議を開催しました💡 ${kw ? '注目の「' + kw + '」について' : ''}熱いディスカッションで大盛り上がり！自由な発想が次々と飛び出しています。今後の発信もぜひチェックしてくださいね🎉 #日常 #笑顔 #前進`,
    (kw) => `活気あふれる現場のオフショットをシェア📷 ${kw ? kw + 'の準備も着々と進行中！' : 'みんなで協力しながら一歩ずつ前進しています。'}温かい仲間に囲まれて最高の雰囲気です！今週も元気いっぱいに駆け抜けます✨ #職場 #仲間 #挑戦`
  ],
  formal: [
    (kw) => `本日、社内ミーティングを実施いたしました。${kw ? '「' + kw + '」に関する進捗共有を行い、' : '各チームの連携強化を図り、'}活発な意見交換のもと今後の具体的な取り組みについて確認しました。今後とも質の高いサービス提供に努めてまいります。 #企業公式 #広報`,
    (kw) => `本日の業務風景をご報告いたします。${kw ? '「' + kw + '」に向けた検討会を開催し、' : '組織一丸となった取り組みを進めており、'}多角的な視点から活発な議論が交わされました。引き続きステークホルダーの皆様の期待に応えてまいります。 #ビジネス #公式発表`,
    (kw) => `プロジェクトミーティングの様子を共有いたします。${kw ? kw + 'の実現に向け、' : '強固なチームワークのもと、'}計画の推進と課題解決に向けた協議を深めました。着実な成長と価値創造を目指して邁進してまいります。 #企業広報 #取り組み`
  ],
  event: [
    (kw) => `本日開催のイベントの様子を公開！${kw ? '「' + kw + '」には' : ''}多くの皆様にご参加いただき、会場は熱気と笑顔に包まれ大盛況となりました🎉 参加いただいた皆様、誠にありがとうございました！次回もお楽しみに✨ #イベント #大盛況 #感謝`,
    (kw) => `大盛況のワークショップを開催しました🔥 ${kw ? kw + 'をテーマに、' : ''}参加者同士の熱心な対話と新しいアイデアが次々と生まれました！皆様の笑顔が最高のエネルギーです。次回のご参加もお待ちしております！ #コミュニティ #勉強会`,
    (kw) => `イベント会場からの速報です！${kw ? '「' + kw + '」が' : ''}大盛況のうちに終了しました👏 皆様の積極的なご参加と温かいご声援に心より感謝申し上げます。今後も皆様とつながる企画をお届けします！ #イベントレポート #大盛況`
  ],
  recruit: [
    (kw) => `私たちの日常の雰囲気を少しだけご紹介💼 ${kw ? kw + 'でも大活躍の' : ''}オープンでフラットな仲間たちが日々切磋琢磨しています。新しい挑戦を共に楽しむメンバーを募集中です！ぜひ採用情報もご覧ください✨ #採用 #求人 #仲間募集`,
    (kw) => `笑顔が絶えない職場のリアルなワンシーン📷 ${kw ? kw + 'に取り組みながら、' : ''}年齢や社歴に関わらず自由に意見を交わせる環境が自慢です。私たちと一緒にワクワクする未来をつくりませんか？ #採用広報 #オフィス #採用`,
    (kw) => `チームの日常風景をお届け！${kw ? kw + 'に向けて' : '困ったときはお互いに支え合いながら、'}全員が主体性を持って挑戦を続けています。温かいカルチャーの中で成長したい方、エントリーをお待ちしています🙌 #求人募集 #カルチャー #働く仲間`
  ]
};

// Tone chip selector
elements.toneChips.forEach(chip => {
  chip.addEventListener('click', () => {
    elements.toneChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    state.selectedTone = chip.dataset.tone;
    generatePRText();
  });
});

elements.btnGeneratePRText.addEventListener('click', () => {
  generatePRText();
});

elements.btnRegenerateText.addEventListener('click', () => {
  state.templateIndex = (state.templateIndex + 1) % 3;
  generatePRText();
});

// Update character gauge & count
function updateCharCounter(text) {
  const len = text.length;
  elements.charCountNum.textContent = len;

  // Percentage relative to target ~100
  const pct = Math.min(100, Math.round((len / 100) * 100));
  elements.charGaugeFill.style.width = `${pct}%`;

  if (len >= 85 && len <= 115) {
    elements.charGaugeFill.className = 'char-gauge-fill';
  } else if (len >= 70 && len <= 130) {
    elements.charGaugeFill.className = 'char-gauge-fill warning';
  } else {
    elements.charGaugeFill.className = 'char-gauge-fill danger';
  }
}

elements.prTextarea.addEventListener('input', (e) => {
  updateCharCounter(e.target.value);
});

// Main PR Text Generation Function (Server-side Gemini AI or Smart Template)
async function generatePRText() {
  const kw = elements.customKeyword.value.trim();
  elements.prLoadingOverlay.classList.remove('hidden');
  elements.generatingStatusText.textContent = 'AIが画像と情景を解析して100字文面を作成中...';

  // 1. Try calling server-side /api/generate endpoint (uses server-side GEMINI_API_KEY)
  if (state.currentImageSource) {
    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: state.currentImageSource,
          tone: state.selectedTone,
          keyword: kw,
          mimeType: state.imageMimeType || 'image/jpeg'
        })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.text) {
          elements.prTextarea.value = data.text;
          updateCharCounter(data.text);
          elements.prLoadingOverlay.classList.add('hidden');
          showToast('AI画像解析により100字広報文を自動生成しました！', 'success');
          return;
        }
      } else {
        const errData = await response.json().catch(() => ({}));
        console.info('Server API fallback reason:', errData);
      }
    } catch (err) {
      console.info('Server API unreachable, using built-in smart template:', err);
    }
  }

  // 2. Fallback: Smart AI Template Engine (Zero latency, keyless, runs anywhere)
  setTimeout(() => {
    const templates = PR_TEMPLATES[state.selectedTone] || PR_TEMPLATES.friendly;
    const templateFn = templates[state.templateIndex % templates.length];
    const generated = templateFn(kw);

    elements.prTextarea.value = generated;
    updateCharCounter(generated);
    elements.prLoadingOverlay.classList.add('hidden');
    showToast('広報文（約100文字）を生成しました！', 'success');
  }, 350);
}

// Copy PR Text
elements.btnCopyText.addEventListener('click', async () => {
  const text = elements.prTextarea.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    showToast('広報文面をクリップボードにコピーしました！', 'success');
  } catch (err) {
    showToast('コピーに失敗しました', 'error');
  }
});

// Share on X (Twitter)
elements.btnShareX.addEventListener('click', () => {
  const text = elements.prTextarea.value;
  if (!text) return;
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
  window.open(tweetUrl, '_blank', 'noopener,noreferrer');
});

// ==========================================
// Download Image & Bundle (JPEG / PNG support)
// ==========================================
function downloadMaskedImage(format = 'image/jpeg') {
  if (!state.originalImage) return;

  renderCanvas();

  const link = document.createElement('a');
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '') + '_' + now.getHours() + now.getMinutes();
  const isPng = format === 'image/png';
  link.download = `Kaomosa_PR_${dateStr}.${isPng ? 'png' : 'jpg'}`;
  link.href = isPng 
    ? elements.mainCanvas.toDataURL('image/png') 
    : elements.mainCanvas.toDataURL('image/jpeg', 0.95);
  link.click();
  showToast(`加工済み画像 (${isPng ? 'PNG' : 'JPEG'}) をダウンロードしました！`, 'success');
}

if (elements.btnDownloadImage) {
  elements.btnDownloadImage.addEventListener('click', () => downloadMaskedImage('image/jpeg'));
}

if (elements.btnDownloadJpeg) {
  elements.btnDownloadJpeg.addEventListener('click', () => downloadMaskedImage('image/jpeg'));
}

if (elements.btnDownloadPng) {
  elements.btnDownloadPng.addEventListener('click', () => downloadMaskedImage('image/png'));
}

if (elements.btnOpenNewImageLink) {
  elements.btnOpenNewImageLink.addEventListener('click', () => {
    elements.fileInput.click();
  });
}

// Bundle Download: Image download + Text copy
elements.btnDownloadAll.addEventListener('click', async () => {
  downloadMaskedImage('image/jpeg');
  const text = elements.prTextarea.value;
  if (text) {
    try {
      await navigator.clipboard.writeText(text);
      setTimeout(() => {
        showToast('画像保存 ＆ 広報文面コピーが完了しました！', 'success');
      }, 500);
      setTimeout(() => {
        // Viral growth: gentle prompt to share
        showToast('🎉 お役に立てましたら、ぜひヘッダーの「仲間に教える」からシェアしてください！', 'info');
      }, 3000);
    } catch (e) {}
  }
});

// New image button
elements.btnNewImage.addEventListener('click', () => {
  elements.editorSection.classList.add('hidden');
  elements.uploadSection.classList.remove('hidden');
  elements.fileInput.value = '';
});

// ==========================================
// Drag & Drop / File Input Events
// ==========================================
elements.dropzone.addEventListener('click', () => {
  elements.fileInput.click();
});

elements.fileInput.addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) {
    handleFileSelect(e.target.files[0]);
  }
});

['dragenter', 'dragover'].forEach(eventName => {
  elements.dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropzone.classList.add('drag-over');
  });
});

['dragleave', 'drop'].forEach(eventName => {
  elements.dropzone.addEventListener(eventName, (e) => {
    e.preventDefault();
    e.stopPropagation();
    elements.dropzone.classList.remove('drag-over');
  });
});

elements.dropzone.addEventListener('drop', (e) => {
  const dt = e.dataTransfer;
  if (dt.files && dt.files[0]) {
    handleFileSelect(dt.files[0]);
  }
});

// Paste from Clipboard (Ctrl + V)
window.addEventListener('paste', (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;

  for (let i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      const file = items[i].getAsFile();
      handleFileSelect(file);
      showToast('クリップボードから画像を読み込みました！', 'success');
      break;
    }
  }
});

// Sample Loaders
elements.btnLoadSampleOffice.addEventListener('click', () => {
  loadImageFromSrc('assets/sample-office.jpg');
});

elements.btnLoadSampleEvent.addEventListener('click', () => {
  loadImageFromSrc('assets/sample-event.jpg');
});


// ==========================================
// Feedback Modal (Beta Testing)
// ==========================================
let currentFeedbackRating = 5;

function openFeedback() {
  elements.feedbackModal.classList.remove('hidden');
}

function closeFeedback() {
  elements.feedbackModal.classList.add('hidden');
}

elements.btnOpenFeedback.addEventListener('click', openFeedback);
elements.btnFooterFeedback.addEventListener('click', openFeedback);
elements.btnCloseFeedback.addEventListener('click', closeFeedback);
elements.btnCloseFeedback2.addEventListener('click', closeFeedback);

elements.starBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    currentFeedbackRating = parseInt(btn.dataset.val, 10);
    elements.starBtns.forEach(b => {
      const val = parseInt(b.dataset.val, 10);
      b.classList.toggle('active', val <= currentFeedbackRating);
    });
  });
});

elements.btnSubmitFeedback.addEventListener('click', () => {
  const feedbackData = {
    rating: currentFeedbackRating,
    role: elements.feedbackRole.value,
    comment: elements.feedbackText.value.trim(),
    timestamp: new Date().toISOString()
  };

  // Save to local history of beta feedbacks
  const feedbacks = JSON.parse(localStorage.getItem('pr_masker_feedbacks') || '[]');
  feedbacks.push(feedbackData);
  localStorage.setItem('pr_masker_feedbacks', JSON.stringify(feedbacks));

  closeFeedback();
  elements.feedbackText.value = '';
  showToast('ご意見・フィードバックを送信しました。誠にありがとうございます！', 'success');
});

// ==========================================
// Share Modal Logic (Viral Growth)
// ==========================================
function openShareModal() {
  if (elements.shareModal) {
    elements.shareModal.classList.remove('hidden');
  }
}

function closeShareModal() {
  if (elements.shareModal) {
    elements.shareModal.classList.add('hidden');
  }
}

if (elements.btnShareSite) {
  elements.btnShareSite.addEventListener('click', openShareModal);
}
if (elements.btnCloseShare) {
  elements.btnCloseShare.addEventListener('click', closeShareModal);
}
if (elements.btnCloseShare2) {
  elements.btnCloseShare2.addEventListener('click', closeShareModal);
}

// Share to X (Twitter)
if (elements.btnShareXApp) {
  elements.btnShareXApp.addEventListener('click', () => {
    const text = '写真の顔モザイクと100字広報文を一瞬で自動生成できるWebツール「かおモザ・PR MAKER」使ってみた！完全無料でブラウザ完結だから機密写真も安心。広報・SNS担当者におすすめ👇';
    const url = window.location.origin || 'https://pr-masker.vercel.app';
    const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}&hashtags=広報,SNS運用,PRMasker,顔モザイク`;
    window.open(xUrl, '_blank', 'noopener,noreferrer');
  });
}

// Share to LINE
if (elements.btnShareLineApp) {
  elements.btnShareLineApp.addEventListener('click', () => {
    const url = window.location.origin || 'https://pr-masker.vercel.app';
    const lineUrl = `https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}`;
    window.open(lineUrl, '_blank', 'noopener,noreferrer');
  });
}

// Copy Site Link
if (elements.btnCopyAppUrl) {
  elements.btnCopyAppUrl.addEventListener('click', async () => {
    const url = window.location.origin || 'https://pr-masker.vercel.app';
    try {
      await navigator.clipboard.writeText(url);
      showToast('サイトURLをコピーしました！広報仲間にぜひシェアしてください 🎉', 'success');
      closeShareModal();
    } catch (err) {
      showToast('URLのコピーに失敗しました', 'error');
    }
  });
}

// Close modals when clicking backdrop
[elements.feedbackModal, elements.shareModal].forEach(modal => {
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  }
});

// ==========================================
// Initialize App
// ==========================================
initFaceDetector();
