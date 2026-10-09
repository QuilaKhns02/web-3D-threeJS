import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ============================================================================
// CONSTANTS & CONFIGURATION
// ============================================================================
const MODEL_PATH = '/models/ford_mustang_shelby_gt500.glb';
const ESTIMATED_TOTAL_BYTES = 21538716; // ~21.5 MB

const DEFAULT_CAMERA_POS = new THREE.Vector3(4.5, 1.8, 4.5);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.7, 0);

const CAMERA_PRESETS = {
  hero: {
    pos: new THREE.Vector3(4.5, 1.8, 4.5),
    target: new THREE.Vector3(0, 0.7, 0),
  },
  front: {
    pos: new THREE.Vector3(0, 1.25, 5.2),
    target: new THREE.Vector3(0, 0.6, 0),
  },
  side: {
    pos: new THREE.Vector3(5.5, 1.3, 0),
    target: new THREE.Vector3(0, 0.7, 0),
  },
  rear: {
    pos: new THREE.Vector3(0, 1.35, -5.2),
    target: new THREE.Vector3(0, 0.6, 0),
  },
  top: {
    pos: new THREE.Vector3(0.1, 6.2, 0.1),
    target: new THREE.Vector3(0, 0.5, 0),
  },
};

// ============================================================================
// STATE VARIABLES
// ============================================================================
let scene, camera, renderer, controls;
let carModel = null;
const carPaintMaterials = [];
const headlightMaterials = [];
let headlightsEnabled = false;
let isAutoRotating = true;

// Camera Transition State
const cameraTransition = {
  active: false,
  progress: 0,
  duration: 1.2, // seconds
  startPos: new THREE.Vector3(),
  targetPos: new THREE.Vector3(),
  startLookAt: new THREE.Vector3(),
  targetLookAt: new THREE.Vector3(),
};

const clock = new THREE.Clock();

// Headlight Spotlights
let leftHeadlight, rightHeadlight;

// DOM Elements
const container = document.getElementById('webgl-container');
const loaderOverlay = document.getElementById('loader-overlay');
const loaderStatus = document.getElementById('loader-status');
const progressBarFill = document.getElementById('progress-bar-fill');
const loaderPercentage = document.getElementById('loader-percentage');
const errorOverlay = document.getElementById('error-overlay');
const errorMessageEl = document.getElementById('error-message');
const btnRetry = document.getElementById('btn-retry');

const btnAutoRotate = document.getElementById('btn-autorotate');
const btnResetView = document.getElementById('btn-reset-view');
const btnHeadlights = document.getElementById('btn-headlights');
const btnEngineSound = document.getElementById('btn-engine-sound');
const btnBackToTop = document.getElementById('btn-back-to-top');

// ============================================================================
// INITIALIZATION
// ============================================================================
function init() {
  if (!container) return;

  // 1. Create Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070709);
  scene.fog = new THREE.FogExp2(0x070709, 0.035);

  // 2. Setup Perspective Camera
  const aspect = container.clientWidth / container.clientHeight;
  camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 100);
  camera.position.copy(DEFAULT_CAMERA_POS);

  // 3. Setup WebGL Renderer
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  // 4. Setup OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.minDistance = 2.4;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // Do not go beneath showroom floor
  controls.minPolarAngle = 0.1;
  controls.target.copy(DEFAULT_TARGET);
  controls.autoRotate = isAutoRotating;
  controls.autoRotateSpeed = 1.2;

  // 5. Setup Lighting & Studio Environment
  setupLights();
  setupStudioEnvironment();

  // 6. Setup Event Listeners
  setupEventListeners();

  // 7. Load GLB Model
  loadCarModel();

  // 8. Start Animation Loop
  animate();
}

