const imageInput = document.getElementById('imageInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const blurStrength = document.getElementById('blurStrength');
const focusRadiusX = document.getElementById('focusRadiusX');
const focusRadiusY = document.getElementById('focusRadiusY');
const falloff = document.getElementById('falloff');
const perspective = document.getElementById('perspective');
const depthCurveOffset = document.getElementById('depthCurveOffset');
const enableBokeh = document.getElementById('enableBokeh');
const bokehShape = document.getElementById('bokehShape');
const bokehIntensity = document.getElementById('bokehIntensity');
const starburst = document.getElementById('starburst');
const showGuides = document.getElementById('showGuides');

const blurStrengthVal = document.getElementById('blurStrengthVal');
const focusRadiusXVal = document.getElementById('focusRadiusXVal');
const focusRadiusYVal = document.getElementById('focusRadiusYVal');
const falloffVal = document.getElementById('falloffVal');
const perspectiveVal = document.getElementById('perspectiveVal');
const depthCurveOffsetVal = document.getElementById('depthCurveOffsetVal');
const bokehIntensityVal = document.getElementById('bokehIntensityVal');
const starburstVal = document.getElementById('starburstVal');

const estimateVpBtn = document.getElementById('estimateVpBtn');
const renderBtn = document.getElementById('renderBtn');
const downloadBtn = document.getElementById('downloadBtn');

const state = {
  image: null,
  focusPoint: null,
  vp: null,
  original: null,
  rendered: null,
  renderTimer: null,
};

const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d');
const blurredNearCanvas = document.createElement('canvas');
const blurredNearCtx = blurredNearCanvas.getContext('2d');
const blurredFarCanvas = document.createElement('canvas');
const blurredFarCtx = blurredFarCanvas.getContext('2d');
const blurredUltraCanvas = document.createElement('canvas');
const blurredUltraCtx = blurredUltraCanvas.getContext('2d');
const compositeCanvas = document.createElement('canvas');
const compositeCtx = compositeCanvas.getContext('2d');

function getBlurPixels() {
  return Number(blurStrength.value) * 2.5;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function setLabelValues() {
  const blurValue = Number(blurStrength.value);
  blurStrengthVal.textContent = `${blurValue.toFixed(2)}（${getBlurPixels().toFixed(2)}px）`;
  focusRadiusXVal.textContent = focusRadiusX.value;
  focusRadiusYVal.textContent = focusRadiusY.value;
  falloffVal.textContent = falloff.value;
  perspectiveVal.textContent = `${perspective.value}%`;
  depthCurveOffsetVal.textContent = `${depthCurveOffset.value}%`;
  bokehIntensityVal.textContent = `${bokehIntensity.value}%`;
  starburstVal.textContent = `${starburst.value}%`;
}

function depthMetrics(width, height, fx, fy, vx, vy) {
  const axisXRaw = fx - vx;
  const axisYRaw = fy - vy;
  const axisLen = Math.hypot(axisXRaw, axisYRaw) || 1;
  const axisX = axisXRaw / axisLen;
  const axisY = axisYRaw / axisLen;

  const corners = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: 0, y: height },
    { x: width, y: height },
  ];

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  for (const corner of corners) {
    const depth = (corner.x - vx) * axisX + (corner.y - vy) * axisY;
    minDepth = Math.min(minDepth, depth);
    maxDepth = Math.max(maxDepth, depth);
  }

  const depthRange = Math.max(1, maxDepth - minDepth);
  const focusDepthNorm = ((fx - vx) * axisX + (fy - vy) * axisY - minDepth) / depthRange;
  const axisScale = Math.max(1, Math.min(width, height) * 0.33);

  return { axisX, axisY, minDepth, depthRange, focusDepthNorm, axisScale, vx, vy };
}

