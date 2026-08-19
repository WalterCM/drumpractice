// Drum Practice Tool - Frontend Logic
// Comunicación con backend por Websockets y motor de Web Audio API para metrónomo

let ws = null;
let wavesurfer = null;
let audioCtx = null;
let audioBuffer = null; // Buffer para la canción sin batería
let drumsBuffer = null; // Buffer para la batería original aislada

// Nodos de Audio
let songNode = null;
let drumsNode = null;
let songGain = null;
let drumsGain = null;
let metronomeGain = null;

// Configuración de reproducción y tempo
let isPlaying = false;
let isLooping = false;
let songDuration = 0;
let playbackStartTime = 0; // en segundos del context
let pausedAt = 0; // posición actual de reproducción en segundos

// Datos de tempo detectados por IA
let originalBPM = 120;
let originalBeats = []; // timestamps en segundos
let currentBPM = 120;
let currentOffset = 0; // en segundos

// Variables del metrónomo
let schedulerIntervalId = null;
let nextNoteTime = 0.0; // cuándo agendar el siguiente click en segundos del context
let beatIndex = 0; // índice del beat actual
const scheduleAheadTime = 0.1; // qué tan adelante agendar (segundos)
const lookahead = 25.0; // qué tan seguido correr la función de agenda (ms)

// Elementos de la UI
const youtubeUrlInput = document.getElementById('youtube-url');
const processBtn = document.getElementById('process-btn');
const progressContainer = document.getElementById('progress-container');
const progressMessage = document.getElementById('progress-message');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');

const workspaceSection = document.getElementById('workspace-section');
const setupSection = document.getElementById('setup-section');
const songTitle = document.getElementById('song-title');

const btnPlayPause = document.getElementById('btn-play-pause');
const btnStop = document.getElementById('btn-stop');
const btnLoop = document.getElementById('btn-loop');
const playIcon = document.getElementById('play-icon');
const pauseIcon = document.getElementById('pause-icon');

const volMusic = document.getElementById('vol-music');
const volDrums = document.getElementById('vol-drums');
const volMetronome = document.getElementById('vol-metronome');
const valMusic = document.getElementById('val-music');
const valDrums = document.getElementById('val-drums');
const valMetronome = document.getElementById('val-metronome');

const bpmDigits = document.getElementById('bpm-digits');
const beatLed = document.getElementById('beat-led');
const offsetSlider = document.getElementById('offset-slider');
const valOffset = document.getElementById('val-offset');
const metronomeSound = document.getElementById('metronome-sound');
const btnResetTempo = document.getElementById('btn-reset-tempo');

const backendStatusDot = document.getElementById('backend-status-dot');
const backendStatusText = document.getElementById('backend-status-text');

// Conectar con el backend FastAPI
function connectBackend() {
  const healthUrl = window.location.protocol === 'file:' 
    ? 'http://127.0.0.1:8000/api/health' 
    : '/api/health';

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
      console.log('Backend no disponible, reintentando...', err);
      backendStatusDot.className = 'status-dot disconnected';
      backendStatusText.textContent = 'Backend Desconectado - Ejecuta ./run_app.sh';
      youtubeUrlInput.setAttribute('disabled', 'true');
      processBtn.setAttribute('disabled', 'true');
      setTimeout(connectBackend, 2000);
    });
}

// Inicializar la conexión
connectBackend();

// Validar entrada del link de YouTube
youtubeUrlInput.addEventListener('input', () => {
  const url = youtubeUrlInput.value.trim();
  if (url.includes('youtube.com/') || url.includes('youtu.be/')) {
    processBtn.removeAttribute('disabled');
  } else {
    processBtn.setAttribute('disabled', 'true');
  }
});

// Acción al clickear en Procesar Pista
processBtn.addEventListener('click', () => {
  let url = youtubeUrlInput.value.trim();
  if (!url) return;
  
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Mostrar contenedor de progreso
  progressContainer.classList.remove('hidden');
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressMessage.textContent = 'Iniciando conexión...';
  processBtn.setAttribute('disabled', 'true');
  youtubeUrlInput.setAttribute('disabled', 'true');

  // Abrir conexión WebSocket dinámicamente para el procesamiento
  const wsHost = window.location.protocol === 'file:' ? '127.0.0.1:8000' : window.location.host;
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${wsProtocol}//${wsHost}/ws/process`);

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
      progressMessage.textContent = data.message || '¡Procesamiento completo!';
      progressBar.style.width = '100%';
      progressPercent.textContent = '100%';
      
      // Cargar los resultados en el reproductor
      setTimeout(() => {
        setupWorkspace(data.result);
      }, 500);
      
      ws.close();
    } else if (data.status === 'error') {
      progressMessage.textContent = `Error: ${data.message}`;
      progressBar.style.background = '#ef4444';
      processBtn.removeAttribute('disabled');
      youtubeUrlInput.removeAttribute('disabled');
      ws.close();
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket Error:', error);
    progressMessage.textContent = 'Error de conexión con el backend.';
    processBtn.removeAttribute('disabled');
    youtubeUrlInput.removeAttribute('disabled');
  };
});