// ============================================================================
// LIGHTING SETUP
// ============================================================================
function setupLights() {
  // Ambient Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  // Key Light (Main front-top-right directional light with shadows)
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
  keyLight.position.set(6, 8, 6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 25;
  keyLight.shadow.camera.left = -5;
  keyLight.shadow.camera.right = 5;
  keyLight.shadow.camera.top = 5;
  keyLight.shadow.camera.bottom = -5;
  keyLight.shadow.bias = -0.0004;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  // Fill Light (Soft cool light from opposite side)
  const fillLight = new THREE.DirectionalLight(0x8fa3bf, 1.5);
  fillLight.position.set(-6, 5, -4);
  scene.add(fillLight);

  // Top Light (Highlight roof curves & hood)
  const topLight = new THREE.DirectionalLight(0xffffff, 1.2);
  topLight.position.set(0, 10, 0);
  scene.add(topLight);

  // Rim Backlight (Accentuates rear spoiler & muscular hips)
  const rimLight = new THREE.SpotLight(0xffffff, 4.0);
  rimLight.position.set(0, 6, -8);
  rimLight.angle = Math.PI / 4;
  rimLight.penumbra = 0.8;
  scene.add(rimLight);

  // Shelby Signature Red Accent Underglow
  const redUnderglow = new THREE.PointLight(0xe61919, 2.0, 7);
  redUnderglow.position.set(0, 0.25, 0);
  scene.add(redUnderglow);

  // Projecting Headlights (SpotLights toggled via UI)
  leftHeadlight = new THREE.SpotLight(0xffffff, 0, 18, Math.PI / 8, 0.4);
  leftHeadlight.position.set(-0.7, 0.65, 2.3);
  leftHeadlight.target.position.set(-0.75, 0.1, 8.0);

  rightHeadlight = new THREE.SpotLight(0xffffff, 0, 18, Math.PI / 8, 0.4);
  rightHeadlight.position.set(0.7, 0.65, 2.3);
  rightHeadlight.target.position.set(0.75, 0.1, 8.0);

  scene.add(leftHeadlight, leftHeadlight.target, rightHeadlight, rightHeadlight.target);
}

// ============================================================================
// SHOWROOM FLOOR & PEDESTAL
// ============================================================================
function setupStudioEnvironment() {
  // Reflective Ground Plane
  const floorGeo = new THREE.PlaneGeometry(80, 80);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0x090a0d,
    roughness: 0.35,
    metalness: 0.75,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  floor.receiveShadow = true;
  scene.add(floor);

  // Circular Showroom Pedestal Rings
  const ring1Geo = new THREE.RingGeometry(3.6, 3.66, 96);
  const ring1Mat = new THREE.MeshBasicMaterial({
    color: 0x242833,
    side: THREE.DoubleSide,
  });
  const ring1 = new THREE.Mesh(ring1Geo, ring1Mat);
  ring1.rotation.x = -Math.PI / 2;
  ring1.position.y = 0.002;
  scene.add(ring1);

  const ring2Geo = new THREE.RingGeometry(4.8, 4.86, 96);
  const ring2Mat = new THREE.MeshBasicMaterial({
    color: 0xe61919,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.35,
  });
  const ring2 = new THREE.Mesh(ring2Geo, ring2Mat);
  ring2.rotation.x = -Math.PI / 2;
  ring2.position.y = 0.003;
  scene.add(ring2);

  const ring3Geo = new THREE.RingGeometry(6.2, 6.24, 96);
  const ring3Mat = new THREE.MeshBasicMaterial({
    color: 0x3b4252,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.25,
  });
  const ring3 = new THREE.Mesh(ring3Geo, ring3Mat);
  ring3.rotation.x = -Math.PI / 2;
  ring3.position.y = 0.004;
  scene.add(ring3);
}

// ============================================================================
// MODEL LOADING (GLTFLoader)
// ============================================================================
function loadCarModel() {
  // Reset states
  carPaintMaterials.length = 0;
  headlightMaterials.length = 0;
  loaderOverlay.classList.remove('hidden');
  errorOverlay.classList.add('hidden');
  progressBarFill.style.width = '0%';
  loaderPercentage.textContent = '0%';
  loaderStatus.textContent = 'Menghubungkan ke server dan mengunduh model...';

  const loader = new GLTFLoader();

  loader.load(
    MODEL_PATH,
    // onLoad
    (gltf) => {
      if (carModel) {
        scene.remove(carModel);
      }

      carModel = gltf.scene;

      // 1. Calculate World Bounding Box
      const box = new THREE.Box3().setFromObject(carModel);
      const center = box.getCenter(new THREE.Vector3());

      // 2. Transform Object: Center model and rest tires on y = 0
      carModel.position.x = -center.x;
      carModel.position.y = -box.min.y;
      carModel.position.z = -center.z;

      // 3. Traverse Meshes & Enhance Materials
      carModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((mat) => {
            if (!mat) return;

            // Car Paint Material Enhancement
            if (mat.name === 'carpaint') {
              carPaintMaterials.push(mat);
              mat.roughness = 0.24;
              mat.metalness = 0.88;
              mat.clearcoat = 1.0;
              mat.clearcoatRoughness = 0.06;
              // Set initial race red color
              mat.color.setStyle('#c8102e');
            }
            // Headlights Material
            else if (mat.name === 'light') {
              headlightMaterials.push(mat);
              mat.emissive = new THREE.Color(0x000000);
              mat.emissiveIntensity = 0.0;
            }
            // Taillights Material (Signature Mustang Tri-bar red)
            else if (mat.name === 'rearlight') {
              mat.emissive = new THREE.Color(0xff1122);
              mat.emissiveIntensity = 1.2;
            }
            // Glass Material
            else if (mat.name === 'tinted_glass') {
              mat.transparent = true;
              mat.opacity = 0.85;
              mat.roughness = 0.05;
              mat.metalness = 0.1;
            }
            // Gloss Black (Spoilers, Grille, Splitters)
            else if (mat.name === 'glossblack') {
              mat.roughness = 0.18;
              mat.metalness = 0.7;
            }
            // Tires Material
            else if (mat.name === 'tire') {
              mat.roughness = 0.85;
              mat.metalness = 0.1;
            }
          });
        }
      });

      // 4. Add to Scene
      scene.add(carModel);

      // 5. Complete Progress & Hide Loader
      progressBarFill.style.width = '100%';
      loaderPercentage.textContent = '100%';
      loaderStatus.textContent = 'Model 3D berhasil dimuat!';

      setTimeout(() => {
        loaderOverlay.classList.add('hidden');
      }, 400);
    },
    // onProgress
    (xhr) => {
      let percent = 0;
      if (xhr.lengthComputable && xhr.total > 0) {
        percent = Math.round((xhr.loaded / xhr.total) * 100);
      } else {
        // Fallback using known model size
        percent = Math.min(99, Math.round((xhr.loaded / ESTIMATED_TOTAL_BYTES) * 100));
      }

      progressBarFill.style.width = `${percent}%`;
      loaderPercentage.textContent = `${percent}%`;

      const loadedMB = (xhr.loaded / (1024 * 1024)).toFixed(1);
      const totalMB = (ESTIMATED_TOTAL_BYTES / (1024 * 1024)).toFixed(1);
      loaderStatus.textContent = `Mengunduh aset 3D (${loadedMB} / ${totalMB} MB)...`;
    },
    // onError
    (error) => {
      console.error('Error loading 3D model:', error);
      loaderOverlay.classList.add('hidden');
      errorOverlay.classList.remove('hidden');
      errorMessageEl.textContent = `Gagal memuat berkas 3D dari path "${MODEL_PATH}". Detail error: ${error.message || 'Network / GLTF Error'}`;
    }
  );
}