function computeBlurMix(
  x,
  y,
  fx,
  fy,
  vx,
  vy,
  radiusX,
  radiusY,
  smooth,
  perspectiveFactor,
  depthOffset,
  metrics
) {
  const rx = Math.max(1, radiusX);
  const ry = Math.max(1, radiusY);
  const nx = (x - fx) / rx;
  const ny = (y - fy) / ry;
  const ellipseNorm = Math.hypot(nx, ny);
  const smoothNorm = Math.max(0.02, smooth / ((rx + ry) * 0.5));
  const radialBase = clamp((ellipseNorm - 1) / smoothNorm, 0, 1);
  const radialBlur = Math.pow(radialBase, 1.08);

  const depthOnAxis = (x - vx) * metrics.axisX + (y - vy) * metrics.axisY;
  const depthNorm = (depthOnAxis - metrics.minDepth) / metrics.depthRange;
  const shiftedFocusDepthNorm = clamp(metrics.focusDepthNorm + depthOffset * 0.35, 0, 1);
  const signedDelta = depthNorm - shiftedFocusDepthNorm;
  const farDelta = Math.max(0, signedDelta);
  const nearDelta = Math.max(0, -signedDelta);

  const perpAxisDist = Math.abs((x - vx) * -metrics.axisY + (y - vy) * metrics.axisX);
  const axisPenalty = clamp(perpAxisDist / metrics.axisScale, 0, 1);
  const axisGain = 1 - axisPenalty * 0.55;

  const perspectiveGain = 0.35 + perspectiveFactor * 1.2;
  const farDepthBlur = clamp(Math.pow(farDelta * (1.4 + perspectiveGain * 1.4), 0.8), 0, 1);
  const nearDepthBlur = clamp(Math.pow(nearDelta * (1.0 + perspectiveGain * 0.65), 0.95), 0, 1);

  const farMix = clamp(farDepthBlur * axisGain + radialBlur * (0.24 + perspectiveFactor * 0.25), 0, 1);
  const nearMix = clamp(nearDepthBlur * (0.62 + perspectiveFactor * 0.18) + radialBlur * 0.22, 0, 1);

  return clamp(Math.max(farMix, nearMix * 0.84), 0, 1);
}

function drawAperturePath(context, x, y, radius, shape) {
  context.beginPath();
  if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const ang = (-Math.PI / 2) + (i * Math.PI) / 3;
      const px = x + Math.cos(ang) * radius;
      const py = y + Math.sin(ang) * radius;
      if (i === 0) context.moveTo(px, py);
      else context.lineTo(px, py);
    }
    context.closePath();
  } else {
    context.arc(x, y, radius, 0, Math.PI * 2);
  }
}

function applyBokehHighlights(outImageData, mixAccessor, strength) {
  if (!enableBokeh.checked || strength <= 0 || !state.original) {
    return outImageData;
  }

  const width = canvas.width;
  const height = canvas.height;
  compositeCanvas.width = width;
  compositeCanvas.height = height;
  compositeCtx.putImageData(outImageData, 0, 0);

  const src = state.original.data;
  const intensity = Number(bokehIntensity.value) / 100;
  const star = Number(starburst.value) / 100;
  const shape = bokehShape.value;

  const step = Math.max(6, Math.round(18 - intensity * 10));
  const threshold = 220 - intensity * 60;
  const maxSprites = Math.max(250, Math.floor((width * height) / 18000));
  let drawn = 0;

  compositeCtx.save();
  compositeCtx.globalCompositeOperation = 'screen';

  for (let y = step; y < height - step; y += step) {
    if (drawn >= maxSprites) break;
    for (let x = step; x < width - step; x += step) {
      if (drawn >= maxSprites) break;

      const idx = (y * width + x) * 4;
      const r = src[idx];
      const g = src[idx + 1];
      const b = src[idx + 2];
      const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
      if (luma < threshold) continue;

      const mix = mixAccessor(x, y);
      if (mix < 0.28) continue;

      const jitter = ((x * 73856093) ^ (y * 19349663)) & 1023;
      if (jitter % 3 !== 0) continue;

      const radius = clamp((1.5 + strength * 0.16 + intensity * 7) * mix, 1.5, 24);
      const alpha = clamp((luma - threshold) / 90, 0, 1) * (0.12 + intensity * 0.28) * mix;
      const rr = clamp(r * 1.08 + 20, 0, 255);
      const gg = clamp(g * 1.08 + 20, 0, 255);
      const bb = clamp(b * 1.12 + 24, 0, 255);

      compositeCtx.fillStyle = `rgba(${rr}, ${gg}, ${bb}, ${alpha.toFixed(3)})`;
      drawAperturePath(compositeCtx, x, y, radius, shape);
      compositeCtx.fill();

      if (star > 0) {
        const lineAlpha = alpha * (0.35 + star * 0.75);
        const lineLen = radius * (1.8 + star * 2.8);
        const lineWidth = Math.max(0.5, radius * 0.06);
        compositeCtx.strokeStyle = `rgba(${rr}, ${gg}, ${bb}, ${lineAlpha.toFixed(3)})`;
        compositeCtx.lineWidth = lineWidth;

        const rayCount = shape === 'hex' ? 6 : 4;
        for (let i = 0; i < rayCount; i++) {
          const angle = (Math.PI * 2 * i) / rayCount + (shape === 'hex' ? 0 : Math.PI / 4);
          const dx = Math.cos(angle) * lineLen;
          const dy = Math.sin(angle) * lineLen;
          compositeCtx.beginPath();
          compositeCtx.moveTo(x - dx, y - dy);
          compositeCtx.lineTo(x + dx, y + dy);
          compositeCtx.stroke();
        }
      }

      drawn += 1;
    }
  }

  compositeCtx.restore();
  return compositeCtx.getImageData(0, 0, width, height);
}