// Manejador para selección de archivo de audio local
const btnBrowseFile = document.getElementById('btn-browse-file');
const localAudioInput = document.getElementById('local-audio-input');

if (btnBrowseFile && localAudioInput) {
  btnBrowseFile.addEventListener('click', () => {
    localAudioInput.click();
  });

  localAudioInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '30%';
    progressPercent.textContent = '30%';
    progressMessage.textContent = `Subiendo y procesando ${file.name} con IA...`;
    processBtn.setAttribute('disabled', 'true');
    youtubeUrlInput.setAttribute('disabled', 'true');

    const formData = new FormData();
    formData.append('file', file);

    const uploadUrl = window.location.protocol === 'file:' 
      ? 'http://127.0.0.1:8000/api/upload' 
      : '/api/upload';

    try {
      const response = await fetch(uploadUrl, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Error en el servidor: HTTP ' + response.status);
      }

      const data = await response.json();
      if (data.status === 'completed' && data.result) {
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressMessage.textContent = '¡Procesamiento completo!';
        setTimeout(() => {
          setupWorkspace(data.result);
        }, 500);
      } else {
        throw new Error(data.message || 'Error desconocido');
      }
    } catch (err) {
      progressMessage.textContent = `Error: ${err.message}`;
      progressBar.style.background = '#ef4444';
      processBtn.removeAttribute('disabled');
      youtubeUrlInput.removeAttribute('disabled');
    }
  });
}

// Configurar el espacio de trabajo con los audios y metadatos
async function setupWorkspace(songData) {
  if (!songData) {
    console.error("Error: songData no está definido");
    return;
  }

  // Ocultar sección setup, mostrar workspace
  setupSection.classList.add('hidden');
  workspaceSection.classList.remove('hidden');
  
  const title = songData.title || songData.id || "Canción";
  songTitle.textContent = title.replace(/_/g, ' ');

  originalBPM = songData.bpm || 120;
  currentBPM = songData.bpm || 120;
  originalBeats = songData.beats || [];
  currentOffset = 0; // en segundos
  
  bpmDigits.textContent = Math.round(currentBPM);
  offsetSlider.value = 0;
  valOffset.textContent = '0 ms';

  // Inicializar Web Audio API Context
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Inicializar WaveSurfer para visualización gráfica
  if (wavesurfer) {
    wavesurfer.destroy();
  }

  wavesurfer = WaveSurfer.create({
    container: '#waveform',
    waveColor: '#4b5563',
    progressColor: '#00e676',
    cursorColor: '#ff5722',
    cursorWidth: 2,
    barWidth: 2,
    barGap: 1,
    height: 120,
    responsive: true,
    interact: true,
    url: songData.no_drums_url
  });

  // Conectar el volumen inicial
  setupAudioRouting();

  // Descargar y decodificar el audio en buffers para Web Audio API (para control de mezcla de baja latencia)
  try {
    const [songRes, drumsRes] = await Promise.all([
      fetch(songData.no_drums_url),
      songData.drums_url ? fetch(songData.drums_url) : Promise.resolve(null)
    ]);

    const songArrBuf = await songRes.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(songArrBuf);

    if (drumsRes) {
      const drumsArrBuf = await drumsRes.arrayBuffer();
      drumsBuffer = await audioCtx.decodeAudioData(drumsArrBuf);
    }
    
    songDuration = audioBuffer.duration;
    console.log(`Audios decodificados con éxito. Duración: ${songDuration} segundos.`);

    // Sincronizar interacción con la forma de onda
    wavesurfer.on('interaction', (newTime) => {
      const seekProgress = wavesurfer.getCurrentTime();
      if (isPlaying) {
        stopAudioNodes();
        pausedAt = seekProgress;
        playTrack(pausedAt);
      } else {
        pausedAt = seekProgress;
      }
    });

  } catch (e) {
    console.error("Error al decodificar audio:", e);
    alert("Error al cargar los archivos de audio en el reproductor: " + e.message);
  }
}

