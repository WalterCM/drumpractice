import librosa
import numpy as np
import json
import os

def analyze_tempo(audio_path: str) -> dict:
    """
    Analiza un archivo de audio usando Librosa.
    Estima el BPM global continuo y el offset de sincronización óptimo
    a partir de regresión lineal sobre los transitorios de la batería.
    
    Devuelve un diccionario:
    {
        "bpm": float,       # BPM continuo exacto (ej. 198.0)
        "offset": float,    # Desfase en segundos para alinear el metrónomo (ej. 0.0942)
        "beats": [float]    # lista de tiempos en segundos
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
    tempo_candidates = librosa.feature.tempo(
        onset_envelope=onset_env, sr=sr,
        aggregate=None,  # devolver todos los candidatos por frame
        ac_size=8.0,     # ventana de autocorrelación de 8 segundos
        start_bpm=120.0
    )
    
    # Calcular el tempo global como la mediana de los candidatos por frame
    global_tempo = float(np.median(tempo_candidates))
    
    # Resolver ambigüedad de octava:
    # Si el tempo está entre 70-115, verificar si el doble (140-230) tiene soporte
    # Calculamos la densidad de onsets para determinar si el tempo real es el doble
    if 70 < global_tempo < 115:
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
    
    initial_bpm = round(global_tempo, 2)
    print(f"Tempo inicial estimado: {initial_bpm} BPM. Calculando beat tracking...")
    
    # Ejecutar beat_track con el BPM como guía (start_bpm)
    tempo_result, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr,
        start_bpm=initial_bpm,
        units='frames'
    )
    
    # Convertir frames de beats a tiempo en segundos
    beat_times = librosa.frames_to_time(beat_frames, sr=sr)
    
    # Refinamiento continuo del BPM y cálculo de fase de inicio mediante regresión lineal
    # Esto elimina el error de cuantización de los bins discretos de Librosa (ej: 198.77 -> 198.00)
    if len(beat_times) >= 4:
        x = np.arange(len(beat_times))
        y = np.array(beat_times)
        m, c = np.polyfit(x, y, 1)  # m = segundos por beat, c = tiempo t0 estimado
        
        refined_bpm = 60.0 / m
        refined_offset = (c % m + m) % m  # desfase de fase [0, m)
        
        bpm = round(float(refined_bpm), 2)
        offset = round(float(refined_offset), 4)
        print(f"  BPM refinado por regresión: {bpm} BPM (offset = {round(offset*1000, 1)} ms)")
    else:
        bpm = initial_bpm
        offset = round(float(beat_times[0] % (60.0 / bpm)), 4) if len(beat_times) > 0 else 0.0
    
    beats_list = [round(float(t), 4) for t in beat_times]
    
    print(f"Análisis completado: BPM={bpm}, Offset={offset}s, Beats={len(beats_list)}")
    
    return {
        "bpm": bpm,
        "offset": offset,
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
