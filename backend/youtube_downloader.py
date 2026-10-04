import os
import re
from yt_dlp import YoutubeDL

def sanitize_filename(name: str) -> str:
    """Elimina caracteres inválidos para nombres de archivo en Linux/Windows."""
    clean = re.sub(r'[\\/*?:"<>|]', "", name)
    clean = re.sub(r'\s+', ' ', clean).strip()
    return clean or "audio_track"

def download_youtube_audio(youtube_url: str, output_dir: str) -> tuple:
    """
    Descarga el audio de un link de YouTube y lo guarda como un archivo WAV con el título del video.
    Devuelve una tupla: (ruta_absoluta_wav, titulo_video).
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    ffmpeg_loc = os.environ.get("FFMPEG_PATH")
    if not ffmpeg_loc:
        import shutil
        ffmpeg_loc = shutil.which("ffmpeg")
        
    ydl_opts = {
        'format': 'bestaudio/best',
        'noplaylist': True,
        'postprocessors': [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'wav',
            'preferredquality': '192',
        }],
        # Usamos el título del video como nombre de archivo
        'outtmpl': os.path.join(output_dir, '%(title)s.%(ext)s'),
        'ffmpeg_location': ffmpeg_loc if ffmpeg_loc else None,
        'quiet': False,
        'no_warnings': False,
        'nocheckcertificate': True,
        'extractor_args': {
            'youtube': {
                'player_client': ['ios', 'android', 'mweb', 'web']
            }
        },
        'http_headers': {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        'fragment_retries': 10,
        'retries': 10,
    }
    
    with YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(youtube_url, download=True)
        if 'entries' in info and len(info['entries']) > 0:
            info = info['entries'][0]
        title = info.get('title', 'audio_track')
        filename = ydl.prepare_filename(info)
        wav_filename = os.path.splitext(filename)[0] + '.wav'
        return os.path.abspath(wav_filename), title

if __name__ == '__main__':
    import sys
    if len(sys.argv) > 1:
        url = sys.argv[1]
        print(f"Descargando audio de: {url}...")
        try:
            path, title = download_youtube_audio(url, './downloads')
            print(f"Descarga exitosa: '{title}'. Guardado en: {path}")
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("Uso: python youtube_downloader.py <youtube_url>")