// ============================================================================
// CAMERA SMOOTH TRANSITIONS
// ============================================================================
function triggerCameraTransition(targetPos, targetLookAt) {
  cameraTransition.startPos.copy(camera.position);
  cameraTransition.targetPos.copy(targetPos);

  cameraTransition.startLookAt.copy(controls.target);
  cameraTransition.targetLookAt.copy(targetLookAt);

  cameraTransition.progress = 0;
  cameraTransition.active = true;
}

function updateCameraTransition(delta) {
  if (!cameraTransition.active) return;

  cameraTransition.progress += delta / cameraTransition.duration;

  if (cameraTransition.progress >= 1) {
    cameraTransition.progress = 1;
    cameraTransition.active = false;
    camera.position.copy(cameraTransition.targetPos);
    controls.target.copy(cameraTransition.targetLookAt);
    return;
  }

  // Smooth EaseInOutCubic formula
  const t = cameraTransition.progress;
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  camera.position.lerpVectors(cameraTransition.startPos, cameraTransition.targetPos, ease);
  controls.target.lerpVectors(cameraTransition.startLookAt, cameraTransition.targetLookAt, ease);
}

// ============================================================================
// EVENT LISTENERS & UI INTERACTIONS
// ============================================================================
function setupEventListeners() {
  // 1. Window Resize
  window.addEventListener('resize', onWindowResize);

  // 2. Reset View Button
  if (btnResetView) {
    btnResetView.addEventListener('click', () => {
      triggerCameraTransition(DEFAULT_CAMERA_POS, DEFAULT_TARGET);
      // Reset preset active state
      document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
      const heroBtn = document.getElementById('btn-preset-hero');
      if (heroBtn) heroBtn.classList.add('active');
    });
  }

  // 3. Auto-Rotate Toggle Button
  if (btnAutoRotate) {
    btnAutoRotate.addEventListener('click', () => {
      isAutoRotating = !isAutoRotating;
      controls.autoRotate = isAutoRotating;

      const statusText = btnAutoRotate.querySelector('.status-text');
      if (isAutoRotating) {
        btnAutoRotate.classList.add('active');
        if (statusText) statusText.textContent = 'ON';
      } else {
        btnAutoRotate.classList.remove('active');
        if (statusText) statusText.textContent = 'OFF';
      }
    });
  }

  // 4. Headlights Toggle Button
  if (btnHeadlights) {
    btnHeadlights.addEventListener('click', () => {
      headlightsEnabled = !headlightsEnabled;

      const lightStatus = btnHeadlights.querySelector('.light-status-text');

      if (headlightsEnabled) {
        btnHeadlights.classList.add('active');
        if (lightStatus) lightStatus.textContent = 'ON';

        leftHeadlight.intensity = 5.0;
        rightHeadlight.intensity = 5.0;

        headlightMaterials.forEach((m) => {
          m.emissive.setHex(0xeef5ff);
          m.emissiveIntensity = 3.5;
        });
      } else {
        btnHeadlights.classList.remove('active');
        if (lightStatus) lightStatus.textContent = 'OFF';

        leftHeadlight.intensity = 0.0;
        rightHeadlight.intensity = 0.0;

        headlightMaterials.forEach((m) => {
          m.emissive.setHex(0x000000);
          m.emissiveIntensity = 0.0;
        });
      }
    });
  }

  // 5. Camera Presets Buttons
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const presetKey = e.currentTarget.getAttribute('data-preset');
      const preset = CAMERA_PRESETS[presetKey];
      if (preset) {
        document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        triggerCameraTransition(preset.pos, preset.target);
      }
    });
  });

  // 6. Car Paint Color Swatches
  document.querySelectorAll('.color-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const colorHex = e.currentTarget.getAttribute('data-color');
      if (!colorHex) return;

      document.querySelectorAll('.color-btn').forEach((b) => b.classList.remove('active'));
      e.currentTarget.classList.add('active');

      carPaintMaterials.forEach((mat) => {
        mat.color.setStyle(colorHex);
      });
    });
  });

  // 7. Retry Button
  if (btnRetry) {
    btnRetry.addEventListener('click', () => {
      loadCarModel();
    });
  }

  // 8. Rev Engine Sound Synthesizer (Web Audio API)
  if (btnEngineSound) {
    btnEngineSound.addEventListener('click', playV8EngineRumble);
  }

  // 9. Back to Top Button
  if (btnBackToTop) {
    btnBackToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}