function fitCanvasToViewport() {
  if (!canvas.width || !canvas.height) return;
  const wrapper = document.querySelector('.canvas-wrap');
  const availableW = Math.max(320, wrapper.clientWidth - 20);
  const availableH = Math.max(240, window.innerHeight - 40);
  const scale = Math.min(availableW / canvas.width, availableH / canvas.height, 1);

  canvas.style.width = `${Math.round(canvas.width * scale)}px`;
  canvas.style.height = `${Math.round(canvas.height * scale)}px`;
}

function drawGuides() {
  if (!showGuides.checked || !state.focusPoint || !state.vp) return;

  const { width, height } = canvas;
  ctx.save();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
  ctx.lineWidth = 1.2;

  const rays = 12;
  for (let i = 0; i < rays; i++) {
    const t = i / rays;
    const angle = t * Math.PI * 2;
    const x = state.vp.x + Math.cos(angle) * Math.max(width, height);
    const y = state.vp.y + Math.sin(angle) * Math.max(width, height);
    ctx.beginPath();
    ctx.moveTo(state.vp.x, state.vp.y);
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  ctx.fillStyle = '#22d3ee';
  ctx.beginPath();
  ctx.arc(state.vp.x, state.vp.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(34, 197, 94, 0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(
    state.focusPoint.x,
    state.focusPoint.y,
    Number(focusRadiusX.value),
    Number(focusRadiusY.value),
    0,
    0,
    Math.PI * 2
  );
  ctx.stroke();

  ctx.fillStyle = '#22c55e';
  ctx.beginPath();
  ctx.arc(state.focusPoint.x, state.focusPoint.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function redrawPreview() {
  if (!state.original) return;
  if (state.rendered) {
    ctx.putImageData(state.rendered, 0, 0);
  } else {
    ctx.putImageData(state.original, 0, 0);
  }
  drawGuides();
}

function estimateVanishingPoint() {
  if (!state.original) return;

  const { width, height, data } = state.original;
  const step = Math.max(2, Math.floor(Math.min(width, height) / 900));
  const edgeThreshold = 18;
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const i = (y * width + x) * 4;
      const l = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const lx = data[i - 4] * 0.299 + data[i - 3] * 0.587 + data[i - 2] * 0.114;
      const ly = data[i - width * 4] * 0.299 + data[i - width * 4 + 1] * 0.587 + data[i - width * 4 + 2] * 0.114;
      const gx = l - lx;
      const gy = l - ly;
      const mag = Math.hypot(gx, gy);
      if (mag < edgeThreshold) continue;

      const edgeWeight = mag * mag;
      sumX += x * edgeWeight;
      sumY += y * edgeWeight;
      sumW += edgeWeight;
    }
  }

  if (sumW > 0) {
    state.vp = {
      x: clamp(sumX / sumW, 0, width),
      y: clamp(sumY / sumW, 0, height),
    };
  } else {
    state.vp = { x: width / 2, y: height / 3 };
  }
}

function renderDepthOfField() {
  if (!state.original || !state.focusPoint || !state.vp) return;

  const { width, height } = canvas;
  const strength = getBlurPixels();
  const radiusX = Number(focusRadiusX.value);
  const radiusY = Number(focusRadiusY.value);
  const smooth = Number(falloff.value);
  const perspectiveFactor = Number(perspective.value) / 100;
  const depthOffset = Number(depthCurveOffset.value) / 100;

  const nearStrength = Math.max(0, strength * 0.45);
  const farStrength = Math.max(0, strength);
  const ultraStrength = Math.max(0, Math.min(90, strength * 1.75));

  blurredNearCtx.clearRect(0, 0, width, height);
  blurredNearCtx.filter = `blur(${nearStrength}px)`;
  blurredNearCtx.drawImage(originalCanvas, 0, 0);
  blurredNearCtx.filter = 'none';

  blurredFarCtx.clearRect(0, 0, width, height);
  blurredFarCtx.filter = `blur(${farStrength}px)`;
  blurredFarCtx.drawImage(originalCanvas, 0, 0);
  blurredFarCtx.filter = 'none';

  blurredUltraCtx.clearRect(0, 0, width, height);
  blurredUltraCtx.filter = `blur(${ultraStrength}px)`;
  blurredUltraCtx.drawImage(originalCanvas, 0, 0);
  blurredUltraCtx.filter = 'none';

  const sharp = state.original;
  const blurryNear = blurredNearCtx.getImageData(0, 0, width, height);
  const blurryFar = blurredFarCtx.getImageData(0, 0, width, height);
  const blurryUltra = blurredUltraCtx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);

  const fx = state.focusPoint.x;
  const fy = state.focusPoint.y;
  const vx = state.vp.x;
  const vy = state.vp.y;

  const metrics = depthMetrics(width, height, fx, fy, vx, vy);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const rx = Math.max(1, radiusX);
      const ry = Math.max(1, radiusY);
      const nx = (x - fx) / rx;
      const ny = (y - fy) / ry;
      const ellipseNorm = Math.hypot(nx, ny);
      const smoothNorm = Math.max(0.02, smooth / ((rx + ry) * 0.5));
      const radialBase = clamp((ellipseNorm - 1) / smoothNorm, 0, 1);
      const radialBlur = Math.pow(radialBase, 1.08);

      const depthOnAxis = (x - vx) * metrics.axisX + (y - vy) * metrics.axisY;
      const depthNorm = (depthOnAxis - metrics.minDepth) / metrics.depthRange;
      const shiftedFocusDepthNorm = clamp(metrics.focusDepthNorm + depthOffset * 0.35, 0, 1);
      const signedDelta = depthNorm - shiftedFocusDepthNorm;
      const farDelta = Math.max(0, signedDelta);
      const nearDelta = Math.max(0, -signedDelta);

      const perpAxisDist = Math.abs((x - vx) * -metrics.axisY + (y - vy) * metrics.axisX);
      const axisPenalty = clamp(perpAxisDist / metrics.axisScale, 0, 1);
      const axisGain = 1 - axisPenalty * 0.55;

      const perspectiveGain = 0.35 + perspectiveFactor * 1.2;
      const farDepthBlur = clamp(Math.pow(farDelta * (1.4 + perspectiveGain * 1.4), 0.8), 0, 1);
      const nearDepthBlur = clamp(Math.pow(nearDelta * (1.0 + perspectiveGain * 0.65), 0.95), 0, 1);

      const farMix = clamp(farDepthBlur * axisGain + radialBlur * (0.24 + perspectiveFactor * 0.25), 0, 1);
      const nearMix = clamp(nearDepthBlur * (0.62 + perspectiveFactor * 0.18) + radialBlur * 0.22, 0, 1);

      const ultraFarWeight = clamp(Math.pow(farMix, 1.7) * (0.3 + perspectiveFactor * 0.5), 0, 1);
      const farWeight = clamp(farMix * (0.78 - ultraFarWeight * 0.28), 0, 1 - ultraFarWeight);
      const nearWeight = clamp(nearMix * (0.56 + (1 - perspectiveFactor) * 0.2), 0, 1 - ultraFarWeight - farWeight);
      const sharpWeight = clamp(1 - nearWeight - farWeight - ultraFarWeight, 0, 1);

      out.data[idx] =
        sharp.data[idx] * sharpWeight +
        blurryNear.data[idx] * nearWeight +
        blurryFar.data[idx] * farWeight +
        blurryUltra.data[idx] * ultraFarWeight;
      out.data[idx + 1] =
        sharp.data[idx + 1] * sharpWeight +
        blurryNear.data[idx + 1] * nearWeight +
        blurryFar.data[idx + 1] * farWeight +
        blurryUltra.data[idx + 1] * ultraFarWeight;
      out.data[idx + 2] =
        sharp.data[idx + 2] * sharpWeight +
        blurryNear.data[idx + 2] * nearWeight +
        blurryFar.data[idx + 2] * farWeight +
        blurryUltra.data[idx + 2] * ultraFarWeight;
      out.data[idx + 3] = 255;
    }
  }

  const finalImage = applyBokehHighlights(
    out,
    (x, y) =>
      computeBlurMix(
        x,
        y,
        fx,
        fy,
        vx,
        vy,
        radiusX,
        radiusY,
        smooth,
        perspectiveFactor,
        depthOffset,
        metrics
      ),
    strength
  );

  state.rendered = finalImage;
  redrawPreview();
  downloadBtn.disabled = false;
}

