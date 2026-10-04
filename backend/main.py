import os
import urllib.parse
import uvicorn
import asyncio
import shutil
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from processor import AudioProcessor
from concurrent.futures import ThreadPoolExecutor

app = FastAPI(title="Drum Practice Backend API")

# Habilitar CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Inicializar el procesador de audio en la carpeta de datos
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("DRUM_PRACTICE_DATA_DIR") or os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
processor = AudioProcessor(data_dir=DATA_DIR)

# Endpoint de comprobación de salud de la API
@app.get("/api/health")
def health_check():
    return {"status": "running", "service": "Drum Practice Backend"}

# Endpoint para guardar la mezcla renderizada en la carpeta de Descargas del usuario
@app.post("/api/save_mix")
async def save_mix(file: UploadFile = File(...)):
    home = os.path.expanduser("~")
    downloads_dir = os.path.join(home, "Downloads")
    if not os.path.exists(downloads_dir):
        downloads_es = os.path.join(home, "Descargas")
        downloads_dir = downloads_es if os.path.exists(downloads_es) else home
        
    os.makedirs(downloads_dir, exist_ok=True)
    filename = file.filename or "drum_practice_mix.wav"
    dest_path = os.path.join(downloads_dir, filename)
    
    with open(dest_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {
        "status": "success",
        "saved_path": dest_path,
        "message": f"Archivo guardado en: {dest_path}"
    }

# Endpoint para procesar archivos de audio subidos localmente (MP3/WAV)
@app.post("/api/upload")
async def upload_audio_file(file: UploadFile = File(...)):
    file_path = os.path.join(processor.downloads_dir, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as pool:
        result = await loop.run_in_executor(
            pool, 
            processor.process_audio_file, 
            file_path
        )
        
    web_original = f"/media/downloads/{os.path.basename(result['original_audio_path'])}"
    web_vocals = f"/media/processed/{os.path.basename(result['vocals_audio_path'])}" if result.get('vocals_audio_path') else None
    web_other = f"/media/processed/{os.path.basename(result['other_audio_path'])}" if result.get('other_audio_path') else None
    web_bass = f"/media/processed/{os.path.basename(result['bass_audio_path'])}" if result.get('bass_audio_path') else None
    web_drums = f"/media/processed/{os.path.basename(result['drums_audio_path'])}" if result.get('drums_audio_path') else None
    
    return {
        "status": "completed",
        "result": {
            "id": result["id"],
            "title": result["title"],
            "original_url": web_original,
            "vocals_url": web_vocals,
            "other_url": web_other,
            "bass_url": web_bass,
            "drums_url": web_drums,
            "bpm": result["bpm"],
            "beats": result["beats"]
        }
    }

# WebSocket para reportar el progreso de procesamiento en tiempo real
@app.websocket("/ws/process")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        youtube_url = data.get("url")
        
        if not youtube_url:
            await websocket.send_json({"status": "error", "message": "URL no proporcionada"})
            await websocket.close()
            return
            
        loop = asyncio.get_event_loop()
        
        def send_progress_sync(msg: str, percentage: int):
            coro = websocket.send_json({
                "status": "processing",
                "progress": percentage,
                "message": msg
            })
            asyncio.run_coroutine_threadsafe(coro, loop)
            
        with ThreadPoolExecutor() as pool:
            result = await loop.run_in_executor(
                pool, 
                processor.process_youtube_link, 
                youtube_url, 
                send_progress_sync
            )
            
        web_original = f"/media/downloads/{os.path.basename(result['original_audio_path'])}"
        web_vocals = f"/media/processed/{os.path.basename(result['vocals_audio_path'])}" if result.get('vocals_audio_path') else None
        web_other = f"/media/processed/{os.path.basename(result['other_audio_path'])}" if result.get('other_audio_path') else None
        web_bass = f"/media/processed/{os.path.basename(result['bass_audio_path'])}" if result.get('bass_audio_path') else None
        web_drums = f"/media/processed/{os.path.basename(result['drums_audio_path'])}" if result.get('drums_audio_path') else None
        
        final_result = {
            "id": result["id"],
            "title": result["title"],
            "original_url": web_original,
            "vocals_url": web_vocals,
            "other_url": web_other,
            "bass_url": web_bass,
            "drums_url": web_drums,
            "bpm": result["bpm"],
            "beats": result["beats"]
        }
        
        await websocket.send_json({
            "status": "completed",
            "progress": 100,
            "message": "¡Procesamiento completo!",
            "result": final_result
        })
        
    except WebSocketDisconnect:
        print("El cliente WebSocket se desconecto.")
    except Exception as e:
        print(f"Error en websocket process: {e}")
        try:
            await websocket.send_json({
                "status": "error",
                "progress": -1,
                "message": f"Error: {str(e)}"
            })
        except:
            pass
    finally:
        try:
            await websocket.close()
        except:
            pass

# Servir archivos estáticos de audio
app.mount("/media", StaticFiles(directory=DATA_DIR), name="media")

# Servir la interfaz web estáticamente en la raíz si existe la carpeta
FRONTEND_DIR = os.environ.get("DRUM_PRACTICE_FRONTEND_DIR") or os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
if os.path.exists(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == '__main__':
    import socket
    port = int(os.environ.get("PORT", 8000))
    # Comprobar si está ocupado
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if s.connect_ex(('127.0.0.1', port)) == 0:
            # Buscar siguiente puerto disponible
            for p in range(port + 1, port + 50):
                with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s2:
                    try:
                        s2.bind(('127.0.0.1', p))
                        port = p
                        break
                    except OSError:
                        continue
    print(f"Iniciando Drum Practice Backend en http://127.0.0.1:{port}")
    uvicorn.run(app, host="127.0.0.1", port=port, reload=False)
