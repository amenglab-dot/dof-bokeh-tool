const imageInput = document.getElementById('imageInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

const blurStrength = document.getElementById('blurStrength');
const focusRadiusX = document.getElementById('focusRadiusX');
const focusRadiusY = document.getElementById('focusRadiusY');
const falloff = document.getElementById('falloff');
const perspective = document.getElementById('perspective');
const depthCurveOffset = document.getElementById('depthCurveOffset');
const orthoX = document.getElementById('orthoX');
const orthoY = document.getElementById('orthoY');
const orthoRotate = document.getElementById('orthoRotate');
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
const orthoXVal = document.getElementById('orthoXVal');
const orthoYVal = document.getElementById('orthoYVal');
const orthoRotateVal = document.getElementById('orthoRotateVal');
const bokehIntensityVal = document.getElementById('bokehIntensityVal');
const starburstVal = document.getElementById('starburstVal');

const autoOrthoBtn = document.getElementById('autoOrthoBtn');
const resetOrthoBtn = document.getElementById('resetOrthoBtn');
const estimateVpBtn = document.getElementById('estimateVpBtn');
const renderBtn = document.getElementById('renderBtn');
const downloadBtn = document.getElementById('downloadBtn');

const state = {
  image: null,
  focusPoint: null,
  vp: null,
  original: null,
  source: null,
  rendered: null,
  renderTimer: null,
  orthoTimer: null,
};

const originalCanvas = document.createElement('canvas');
const originalCtx = originalCanvas.getContext('2d');
const sourceCanvas = document.createElement('canvas');
const sourceCtx = sourceCanvas.getContext('2d');
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
  orthoXVal.textContent = `${Number(orthoX.value).toFixed(1)}%`;
  orthoYVal.textContent = `${Number(orthoY.value).toFixed(1)}%`;
  orthoRotateVal.textContent = `${Number(orthoRotate.value).toFixed(1)}°`;
  bokehIntensityVal.textContent = `${bokehIntensity.value}%`;
  starburstVal.textContent = `${starburst.value}%`;
}

function sampleBilinear(imageData, width, height, x, y) {
  const sx = clamp(x, 0, width - 1);
  const sy = clamp(y, 0, height - 1);
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = sx - x0;
  const ty = sy - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const out = [0, 0, 0, 255];
  for (let c = 0; c < 3; c++) {
    const v0 = imageData.data[i00 + c] * (1 - tx) + imageData.data[i10 + c] * tx;
    const v1 = imageData.data[i01 + c] * (1 - tx) + imageData.data[i11 + c] * tx;
    out[c] = v0 * (1 - ty) + v1 * ty;
  }
  return out;
}

function solveLinearSystem(matrix, vector) {
  const n = vector.length;
  const a = matrix.map((row) => row.slice());
  const b = vector.slice();

  for (let i = 0; i < n; i++) {
    let pivot = i;
    let maxAbs = Math.abs(a[i][i]);
    for (let r = i + 1; r < n; r++) {
      const value = Math.abs(a[r][i]);
      if (value > maxAbs) {
        maxAbs = value;
        pivot = r;
      }
    }
    if (maxAbs < 1e-8) return null;

    if (pivot !== i) {
      [a[i], a[pivot]] = [a[pivot], a[i]];
      [b[i], b[pivot]] = [b[pivot], b[i]];
    }

    const diag = a[i][i];
    for (let c = i; c < n; c++) a[i][c] /= diag;
    b[i] /= diag;

    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = a[r][i];
      if (Math.abs(factor) < 1e-10) continue;
      for (let c = i; c < n; c++) a[r][c] -= factor * a[i][c];
      b[r] -= factor * b[i];
    }
  }

  return b;
}

function computeHomography(quad, width, height) {
  const rect = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: 0, y: height - 1 },
    { x: width - 1, y: height - 1 },
  ];

  const m = [];
  const v = [];

  for (let i = 0; i < 4; i++) {
    const x = quad[i].x;
    const y = quad[i].y;
    const u = rect[i].x;
    const w = rect[i].y;

    m.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    v.push(u);
    m.push([0, 0, 0, x, y, 1, -w * x, -w * y]);
    v.push(w);
  }

  const h = solveLinearSystem(m, v);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

function applyHomography(h, x, y) {
  const den = h[6] * x + h[7] * y + h[8];
  if (Math.abs(den) < 1e-8) return null;
  return {
    x: (h[0] * x + h[1] * y + h[2]) / den,
    y: (h[3] * x + h[4] * y + h[5]) / den,
  };
}

