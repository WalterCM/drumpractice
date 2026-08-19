// Drum Practice Studio - DAW Engine
// Web Audio API Multitrack Engine con Canvas Waves, Mute/Solo, Scheduler y Drag & Drop Sync

let audioCtx = null;
let musicBuffer = null;
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
  music: { vol: 0.8, mute: false, solo: false, gainNode: null, sourceNode: null },
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

// Canvas
const rulerCanvas = document.getElementById('ruler-canvas');
const canvasMusic = document.getElementById('canvas-music');
const canvasDrums = document.getElementById('canvas-drums');
const canvasMetronome = document.getElementById('canvas-metronome');
const globalPlayhead = document.getElementById('global-playhead');
const laneMetronome = document.getElementById('lane-metronome');

// Conexión Backend
function connectBackend() {
  const healthUrl = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000/api/health' : '/api/health';
  fetch(healthUrl)
    .then(res => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(data => {
      if (data.status === 'running') {
        backendStatusDot.className = 'status-dot connected';
        backendStatusText.textContent = 'Backend Conectado (Local)';
        youtubeUrlInput.removeAttribute('disabled');
        const url = youtubeUrlInput.value.trim();
        if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
          processBtn.removeAttribute('disabled');
        }
      }
    })
    .catch(err => {
      backendStatusDot.className = 'status-dot disconnected';
      backendStatusText.textContent = 'Backend Desconectado - Ejecuta ./run_app.sh';
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

  const wsHost = window.location.protocol === 'file:' ? '127.0.0.1:8000' : window.location.host;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/process`);

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
    const uploadUrl = window.location.protocol === 'file:' ? 'http://127.0.0.1:8000/api/upload' : '/api/upload';

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
  if (detectedBeats.length > 0) {
    const secondsPerBeat = 60.0 / currentBPM;
    // Calculamos el desfase módulo período para cada beat y obtenemos la mediana
    const phases = detectedBeats.map(b => ((b % secondsPerBeat) + secondsPerBeat) % secondsPerBeat);
    phases.sort((a, b) => a - b);
    currentOffset = phases[Math.floor(phases.length / 2)];
  } else {
    currentOffset = 0.0;
  }

  const offsetMs = Math.round(currentOffset * 1000);
  offsetSlider.value = offsetMs;
  valOffset.textContent = `${offsetMs >= 0 ? '+' : ''}${offsetMs} ms`;

  // Inicializar Audio Context
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Configurar Gain Nodes
  tracks.music.gainNode = audioCtx.createGain();
  tracks.drums.gainNode = audioCtx.createGain();
  tracks.metronome.gainNode = audioCtx.createGain();

  tracks.music.gainNode.connect(audioCtx.destination);
  tracks.drums.gainNode.connect(audioCtx.destination);
  tracks.metronome.gainNode.connect(audioCtx.destination);

  // Sincronizar el estado interno de volumen y botones con los sliders del DOM
  const volMusicElem = document.getElementById('vol-music');
  const volDrumsElem = document.getElementById('vol-drums');
  const volMetroElem = document.getElementById('vol-metronome');

  tracks.music.vol = volMusicElem ? parseFloat(volMusicElem.value) / 100 : 0.8;
  tracks.drums.vol = volDrumsElem ? parseFloat(volDrumsElem.value) / 100 : 0.0;
  tracks.metronome.vol = volMetroElem ? parseFloat(volMetroElem.value) / 100 : 0.6;

  document.getElementById('val-music').textContent = `${Math.round(tracks.music.vol * 100)}%`;
  document.getElementById('val-drums').textContent = `${Math.round(tracks.drums.vol * 100)}%`;
  document.getElementById('val-metronome').textContent = `${Math.round(tracks.metronome.vol * 100)}%`;

  tracks.music.mute = document.getElementById('mute-music').classList.contains('active');
  tracks.drums.mute = document.getElementById('mute-drums').classList.contains('active');
  tracks.metronome.mute = document.getElementById('mute-metronome').classList.contains('active');

  tracks.music.solo = document.getElementById('solo-music').classList.contains('active');
  tracks.drums.solo = document.getElementById('solo-drums').classList.contains('active');
  tracks.metronome.solo = document.getElementById('solo-metronome').classList.contains('active');

  updateTrackGains();

  progressMessage.textContent = "Decodificando pistas de audio...";
  try {
    const [songRes, drumsRes] = await Promise.all([
      fetch(songData.no_drums_url),
      songData.drums_url ? fetch(songData.drums_url) : Promise.resolve(null)
    ]);

    const songArr = await songRes.arrayBuffer();
    musicBuffer = await audioCtx.decodeAudioData(songArr);

    if (drumsRes) {
      const drumsArr = await drumsRes.arrayBuffer();
      drumsBuffer = await audioCtx.decodeAudioData(drumsArr);
    } else {
      drumsBuffer = null;
    }

    songDuration = musicBuffer.duration;
    timeTotal.textContent = formatTime(songDuration);
    timeCurrent.textContent = formatTime(0);

    // Ajustar resolución y dibujar formas de onda
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
  const anySolo = tracks.music.solo || tracks.drums.solo || tracks.metronome.solo;

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
  setupCanvasSize(canvasMusic, timelineWidth, 110);
  setupCanvasSize(canvasDrums, timelineWidth, 110);
  setupCanvasSize(canvasMetronome, timelineWidth, 110);

  // Dibujar
  drawRuler();
  if (musicBuffer) drawWaveform(canvasMusic, musicBuffer, '#06b6d4');
  if (drumsBuffer) drawWaveform(canvasDrums, drumsBuffer, '#a855f7');
  drawMetronomeGrid();
}

// Listeners de Volumen
document.getElementById('vol-music').addEventListener('input', (e) => {
  const v = e.target.value / 100;
  tracks.music.vol = v;
  document.getElementById('val-music').textContent = `${Math.round(v * 100)}%`;
  updateTrackGains();
});

document.getElementById('vol-drums').addEventListener('input', (e) => {
  const v = e.target.value / 100;
  tracks.drums.vol = v;
  document.getElementById('val-drums').textContent = `${Math.round(v * 100)}%`;
  updateTrackGains();
});

document.getElementById('vol-metronome').addEventListener('input', (e) => {
  const v = e.target.value / 100;
  tracks.metronome.vol = v;
  document.getElementById('val-metronome').textContent = `${Math.round(v * 100)}%`;
  updateTrackGains();
});

// Listeners Mute
document.getElementById('mute-music').addEventListener('click', (e) => {
  tracks.music.mute = !tracks.music.mute;
  e.target.classList.toggle('active', tracks.music.mute);
  updateTrackGains();
});

document.getElementById('mute-drums').addEventListener('click', (e) => {
  tracks.drums.mute = !tracks.drums.mute;
  e.target.classList.toggle('active', tracks.drums.mute);
  updateTrackGains();
});

document.getElementById('mute-metronome').addEventListener('click', (e) => {
  tracks.metronome.mute = !tracks.metronome.mute;
  e.target.classList.toggle('active', tracks.metronome.mute);
  updateTrackGains();
});

// Listeners Solo
document.getElementById('solo-music').addEventListener('click', (e) => {
  tracks.music.solo = !tracks.music.solo;
  e.target.classList.toggle('active', tracks.music.solo);
  updateTrackGains();
});

document.getElementById('solo-drums').addEventListener('click', (e) => {
  tracks.drums.solo = !tracks.drums.solo;
  e.target.classList.toggle('active', tracks.drums.solo);
  updateTrackGains();
});

document.getElementById('solo-metronome').addEventListener('click', (e) => {
  tracks.metronome.solo = !tracks.metronome.solo;
  e.target.classList.toggle('active', tracks.metronome.solo);
  updateTrackGains();
});


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
  let beatTime = currentOffset;
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

// ==========================================================================
// REPRODUCCIÓN MULTITRACK (WEB AUDIO API & SCHEDULER)
// ==========================================================================
async function playTrack(startSeconds = 0) {
  if (!musicBuffer) return;

  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }

  isPlaying = true;
  pausedAt = startSeconds;

  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');

  const now = audioCtx.currentTime;
  playbackStartTime = now - startSeconds;

  // Actualizar volumen de las pistas antes de empezar
  updateTrackGains();

  // Crear nodos fuente de audio para música y batería
  tracks.music.sourceNode = audioCtx.createBufferSource();
  tracks.music.sourceNode.buffer = musicBuffer;
  tracks.music.sourceNode.connect(tracks.music.gainNode);

  if (drumsBuffer) {
    tracks.drums.sourceNode = audioCtx.createBufferSource();
    tracks.drums.sourceNode.buffer = drumsBuffer;
    tracks.drums.sourceNode.connect(tracks.drums.gainNode);
  }

  // Loop
  if (isLooping) {
    tracks.music.sourceNode.loop = true;
    tracks.music.sourceNode.loopStart = 0;
    tracks.music.sourceNode.loopEnd = songDuration;
    if (tracks.drums.sourceNode) {
      tracks.drums.sourceNode.loop = true;
      tracks.drums.sourceNode.loopStart = 0;
      tracks.drums.sourceNode.loopEnd = songDuration;
    }
  }

  // Configurar Scheduler del Metrónomo
  resyncScheduler();

  // Iniciar reproducción
  tracks.music.sourceNode.start(now, startSeconds);
  if (tracks.drums.sourceNode) {
    tracks.drums.sourceNode.start(now, startSeconds);
  }

  // Iniciar intervalo de scheduler del metrónomo
  if (schedulerIntervalId) clearInterval(schedulerIntervalId);
  schedulerIntervalId = setInterval(scheduler, lookahead);

  // Iniciar animación de Playhead
  requestAnimationFrame(updatePlayhead);
}

function stopAudioSources() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }

  try {
    if (tracks.music.sourceNode) {
      tracks.music.sourceNode.stop();
      tracks.music.sourceNode.disconnect();
      tracks.music.sourceNode = null;
    }
    if (tracks.drums.sourceNode) {
      tracks.drums.sourceNode.stop();
      tracks.drums.sourceNode.disconnect();
      tracks.drums.sourceNode = null;
    }
  } catch (e) {}
}

function pauseTrack() {
  if (!isPlaying) return;
  isPlaying = false;
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');

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
  if (tracks.music.sourceNode) tracks.music.sourceNode.loop = isLooping;
  if (tracks.drums.sourceNode) tracks.drums.sourceNode.loop = isLooping;
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
document.getElementById('lane-music').addEventListener('click', handleTimelineClick);
document.getElementById('lane-drums').addEventListener('click', handleTimelineClick);

// ==========================================================================
// SCHEDULER DEL METRÓNOMO & ANIMACIÓN PLAYHEAD
// ==========================================================================
function resyncScheduler() {
  const currentSongTime = isPlaying ? (audioCtx.currentTime - playbackStartTime) : pausedAt;
  const secondsPerBeat = 60.0 / currentBPM;

  let n = 0;
  if (currentSongTime > currentOffset) {
    n = Math.ceil((currentSongTime - currentOffset) / secondsPerBeat);
  }
  beatIndex = n;
  nextNoteTime = playbackStartTime + currentOffset + n * secondsPerBeat;
}

function scheduler() {
  const currentTime = audioCtx.currentTime;
  while (nextNoteTime < currentTime + scheduleAheadTime) {
    const songPlayPosition = nextNoteTime - playbackStartTime;
    if (songPlayPosition >= songDuration) {
      if (isLooping) {
        playbackStartTime += songDuration;
        nextNoteTime = playbackStartTime + currentOffset;
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
