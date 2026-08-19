import numpy as np
import soundfile as sf

def create_synthetic_beat(filename="synthetic_beat.wav", bpm=120, duration=6):
    """
    Genera un archivo WAV de prueba con beeps a un tempo determinado.
    """
    sr = 22050
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = np.zeros_like(t)
    
    # Intervalo de beat en segundos
    beat_interval = 60.0 / bpm
    
    # Añadir pulsos (beeps) en cada beat
    for i in range(int(duration / beat_interval)):
        beat_time = i * beat_interval
        beep_samples = int(sr * 0.1)
        start_idx = int(sr * beat_time)
        if start_idx + beep_samples < len(audio):
            beep_t = np.linspace(0, 0.1, beep_samples, endpoint=False)
            beep = np.sin(2 * np.pi * 440 * beep_t) * np.exp(-beep_t * 30)
            audio[start_idx:start_idx+beep_samples] = beep
            
    # Normalizar y guardar
    audio = audio / (np.max(np.abs(audio)) + 1e-6)
    sf.write(filename, audio, sr)
    print(f"Archivo de prueba '{filename}' creado con exito ({bpm} BPM, {duration}s).")

if __name__ == '__main__':
    create_synthetic_beat()
