import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

// ===== Paths (hardcoded like you prefer) =====
const EXERCISES_JSON_URL = "./exercises.json";
const TTS_URL = "http://127.0.0.1:8001/tts";
const AVATAR_LIST_URL = "http://127.0.0.1:8001/avatars";

// ===== Frame check / visibility =====
const VIS_MIN = 0.60;

// ===== Exercises loaded from JSON =====
let ACTIVE_ARM = "left";
let EXERCISES = [];
let EXERCISE_MAP = new Map();
let currentExerciseId = "";

// ===== State =====
let reps = 0;
let targetReps = 12;
let phase = "DOWN";
let lastUpReachedTop = false;
let ttsOn = true;
let TTS_LANG = "en";

// ===== Avatars =====
let AVATARS = []; // [{id,label,glb}]
let previewIdx = 0;
let lockedAvatarIndex = null;

// ===== DOM =====
const landingEl = document.getElementById("landing");
const appEl = document.getElementById("app");

const setupAvatarSelect = document.getElementById("setupAvatarSelect");
const setupExerciseEl = document.getElementById("setupExercise");
const setupStartEl = document.getElementById("setupStart");
const targetRepsInput = document.getElementById("targetRepsInput");
const ttsLangSel = document.getElementById("ttsLang");

const prevAvatarBtn = document.getElementById("prevAvatarBtn");
const nextAvatarBtn = document.getElementById("nextAvatarBtn");
const lockBtn = document.getElementById("lockBtn");
const avatarNamePill = document.getElementById("avatarNamePill");
const lockState = document.getElementById("lockState");

const exerciseSelectEl = document.getElementById("exerciseSelect");
const repsEl = document.getElementById("reps");
const repStateEl = document.getElementById("repState");
const targetPill = document.getElementById("targetPill");
const feedbackText = document.getElementById("feedbackText");
const dotEl = document.getElementById("dot");
const barEl = document.getElementById("bar");
const toggleTTSBtn = document.getElementById("toggleTTSBtn");
const resetRepsBtn = document.getElementById("resetRepsBtn");
const backToSetupBtn = document.getElementById("backToSetupBtn");

const smoothEl = document.getElementById("smooth");
const smoothValEl = document.getElementById("smoothVal");

let smooth = 0.25; // default

if (smoothEl && smoothValEl) {
  smooth = parseFloat(smoothEl.value);
  smoothValEl.textContent = smooth.toFixed(2);

  smoothEl.addEventListener("input", () => {
    smooth = parseFloat(smoothEl.value);
    smoothValEl.textContent = smooth.toFixed(2);
  });
}


smoothValEl.textContent = smooth.toFixed(2);
smoothEl.addEventListener("input", () => {
  smooth = parseFloat(smoothEl.value);
  smoothValEl.textContent = smooth.toFixed(2);
});

const mirrorValEl = document.getElementById("mirrorVal");

// Metrics
const mAngleEl = document.getElementById("mAngle");
const mHeightEl = document.getElementById("mHeight");
const mDxEl = document.getElementById("mDx");
const mVisEl = document.getElementById("mVis");

function setMetrics(angleDegVal, heightDelta, dx, vis) {
  mAngleEl.textContent = Number.isFinite(angleDegVal) ? `${Math.round(angleDegVal)}°` : "—";
  mHeightEl.textContent = Number.isFinite(heightDelta) ? `${heightDelta >= 0 ? "+" : ""}${heightDelta.toFixed(3)}` : "—";
  mDxEl.textContent = Number.isFinite(dx) ? dx.toFixed(3) : "—";
  mVisEl.textContent = Number.isFinite(vis) ? vis.toFixed(2) : "—";
}

// ===== Progress bar segments =====
const SEGMENTS = 10;
const segs = [];
for (let i = 0; i < SEGMENTS; i++) {
  const d = document.createElement("div");
  d.className = "seg";
  barEl.appendChild(d);
  segs.push(d);
}
function setBar(p01) {
  const filled = Math.round(THREE.MathUtils.clamp(p01, 0, 1) * SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) segs[i].classList.toggle("on", i < filled);
}

// ===== Feedback =====
function setFeedback(txt, ok) {
  feedbackText.textContent = txt;
  dotEl.style.background = ok ? "#00ff88" : "#ff5577";
  dotEl.style.boxShadow = ok
    ? "0 0 0 3px rgba(0,255,136,.20)"
    : "0 0 0 3px rgba(255,85,119,.20)";
}

