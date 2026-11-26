const MEDIAPIPE_VERSION = '1.2.3';
const WASM_BASE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
const FACE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

let filesetPromise;

export async function createFaceTracker() {
  const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
  if (!filesetPromise) {
    filesetPromise = FilesetResolver.forVisionTasks(WASM_BASE_URL).catch((error) => {
      filesetPromise = null;
      throw error;
    });
  }
  const fileset = await filesetPromise;
  const options = {
    baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  let landmarker;
  try {
    landmarker = await FaceLandmarker.createFromOptions(fileset, options);
  } catch (gpuError) {
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        ...options,
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' },
      });
    } catch (cpuError) {
      throw new Error(cpuError?.message || gpuError?.message || 'Face tracking could not start on this device.');
    }
  }

  let lastTimestamp = 0;
  return {
    detect(video) {
      const timestamp = Math.max(performance.now(), lastTimestamp + 1);
      lastTimestamp = timestamp;
      return landmarker.detectForVideo(video, timestamp).faceLandmarks?.[0] || null;
    },
    close() {
      landmarker.close();
    },
  };
}

const canvasPoint = (landmarks, index, width, height) => ({
  x: landmarks[index].x * width,
  y: landmarks[index].y * height,
});
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

function heart(ctx, x, y, size, color, rotation = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.scale(size / 32, size / 32);
  ctx.beginPath();
  ctx.moveTo(0, 27);
  ctx.bezierCurveTo(-38, 4, -19, -17, 0, -4);
  ctx.bezierCurveTo(19, -17, 38, 4, 0, 27);
  ctx.fillStyle = color;
  ctx.shadowColor = 'rgba(0,0,0,.28)';
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.restore();
}

function droopyEar(ctx, x, y, rotation, color, inner) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.bezierCurveTo(-48, -18, -43, 36, -25, 65);
  ctx.quadraticCurveTo(-4, 82, 7, 54);
  ctx.bezierCurveTo(20, 26, 18, 6, -12, 0);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(60,30,20,.7)';
  ctx.lineWidth = 4;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-13, 12);
  ctx.quadraticCurveTo(-33, 6, -23, 43);
  ctx.quadraticCurveTo(-16, 58, -9, 39);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.restore();
}

function catEar(ctx, x, y, rotation) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.beginPath();
  ctx.moveTo(-36, 28);
  ctx.lineTo(-28, -42);
  ctx.lineTo(20, 10);
  ctx.closePath();
  ctx.fillStyle = '#35303f';
  ctx.strokeStyle = '#17131d';
  ctx.lineWidth = 5;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-23, 13);
  ctx.lineTo(-20, -22);
  ctx.lineTo(3, 8);
  ctx.closePath();
  ctx.fillStyle = '#ff9aa9';
  ctx.fill();
  ctx.restore();
}

