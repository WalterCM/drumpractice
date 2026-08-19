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
    
    # Calcular Onset Strength una sola vez para reutilizar
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    
    print("Estimando tempo con múltiples candidatos...")
    
    # Obtener candidatos de tempo con ac_size grande para mejor resolución
    # librosa.feature.tempo devuelve los candidatos ordenados por probabilidad
    tempo_candidates = librosa.feature.tempo(
        onset_envelope=onset_env, sr=sr,
        aggregate=None,  # devolver todos los candidatos por frame
        ac_size=8.0,     # ventana de autocorrelación de 8 segundos
        start_bpm=120.0
    )
    
    # Calcular el tempo global como la mediana de los candidatos por frame
    # Esto nos da el tempo más frecuente a lo largo de la canción
    global_tempo = float(np.median(tempo_candidates))
    
    # Resolver ambigüedad de octava:
    # Si el tempo está entre 80-110, verificar si el doble (160-220) tiene soporte
    # Calculamos la densidad de onsets para determinar si el tempo real es el doble
    if 70 < global_tempo < 115:
        # Contar la distancia media entre picos de onset
        peaks = librosa.util.peak_pick(
            onset_env, pre_max=3, post_max=3, 
            pre_avg=3, post_avg=5, delta=0.5, wait=5
        )
        if len(peaks) > 2:
            peak_times = librosa.frames_to_time(peaks, sr=sr)
            intervals = np.diff(peak_times)
            median_interval = float(np.median(intervals))
            implied_bpm = 60.0 / median_interval if median_interval > 0 else global_tempo
            
            # Si los intervalos entre onsets implican un BPM cercano al doble, usar el doble
            double_tempo = global_tempo * 2
            if abs(implied_bpm - double_tempo) < abs(implied_bpm - global_tempo):
                print(f"  Resolviendo ambigüedad de octava: {global_tempo:.1f} -> {double_tempo:.1f} BPM")
                global_tempo = double_tempo
    
    bpm = round(global_tempo, 2)
    
    print(f"Tempo estimado: {bpm} BPM. Calculando beat tracking...")
    
    # Ejecutar beat_track con el BPM correcto como pista (start_bpm)
    # Esto fuerza al algoritmo de programación dinámica a buscar beats
    # con el período correcto en lugar del default de 120 BPM
    tempo_result, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr,
        start_bpm=bpm,
        units='frames'
    )
    
    # Convertir frames de beats a tiempo en segundos
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    
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
