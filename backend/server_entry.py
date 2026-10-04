import os
import sys

# 1. Configurar directorios si estamos dentro de un paquete congelado por PyInstaller
if getattr(sys, 'frozen', False):
    bundle_dir = sys._MEIPASS
    # Prepend bundle directory al PATH del sistema para que ffmpeg/ffprobe se encuentren inmediatamente
    os.environ["PATH"] = bundle_dir + os.pathsep + os.environ.get("PATH", "")
    
    # En Windows/Linux de producción, usar carpeta de datos de usuario en lugar del directorio de instalación
    if not os.environ.get("DRUM_PRACTICE_DATA_DIR"):
        if sys.platform == "win32":
            base_user_data = os.environ.get("APPDATA") or os.path.expanduser("~")
            drum_data = os.path.join(base_user_data, "DrumPractice", "data")
        else:
            drum_data = os.path.expanduser("~/.drum_practice/data")
            
        os.makedirs(drum_data, exist_ok=True)
        os.environ["DRUM_PRACTICE_DATA_DIR"] = drum_data
        print(f"[Desktop Backend] Directorio de datos de usuario: {drum_data}")
else:
    # Modo desarrollo normal: añadir carpeta del backend a sys.path
    current_dir = os.path.dirname(os.path.abspath(__file__))
    if current_dir not in sys.path:
        sys.path.insert(0, current_dir)

import socket
import argparse
import uvicorn
from main import app

def find_available_port(start_port=8000, max_tries=50):
    for p in range(start_port, start_port + max_tries):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', p))
                return p
            except OSError:
                continue
    return start_port

def get_target_port():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=None, help="Port to run server on")
    args, _ = parser.parse_known_args()
    
    if args.port:
        return args.port
    if os.environ.get("PORT"):
        try:
            return int(os.environ.get("PORT"))
        except ValueError:
            pass
            
    # Si el puerto 8000 está ocupado, buscar automáticamente el siguiente disponible (8001, 8002, etc.)
    return find_available_port(8000)

def run_server():
    port = get_target_port()
    print(f"[Desktop Backend] Iniciando servidor Drum Practice en http://127.0.0.1:{port} ...")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info", access_log=True)

if __name__ == '__main__':
    run_server()
