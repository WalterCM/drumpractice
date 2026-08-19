import os
import shutil
import json
from youtube_downloader import download_youtube_audio
from audio_separator import separate_drums
from tempo_detector import analyze_tempo

class AudioProcessor:
    def __init__(self, data_dir: str = None):
        if data_dir is None:
            # Por defecto en backend/data
            base_dir = os.path.dirname(os.path.abspath(__file__))
            self.data_dir = os.path.join(base_dir, "data")
        else:
            self.data_dir = os.path.abspath(data_dir)
            
        self.downloads_dir = os.path.join(self.data_dir, "downloads")
        self.processed_dir = os.path.join(self.data_dir, "processed")
        
        # Crear directorios si no existen
        os.makedirs(self.downloads_dir, exist_ok=True)
        os.makedirs(self.processed_dir, exist_ok=True)

    def process_youtube_link(self, youtube_url: str, progress_callback=None) -> dict:
        """
        Orquesta el proceso completo para un enlace de YouTube:
        1. Descarga el audio original.
        2. Remueve la batería usando IA (Demucs).
        3. Analiza el BPM y los beats usando Librosa.
        
        Retorna un diccionario con las rutas de los archivos generados y los datos de tempo.
        """
        try:
            if progress_callback:
                progress_callback("Descargando audio de YouTube...", 10)
                
            # 1. Descargar
            original_wav, video_title = download_youtube_audio(youtube_url, self.downloads_dir)
            base_name = os.path.splitext(os.path.basename(original_wav))[0]
            
            # Verificar si ya existe en caché procesado
            meta_path = os.path.join(self.processed_dir, f"{base_name}_meta.json")
            if os.path.exists(meta_path):
                if progress_callback:
                    progress_callback(f"Cargando '{video_title}' desde caché local...", 90)
                try:
                    with open(meta_path, 'r', encoding='utf-8') as f:
                        cached_data = json.load(f)
                    if os.path.exists(cached_data.get("no_drums_audio_path", "")):
                        if progress_callback:
                            progress_callback("¡Procesamiento completo!", 100)
                        return cached_data
                except Exception as cache_err:
                    print(f"Error al leer caché: {cache_err}. Se procesará nuevamente.")
            
            if progress_callback:
                progress_callback(f"Audio descargado ({video_title}). Separando batería con IA...", 30)
                
            # 2. Separar Batería
            # Esto genera {base_name}_no_drums.wav y {base_name}_drums.wav en self.processed_dir
            no_drums_wav = separate_drums(original_wav, self.processed_dir)
            drums_wav = os.path.join(self.processed_dir, f"{base_name}_drums.wav")
            
            if progress_callback:
                progress_callback("Audio separado. Analizando BPM y ritmo sobre la pista de batería...", 80)
                
            # 3. Analizar tempo
            # Usamos la pista de batería aislada (o el audio original si no hay batería)
            # ya que los transitorios de ataque de bombos y cajas proporcionan el Onset Flux más nítido
            audio_for_tempo = drums_wav if (drums_wav and os.path.exists(drums_wav)) else original_wav
            tempo_data = analyze_tempo(audio_for_tempo)
            
            # Formatear la respuesta
            result = {
                "id": base_name,
                "title": video_title,
                "original_audio_path": original_wav,
                "no_drums_audio_path": no_drums_wav,
                "drums_audio_path": drums_wav if os.path.exists(drums_wav) else None,
                "bpm": tempo_data["bpm"],
                "offset": tempo_data.get("offset", 0.0),
                "beats": tempo_data["beats"]
            }
            
            # Guardamos un archivo JSON metadata al lado de la canción procesada
            meta_path = os.path.join(self.processed_dir, f"{base_name}_meta.json")
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=4)
                
            if progress_callback:
                progress_callback("¡Procesamiento completo!", 100)
                
            return result
            
        except Exception as e:
            print(f"Error durante el procesamiento del audio: {e}")
            if progress_callback:
                progress_callback(f"Error: {str(e)}", -1)
            raise e

    def process_audio_file(self, audio_file_path: str, progress_callback=None) -> dict:
        """
        Procesa un archivo de audio local directamente:
        1. Remueve la batería usando IA (Demucs).
        2. Analiza el BPM y los beats usando Librosa.
        """
        try:
            base_name = os.path.splitext(os.path.basename(audio_file_path))[0]
            if progress_callback:
                progress_callback("Separando batería con IA...", 30)
                
            no_drums_wav = separate_drums(audio_file_path, self.processed_dir)
            drums_wav = os.path.join(self.processed_dir, f"{base_name}_drums.wav")
            
            audio_for_tempo = drums_wav if (drums_wav and os.path.exists(drums_wav)) else audio_file_path
            tempo_data = analyze_tempo(audio_for_tempo)
            
            result = {
                "id": base_name,
                "title": base_name,
                "original_audio_path": audio_file_path,
                "no_drums_audio_path": no_drums_wav,
                "drums_audio_path": drums_wav if os.path.exists(drums_wav) else None,
                "bpm": tempo_data["bpm"],
                "offset": tempo_data.get("offset", 0.0),
                "beats": tempo_data["beats"]
            }
            
            meta_path = os.path.join(self.processed_dir, f"{base_name}_meta.json")
            with open(meta_path, 'w', encoding='utf-8') as f:
                json.dump(result, f, indent=4)
                
            if progress_callback:
                progress_callback("¡Procesamiento completo!", 100)
                
            return result
        except Exception as e:
            print(f"Error durante el procesamiento del archivo local: {e}")
            if progress_callback:
                progress_callback(f"Error: {str(e)}", -1)
            raise e

if __name__ == '__main__':
    # Prueba rápida
    import sys
    if len(sys.argv) > 1:
        url = sys.argv[1]
        processor = AudioProcessor()
        def log_progress(msg, percentage):
            print(f"[{percentage}%] {msg}")
            
        print(f"Iniciando procesamiento de: {url}")
        try:
            res = processor.process_youtube_link(url, progress_callback=log_progress)
            print("\nResultado:")
            print(json.dumps(res, indent=2))
        except Exception as e:
            print(f"Error en ejecución: {e}")
    else:
        print("Uso: python processor.py <youtube_url>")