// Configurar el ruteo de volumen
function setupAudioRouting() {
  // Crear nodos de ganancia
  songGain = audioCtx.createGain();
  drumsGain = audioCtx.createGain();
  metronomeGain = audioCtx.createGain();

  // Configurar volumenes iniciales
  songGain.gain.setValueAtTime(volMusic.value / 100, audioCtx.currentTime);
  drumsGain.gain.setValueAtTime(volDrums.value / 100, audioCtx.currentTime);
  metronomeGain.gain.setValueAtTime(volMetronome.value / 100, audioCtx.currentTime);

  // Conectar a salida física de audio
  songGain.connect(audioCtx.destination);
  drumsGain.connect(audioCtx.destination);
  metronomeGain.connect(audioCtx.destination);
}

// --- LOGICA DEL METRONOMO (WEB AUDIO API SCHEDULER) ---

// Reproducir un sonido de clic sintetizado preciso
function playClickSound(time, isAccent = false) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.connect(gain);
  gain.connect(metronomeGain);
  
  const soundType = metronomeSound.value;
  const duration = 0.08; // duración en segundos
  
  if (soundType === 'woodblock') {
    // Sonido orgánico de madera
    const freq = isAccent ? 1200 : 800;
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    // Barrido de frecuencia descendente rápido
    osc.frequency.exponentialRampToValueAtTime(100, time + duration);
    
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
  } 
  else if (soundType === 'cowbell') {
    // Sonido metálico de cencerro
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 800 : 587, time);
    
    // Un segundo oscilador desafinado para el tono metálico
    const osc2 = audioCtx.createOscillator();
    const gain2 = audioCtx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(isAccent ? 1200 : 845, time);
    osc2.connect(gain2);
    gain2.connect(metronomeGain);
    
    gain.gain.setValueAtTime(0.7, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
    gain2.gain.setValueAtTime(0.4, time);
    gain2.gain.exponentialRampToValueAtTime(0.001, time + duration);
    
    osc2.start(time);
    osc2.stop(time + duration);
  } 
  else if (soundType === 'digital') {
    // Clic digital de sintetizador
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 1500 : 1000, time);
    
    gain.gain.setValueAtTime(1.0, time);
    gain.gain.linearRampToValueAtTime(0.001, time + 0.03); // muy corto
  } 
  else { // beep
    // Tono puro
    osc.type = 'sine';
    osc.frequency.setValueAtTime(isAccent ? 880 : 440, time);
    
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
  }
  
  osc.start(time);
  osc.stop(time + duration + 0.05);

  // Disparar flash visual en el hilo de UI
  const delayMs = (time - audioCtx.currentTime) * 1000;
  setTimeout(() => {
    if (isPlaying) {
      flashLed();
    }
  }, Math.max(0, delayMs));
}

function flashLed() {
  beatLed.classList.add('flash');
  setTimeout(() => {
    beatLed.classList.remove('flash');
  }, 80);
}

// Agendar las notas del metrónomo que caen en el intervalo de adelanto
function scheduler() {
  const currentTime = audioCtx.currentTime;
  
  // Mientras haya beats que ocurran antes del tiempo límite agenda-adelante
  while (nextNoteTime < currentTime + scheduleAheadTime) {
    // Calculamos en qué momento de la canción actual cae este beat
    // tiempo_cancion = tiempo_beat_context - tiempo_inicio_reproduccion_context
    const songPlayPosition = nextNoteTime - playbackStartTime;
    
    // Si la posición de reproducción excede la duración de la canción, detenemos o reiniciamos
    if (songPlayPosition >= songDuration) {
      if (isLooping) {
        // En loop, reiniciamos el tiempo de inicio de reproducción
        playbackStartTime += songDuration;
        nextNoteTime = playbackStartTime + currentOffset;
        beatIndex = 0;
        continue;
      } else {
        break;
      }
    }

    // Acentuar el primer beat de cada compás de 4 tiempos
    const isAccent = (beatIndex % 4 === 0);
    
    // Agendar sonido de clic
    playClickSound(nextNoteTime, isAccent);
    
    // Avanzar al siguiente beat
    advanceTimer();
  }
}

// Avanza el tiempo del metrónomo en base al BPM
function advanceTimer() {
  const secondsPerBeat = 60.0 / currentBPM;
  nextNoteTime += secondsPerBeat;
  beatIndex++;
}

// --- LOGICA DE REPRODUCCION DE AUDIO ---

