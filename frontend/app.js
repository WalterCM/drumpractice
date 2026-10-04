// Drum Practice Studio - DAW Engine
// Web Audio API Multitrack Engine con Canvas Waves, Mute/Solo, Scheduler y Drag & Drop Sync

let audioCtx = null;
let vocalsBuffer = null;
let otherBuffer = null;
let bassBuffer = null;
let drumsBuffer = null;
let songDuration = 0;
let isPlaying = false;
let isLooping = false;
let playbackStartTime = 0;
let pausedAt = 0;

// Configuración del Tempo y Sincronización
let currentBPM = 120.0;
let currentOffset = 0.0; // en segundos (-1.0 a +1.0)
let detectedBeats = []; // Timestamps exactos detectados por la IA
let songId = null;
let songTitleStr = "Pista";

// Estado de pistas (DAW Tracks)
const tracks = {
  vocals: { vol: 0.8, mute: false, solo: false, gainNode: null, sourceNode: null },
  other: { vol: 0.8, mute: false, solo: false, gainNode: null, sourceNode: null },
  bass: { vol: 0.8, mute: false, solo: false, gainNode: null, sourceNode: null },
  drums: { vol: 0.0, mute: false, solo: false, gainNode: null, sourceNode: null },
  metronome: { vol: 0.6, mute: false, solo: false, gainNode: null }
};

// Metrónomo Scheduler
let schedulerIntervalId = null;
let nextNoteTime = 0.0;
let beatIndex = 0;
const scheduleAheadTime = 0.1;
const lookahead = 25.0;

// Variables de Canvas y Dibujo
const HEADER_WIDTH = 250;
let timelineWidth = 800; // Ancho en px del carril de audio
let pixelsPerSecond = 50;

// Elementos de la UI
const setupSection = document.getElementById('setup-section');
const workspaceSection = document.getElementById('workspace-section');
const youtubeUrlInput = document.getElementById('youtube-url');
const processBtn = document.getElementById('process-btn');
const progressContainer = document.getElementById('progress-container');
const progressMessage = document.getElementById('progress-message');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');

const backendStatusDot = document.getElementById('backend-status-dot');
const backendStatusText = document.getElementById('backend-status-text');
const currentSongBadge = document.getElementById('current-song-badge');

// Elementos de Transporte
const btnPlayPause = document.getElementById('btn-play-pause');
const btnStop = document.getElementById('btn-stop');
const btnLoop = document.getElementById('btn-loop');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');
const timeCurrent = document.getElementById('time-current');
const timeTotal = document.getElementById('time-total');
const btnNewSong = document.getElementById('btn-new-song');

// Controles de BPM y Offset
const bpmInput = document.getElementById('bpm-input');
const beatLed = document.getElementById('beat-led');
const offsetSlider = document.getElementById('offset-slider');
const valOffset = document.getElementById('val-offset');
const metronomeSound = document.getElementById('metronome-sound');
const countInSelect = document.getElementById('count-in-select');

// Variables de Cuenta Previa (Count-in)
let isCountingIn = false;
let countInTimeoutId = null;
let countInIntervalId = null;
let countInVisualTimeouts = [];
let activeOscillators = [];
let beatShift = 0;

function getEffectiveOffset() {
  const secondsPerBeat = 60.0 / currentBPM;
  return currentOffset + beatShift * secondsPerBeat;
}

// Canvas
const rulerCanvas = document.getElementById('ruler-canvas');
const canvasVocals = document.getElementById('canvas-vocals');
const canvasOther = document.getElementById('canvas-other');
const canvasBass = document.getElementById('canvas-bass');
const canvasDrums = document.getElementById('canvas-drums');
const canvasMetronome = document.getElementById('canvas-metronome');
const globalPlayhead = document.getElementById('global-playhead');
const laneMetronome = document.getElementById('lane-metronome');

// Detección dinámica del puerto del Backend (8000, 8001, 8002...)
let activeBackendPort = window.__BACKEND_PORT__ || 8000;

async function detectBackendPort() {
  if (window.__BACKEND_PORT__) {
    activeBackendPort = window.__BACKEND_PORT__;
    return activeBackendPort;
  }
  
  // Probar candidatos comunes rápidamente (8000, 8001, 8002, 8003, ...)
  const candidates = [8000, 8001, 8002, 8003, 8004, 8005, 8080];
  for (const p of candidates) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 200);
      const res = await fetch(`http://127.0.0.1:${p}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        if (data.service === "Drum Practice Backend") {
          activeBackendPort = p;
          console.log(`[Connectivity] Backend de Drum Practice detectado en puerto ${p}`);
          return p;
        }
      }
    } catch (e) {}
  }
  return activeBackendPort;
}

function getBackendBase() {
  return `http://127.0.0.1:${activeBackendPort}`;
}

function getBackendUrl(path) {
  if (!path) return '';
  let fullUrl = path;
  if (!path.startsWith('http://') && !path.startsWith('https://') && !path.startsWith('blob:')) {
    const base = getBackendBase();
    fullUrl = `${base}${path.startsWith('/') ? '' : '/'}${path}`;
  }
  try {
    fullUrl = decodeURI(fullUrl);
  } catch (e) {}
  return encodeURI(fullUrl);
}

function getWebSocketUrl(path) {
  return `ws://127.0.0.1:${activeBackendPort}${path.startsWith('/') ? '' : '/'}${path}`;
}

// Conexión Backend
async function connectBackend() {
  await detectBackendPort();
  const healthUrl = getBackendUrl('/api/health');
  fetch(healthUrl)
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      if (data.status === 'running') {
        backendStatusDot.className = 'status-dot connected';
        backendStatusText.textContent = `Backend Conectado (Puerto ${activeBackendPort})`;
        youtubeUrlInput.removeAttribute('disabled');
        const url = youtubeUrlInput.value.trim();
        if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
          processBtn.removeAttribute('disabled');
        }
      }
    })
    .catch(err => {
      backendStatusDot.className = 'status-dot disconnected';
      backendStatusText.textContent = 'Buscando Backend...';
      youtubeUrlInput.setAttribute('disabled', 'true');
      processBtn.setAttribute('disabled', 'true');
      setTimeout(connectBackend, 2000);
    });
}
connectBackend();