function buildOrthoQuad(width, height, orthoXPct, orthoYPct) {
  const kx = clamp(orthoXPct, -100, 100) / 100;
  const ky = clamp(orthoYPct, -100, 100) / 100;

  const xTopInset = Math.max(0, kx) * width * 0.36;
  const xBottomInset = Math.max(0, -kx) * width * 0.36;
  const yLeftInset = Math.max(0, ky) * height * 0.36;
  const yRightInset = Math.max(0, -ky) * height * 0.36;

  return [
    { x: xTopInset, y: yLeftInset },
    { x: width - 1 - xTopInset, y: yRightInset },
    { x: xBottomInset, y: height - 1 - yLeftInset },
    { x: width - 1 - xBottomInset, y: height - 1 - yRightInset },
  ];
}

function renderOrthographicWarp(src, width, height, out, orthoXPct, orthoYPct, rotateDeg, fastMode = false) {
  const quad = buildOrthoQuad(width, height, orthoXPct, orthoYPct);
  const homography = computeHomography(quad, width, height);
  if (!homography) {
    for (let i = 0; i < out.data.length; i++) out.data[i] = src.data[i] || 0;
    return;
  }

  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const rot = (rotateDeg * Math.PI) / 180;
  const cosR = Math.cos(-rot);
  const sinR = Math.sin(-rot);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const unrotX = dx * cosR - dy * sinR + centerX;
      const unrotY = dx * sinR + dy * cosR + centerY;

      const srcPoint = applyHomography(homography, unrotX, unrotY);
      const idx = (y * width + x) * 4;

      if (!srcPoint) {
        out.data[idx] = 0;
        out.data[idx + 1] = 0;
        out.data[idx + 2] = 0;
        out.data[idx + 3] = 255;
        continue;
      }

      if (fastMode) {
        const sx = clamp(Math.round(srcPoint.x), 0, width - 1);
        const sy = clamp(Math.round(srcPoint.y), 0, height - 1);
        const sidx = (sy * width + sx) * 4;
        out.data[idx] = src.data[sidx];
        out.data[idx + 1] = src.data[sidx + 1];
        out.data[idx + 2] = src.data[sidx + 2];
        out.data[idx + 3] = 255;
      } else {
        const rgba = sampleBilinear(src, width, height, srcPoint.x, srcPoint.y);
        out.data[idx] = rgba[0];
        out.data[idx + 1] = rgba[1];
        out.data[idx + 2] = rgba[2];
        out.data[idx + 3] = 255;
      }
    }
  }
}

function normalizeAxisAngle(angleDeg) {
  let angle = angleDeg % 180;
  if (angle < 0) angle += 180;
  return angle;
}

function signedHorizontalDeviation(angleDeg) {
  let angle = normalizeAxisAngle(angleDeg);
  if (angle > 90) angle -= 180;
  return angle;
}

function analyzeRegionOrientation(imageData, width, height, x0, y0, x1, y1) {
  const data = imageData.data;
  const hist = new Float32Array(180);
  let total = 0;

  const sx = Math.max(1, Math.floor(x0));
  const sy = Math.max(1, Math.floor(y0));
  const ex = Math.min(width - 2, Math.ceil(x1));
  const ey = Math.min(height - 2, Math.ceil(y1));

  for (let y = sy; y <= ey; y++) {
    for (let x = sx; x <= ex; x++) {
      const i00 = (y * width + x) * 4;
      const iL = (y * width + (x - 1)) * 4;
      const iR = (y * width + (x + 1)) * 4;
      const iT = ((y - 1) * width + x) * 4;
      const iB = ((y + 1) * width + x) * 4;

      const gL = 0.299 * data[iL] + 0.587 * data[iL + 1] + 0.114 * data[iL + 2];
      const gR = 0.299 * data[iR] + 0.587 * data[iR + 1] + 0.114 * data[iR + 2];
      const gT = 0.299 * data[iT] + 0.587 * data[iT + 1] + 0.114 * data[iT + 2];
      const gB = 0.299 * data[iB] + 0.587 * data[iB + 1] + 0.114 * data[iB + 2];
      const _gC = 0.299 * data[i00] + 0.587 * data[i00 + 1] + 0.114 * data[i00 + 2];

      const gx = gR - gL;
      const gy = gB - gT;
      const mag = Math.hypot(gx, gy);
      if (mag < 24) continue;

      let lineAngle = (Math.atan2(gy, gx) * 180) / Math.PI + 90;
      lineAngle = normalizeAxisAngle(lineAngle);
      hist[Math.round(lineAngle) % 180] += mag;
      total += mag;
    }
  }

  if (total <= 1e-5) {
    return {
      verticalAngle: 90,
      horizontalAngle: 0,
      verticalDev: 0,
      horizontalDev: 0,
      verticalStrength: 0,
      horizontalStrength: 0,
    };
  }

  let vSumW = 0;
  let vSumA = 0;
  for (let a = 70; a <= 110; a++) {
    const w = hist[a % 180];
    vSumW += w;
    vSumA += a * w;
  }
  const verticalAngle = vSumW > 1e-5 ? vSumA / vSumW : 90;

  let hSumW = 0;
  let hSumA = 0;
  for (let a = 0; a <= 20; a++) {
    const w = hist[a];
    hSumW += w;
    hSumA += a * w;
  }
  for (let a = 160; a <= 179; a++) {
    const w = hist[a];
    hSumW += w;
    hSumA += (a - 180) * w;
  }
  const horizontalSigned = hSumW > 1e-5 ? hSumA / hSumW : 0;

  return {
    verticalAngle,
    horizontalAngle: horizontalSigned < 0 ? horizontalSigned + 180 : horizontalSigned,
    verticalDev: verticalAngle - 90,
    horizontalDev: horizontalSigned,
    verticalStrength: vSumW / total,
    horizontalStrength: hSumW / total,
  };
}