// Iniciar reproducción desde una posición en segundos
function playTrack(startSeconds = 0) {
  if (!audioBuffer) return;
  
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  isPlaying = true;
  pausedAt = startSeconds;
  
  // Configurar iconos de play/pausa
  playIcon.classList.add('hidden');
  pauseIcon.classList.remove('hidden');

  // Iniciar visualizador de WaveSurfer
  wavesurfer.setTime(startSeconds);
  wavesurfer.play();

  // El tiempo del context en el que arrancamos a reproducir la canción
  const now = audioCtx.currentTime;
  playbackStartTime = now - startSeconds;

  // Crear y conectar nodos fuente de audio para esta sesión de reproducción
  songNode = audioCtx.createBufferSource();
  songNode.buffer = audioBuffer;
  songNode.connect(songGain);

  if (drumsBuffer) {
    drumsNode = audioCtx.createBufferSource();
    drumsNode.buffer = drumsBuffer;
    drumsNode.connect(drumsGain);
  }

  // Sincronizar el loop de Web Audio API si loop está activo
  if (isLooping) {
    songNode.loop = true;
    songNode.loopStart = 0;
    songNode.loopEnd = songDuration;
    if (drumsNode) {
      drumsNode.loop = true;
      drumsNode.loopStart = 0;
      drumsNode.loopEnd = songDuration;
    }
  }

  // Configurar agenda del metrónomo
  // Buscamos cuál es el primer beat que ocurre después de nuestra posición de inicio
  // Para un metrónomo de tempo constante alineado por offset:
  const secondsPerBeat = 60.0 / currentBPM;
  
  // La fórmula del beat 'n' es: t = currentOffset + n * secondsPerBeat
  // Queremos el menor 'n' tal que: offset + n * secondsPerBeat >= startSeconds
  let n = 0;
  if (startSeconds > currentOffset) {
    n = Math.ceil((startSeconds - currentOffset) / secondsPerBeat);
  }
  
  beatIndex = n;
  // Tiempo exacto en segundos de la canción para el siguiente click
  const nextBeatSongTime = currentOffset + n * secondsPerBeat;
  
  // Tiempo absoluto en el contexto de audio
  nextNoteTime = playbackStartTime + nextBeatSongTime;

  // Arrancar audios en el instante 'now' y reproducir desde la posición 'startSeconds'
  songNode.start(now, startSeconds);
  if (drumsNode) {
    drumsNode.start(now, startSeconds);
  }

  // Lanzar el timer scheduler del metrónomo
  schedulerIntervalId = setInterval(scheduler, lookahead);
}

// Detener los nodos de audio actuales
function stopAudioNodes() {
  if (schedulerIntervalId) {
    clearInterval(schedulerIntervalId);
    schedulerIntervalId = null;
  }
  
  try {
    if (songNode) {
      songNode.stop();
      songNode.disconnect();
      songNode = null;
    }
    if (drumsNode) {
      drumsNode.stop();
      drumsNode.disconnect();
      drumsNode = null;
    }
  } catch (e) {
    // el audio ya se había detenido
  }
}

// Pausar la reproducción
function pauseTrack() {
  if (!isPlaying) return;
  isPlaying = false;
  
  // Iconos
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
  
  // Pausar wavesurfer
  wavesurfer.pause();
  
  // Calcular posición exacta donde pausamos en segundos
  pausedAt = audioCtx.currentTime - playbackStartTime;
  if (pausedAt >= songDuration) {
    pausedAt = 0;
  }
  
  stopAudioNodes();
}

// Detener por completo la reproducción (volver al inicio)
function stopTrack() {
  isPlaying = false;
  pausedAt = 0;
  
  // Iconos
  playIcon.classList.remove('hidden');
  pauseIcon.classList.add('hidden');
  
  wavesurfer.stop();
  stopAudioNodes();
}

// Manejar los clicks de Play / Pausa / Stop
btnPlayPause.addEventListener('click', () => {
  if (isPlaying) {
    pauseTrack();
  } else {
    playTrack(pausedAt);
  }
});

btnStop.addEventListener('click', () => {
  stopTrack();
});

btnLoop.addEventListener('click', () => {
  isLooping = !isLooping;
  btnLoop.classList.toggle('active', isLooping);
  
  // Actualizar nodos en caliente si están reproduciendo
  if (songNode) {
    songNode.loop = isLooping;
    if (isLooping) {
      songNode.loopStart = 0;
      songNode.loopEnd = songDuration;
    }
  }
  if (drumsNode) {
    drumsNode.loop = isLooping;
    if (isLooping) {
      drumsNode.loopStart = 0;
      drumsNode.loopEnd = songDuration;
    }
  }
});

// Controladores de volumen en caliente
volMusic.addEventListener('input', () => {
  const v = volMusic.value;
  valMusic.textContent = `${v}%`;
  if (songGain) {
    songGain.gain.setValueAtTime(v / 100, audioCtx.currentTime);
  }
});

