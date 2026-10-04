import os
import sys
import subprocess
import shutil

def separate_stems(audio_path: str, output_dir: str) -> dict:
    """
    Usa Meta Demucs para separar el audio en 4 pistas independientes:
    - vocals.wav (Voz)
    - other.wav (Música / Otros instrumentos)
    - bass.wav (Bajo)
    - drums.wav (Batería)
    
    Devuelve un diccionario con las rutas absolutas de cada stem generado.
    """
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    python_exe = sys.executable
    base_name = os.path.splitext(os.path.basename(audio_path))[0]
    
    demucs_args = [
        "-n", "htdemucs",
        "-d", "cpu",
        "-o", output_dir,
        audio_path
    ]
    
    # Intentar ejecutar Demucs directamente en el proceso (crucial para entornos PyInstaller/congelados)
    in_process_success = False
    try:
        from demucs.separate import main as demucs_main
        print(f"Ejecutando Demucs in-process: {' '.join(demucs_args)}")
        try:
            demucs_main(demucs_args)
            in_process_success = True
        except SystemExit as se:
            if se.code in (0, None):
                in_process_success = True
            else:
                raise RuntimeError(f"Demucs falló con código {se.code}")
    except Exception as direct_err:
        print(f"Aviso: Ejecución in-process de Demucs no completada ({direct_err}), intentando subprocess...")

    if not in_process_success:
        cmd = [python_exe, "-m", "demucs.separate"] + demucs_args
        print(f"Ejecutando comando Demucs (4 stems): {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print("Error al ejecutar Demucs:")
            print("STDOUT:", result.stdout)
            print("STDERR:", result.stderr)
            raise RuntimeError(f"Demucs falló con código de salida {result.returncode}. Error: {result.stderr}")
        
    # Buscar el directorio del modelo htdemucs
    model_output_dir = os.path.join(output_dir, "htdemucs", base_name)
    if not os.path.exists(model_output_dir):
        # Fallback de búsqueda si la carpeta tiene otro nombre
        for root, dirs, files in os.walk(output_dir):
            if "drums.wav" in files:
                model_output_dir = root
                break

    stem_names = ["vocals", "other", "bass", "drums"]
    stem_paths = {}

    for stem in stem_names:
        stem_filename = f"{stem}.wav"
        src_path = os.path.join(model_output_dir, stem_filename)
        dest_path = os.path.join(output_dir, f"{base_name}_{stem}.wav")
        
        if os.path.exists(src_path):
            if os.path.exists(dest_path):
                os.remove(dest_path)
            shutil.move(src_path, dest_path)
            stem_paths[stem] = os.path.abspath(dest_path)
        else:
            print(f"Advertencia: No se encontró {stem_filename} en {model_output_dir}")
            stem_paths[stem] = None

    # Limpiar carpetas temporales de Demucs
    temp_model_dir = os.path.join(output_dir, "htdemucs")
    if os.path.exists(temp_model_dir):
        shutil.rmtree(temp_model_dir)

    return stem_paths

def separate_drums(audio_path: str, output_dir: str) -> str:
    """ Wrapper de compatibilidad hacia atrás """
    stems = separate_stems(audio_path, output_dir)
    return stems.get("other") or stems.get("drums")

if __name__ == '__main__':
    if len(sys.argv) > 1:
        audio_file = sys.argv[1]
        print(f"Separando 4 stems de: {audio_file}...")
        try:
            paths = separate_stems(audio_file, './separated')
            print("Separación exitosa:")
            for stem, p in paths.items():
                print(f" - {stem}: {p}")
        except Exception as e:
            print(f"Error: {e}")
    else:
        print("Uso: python audio_separator.py <ruta_audio_original>")