// Validar input de YouTube
youtubeUrlInput.addEventListener('input', () => {
  const url = youtubeUrlInput.value.trim();
  if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
    processBtn.removeAttribute('disabled');
  } else {
    processBtn.setAttribute('disabled', 'true');
  }
});

// Botón Procesar
processBtn.addEventListener('click', () => {
  let url = youtubeUrlInput.value.trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressMessage.textContent = 'Iniciando conexión con el backend...';
  processBtn.setAttribute('disabled', 'true');
  youtubeUrlInput.setAttribute('disabled', 'true');

  const ws = new WebSocket(getWebSocketUrl('/ws/process'));

  ws.onopen = () => {
    ws.send(JSON.stringify({ url: url }));
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.status === 'processing') {
      progressMessage.textContent = data.message;
      progressBar.style.width = `${data.progress}%`;
      progressPercent.textContent = `${data.progress}%`;
    } else if (data.status === 'completed' && data.result) {
      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
      progressMessage.textContent = '¡Procesamiento completo!';
      setTimeout(() => {
        setupDAWWorkspace(data.result);
      }, 500);
      ws.close();
    } else if (data.status === 'error') {
      progressMessage.textContent = `Error: ${data.message}`;
      progressBar.style.background = 'var(--accent-red)';
      processBtn.removeAttribute('disabled');
      youtubeUrlInput.removeAttribute('disabled');
      ws.close();
    }
  };

  ws.onerror = (err) => {
    console.error('WS Error:', err);
    progressMessage.textContent = 'Error de conexión con el backend.';
    processBtn.removeAttribute('disabled');
    youtubeUrlInput.removeAttribute('disabled');
  };
});

// Carga de Archivo Local
const btnBrowseFile = document.getElementById('btn-browse-file');
const localAudioInput = document.getElementById('local-audio-input');

if (btnBrowseFile && localAudioInput) {
  btnBrowseFile.addEventListener('click', () => localAudioInput.click());
  localAudioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '20%';
    progressPercent.textContent = '20%';
    progressMessage.textContent = `Subiendo y procesando ${file.name} con IA...`;
    processBtn.setAttribute('disabled', 'true');
    youtubeUrlInput.setAttribute('disabled', 'true');

    const formData = new FormData();
    formData.append('file', file);
    const uploadUrl = getBackendUrl('/api/upload');

    try {
      const response = await fetch(uploadUrl, { method: 'POST', body: formData });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.status === 'completed' && data.result) {
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressMessage.textContent = '¡Procesamiento completo!';
        setTimeout(() => setupDAWWorkspace(data.result), 500);
      } else {
        throw new Error(data.message || 'Error desconocido');
      }
    } catch (err) {
      progressMessage.textContent = `Error: ${err.message}`;
      progressBar.style.background = 'var(--accent-red)';
      processBtn.removeAttribute('disabled');
      youtubeUrlInput.removeAttribute('disabled');
    }
  });
}

// Botón Nueva Pista
btnNewSong.addEventListener('click', () => {
  stopTrack();
  workspaceSection.classList.add('hidden');
  setupSection.classList.remove('hidden');
  currentSongBadge.classList.add('hidden');
  progressContainer.classList.add('hidden');
  youtubeUrlInput.removeAttribute('disabled');
  youtubeUrlInput.value = '';
  processBtn.setAttribute('disabled', 'true');
});