// ============================================================================
// RESIZE HANDLER
// ============================================================================
function onWindowResize() {
  if (!container || !renderer || !camera) return;

  const width = container.clientWidth;
  const height = container.clientHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// ============================================================================
// WEB AUDIO API - V8 ENGINE RUMBLE SYNTHESIZER
// ============================================================================
let audioCtx = null;
function playV8EngineRumble() {
  if (!window.AudioContext && !window.webkitAudioContext) return;

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    btnEngineSound.classList.add('playing');

    const duration = 2.4; // seconds
    const now = audioCtx.currentTime;

    // Master Gain
    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.01, now);
    masterGain.gain.linearRampToValueAtTime(0.3, now + 0.3);
    masterGain.gain.linearRampToValueAtTime(0.35, now + 1.2);
    masterGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    masterGain.connect(audioCtx.destination);

    // Lowpass filter for deep throat rumble
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.exponentialRampToValueAtTime(380, now + 0.8);
    filter.frequency.exponentialRampToValueAtTime(120, now + duration);
    filter.connect(masterGain);

    // Oscillator 1 (V8 low rumble base frequency)
    const osc1 = audioCtx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(45, now);
    osc1.frequency.linearRampToValueAtTime(95, now + 0.9);
    osc1.frequency.linearRampToValueAtTime(40, now + duration);
    osc1.connect(filter);
    osc1.start(now);
    osc1.stop(now + duration);

    // Oscillator 2 (Cross-plane V8 supercharger harmonic)
    const osc2 = audioCtx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(90, now);
    osc2.frequency.linearRampToValueAtTime(190, now + 0.9);
    osc2.frequency.linearRampToValueAtTime(80, now + duration);
    osc2.connect(filter);
    osc2.start(now);
    osc2.stop(now + duration);

    // White Noise for exhaust breath & supercharger whine
    const bufferSize = audioCtx.sampleRate * duration;
    const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = audioCtx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;

    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(300, now);
    noiseFilter.frequency.linearRampToValueAtTime(800, now + 0.9);
    noiseFilter.Q.value = 1.8;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.05, now);
    noiseGain.gain.linearRampToValueAtTime(0.12, now + 0.9);
    noiseGain.gain.linearRampToValueAtTime(0.01, now + duration);

    whiteNoise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(masterGain);

    whiteNoise.start(now);
    whiteNoise.stop(now + duration);

    setTimeout(() => {
      btnEngineSound.classList.remove('playing');
    }, duration * 1000);
  } catch (err) {
    console.warn('Audio synthesis failed:', err);
    btnEngineSound.classList.remove('playing');
  }
}

// ============================================================================
// ANIMATION LOOP (requestAnimationFrame)
// ============================================================================
function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  // Handle smooth camera transition if active
  if (cameraTransition.active) {
    updateCameraTransition(delta);
  }

  // Update OrbitControls
  controls.update();

  // Render Scene
  renderer.render(scene, camera);
}

// Start Application on DOM Ready
window.addEventListener('DOMContentLoaded', init);