function scheduleRender(immediate = false) {
  if (!state.original) return;
  if (state.renderTimer) clearTimeout(state.renderTimer);

  const delay = immediate ? 30 : 120;
  state.renderTimer = setTimeout(() => {
    state.renderTimer = null;
    renderDepthOfField();
  }, delay);
}

function fitImageToCanvas(img) {
  const width = img.width;
  const height = img.height;

  canvas.width = width;
  canvas.height = height;
  originalCanvas.width = width;
  originalCanvas.height = height;
  blurredNearCanvas.width = width;
  blurredNearCanvas.height = height;
  blurredFarCanvas.width = width;
  blurredFarCanvas.height = height;
  blurredUltraCanvas.width = width;
  blurredUltraCanvas.height = height;

  originalCtx.clearRect(0, 0, width, height);
  originalCtx.drawImage(img, 0, 0, width, height);

  state.original = originalCtx.getImageData(0, 0, width, height);
  state.focusPoint = { x: width / 2, y: height / 2 };
  state.vp = { x: width / 2, y: height / 3 };

  fitCanvasToViewport();
  estimateVanishingPoint();
  setLabelValues();
  redrawPreview();
  scheduleRender(true);
}

imageInput.addEventListener('change', (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  const img = new Image();
  img.onload = () => {
    state.image = img;
    state.rendered = null;
    downloadBtn.disabled = true;
    fitImageToCanvas(img);
  };
  img.src = URL.createObjectURL(file);
});