// ==========================================================================
// CONFIGURACIÓN DEL WORKSPACE DAW
// ==========================================================================
async function setupDAWWorkspace(songData) {
  if (!songData) return;
  
  setupSection.classList.add('hidden');
  workspaceSection.classList.remove('hidden');

  songId = songData.id;
  songTitleStr = songData.title || songData.id || "Pista";
  currentSongBadge.textContent = songTitleStr;
  currentSongBadge.classList.remove('hidden');

  currentBPM = parseFloat(songData.bpm) || 120.0;
  bpmInput.value = currentBPM.toFixed(1);
  
  detectedBeats = songData.beats || [];

  // SINCRONIZACIÓN AUTOMÁTICA DE FASE CON LOS BEATS REALES DE LA BATERÍA
  if (songData.offset !== undefined && songData.offset !== null) {
    currentOffset = parseFloat(songData.offset);
  } else if (detectedBeats.length > 0) {
    const secondsPerBeat = 60.0 / currentBPM;
    // Calculamos el desfase módulo período para cada beat y obtenemos la mediana
    const phases = detectedBeats.map(b => ((b % secondsPerBeat) + secondsPerBeat) % secondsPerBeat);
    phases.sort((a, b) => a - b);
    currentOffset = phases[Math.floor(phases.length / 2)];
  } else {
    currentOffset = 0.0;
  }

  beatShift = 0;
  if (valBeatShift) {
    valBeatShift.textContent = `0 Beats`;
  }

  const offsetMs = Math.round(currentOffset * 1000);
  offsetSlider.value = offsetMs;
  valOffset.textContent = `${offsetMs >= 0 ? '+' : ''}${offsetMs} ms`;

  // Inicializar Audio Context
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Configurar Gain Nodes para las 5 pistas
  ['vocals', 'other', 'bass', 'drums', 'metronome'].forEach(key => {
    tracks[key].gainNode = audioCtx.createGain();
    tracks[key].gainNode.connect(audioCtx.destination);
  });

  // Sincronizar el estado interno de volumen y botones con el DOM
  const trackKeys = ['vocals', 'other', 'bass', 'drums', 'metronome'];
  const defaultVols = { vocals: 0.8, other: 0.8, bass: 0.8, drums: 0.0, metronome: 0.6 };

  trackKeys.forEach(key => {
    const volElem = document.getElementById(`vol-${key}`);
    const valElem = document.getElementById(`val-${key}`);
    const muteElem = document.getElementById(`mute-${key}`);
    const soloElem = document.getElementById(`solo-${key}`);

    tracks[key].vol = volElem ? parseFloat(volElem.value) / 100 : defaultVols[key];
    if (valElem) valElem.textContent = `${Math.round(tracks[key].vol * 100)}%`;

    tracks[key].mute = muteElem ? muteElem.classList.contains('active') : false;
    tracks[key].solo = soloElem ? soloElem.classList.contains('active') : false;
  });

  updateTrackGains();

// Decodificador manual de archivos WAV (16-bit PCM y 32-bit Float)
// Garantiza compatibilidad al 100% sin depender de los plugins de GStreamer en Linux/WebKitGTK
function decodeWavManually(arrayBuffer, ctx) {
  const view = new DataView(arrayBuffer);
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (riff !== 'RIFF' || wave !== 'WAVE') {
    throw new Error('El archivo no es un formato WAV válido');
  }

  let offset = 12;
  let channels = 2;
  let sampleRate = 44100;
  let bitsPerSample = 16;
  let audioFormat = 1;
  let dataOffset = 0;
  let dataLength = 0;

  while (offset < view.byteLength) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      audioFormat = view.getUint16(offset + 8, true);
      channels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === 'data') {
      dataOffset = offset + 8;
      dataLength = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }

  if (!dataOffset) {
    throw new Error('No se encontró el bloque de datos de audio en el WAV');
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataLength / (channels * bytesPerSample));
  const audioBuffer = ctx.createBuffer(channels, totalSamples, sampleRate);

  if (audioFormat === 1 && bitsPerSample === 16) {
    const samples = new Int16Array(arrayBuffer, dataOffset, totalSamples * channels);
    for (let c = 0; c < channels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < totalSamples; i++) {
        channelData[i] = samples[i * channels + c] / 32768.0;
      }
    }
    return audioBuffer;
  } else if (audioFormat === 3 && bitsPerSample === 32) {
    const samples = new Float32Array(arrayBuffer, dataOffset, totalSamples * channels);
    for (let c = 0; c < channels; c++) {
      const channelData = audioBuffer.getChannelData(c);
      for (let i = 0; i < totalSamples; i++) {
        channelData[i] = samples[i * channels + c];
      }
    }
    return audioBuffer;
  } else {
    throw new Error(`Formato WAV no soportado: format=${audioFormat}, bits=${bitsPerSample}`);
  }
}

  progressMessage.textContent = "Decodificando pistas de audio separadas por IA...";
  try {
    async function fetchAndDecode(path, name) {
      if (!path) return null;
      const url = getBackendUrl(path);
      console.log(`[Audio Engine] Descargando ${name} desde:`, url);
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} al descargar pista ${name} (${url})`);
      }
      const buffer = await res.arrayBuffer();
      if (!buffer || buffer.byteLength === 0) {
        throw new Error(`Buffer vacío recibido para pista ${name}`);
      }
      
      // Intentar decodificación nativa con AudioContext; si falla por falta de codecs en Linux, usar decodificador manual
      try {
        return await audioCtx.decodeAudioData(buffer.slice(0));
      } catch (nativeErr) {
        console.warn(`[Audio Engine] decodeAudioData nativo no disponible (${nativeErr.message}). Decodificando ${name} manualmente en JS...`);
        return decodeWavManually(buffer, audioCtx);
      }
    }

    const [vBuf, oBuf, bBuf, dBuf] = await Promise.all([
      fetchAndDecode(songData.vocals_url, 'Voz'),
      fetchAndDecode(songData.other_url || songData.no_drums_url, 'Otros'),
      fetchAndDecode(songData.bass_url, 'Bajo'),
      fetchAndDecode(songData.drums_url, 'Batería')
    ]);

    vocalsBuffer = vBuf;
    otherBuffer = oBuf;
    bassBuffer = bBuf;
    drumsBuffer = dBuf;

    const mainBuf = vocalsBuffer || otherBuffer || bassBuffer || drumsBuffer;
    songDuration = mainBuf ? mainBuf.duration : 0;

    timeTotal.textContent = formatTime(songDuration);
    timeCurrent.textContent = formatTime(0);

    requestAnimationFrame(() => {
      resizeAndDrawAllTracks();
    });

  } catch (err) {
    console.error("Error al decodificar audio:", err);
    alert("Error al decodificar el audio: " + err.message);
  }
}

// ==========================================================================
// CONTROL DE VOLUMEN, MUTE Y SOLO (ESTILO DAW)
// ==========================================================================
function updateTrackGains() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const anySolo = tracks.vocals.solo || tracks.other.solo || tracks.bass.solo || tracks.drums.solo || tracks.metronome.solo;

  for (const key in tracks) {
    const t = tracks[key];
    if (!t.gainNode) continue;
    let targetVol = 0;

    if (anySolo) {
      if (t.solo && !t.mute) {
        targetVol = t.vol;
      } else {
        targetVol = 0;
      }
    } else {
      if (!t.mute) {
        targetVol = t.vol;
      } else {
        targetVol = 0;
      }
    }

    t.gainNode.gain.setValueAtTime(targetVol, now);
  }
}

// Listeners de Volumen, Mute y Solo
['vocals', 'other', 'bass', 'drums', 'metronome'].forEach(key => {
  const volElem = document.getElementById(`vol-${key}`);
  const muteElem = document.getElementById(`mute-${key}`);
  const soloElem = document.getElementById(`solo-${key}`);

  if (volElem) {
    volElem.addEventListener('input', (e) => {
      const v = e.target.value / 100;
      tracks[key].vol = v;
      const valElem = document.getElementById(`val-${key}`);
      if (valElem) valElem.textContent = `${Math.round(v * 100)}%`;
      updateTrackGains();
    });
  }

  if (muteElem) {
    muteElem.addEventListener('click', (e) => {
      tracks[key].mute = !tracks[key].mute;
      e.target.classList.toggle('active', tracks[key].mute);
      updateTrackGains();
    });
  }

  if (soloElem) {
    soloElem.addEventListener('click', (e) => {
      tracks[key].solo = !tracks[key].solo;
      e.target.classList.toggle('active', tracks[key].solo);
      updateTrackGains();
    });
  }
});

// ==========================================================================
// DIBUJO DE FORMAS DE ONDA & REGLAS (CANVAS HIGH PERFORMANCE)
// ==========================================================================
function resizeAndDrawAllTracks() {
  const container = document.getElementById('tracks-list');
  if (!container) return;
  const clientW = container.clientWidth || (window.innerWidth - 60);
  timelineWidth = Math.max(300, clientW - HEADER_WIDTH);

  if (songDuration > 0) {
    pixelsPerSecond = timelineWidth / songDuration;
  }

  // Redimensionar Canvas
  setupCanvasSize(rulerCanvas, timelineWidth, 30);
  setupCanvasSize(canvasVocals, timelineWidth, 110);
  setupCanvasSize(canvasOther, timelineWidth, 110);
  setupCanvasSize(canvasBass, timelineWidth, 110);
  setupCanvasSize(canvasDrums, timelineWidth, 110);
  setupCanvasSize(canvasMetronome, timelineWidth, 110);

  // Dibujar
  drawRuler();
  if (vocalsBuffer) drawWaveform(canvasVocals, vocalsBuffer, '#c084fc');
  if (otherBuffer) drawWaveform(canvasOther, otherBuffer, '#06b6d4');
  if (bassBuffer) drawWaveform(canvasBass, bassBuffer, '#fbbf24');
  if (drumsBuffer) drawWaveform(canvasDrums, drumsBuffer, '#f43f5e');
  drawMetronomeGrid();
}

function setupCanvasSize(canvas, width, height) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  canvas.style.width = width + 'px';
  canvas.style.height = height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
}

// Dibujar Regla de Tiempo
function drawRuler() {
  const ctx = rulerCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = rulerCanvas.width / dpr;
  const height = rulerCanvas.height / dpr;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#6b7280';
  ctx.font = '10px JetBrains Mono';

  // Intervalo de marcas en segundos (ej. cada 5 segundos)
  const step = 5;
  for (let s = 0; s <= songDuration; s += step) {
    const x = s * pixelsPerSecond;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.beginPath();
    ctx.moveTo(x, height - 10);
    ctx.lineTo(x, height);
    ctx.stroke();

    ctx.fillText(formatTimeShort(s), x + 4, height - 6);
  }
}

// Dibujar Forma de Onda de un Buffer
function drawWaveform(canvas, buffer, color) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.width / dpr;
  const height = canvas.height / dpr;

  ctx.clearRect(0, 0, width, height);

  const rawData = buffer.getChannelData(0);
  const totalSamples = rawData.length;
  const samplesPerPixel = Math.floor(totalSamples / width);
  const midY = height / 2;

  ctx.fillStyle = color;
  ctx.beginPath();

  for (let x = 0; x < width; x++) {
    const start = x * samplesPerPixel;
    let min = 1.0;
    let max = -1.0;

    for (let i = 0; i < samplesPerPixel; i += 4) {
      const val = rawData[start + i];
      if (val < min) min = val;
      if (val > max) max = val;
    }

    if (max < min) { min = 0; max = 0; }
    const top = midY + min * midY * 0.95;
    const bottom = midY + max * midY * 0.95;

    ctx.fillRect(x, top, 1, Math.max(1, bottom - top));
  }
}

// Dibujar Rejilla de Beats del Metrónomo
function drawMetronomeGrid() {
  const ctx = canvasMetronome.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const width = canvasMetronome.width / dpr;
  const height = canvasMetronome.height / dpr;

  ctx.clearRect(0, 0, width, height);

  if (currentBPM <= 0 || songDuration <= 0) return;

  const secondsPerBeat = 60.0 / currentBPM;
  let beatTime = getEffectiveOffset();
  let index = 0;

  // Dibujar marcadores de beats detectados por IA (puntos cian de referencia en la parte superior)
  if (detectedBeats && detectedBeats.length > 0) {
    ctx.fillStyle = 'rgba(6, 182, 212, 0.7)';
    for (let i = 0; i < detectedBeats.length; i++) {
      const bx = detectedBeats[i] * pixelsPerSecond;
      if (bx >= 0 && bx <= width) {
        ctx.beginPath();
        ctx.arc(bx, 6, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Dibujar rejilla periódica del metrónomo
  while (beatTime < songDuration) {
    if (beatTime >= 0) {
      const x = beatTime * pixelsPerSecond;
      const isDownbeat = (index % 4 === 0);

      // Línea de beat
      ctx.strokeStyle = isDownbeat ? 'rgba(255, 87, 34, 0.95)' : 'rgba(255, 87, 34, 0.4)';
      ctx.lineWidth = isDownbeat ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Bloque / Indicador visual de beat
      ctx.fillStyle = isDownbeat ? 'rgba(255, 87, 34, 0.35)' : 'rgba(255, 87, 34, 0.15)';
      const blockWidth = Math.max(4, Math.min(18, (secondsPerBeat * pixelsPerSecond) * 0.4));
      ctx.fillRect(x, height / 2 - 15, blockWidth, 30);

      // Número de tiempo
      ctx.fillStyle = isDownbeat ? '#fff' : 'rgba(255, 255, 255, 0.6)';
      ctx.font = '10px JetBrains Mono';
      const measureNum = Math.floor(index / 4) + 1;
      const beatInMeasure = (index % 4) + 1;
      ctx.fillText(`${measureNum}.${beatInMeasure}`, x + 4, 22);
    }
    beatTime += secondsPerBeat;
    index++;
  }
}

window.addEventListener('resize', () => {
  if (songDuration > 0) resizeAndDrawAllTracks();
});

// ==========================================================================
// ARRASTRE INTERACTIVO (DRAG & DROP HORIZONTAL PARA SINCRONIZACIÓN)
// ==========================================================================
let isDraggingMetronome = false;
let dragStartX = 0;
let dragStartOffset = 0;

laneMetronome.addEventListener('mousedown', (e) => {
  isDraggingMetronome = true;
  dragStartX = e.clientX;
  dragStartOffset = currentOffset;
  document.body.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!isDraggingMetronome) return;
  const deltaX = e.clientX - dragStartX;
  const deltaSeconds = deltaX / pixelsPerSecond;
  
  // Nuevo offset
  currentOffset = dragStartOffset + deltaSeconds;
  
  // Limitar entre -2s y +2s para dar más margen
  currentOffset = Math.max(-2.0, Math.min(2.0, currentOffset));
  
  const ms = Math.round(currentOffset * 1000);
  offsetSlider.value = ms;
  valOffset.textContent = `${ms >= 0 ? '+' : ''}${ms} ms`;

  // Redibujar rejilla en tiempo real
  drawMetronomeGrid();

  // Si está reproduciendo, resincronizar scheduler en caliente
  if (isPlaying) {
    resyncScheduler();
  }
});

window.addEventListener('mouseup', () => {
  if (isDraggingMetronome) {
    isDraggingMetronome = false;
    document.body.style.cursor = 'default';
  }
});

// Slider de Offset
offsetSlider.addEventListener('input', (e) => {
  const ms = parseInt(e.target.value);
  currentOffset = ms / 1000.0;
  valOffset.textContent = `${ms >= 0 ? '+' : ''}${ms} ms`;
  drawMetronomeGrid();
  if (isPlaying) resyncScheduler();
});

// Desplazamiento por Beats (Tiempos)
const btnBeatShiftMinus = document.getElementById('btn-beat-shift-minus');
const btnBeatShiftPlus = document.getElementById('btn-beat-shift-plus');
const valBeatShift = document.getElementById('val-beat-shift');

function updateBeatShift(newShift) {
  beatShift = newShift;
  if (valBeatShift) {
    valBeatShift.textContent = `${beatShift >= 0 ? '+' : ''}${beatShift} Beats`;
  }
  drawMetronomeGrid();
  if (isPlaying) resyncScheduler();
}

if (btnBeatShiftMinus && btnBeatShiftPlus) {
  btnBeatShiftMinus.addEventListener('click', () => {
    updateBeatShift(beatShift - 1);
  });
  btnBeatShiftPlus.addEventListener('click', () => {
    updateBeatShift(beatShift + 1);
  });
}

// ==========================================================================
// REPRODUCCIÓN MULTITRACK (WEB AUDIO API & SCHEDULER)
// ==========================================================================
async function playTrack(startSeconds = 0) {
  if (!vocalsBuffer && !otherBuffer && !bassBuffer && !drumsBuffer) return;

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  const countInMeasuresVal = parseInt(countInSelect ? countInSelect.value : "1", 10) || 0;

  // Si arrancamos desde el inicio (startSeconds === 0) y hay cuenta previa activada
  if (startSeconds === 0 && countInMeasuresVal > 0 && !isCountingIn) {
    isCountingIn = true;
    isPlaying = true;
    playIcon.classList.add('hidden');
    pauseIcon.classList.remove('hidden');

    // Actualizar volumen de las pistas antes de empezar la cuenta
    updateTrackGains();

    const secondsPerBeat = 60.0 / currentBPM;
    const totalCountBeats = countInMeasuresVal * 4;
    const countInDuration = totalCountBeats * secondsPerBeat;
    const now = audioCtx.currentTime;

    // Obtener desfase total (ajuste fino + desplazamiento por beats)
    const effOffset = getEffectiveOffset();
    
    // Si el desfase efectivo es menor o igual a 2.0s, retrasamos el inicio de la canción
    // para que coincida exactamente con el final de la cuenta previa.
    // Si es mayor a 2.0s (introducción larga), iniciamos el audio directamente y la cuenta
    // previa sonará antes de que empiece la canción física (o encima de la intro).
    const alignTime = effOffset <= 2.0 ? effOffset : 0.0;
    const audioStartDelay = Math.max(0, countInDuration - alignTime);

    // Limpiar programaciones visuales previas
    countInVisualTimeouts.forEach(clearTimeout);
    countInVisualTimeouts = [];

    // Disparar clics de la cuenta previa
    // Estos clics se programan hacia atrás desde el inicio del audio (now + audioStartDelay)
    // Si effOffset es negativo, el click de la canción correspondiente al tiempo 0 (k=0)
    // cae antes del inicio físico del audio y por tanto debe ser reproducido en esta fase.
    const minK = effOffset < 0 ? 0 : 1;
    for (let k = totalCountBeats; k >= minK; k--) {
      const clickTime = now + audioStartDelay + effOffset - k * secondsPerBeat;
      const isAccent = ((totalCountBeats - k) % 4 === 0);
      
      if (clickTime >= now - 0.02) {
        playClickSound(Math.max(now, clickTime), isAccent);
        
        // Programar conteo visual en timeCurrent coincidiendo exactamente con el clic
        const delayMs = Math.max(0, (clickTime - now) * 1000);
        const visualBeatNum = ((totalCountBeats - k) % 4) + 1;
        const timeoutId = setTimeout(() => {
          timeCurrent.textContent = `COUNT: ${visualBeatNum}`;
        }, delayMs);
        countInVisualTimeouts.push(timeoutId);
      }
    }

    if (countInTimeoutId) clearTimeout(countInTimeoutId);
    countInTimeoutId = setTimeout(() => {
      isCountingIn = false;
      countInTimeoutId = null;
      countInVisualTimeouts.forEach(clearTimeout);
      countInVisualTimeouts = [];
      if (!isPlaying) return;
      startActualPlayback(0);
    }, audioStartDelay * 1000);

    return;
  }

  startActualPlayback(startSeconds);
}

function startActualPlayback(startSeconds = 0) {
  if (!vocalsBuffer && !otherBuffer && !bassBuffer && !drumsBuffer) return;
  isPlaying = true;
  pausedAt = startSeconds;

  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');

  const now = audioCtx.currentTime;
  playbackStartTime = now - startSeconds;

  // Actualizar volumen de las pistas antes de empezar
  updateTrackGains();

  // Crear nodos fuente para cada stem disponible
  const stemBuffers = {
    vocals: vocalsBuffer,
    other: otherBuffer,
    bass: bassBuffer,
    drums: drumsBuffer
  };

  for (const key in stemBuffers) {
    const buf = stemBuffers[key];
    if (buf) {
      tracks[key].sourceNode = audioCtx.createBufferSource();
      tracks[key].sourceNode.buffer = buf;
      tracks[key].sourceNode.connect(tracks[key].gainNode);

      if (isLooping) {
        tracks[key].sourceNode.loop = true;
        tracks[key].sourceNode.loopStart = 0;
        tracks[key].sourceNode.loopEnd = songDuration;
      }

      tracks[key].sourceNode.start(now, startSeconds);
    }
  }

  // Configurar Scheduler del Metrónomo
  resyncScheduler();

  // Iniciar intervalo de scheduler del metrónomo
  if (schedulerIntervalId) clearInterval(schedulerIntervalId);
  schedulerIntervalId = setInterval(scheduler, lookahead);

  // Iniciar animación de Playhead
  requestAnimationFrame(updatePlayhead);
}

function stopAudioSources() {
  if (isCountingIn) {
    isCountingIn = false;
  }
  if (countInTimeoutId) {
    clearTimeout(countInTimeoutId);
    countInTimeoutId = null;
  }
  if (countInIntervalId) {
    clearInterval(countInIntervalId);
    countInIntervalId = null;
  }

  // Limpiar timeouts del conteo visual
  countInVisualTimeouts.forEach(clearTimeout);
  countInVisualTimeouts = [];

  // Detener todos los osciladores del metrónomo que estén sonando
  activeOscillators.forEach(osc => {
    try {
      osc.stop();
      osc.disconnect();
    } catch (e) {}
  });
  activeOscillators = [];

  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  ['vocals', 'other', 'bass', 'drums'].forEach(key => {
    try {
      if (tracks[key] && tracks[key].sourceNode) {
        tracks[key].sourceNode.stop();
        tracks[key].sourceNode.disconnect();
        tracks[key].sourceNode = null;
      }
    } catch (e) {}
  });
}

function pauseTrack() {
  if (!isPlaying) return;
  isPlaying = false;
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');

  if (isCountingIn) {
    stopAudioSources();
    pausedAt = 0;
    timeCurrent.textContent = formatTime(0);
    return;
  }

  pausedAt = audioCtx.currentTime - playbackStartTime;
  if (pausedAt >= songDuration) pausedAt = 0;

  stopAudioSources();
}

function stopTrack() {
  isPlaying = false;
  pausedAt = 0;
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');

  stopAudioSources();
  timeCurrent.textContent = formatTime(0);
  globalPlayhead.style.transform = `translateX(0px)`;
}

// Botones de Transporte
btnPlayPause.addEventListener('click', () => {
  if (isPlaying) pauseTrack();
  else playTrack(pausedAt);
});

btnStop.addEventListener('click', () => stopTrack());

btnLoop.addEventListener('click', () => {
  isLooping = !isLooping;
  btnLoop.classList.toggle('active', isLooping);
  ['vocals', 'other', 'bass', 'drums'].forEach(key => {
    if (tracks[key] && tracks[key].sourceNode) {
      tracks[key].sourceNode.loop = isLooping;
    }
  });
});

// Atajos de teclado (Espacio = Play/Pause, Enter = Stop)
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (isPlaying) pauseTrack();
    else playTrack(pausedAt);
  } else if (e.code === 'Enter') {
    e.preventDefault();
    stopTrack();
  }
});

// Click en el Timeline para saltar de posición
function handleTimelineClick(e) {
  const rect = rulerCanvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  if (clickX < 0 || clickX > timelineWidth || songDuration <= 0) return;

  const targetSeconds = (clickX / timelineWidth) * songDuration;
  if (isPlaying) {
    stopAudioSources();
    pausedAt = targetSeconds;
    playTrack(pausedAt);
  } else {
    pausedAt = targetSeconds;
    timeCurrent.textContent = formatTime(pausedAt);
    const playheadX = pausedAt * pixelsPerSecond;
    globalPlayhead.style.transform = `translateX(${playheadX}px)`;
  }
}

document.getElementById('ruler-container').addEventListener('click', handleTimelineClick);
['lane-vocals', 'lane-other', 'lane-bass', 'lane-drums'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handleTimelineClick);
});

// ==========================================================================
// SCHEDULER DEL METRÓNOMO & ANIMACIÓN PLAYHEAD
// ==========================================================================
function resyncScheduler() {
  const currentSongTime = isPlaying ? (audioCtx.currentTime - playbackStartTime) : pausedAt;
  const secondsPerBeat = 60.0 / currentBPM;
  const effOffset = getEffectiveOffset();

  let n = 0;
  if (currentSongTime > effOffset) {
    n = Math.ceil((currentSongTime - effOffset) / secondsPerBeat);
  }
  beatIndex = n;
  nextNoteTime = playbackStartTime + effOffset + n * secondsPerBeat;
}

function scheduler() {
  const currentTime = audioCtx.currentTime;
  while (nextNoteTime < currentTime + scheduleAheadTime) {
    const songPlayPosition = nextNoteTime - playbackStartTime;
    if (songPlayPosition >= songDuration) {
      if (isLooping) {
        playbackStartTime += songDuration;
        nextNoteTime = playbackStartTime + getEffectiveOffset();
        beatIndex = 0;
        continue;
      } else {
        break;
      }
    }

    const isAccent = (beatIndex % 4 === 0);
    playClickSound(nextNoteTime, isAccent);
    
    const secondsPerBeat = 60.0 / currentBPM;
    nextNoteTime += secondsPerBeat;
    beatIndex++;
  }
}

function playClickSound(time, isAccent = false) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(tracks.metronome.gainNode);

  const soundType = metronomeSound.value;
  const duration = 0.07;

  if (soundType === 'woodblock') {
    const freq = isAccent ? 1200 : 800;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + duration);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  } else if (soundType === 'cowbell') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 800 : 587, time);
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(isAccent ? 1200 : 845, time);
    osc2.connect(gain2);
    gain2.connect(tracks.metronome.gainNode);
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    gain2.gain.setValueAtTime(0.4, time);
    gain2.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc2.start(time);
    osc2.stop(time + duration);
    activeOscillators.push(osc2);
    osc2.onended = () => {
      activeOscillators = activeOscillators.filter(item => item !== osc2);
    };
  } else if (soundType === 'digital') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1600 : 1000, time);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.linearRampToValueAtTime(0.001, time + 0.03);
  } else {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 880 : 440, time);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  }

  osc.start(time);
  osc.stop(time + duration + 0.02);
  activeOscillators.push(osc);
  osc.onended = () => {
    activeOscillators = activeOscillators.filter(item => item !== osc);
  };

  // Flash LED visual
  const delayMs = (time - audioCtx.currentTime) * 1000;
  setTimeout(() => {
    if (isPlaying) flashLed();
  }, Math.max(0, delayMs));
}

function flashLed() {
  beatLed.classList.add('flash');
  setTimeout(() => beatLed.classList.remove('flash'), 80);
}

// Actualización continua de Playhead
function updatePlayhead() {
  if (!isPlaying) return;

  const currentSeconds = audioCtx.currentTime - playbackStartTime;
  if (currentSeconds >= songDuration) {
    if (isLooping) {
      // Loop manejado por buffer
    } else {
      stopTrack();
      return;
    }
  }

  timeCurrent.textContent = formatTime(currentSeconds);
  const playheadX = currentSeconds * pixelsPerSecond;
  globalPlayhead.style.transform = `translateX(${playheadX}px)`;

  requestAnimationFrame(updatePlayhead);
}

// ==========================================================================
// CONTROLES DE BPM & TAP TEMPO
// ==========================================================================
function updateBPM(val) {
  currentBPM = Math.max(20, Math.min(300, parseFloat(val) || 120));
  bpmInput.value = currentBPM.toFixed(1);
  drawMetronomeGrid();
  if (isPlaying) resyncScheduler();
}

bpmInput.addEventListener('change', (e) => updateBPM(e.target.value));
document.getElementById('bpm-minus-1').addEventListener('click', () => updateBPM(currentBPM - 1));
document.getElementById('bpm-plus-1').addEventListener('click', () => updateBPM(currentBPM + 1));
document.getElementById('bpm-half').addEventListener('click', () => updateBPM(currentBPM / 2));
document.getElementById('bpm-double').addEventListener('click', () => updateBPM(currentBPM * 2));

// Tap Tempo
let tapTimes = [];
document.getElementById('btn-tap').addEventListener('click', () => {
  const now = performance.now();
  if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 2500) {
    tapTimes = [];
  }
  tapTimes.push(now);

  if (tapTimes.length >= 2) {
    let diffs = [];
    for (let i = 1; i < tapTimes.length; i++) {
      diffs.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const calcBPM = 60000 / avg;
    updateBPM(calcBPM);
  }
  flashLed();
});

// Helpers de formato de tiempo
function formatTime(seconds) {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
}

function formatTimeShort(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ==========================================================================
// EXPORTACIÓN DE MEZCLA A ARCHIVO WAV (OFFLINE AUDIO CONTEXT)
// ==========================================================================
const btnExportWav = document.getElementById('btn-export-wav');

if (btnExportWav) {
  btnExportWav.addEventListener('click', async () => {
    const anyBuffer = vocalsBuffer || otherBuffer || bassBuffer || drumsBuffer;
    if (!anyBuffer) {
      alert("No hay ninguna pista de audio cargada para exportar.");
      return;
    }

    const originalHtml = btnExportWav.innerHTML;
    btnExportWav.disabled = true;
    btnExportWav.innerHTML = `
      <svg class="spin-icon" viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
        <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
      </svg>
      <span>Renderizando...</span>
    `;

    try {
      // 1. Configurar cuenta previa y contexto offline
      const countInMeasuresVal = parseInt(countInSelect ? countInSelect.value : "1", 10) || 0;
      const secondsPerBeat = 60.0 / currentBPM;
      const totalCountBeats = countInMeasuresVal * 4;
      const countInDuration = totalCountBeats * secondsPerBeat;

      // Calcular el retraso efectivo basándose en getEffectiveOffset()
      const effOffset = getEffectiveOffset();
      const alignTime = effOffset <= 2.0 ? effOffset : 0.0;
      const audioStartDelay = countInMeasuresVal > 0 ? Math.max(0, countInDuration - alignTime) : 0;

      const sampleRate = anyBuffer.sampleRate || 44100;
      const numChannels = 2; // Stereo
      const totalExportDuration = songDuration + audioStartDelay;
      const totalFrames = Math.ceil(totalExportDuration * sampleRate);
      
      const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        numChannels,
        totalFrames,
        sampleRate
      );

      // 2. Calcular ganancias efectivas según los sliders, Mute y Solo
      const anySolo = tracks.vocals.solo || tracks.other.solo || tracks.bass.solo || tracks.drums.solo || tracks.metronome.solo;
      function getEffectiveGain(t) {
        if (anySolo) {
          return (t.solo && !t.mute) ? t.vol : 0;
        } else {
          return !t.mute ? t.vol : 0;
        }
      }

      // 3. Renderizar las pistas de audio (Vocals, Other, Bass, Drums)
      const stemBuffers = {
        vocals: vocalsBuffer,
        other: otherBuffer,
        bass: bassBuffer,
        drums: drumsBuffer
      };

      for (const key in stemBuffers) {
        const buf = stemBuffers[key];
        const gainVal = getEffectiveGain(tracks[key]);
        if (gainVal > 0 && buf) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buf;
          const gNode = offlineCtx.createGain();
          gNode.gain.setValueAtTime(gainVal, 0);
          source.connect(gNode);
          gNode.connect(offlineCtx.destination);
          source.start(audioStartDelay);
        }
      }

      const metroGainVal = getEffectiveGain(tracks.metronome);

      // 5. Metrónomo sintetizado: Cuenta Previa + Pista
      if (metroGainVal > 0 && currentBPM > 0) {
        const metroMasterGain = offlineCtx.createGain();
        metroMasterGain.gain.setValueAtTime(metroGainVal, 0);
        metroMasterGain.connect(offlineCtx.destination);

        // A. Clics de la cuenta previa (1, 2, 3, 4...)
        if (countInMeasuresVal > 0) {
          const minK = effOffset < 0 ? 0 : 1;
          for (let k = totalCountBeats; k >= minK; k--) {
            const clickTime = audioStartDelay + effOffset - k * secondsPerBeat;
            const isAccent = ((totalCountBeats - k) % 4 === 0);
            if (clickTime >= 0) {
              scheduleOfflineClick(offlineCtx, metroMasterGain, clickTime, isAccent, metronomeSound.value);
            }
          }
        }

        // B. Clics durante la canción
        let beatTime = effOffset;
        let index = 0;

        while (beatTime < songDuration) {
          if (beatTime >= 0) {
            const isAccent = (index % 4 === 0);
            const clickTime = audioStartDelay + beatTime;
            scheduleOfflineClick(offlineCtx, metroMasterGain, clickTime, isAccent, metronomeSound.value);
          }
          beatTime += secondsPerBeat;
          index++;
        }
      }

      // 6. Renderizado ultra-rápido offline
      const renderedAudioBuffer = await offlineCtx.startRendering();

      // 7. Codificación a WAV 16-bit PCM Stereo
      const wavArrayBuffer = encodeWAV(renderedAudioBuffer);
      const blob = new Blob([wavArrayBuffer], { type: 'audio/wav' });

      // Generar nombre de archivo seguro
      const safeTitle = (songTitleStr || 'Pista').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_');
      const filename = `${safeTitle}_drum_practice_${Math.round(currentBPM)}bpm.wav`;

      // 8. Guardar archivo en la carpeta Descargas del usuario
      let savedPath = null;
      try {
        const formData = new FormData();
        formData.append('file', blob, filename);
        const saveRes = await fetch(getBackendUrl('/api/save_mix'), {
          method: 'POST',
          body: formData
        });
        if (saveRes.ok) {
          const saveJson = await saveRes.json();
          savedPath = saveJson.saved_path;
        }
      } catch (saveErr) {
        console.warn("Fallo guardado en backend, usando fallback de navegador:", saveErr);
      }

      // Fallback para navegador web estándar si el backend no respondió
      if (!savedPath) {
        const downloadUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = downloadUrl;
        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();
        
        setTimeout(() => {
          document.body.removeChild(downloadLink);
          URL.revokeObjectURL(downloadUrl);
        }, 2000);
      }

      btnExportWav.innerHTML = `
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
        <span>¡Guardado!</span>
      `;

      if (savedPath) {
        alert(`¡Mezcla guardada exitosamente!\n\n📁 Archivo: ${savedPath}`);
      }

      setTimeout(() => {
        btnExportWav.disabled = false;
        btnExportWav.innerHTML = originalHtml;
      }, 2000);

    } catch (err) {
      console.error("Error al exportar WAV:", err);
      alert("Error al exportar WAV: " + err.message);
      btnExportWav.disabled = false;
      btnExportWav.innerHTML = originalHtml;
    }
  });
}

// Sintetizador de clicks para OfflineAudioContext
function scheduleOfflineClick(ctx, targetGainNode, time, isAccent, soundType) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(targetGainNode);

  const duration = 0.07;

  if (soundType === 'woodblock') {
    const freq = isAccent ? 1200 : 800;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + duration);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  } else if (soundType === 'cowbell') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 800 : 587, time);
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(isAccent ? 1200 : 845, time);
    osc2.connect(gain2);
    gain2.connect(targetGainNode);
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    gain2.gain.setValueAtTime(0.4, time);
    gain2.gain.exponentialRampToValueAtTime(0.001, time + duration);
    osc2.start(time);
    osc2.stop(time + duration);
  } else if (soundType === 'digital') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1600 : 1000, time);
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.linearRampToValueAtTime(0.001, time + 0.03);
  } else {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 880 : 440, time);
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);
  }

  osc.start(time);
  osc.stop(time + duration + 0.02);
}

// Codificador WAV 16-bit PCM Stereo Lossless
function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const length = audioBuffer.length;
  const dataSize = length * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;
  
  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);
  
  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  // RIFF Header
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  
  // "fmt " Sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  
  // "data" Sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  
  // Intercalar canales y escribir muestras de 16-bit PCM
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }
  
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channelData[ch][i];
      // Clamping [-1.0, 1.0]
      sample = Math.max(-1.0, Math.min(1.0, sample));
      // Escalar a entero de 16 bits firmado
      const int16Sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, int16Sample, true);
      offset += 2;
    }
  }
  
  return arrayBuffer;
}