function applyOrthographicCorrection(reestimateVp = false) {
  if (!state.source) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const src = state.source;
  const out = originalCtx.createImageData(width, height);

  renderOrthographicWarp(
    src,
    width,
    height,
    out,
    Number(orthoX.value),
    Number(orthoY.value),
    Number(orthoRotate.value),
    false
  );

  originalCtx.putImageData(out, 0, 0);
  state.original = out;

  if (!state.focusPoint) {
    state.focusPoint = { x: width / 2, y: height / 2 };
  } else {
    state.focusPoint.x = clamp(state.focusPoint.x, 0, width - 1);
    state.focusPoint.y = clamp(state.focusPoint.y, 0, height - 1);
  }

  if (reestimateVp || !state.vp) {
    estimateVanishingPoint();
  } else {
    state.vp.x = clamp(state.vp.x, 0, width - 1);
    state.vp.y = clamp(state.vp.y, 0, height - 1);
  }

  redrawPreview();
  scheduleRender(true);
}

function scheduleOrthoApply(reestimateVp = false) {
  if (!state.source) return;
  if (state.orthoTimer) clearTimeout(state.orthoTimer);

  state.orthoTimer = setTimeout(() => {
    state.orthoTimer = null;
    applyOrthographicCorrection(reestimateVp);
  }, 120);
}

function createOptimizationImageData(maxSide = 220) {
  if (!state.source) return null;
  const srcW = sourceCanvas.width;
  const srcH = sourceCanvas.height;
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(80, Math.round(srcW * scale));
  const height = Math.max(80, Math.round(srcH * scale));

  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = width;
  tempCanvas.height = height;
  const tempCtx = tempCanvas.getContext('2d');

  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext('2d');
  srcCtx.putImageData(state.source, 0, 0);

  tempCtx.drawImage(srcCanvas, 0, 0, width, height);
  return tempCtx.getImageData(0, 0, width, height);
}

function evaluateOrthoParams(srcSmall, width, height, orthoXPct, orthoYPct, rotateDeg) {
  const warped = new ImageData(width, height);
  renderOrthographicWarp(srcSmall, width, height, warped, orthoXPct, orthoYPct, rotateDeg, true);

  const full = analyzeRegionOrientation(warped, width, height, 0, 0, width - 1, height - 1);
  const top = analyzeRegionOrientation(warped, width, height, 0, 0, width - 1, height * 0.36);
  const bottom = analyzeRegionOrientation(warped, width, height, 0, height * 0.64, width - 1, height - 1);
  const left = analyzeRegionOrientation(warped, width, height, 0, 0, width * 0.36, height - 1);
  const right = analyzeRegionOrientation(warped, width, height, width * 0.64, 0, width - 1, height - 1);

  const verticalParallel = Math.abs(top.verticalDev - bottom.verticalDev);
  const horizontalParallel = Math.abs(left.horizontalDev - right.horizontalDev);
  const verticalTilt = Math.abs(full.verticalDev);
  const horizontalTilt = Math.abs(signedHorizontalDeviation(full.horizontalAngle));
  const lowConfidencePenalty = Math.max(0, 0.06 - full.verticalStrength) * 80;

  const score =
    verticalTilt * 2.6 +
    verticalParallel * 1.8 +
    horizontalParallel * 1.2 +
    horizontalTilt * 0.7 +
    Math.abs(rotateDeg) * 0.05 +
    lowConfidencePenalty;

  return {
    score,
    metrics: { full, top, bottom, left, right },
  };
}

