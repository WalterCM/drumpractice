import sys
import os
from processor import AudioProcessor

def main():
    print("Iniciando prueba del pipeline de audio...")
    
    # Metrónomo de 120 BPM de 10 segundos para prueba ultrarrápida
    test_url = "https://www.youtube.com/watch?v=37Zryx323Xg" 
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
        
    print(f"Probando con URL: {test_url}")
    
    # Instanciar el procesador en carpeta local
    processor = AudioProcessor(data_dir="./data_test")
    
    def progress_cb(msg, pct):
        print(f"[{pct}%] {msg}")
        
    try:
        print("Ejecutando proceso...")
        res = processor.process_youtube_link(test_url, progress_callback=progress_cb)
        print("\n¡Prueba completada con éxito!")
        print(f"ID: {res['id']}")
        print(f"BPM Estimado: {res['bpm']}")
        print(f"Numero de Beats: {len(res['beats'])}")
        print(f"Original: {res['original_audio_path']}")
        print(f"Sin Bateria: {res['no_drums_audio_path']}")
        print(f"Bateria: {res['drums_audio_path']}")
    except Exception as e:
        print(f"\n❌ Error en el pipeline: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
