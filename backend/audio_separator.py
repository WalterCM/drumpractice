import os
import sys
import subprocess
import shutil

def separate_drums(audio_path: str, output_dir: str) -> str:
    """
    Usa Meta Demucs para separar la batería del audio dado.
    Utiliza la opción --two-stems=drums para generar directamente
    la pista sin batería (no_drums.wav).
    
    Devuelve la ruta absoluta de 'no_drums.wav'.
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    # Obtener el ejecutable de python del venv para correr demucs
    python_exe = sys.executable
    
    # Nombre base del archivo sin extensión
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    
    # Demucs creará la carpeta: <output_dir>/htdemucs/<base_name>/
    # Y los archivos drums.wav y no_drums.wav
    cmd = [
        python_exe, "-m", "demucs.separate",
        "-n", "htdemucs",
        "-d", "cpu",
        "--two-stems", "drums",
        "-o", output_dir,
        audio_path
    ]
    
    print(f"Ejecutando comando Demucs: {' '.join(cmd)}")
    
    # Ejecutamos el comando
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.returncode != 0:
        print("Error al ejecutar Demucs:")
        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)
        raise RuntimeError(f"Demucs falló con código de salida {result.returncode}. Error: {result.stderr}")
        
    # La ruta esperada para el archivo sin batería
    no_drums_path = os.path.join(output_dir, "htdemucs", base_name, "no_drums.wav")
    
    if not os.path.exists(no_drums_path):
        # Buscar en la subcarpeta por si se usó otro modelo por defecto
        found = False
        for root, dirs, files in os.walk(output_dir):
            if "no_drums.wav" in files:
                no_drums_path = os.path.join(root, "no_drums.wav")
                found = True
                break
        if not found:
            raise FileNotFoundError(f"Demucs terminó pero no se encontró el archivo 'no_drums.wav' en {output_dir}")
            
    # Mover el archivo no_drums.wav al nivel superior de output_dir con un nombre limpio
    final_path = os.path.join(output_dir, f"{base_name}_no_drums.wav")
    if os.path.exists(final_path):
        os.remove(final_path)
    shutil.move(no_drums_path, final_path)
    
    # Mover también el de la batería
    drums_path = os.path.join(os.path.dirname(no_drums_path), "drums.wav")
    if os.path.exists(drums_path):
        final_drums_path = os.path.join(output_dir, f"{base_name}_drums.wav")
        if os.path.exists(final_drums_path):
            os.remove(final_drums_path)
        shutil.move(drums_path, final_drums_path)
        
    # Limpiamos las carpetas temporales de Demucs
    temp_model_dir = os.path.join(output_dir, "htdemucs")
    if os.path.exists(temp_model_dir):
        shutil.rmtree(temp_model_dir)
        
    return os.path.abspath(final_path)

if __name__ == '__main__':
    # Prueba rápida
    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        print(f"Separando batería de: {audio_file}...")
        try:
            path = separate_drums(audio_file, './separated')
            print(f"Separación exitosa. Guardado en: {path}")
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("Uso: python audio_separator.py <ruta_audio_original>")