function autoOrthographicCorrection() {
  if (!state.source) return;

  const small = createOptimizationImageData(220);
  if (!small) return;

  const width = small.width;
  const height = small.height;
  const base = analyzeRegionOrientation(small, width, height, 0, 0, width - 1, height - 1);
  const top = analyzeRegionOrientation(small, width, height, 0, 0, width - 1, height * 0.36);
  const bottom = analyzeRegionOrientation(small, width, height, 0, height * 0.64, width - 1, height - 1);
  const left = analyzeRegionOrientation(small, width, height, 0, 0, width * 0.36, height - 1);
  const right = analyzeRegionOrientation(small, width, height, width * 0.64, 0, width - 1, height - 1);

  const verticalPerspectiveDelta = top.verticalDev - bottom.verticalDev;
  const horizontalPerspectiveDelta = left.horizontalDev - right.horizontalDev;

  let initX = clamp(-verticalPerspectiveDelta * 2.4, -100, 100);
  let initY = clamp(-horizontalPerspectiveDelta * 2.4, -100, 100);
  let initR = clamp(-base.verticalDev * 0.92, -15, 15);

  if (state.vp) {
    const srcW = sourceCanvas.width;
    const srcH = sourceCanvas.height;
    const vpNx = (state.vp.x - srcW / 2) / (srcW / 2 || 1);
    const vpNy = (state.vp.y - srcH / 2) / (srcH / 2 || 1);
    initX = initX * 0.8 + clamp(-vpNy * 42, -100, 100) * 0.2;
    initY = initY * 0.8 + clamp(-vpNx * 42, -100, 100) * 0.2;
  }

  let best = {
    x: initX,
    y: initY,
    r: initR,
    ...evaluateOrthoParams(small, width, height, initX, initY, initR),
  };

  const searchSteps = [20, 10, 5, 2.5];
  for (const step of searchSteps) {
    let improved = true;
    while (improved) {
      improved = false;
      const candidates = [
        { dx: -step, dy: 0, dr: 0 },
        { dx: step, dy: 0, dr: 0 },
        { dx: 0, dy: -step, dr: 0 },
        { dx: 0, dy: step, dr: 0 },
        { dx: 0, dy: 0, dr: -step * 0.25 },
        { dx: 0, dy: 0, dr: step * 0.25 },
        { dx: -step, dy: -step, dr: 0 },
        { dx: step, dy: step, dr: 0 },
        { dx: -step, dy: step, dr: 0 },
        { dx: step, dy: -step, dr: 0 },
      ];

      for (const candidate of candidates) {
        const nx = clamp(best.x + candidate.dx, -100, 100);
        const ny = clamp(best.y + candidate.dy, -100, 100);
        const nr = clamp(best.r + candidate.dr, -15, 15);
        const result = evaluateOrthoParams(small, width, height, nx, ny, nr);
        if (result.score < best.score - 0.03) {
          best = { x: nx, y: ny, r: nr, ...result };
          improved = true;
        }
      }
    }
  }

  orthoX.value = best.x.toFixed(1);
  orthoY.value = best.y.toFixed(1);
  orthoRotate.value = best.r.toFixed(1);

  setLabelValues();
  applyOrthographicCorrection(true);
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
  sourceCanvas.width = width;
  sourceCanvas.height = height;
  originalCanvas.width = width;
  originalCanvas.height = height;
  blurredNearCanvas.width = width;
  blurredNearCanvas.height = height;
  blurredFarCanvas.width = width;
  blurredFarCanvas.height = height;
  blurredUltraCanvas.width = width;
  blurredUltraCanvas.height = height;

  sourceCtx.clearRect(0, 0, width, height);
  sourceCtx.drawImage(img, 0, 0, width, height);
  state.source = sourceCtx.getImageData(0, 0, width, height);

  originalCtx.clearRect(0, 0, width, height);
  originalCtx.putImageData(state.source, 0, 0);
  state.original = originalCtx.getImageData(0, 0, width, height);
  state.focusPoint = { x: width / 2, y: height / 2 };
  state.vp = { x: width / 2, y: height / 3 };

  fitCanvasToViewport();
  estimateVanishingPoint();
  setLabelValues();
  applyOrthographicCorrection(true);
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

[orthoX, orthoY, orthoRotate].forEach((slider) => {
  slider.addEventListener('input', () => {
    setLabelValues();
    scheduleOrthoApply(false);
  });
});

showGuides.addEventListener('change', redrawPreview);
bokehShape.addEventListener('change', () => scheduleRender(true));
enableBokeh.addEventListener('change', () => scheduleRender(true));
autoOrthoBtn.addEventListener('click', autoOrthographicCorrection);
resetOrthoBtn.addEventListener('click', () => {
  orthoX.value = '0';
  orthoY.value = '0';
  orthoRotate.value = '0';
  setLabelValues();
  applyOrthographicCorrection(true);
});
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