volDrums.addEventListener('input', () => {
  const v = volDrums.value;
  valDrums.textContent = `${v}%`;
  if (drumsGain) {
    drumsGain.gain.setValueAtTime(v / 100, audioCtx.currentTime);
  }
});

volMetronome.addEventListener('input', () => {
  const v = volMetronome.value;
  valMetronome.textContent = `${v}%`;
  if (metronomeGain) {
    metronomeGain.gain.setValueAtTime(v / 100, audioCtx.currentTime);
  }
});

// --- EDICIÓN Y AJUSTES DE TEMPO ---

function updateBPM(newBPM) {
  currentBPM = Math.max(20, Math.min(300, newBPM)); // límite entre 20 y 300 BPM
  bpmDigits.textContent = Math.round(currentBPM);
  
  // Si está reproduciendo, debemos actualizar el scheduler para que tome el nuevo tempo al instante.
  // Para evitar saltos bruscos desafinados, recalculamos cuándo debe sonar el siguiente beat.
  if (isPlaying) {
    // Calculamos qué parte de la canción va actualmente
    const currentSongTime = audioCtx.currentTime - playbackStartTime;
    const secondsPerBeat = 60.0 / currentBPM;
    
    // Reposicionamos el índice de beat actual en base a la posición de la canción y el nuevo tempo
    let n = 0;
    if (currentSongTime > currentOffset) {
      n = Math.ceil((currentSongTime - currentOffset) / secondsPerBeat);
    }
    beatIndex = n;
    nextNoteTime = playbackStartTime + currentOffset + n * secondsPerBeat;
  }
}

// Botones de ajuste de tempo
document.getElementById('bpm-minus-5').addEventListener('click', () => updateBPM(currentBPM - 5));
document.getElementById('bpm-minus-1').addEventListener('click', () => updateBPM(currentBPM - 1));
document.getElementById('bpm-plus-1').addEventListener('click', () => updateBPM(currentBPM + 1));
document.getElementById('bpm-plus-5').addEventListener('click', () => updateBPM(currentBPM + 5));

document.getElementById('bpm-half').addEventListener('click', () => updateBPM(currentBPM / 2));
document.getElementById('bpm-double').addEventListener('click', () => updateBPM(currentBPM * 2));

// Control de Offset (Desfase del metrónomo)
offsetSlider.addEventListener('input', () => {
  const ms = parseInt(offsetSlider.value);
  valOffset.textContent = `${ms >= 0 ? '+' : ''}${ms} ms`;
  
  // Convertimos ms a segundos
  currentOffset = ms / 1000.0;
  
  // Recalcular nextNoteTime si está reproduciendo
  if (isPlaying) {
    const currentSongTime = audioCtx.currentTime - playbackStartTime;
    const secondsPerBeat = 60.0 / currentBPM;
    
    let n = 0;
    if (currentSongTime > currentOffset) {
      n = Math.ceil((currentSongTime - currentOffset) / secondsPerBeat);
    }
    beatIndex = n;
    nextNoteTime = playbackStartTime + currentOffset + n * secondsPerBeat;
  }
});

// Botón de restaurar original
btnResetTempo.addEventListener('click', () => {
  updateBPM(originalBPM);
  currentOffset = 0;
  offsetSlider.value = 0;
  valOffset.textContent = '0 ms';
});

// --- LÓGICA DE TAP TEMPO ---
let tapTimes = [];
document.getElementById('btn-tap').addEventListener('click', () => {
  const now = performance.now();
  
  // Limpiar taps viejos (si pasó más de 3 segundos desde el último)
  if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > 3000) {
    tapTimes = [];
  }
  
  tapTimes.push(now);
  
  if (tapTimes.length >= 2) {
    // Calcular diferencias de tiempo (intervalos)
    let intervals = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    
    // Promediar los intervalos (en ms)
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    
    // Calcular BPM: (60 segundos / intervalo en segundos)
    const calculatedBPM = 60000 / avgInterval;
    updateBPM(calculatedBPM);
  }
  
  // Flash LED visual al hacer TAP
  flashLed();
});

// Sincronizar parada de audio cuando termina la canción de forma natural
// (Cuando se agota el buffer de audio de forma natural)
setInterval(() => {
  if (isPlaying) {
    const currentPosition = audioCtx.currentTime - playbackStartTime;
    if (currentPosition >= songDuration) {
      if (isLooping) {
        // En loop, Web Audio API reinicia solo el buffer. 
        // El scheduler del metrónomo se encarga del offset en su hilo,
        // pero wavesurfer necesita ser reseteado visualmente
        wavesurfer.setTime(0);
      } else {
        stopTrack();
      }
    }
  }
}, 200);