// ===== TTS queue =====
let ttsBusy = false;
const ttsQueue = [];
function enqueueTTS(text) {
  if (!ttsOn) return;
  if (!text) return;
  ttsQueue.push(text);
  pumpTTS();
}
async function pumpTTS() {
  if (ttsBusy) return;
  const text = ttsQueue.shift();
  if (!text) return;
  ttsBusy = true;
  try {
    await fetch(TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {}
  ttsBusy = false;
  if (ttsQueue.length) pumpTTS();
}

function pickSuccessPhraseForExercise(ex) {
  const rep = ex?.rep || {};
  const arr = (TTS_LANG === "ar")
    ? (rep.success_ar || ["أحسنت!"])
    : (rep.success_en || ["Good job!"]);
  if (!Array.isArray(arr) || arr.length === 0) return (TTS_LANG === "ar") ? "أحسنت!" : "Good job!";
  return arr[Math.floor(Math.random() * arr.length)];
}

// ===== Math helpers =====
function lerp(a, b, t) { return a + (b - a) * t; }

function angleDeg(A, B, C) {
  // angle ABC
  const abx = A.x - B.x, aby = A.y - B.y;
  const cbx = C.x - B.x, cby = C.y - B.y;
  const dot = abx * cbx + aby * cby;
  const mag1 = Math.hypot(abx, aby);
  const mag2 = Math.hypot(cbx, cby);
  if (mag1 === 0 || mag2 === 0) return NaN;
  const cos = THREE.MathUtils.clamp(dot / (mag1 * mag2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

function getActiveArmLM(poseLm) {
  // mediapipe pose indices:
  // left: shoulder 11, elbow 13, wrist 15
  // right: shoulder 12, elbow 14, wrist 16
  if (!poseLm) return null;

  const isRight = (ACTIVE_ARM === "right");
  const S = poseLm[isRight ? 12 : 11];
  const E = poseLm[isRight ? 14 : 13];
  const W = poseLm[isRight ? 16 : 15];
  if (!S || !E || !W) return null;

  // visibility average
  const vS = (typeof S.visibility === "number") ? S.visibility : 0;
  const vE = (typeof E.visibility === "number") ? E.visibility : 0;
  const vW = (typeof W.visibility === "number") ? W.visibility : 0;
  const v = (vS + vE + vW) / 3;

  return { S, E, W, v };
}

// ===== Load exercises.json =====
async function loadExercises() {
  const res = await fetch(EXERCISES_JSON_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${EXERCISES_JSON_URL}: HTTP ${res.status}`);
  const data = await res.json();

  ACTIVE_ARM = ((data.active_arm || "left").toLowerCase() === "right") ? "right" : "left";
  EXERCISES = Array.isArray(data.exercises) ? data.exercises : [];
  EXERCISE_MAP = new Map(EXERCISES.map(e => [e.id, e]));

  // Populate BOTH dropdowns from JSON (like your original) :contentReference[oaicite:10]{index=10}
  setupExerciseEl.innerHTML = "";
  exerciseSelectEl.innerHTML = "";

  for (const e of EXERCISES) {
    const o1 = document.createElement("option");
    o1.value = e.id;
    o1.textContent = e.name || e.id;
    setupExerciseEl.appendChild(o1);

    const o2 = document.createElement("option");
    o2.value = e.id;
    o2.textContent = e.name || e.id;
    exerciseSelectEl.appendChild(o2);
  }

  if (!EXERCISES.length) throw new Error("exercises.json has no exercises[]");
}

// ===== Avatars =====
async function fetchAvatars() {
  const res = await fetch(AVATAR_LIST_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch avatars: HTTP ${res.status}`);
  const data = await res.json();

  if (!data?.ok || !Array.isArray(data.avatars)) {
    throw new Error("Avatar API response invalid (expected {ok:true, avatars:[]})");
  }

  AVATARS = data.avatars;
  if (!AVATARS.length) throw new Error("No avatars returned from server.");

  // Fill setup dropdown
  setupAvatarSelect.innerHTML = "";
  for (let i = 0; i < AVATARS.length; i++) {
    const a = AVATARS[i];
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = a.label || a.id || `Avatar ${i + 1}`;
    setupAvatarSelect.appendChild(opt);
  }

  previewIdx = 0;
  lockedAvatarIndex = null;
  renderAvatarPreviewLabel();
}

function avatarGlbPath(a) {
  // Server returns: {id,label,glb} :contentReference[oaicite:11]{index=11}
  if (!a?.id || !a?.glb) return null;
  return `./Avatars/${a.id}/${a.glb}`;
}

function renderAvatarPreviewLabel() {
  const a = AVATARS[previewIdx];
  avatarNamePill.textContent = a ? (a.label || a.id) : "No avatars";
  lockState.textContent = (lockedAvatarIndex === null)
    ? "Not locked"
    : `Locked: ${(AVATARS[lockedAvatarIndex]?.label || AVATARS[lockedAvatarIndex]?.id || "Avatar")}`;
  setupStartEl.disabled = (lockedAvatarIndex === null);
}

// ===== Three scenes: main + preview =====
const threeCanvas = document.getElementById("threeCanvas");
const renderer = new THREE.WebGLRenderer({ canvas: threeCanvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x141c28);
const cam3 = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
cam3.position.set(0, 1.4, 2.6);
scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(2, 4, 2); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.8); fill.position.set(-2, 2, 1); scene.add(fill);

const previewCanvas = document.getElementById("avatarPreview");
const previewRenderer = new THREE.WebGLRenderer({ canvas: previewCanvas, antialias: true });
previewRenderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color(0x0f1722);
const previewCam = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
previewCam.position.set(0, 1.4, 2.6);
previewScene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
const pKey = new THREE.DirectionalLight(0xffffff, 1.6); pKey.position.set(2, 4, 2); previewScene.add(pKey);
const pFill = new THREE.DirectionalLight(0xffffff, 0.8); pFill.position.set(-2, 2, 1); previewScene.add(pFill);

function resizeMain3D() {
  const r = threeCanvas.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  cam3.aspect = r.width / r.height;
  cam3.updateProjectionMatrix();
}

function resizePreview3D() {
  const r = previewCanvas.getBoundingClientRect();
  previewRenderer.setSize(r.width, r.height, false);
  previewCam.aspect = r.width / r.height;
  previewCam.updateProjectionMatrix();
}

window.addEventListener("resize", () => {
  resizeMain3D();
  resizePreview3D();
  resizeOverlay();
});

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);

let mainAvatar = null;
let previewAvatar = null;

async function loadPreviewAvatar() {
  if (!AVATARS.length) return;
  const a = AVATARS[previewIdx];
  const path = avatarGlbPath(a);
  if (!path) return;

  if (previewAvatar) {
    previewScene.remove(previewAvatar);
    previewAvatar = null;
  }

  return new Promise((resolve, reject) => {
    loader.load(path, (gltf) => {
      previewAvatar = gltf.scene;
      previewScene.add(previewAvatar);
      resolve();
    }, undefined, reject);
  });
}

async function loadMainAvatarByIndex(idx) {
  const a = AVATARS[idx];
  const path = avatarGlbPath(a);
  if (!path) throw new Error("Avatar GLB path invalid");

  if (mainAvatar) {
    scene.remove(mainAvatar);
    mainAvatar = null;
  }

  return new Promise((resolve, reject) => {
    loader.load(path, (gltf) => {
      mainAvatar = gltf.scene;
      scene.add(mainAvatar);
      resolve();
    }, undefined, reject);
  });
}

// ===== Overlay + MediaPipe Pose =====
const videoEl = document.getElementById("video");
const overlay = document.getElementById("overlay");
const ctx = overlay.getContext("2d");
let mirrorOn = true;

function resizeOverlay() {
  overlay.width = overlay.clientWidth;
  overlay.height = overlay.clientHeight;
}

function drawPose(poseLm) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  if (!poseLm) return;

  // mirror drawing to match user camera (like your original behavior)
  ctx.save();
  if (mirrorOn) {
    ctx.translate(overlay.width, 0);
    ctx.scale(-1, 1);
  }

  try {
    drawConnectors(ctx, poseLm, POSE_CONNECTIONS);
    drawLandmarks(ctx, poseLm);
  } catch {}

  ctx.restore();
}

// ===== Rep logic (raise/curl) from your original =====
function updateTargetPill() {
  targetPill.textContent = `${reps} / ${targetReps}`;
}

function updateExercise(poseLm) {
  const ex = EXERCISE_MAP.get(currentExerciseId);
  if (!ex) return;

  const repCfg = ex.rep || {};
  const repType = repCfg.type || "raise";

  if (!poseLm) {
    repStateEl.textContent = "WAITING";
    setFeedback("Pose not detected.", false);
    setBar(0);
    setMetrics(NaN, NaN, NaN, NaN);
    return;
  }

  const arm = getActiveArmLM(poseLm);
  if (!arm) {
    repStateEl.textContent = "WAITING";
    setFeedback("Arm not visible.", false);
    setBar(0);
    setMetrics(NaN, NaN, NaN, NaN);
    return;
  }

  const { S, E, W, v } = arm;
  const elbowA = angleDeg(S, E, W);
  const heightDelta = (S.y - W.y);
  const dx = Math.abs(W.x - S.x);
  setMetrics(elbowA, heightDelta, dx, v);

  const VIS_OK = v >= VIS_MIN;
  repStateEl.textContent = phase;

  // ---- RAISE (based on wrist height between down zone & top zone) ----
  if (repType === "raise") {
    const downZoneOffset = (typeof repCfg.down_zone_offset === "number") ? repCfg.down_zone_offset : 0.18;
    const topZoneOffset = (typeof repCfg.top_zone_offset === "number") ? repCfg.top_zone_offset : -0.05;
    const upTh = (typeof repCfg.up_threshold === "number") ? repCfg.up_threshold : 0.78;
    const downTh = (typeof repCfg.down_threshold === "number") ? repCfg.down_threshold : 0.30;

    const downZoneY = S.y + downZoneOffset;
    const topZoneY = S.y + topZoneOffset;

    const t = THREE.MathUtils.clamp((downZoneY - W.y) / (downZoneY - topZoneY), 0, 1);
    setBar(t);

    if (!VIS_OK) setFeedback("Move back so your arm is visible.", false);
    else if (t < upTh) setFeedback("Raise to shoulder height.", false);
    else setFeedback("Good ✅", true);

    if (phase === "DOWN") {
      if (t >= upTh && VIS_OK) {
        phase = "UP";
        lastUpReachedTop = true;
      }
    } else {
      if (t <= downTh) {
        if (lastUpReachedTop) {
          reps += 1;
          repsEl.textContent = String(reps);
          updateTargetPill();

          if (reps < targetReps) enqueueTTS(pickSuccessPhraseForExercise(ex));
        }
        phase = "DOWN";
      }
    }
    return;
  }

  // ---- CURL (based on elbow angle) ----
  if (repType === "curl") {
    const elbowDown = (typeof repCfg.elbow_down_angle === "number") ? repCfg.elbow_down_angle : 170;
    const elbowTop = (typeof repCfg.elbow_top_angle === "number") ? repCfg.elbow_top_angle : 60;
    const upTh = (typeof repCfg.up_threshold === "number") ? repCfg.up_threshold : 0.72;
    const downTh = (typeof repCfg.down_threshold === "number") ? repCfg.down_threshold : 0.25;

    const t = THREE.MathUtils.clamp((elbowDown - elbowA) / (elbowDown - elbowTop), 0, 1);
    setBar(t);

    if (!VIS_OK) setFeedback("Move back so your arm is visible.", false);
    else if (t < upTh) setFeedback("Curl higher.", false);
    else setFeedback("Good ✅", true);

    if (phase === "DOWN") {
      if (t >= upTh && VIS_OK) {
        phase = "UP";
        lastUpReachedTop = true;
      }
    } else {
      if (t <= downTh) {
        if (lastUpReachedTop) {
          reps += 1;
          repsEl.textContent = String(reps);
          updateTargetPill();

          if (reps < targetReps) enqueueTTS(pickSuccessPhraseForExercise(ex));
        }
        phase = "DOWN";
      }
    }
  }
}

// ===== Camera / Pose =====
let lastPoseLm = null;

const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  enableSegmentation: false,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

pose.onResults((results) => {
  lastPoseLm = results.poseLandmarks || null;
  drawPose(lastPoseLm);

  // Apply smoothing-ish by interpolating meters only (pose is already smoothed)
  updateExercise(lastPoseLm);
});

function startCamera() {
  const cam = new Camera(videoEl, {
    onFrame: async () => { await pose.send({ image: videoEl }); },
    width: 640,
    height: 480
  });
  cam.start();
}

// ===== UI actions =====
function updateStartEnabled() {
  setupStartEl.disabled = (lockedAvatarIndex === null) || !EXERCISES.length;
}

prevAvatarBtn.addEventListener("click", async () => {
  if (!AVATARS.length) return;
  previewIdx = (previewIdx - 1 + AVATARS.length) % AVATARS.length;
  renderAvatarPreviewLabel();
  await loadPreviewAvatar();
});

nextAvatarBtn.addEventListener("click", async () => {
  if (!AVATARS.length) return;
  previewIdx = (previewIdx + 1) % AVATARS.length;
  renderAvatarPreviewLabel();
  await loadPreviewAvatar();
});

lockBtn.addEventListener("click", () => {
  lockedAvatarIndex = previewIdx;
  renderAvatarPreviewLabel();
  updateStartEnabled();
  enqueueTTS(TTS_LANG === "ar"
    ? "تم تثبيت الأفاتار."
    : "Avatar locked.");
});

setupAvatarSelect.addEventListener("change", async () => {
  const idx = Number(setupAvatarSelect.value);
  if (Number.isFinite(idx)) {
    previewIdx = idx;
    renderAvatarPreviewLabel();
    await loadPreviewAvatar();
  }
});

setupExerciseEl.addEventListener("change", () => {
  currentExerciseId = setupExerciseEl.value;
});

exerciseSelectEl.addEventListener("change", () => {
  currentExerciseId = exerciseSelectEl.value;
  reps = 0;
  repsEl.textContent = "0";
  phase = "DOWN";
  lastUpReachedTop = false;
  updateTargetPill();
});

toggleTTSBtn.addEventListener("click", () => {
  ttsOn = !ttsOn;
  toggleTTSBtn.textContent = ttsOn ? "TTS: ON" : "TTS: OFF";
});

resetRepsBtn.addEventListener("click", () => {
  reps = 0;
  repsEl.textContent = "0";
  phase = "DOWN";
  lastUpReachedTop = false;
  updateTargetPill();
});

backToSetupBtn.addEventListener("click", () => {
  appEl.style.display = "none";
  landingEl.style.display = "flex";
});

ttsLangSel.addEventListener("change", () => {
  TTS_LANG = ttsLangSel.value || "en";
});

targetRepsInput.addEventListener("input", () => {
  const v = parseInt(targetRepsInput.value || "12", 10);
  targetReps = Number.isFinite(v) && v > 0 ? v : 12;
  updateTargetPill();
});

// Start button: show app and load main avatar
setupStartEl.addEventListener("click", async () => {
  if (lockedAvatarIndex === null) return;

  // set exercise
  currentExerciseId = setupExerciseEl.value || EXERCISES[0].id;
  exerciseSelectEl.value = currentExerciseId;

  // set reps
  const v = parseInt(targetRepsInput.value || "12", 10);
  targetReps = Number.isFinite(v) && v > 0 ? v : 12;

  // reset counters
  reps = 0;
  repsEl.textContent = "0";
  phase = "DOWN";
  lastUpReachedTop = false;
  updateTargetPill();

  // show app
  landingEl.style.display = "none";
  appEl.style.display = "block";

  resizeMain3D();
  resizeOverlay();

  await loadMainAvatarByIndex(lockedAvatarIndex);
  enqueueTTS(TTS_LANG === "ar" ? "ابدأ التمرين." : "Start workout.");
});

// ===== Render loops =====
function animate() {
  requestAnimationFrame(animate);

  resizeMain3D();
  resizePreview3D();

  if (previewRenderer && previewScene && previewCam) {
    previewRenderer.render(previewScene, previewCam);
  }
  if (renderer && scene && cam3) {
    renderer.render(scene, cam3);
  }
}

// ===== Boot order: exercises -> avatars =====
(async () => {
  mirrorValEl.textContent = mirrorOn ? "ON" : "OFF";

  try {
    await loadExercises();
    currentExerciseId = EXERCISES[0].id;
    setupExerciseEl.value = currentExerciseId;
    exerciseSelectEl.value = currentExerciseId;
    updateStartEnabled();
  } catch (e) {
    console.error(e);
    setupExerciseEl.innerHTML = `<option value="">Failed to load exercises.json</option>`;
    exerciseSelectEl.innerHTML = `<option value="">Failed to load exercises.json</option>`;
  }

  try {
    await fetchAvatars();
    // initial preview load
    await loadPreviewAvatar();
  } catch (e) {
    console.error(e);
    avatarNamePill.textContent = "Failed to load avatars (is tts_server running?)";
    prevAvatarBtn.disabled = true;
    nextAvatarBtn.disabled = true;
    lockBtn.disabled = true;
  }

  // Start camera immediately (works while landing is visible)
  resizeOverlay();
  startCamera();
  animate();

  setFeedback("Choose avatar and press Lock, then Start.", false);
})();
