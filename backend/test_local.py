import os
import sys
from audio_separator import separate_drums
from tempo_detector import analyze_tempo

def main():
    print("Iniciando prueba local del backend...")
    
    audio_path = "synthetic_beat.wav"
    output_dir = "./data_local_test"
    
    if not os.path.exists(audio_path):
        print(f"Error: No se encontro {audio_path}")
        sys.exit(1)
        
    try:
        # 1. Probar separacion por IA (Demucs)
        print("\n--- Paso 1: Separacion de bateria (Meta Demucs) ---")
        print("Esto cargara el modelo de IA local.")
        no_drums_path = separate_drums(audio_path, output_dir)
        print(f"Separacion completada con exito.")
        print(f"Resultado sin bateria guardado en: {no_drums_path}")
        
        # 2. Probar deteccion de tempo (Librosa)
        print("\n--- Paso 2: Deteccion de tempo (Librosa) ---")
        tempo_data = analyze_tempo(no_drums_path)
        print(f"Deteccion completada con exito.")
        print(f"BPM Estimado: {tempo_data['bpm']}")
        print(f"Numero de beats detectados: {len(tempo_data['beats'])}")
        print(f"Beats: {tempo_data['beats']}")
        
        print("\n🎉 ¡Todas las pruebas locales del backend pasaron con exito!")
        
    except Exception as e:
        print(f"\n❌ Error en la prueba local: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