function drawGlasses(ctx, leftEye, rightEye) {
  const frame = (eye) => {
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 29, 21, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(35, 185, 220, .24)';
    ctx.fill();
    ctx.strokeStyle = '#17212c';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(eye.x, eye.y, 25, 17, 0, Math.PI * 1.12, Math.PI * 1.88);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  frame(leftEye);
  frame(rightEye);
  ctx.beginPath();
  ctx.moveTo(leftEye.x + 27, leftEye.y - 3);
  ctx.quadraticCurveTo(0, leftEye.y - 17, rightEye.x - 27, rightEye.y - 3);
  ctx.strokeStyle = '#17212c';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(leftEye.x - 28, leftEye.y - 1);
  ctx.lineTo(leftEye.x - 49, leftEye.y - 9);
  ctx.moveTo(rightEye.x + 28, rightEye.y - 1);
  ctx.lineTo(rightEye.x + 49, rightEye.y - 9);
  ctx.stroke();
}

function drawMask(ctx, leftCheek, rightCheek, nose, mouth, chin) {
  ctx.beginPath();
  ctx.moveTo(leftCheek.x, leftCheek.y);
  ctx.quadraticCurveTo(nose.x - 22, nose.y - 24, nose.x, nose.y);
  ctx.quadraticCurveTo(nose.x + 22, nose.y - 24, rightCheek.x, rightCheek.y);
  ctx.quadraticCurveTo(rightCheek.x - 4, mouth.y + 18, mouth.x, mouth.y + 27);
  ctx.quadraticCurveTo(leftCheek.x + 4, mouth.y + 18, leftCheek.x, leftCheek.y);
  ctx.closePath();
  ctx.fillStyle = '#7666f5';
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 3;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(leftCheek.x, leftCheek.y + 1);
  ctx.quadraticCurveTo(leftCheek.x - 28, mouth.y + 8, chin.x - 45, chin.y - 8);
  ctx.moveTo(rightCheek.x, rightCheek.y + 1);
  ctx.quadraticCurveTo(rightCheek.x + 28, mouth.y + 8, chin.x + 45, chin.y - 8);
  ctx.strokeStyle = '#c5bfff';
  ctx.lineWidth = 4;
  ctx.stroke();
}

/** Draws a sticker using normalized Face Landmarker points in the source video coordinates. */
export function drawFaceEffect(ctx, effectId, landmarks, width, height) {
  if (effectId === 'none' || !landmarks || landmarks.length < 455) return;
  const point = (index) => canvasPoint(landmarks, index, width, height);
  const leftEyePx = point(33);
  const rightEyePx = point(263);
  const eyeCenterPx = { x: (leftEyePx.x + rightEyePx.x) / 2, y: (leftEyePx.y + rightEyePx.y) / 2 };
  const faceWidth = distance(point(234), point(454));
  if (!Number.isFinite(faceWidth) || faceWidth < 12) return;
  const scale = faceWidth / 200;
  const local = (p) => ({ x: (p.x - eyeCenterPx.x) / scale, y: (p.y - eyeCenterPx.y) / scale });
  const leftEye = local(leftEyePx);
  const rightEye = local(rightEyePx);
  const top = local(point(10));
  const nose = local(point(1));
  const leftCheek = local(point(234));
  const rightCheek = local(point(454));
  const mouth = local(point(13));
  const chin = local(point(152));
  const angle = Math.atan2(rightEyePx.y - leftEyePx.y, rightEyePx.x - leftEyePx.x);

  ctx.save();
  ctx.translate(eyeCenterPx.x, eyeCenterPx.y);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  if (effectId === 'dog') {
    droopyEar(ctx, -66, top.y + 5, -0.24, '#9a623c', '#d99073');
    droopyEar(ctx, 66, top.y + 5, 0.24, '#9a623c', '#d99073');
    ctx.beginPath();
    ctx.ellipse(nose.x, nose.y + 6, 12, 8, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#24202a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(nose.x - 3, nose.y + 4, 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fill();
  } else if (effectId === 'cat') {
    catEar(ctx, -58, top.y + 18, -0.12);
    catEar(ctx, 58, top.y + 18, 0.12);
    ctx.beginPath();
    ctx.moveTo(nose.x - 7, nose.y + 3);
    ctx.lineTo(nose.x + 7, nose.y + 3);
    ctx.lineTo(nose.x, nose.y + 12);
    ctx.closePath();
    ctx.fillStyle = '#f28ca7';
    ctx.fill();
  } else if (effectId === 'glasses') {
    drawGlasses(ctx, leftEye, rightEye);
  } else if (effectId === 'crown') {
    const y = top.y - 4;
    ctx.beginPath();
    ctx.moveTo(-74, y);
    ctx.lineTo(-64, y - 53);
    ctx.lineTo(-28, y - 20);
    ctx.lineTo(0, y - 65);
    ctx.lineTo(28, y - 20);
    ctx.lineTo(64, y - 53);
    ctx.lineTo(74, y);
    ctx.closePath();
    ctx.fillStyle = '#ffc928';
    ctx.strokeStyle = '#a65e15';
    ctx.lineWidth = 5;
    ctx.fill();
    ctx.stroke();
    for (const x of [-43, 0, 43]) {
      ctx.beginPath();
      ctx.arc(x, y - (x === 0 ? 42 : 31), 7, 0, Math.PI * 2);
      ctx.fillStyle = x === 0 ? '#ff628c' : '#55d7ff';
      ctx.fill();
    }
  } else if (effectId === 'halo') {
    ctx.beginPath();
    ctx.ellipse(0, top.y - 48, 66, 14, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,219,92,.42)';
    ctx.lineWidth = 17;
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, top.y - 48, 66, 14, 0, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffe878';
    ctx.lineWidth = 8;
    ctx.shadowColor = '#ffe878';
    ctx.shadowBlur = 14;
    ctx.stroke();
  } else if (effectId === 'hearts') {
    heart(ctx, leftCheek.x - 8, leftCheek.y + 4, 30, '#ff5b8e', -0.2);
    heart(ctx, rightCheek.x + 8, rightCheek.y + 4, 30, '#ff5b8e', 0.2);
    heart(ctx, leftEye.x, leftEye.y - 32, 19, '#ffb3cc', -0.1);
    heart(ctx, rightEye.x, rightEye.y - 32, 19, '#ffb3cc', 0.1);
  } else if (effectId === 'mask') {
    drawMask(ctx, leftCheek, rightCheek, nose, mouth, chin);
  }

  ctx.restore();
}
