import os
import sys
from audio_separator import separate_stems
from tempo_detector import analyze_tempo

def main():
    print("Iniciando prueba local del backend...")
    
    audio_path = "synthetic_beat.wav"
    output_dir = "./data_local_test"
    
    if not os.path.exists(audio_path):
        print(f"Error: No se encontro {audio_path}")
        sys.exit(1)
        
    try:
        # 1. Probar separación por IA (Demucs)
        print("\n--- Paso 1: Separación de 4 stems (Meta Demucs) ---")
        print("Esto cargará el modelo de IA local.")
        stems = separate_stems(audio_path, output_dir)
        print("Separación completada con éxito.")
        for stem, path in stems.items():
            print(f" - {stem}: {path}")
        
        # 2. Probar detección de tempo (Librosa)
        print("\n--- Paso 2: Detección de tempo (Librosa) ---")
        drums_path = stems.get("drums") or audio_path
        tempo_data = analyze_tempo(drums_path)
        print(f"Detección completada con éxito.")
        print(f"BPM Estimado: {tempo_data['bpm']}")
        print(f"Número de beats detectados: {len(tempo_data['beats'])}")
        print(f"Beats: {tempo_data['beats']}")
        
        print("\n🎉 ¡Todas las pruebas locales del backend pasaron con éxito!")
        
    except Exception as e:
        print(f"\n❌ Error en la prueba local: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()