canvas.addEventListener('click', (event) => {
  if (!state.original) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (event.clientX - rect.left) * scaleX;
  const y = (event.clientY - rect.top) * scaleY;

  if (event.shiftKey) {
    state.vp = { x, y };
  } else {
    state.focusPoint = { x, y };
  }

  redrawPreview();
  scheduleRender(true);
});

[blurStrength, focusRadiusX, focusRadiusY, falloff, perspective, depthCurveOffset, bokehIntensity, starburst].forEach((slider) => {
  slider.addEventListener('input', () => {
    setLabelValues();
    redrawPreview();
    scheduleRender();
  });
});

showGuides.addEventListener('change', redrawPreview);
bokehShape.addEventListener('change', () => scheduleRender(true));
enableBokeh.addEventListener('change', () => scheduleRender(true));
estimateVpBtn.addEventListener('click', () => {
  estimateVanishingPoint();
  redrawPreview();
  scheduleRender(true);
});
renderBtn.addEventListener('click', renderDepthOfField);

downloadBtn.addEventListener('click', () => {
  if (!state.rendered) return;
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  const tempCtx = temp.getContext('2d');
  tempCtx.putImageData(state.rendered, 0, 0);

  const link = document.createElement('a');
  link.download = 'dof-result.png';
  link.href = temp.toDataURL('image/png');
  link.click();
});

setLabelValues();
ctx.fillStyle = '#9ca3af';
ctx.font = '20px sans-serif';
ctx.fillText('请先上传图片', 20, 40);

window.addEventListener('resize', fitCanvasToViewport);
