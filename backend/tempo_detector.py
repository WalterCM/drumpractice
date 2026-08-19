import librosa
import numpy as np
import json
import os

def analyze_tempo(audio_path: str) -> dict:
    """
    Analiza un archivo de audio usando Librosa.
    Estima el BPM global (tempo) y los timestamps (en segundos) de los beats detectados.
    
    Devuelve un diccionario:
    {
        "bpm": float,
        "beats": [float]  # lista de tiempos en segundos
    }
    """
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Archivo de audio no encontrado: {audio_path}")
        
    print(f"Cargando audio para análisis de tempo: {audio_path}...")
    # sr=22050 para optimizar el rendimiento de librosa y la carga de memoria
    y, sr = librosa.load(audio_path, sr=22050)
    
    print("Calculando beat tracking...")
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr)
    
    # Convertir frames de beats a tiempo en segundos
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    
    # Asegurarnos de que el tempo sea un float de Python nativo (librosa 0.10+ devuelve float o array de un elemento)
    if isinstance(tempo, np.ndarray):
        bpm = float(tempo[0]) if len(tempo) > 0 else 120.0
    else:
        bpm = float(tempo)
        
    bpm = round(bpm, 2)
    beats_list = [round(float(t), 4) for t in beat_times]
    
    print(f"Análisis completado: BPM estimado = {bpm}, Beats detectados = {len(beats_list)}")
    
    return {
        "bpm": bpm,
        "beats": beats_list
    }

if __name__ == '__main__':
    # Prueba rápida
    import sys
    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        try:
            results = analyze_tempo(audio_file)
            print(json.dumps(results, indent=2))
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("Uso: python tempo_detector.py <ruta_audio>")
