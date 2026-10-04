#!/bin/bash

# Directorio base del proyecto
BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "=================================================="
echo "       INICIANDO DRUM PRACTICE DESKTOP (TAURI)"
echo "=================================================="

# Comprobar que existe el venv
if [ ! -d "$BASE_DIR/backend/venv" ]; then
    echo "Error: No se encontró el entorno virtual en $BASE_DIR/backend/venv"
    exit 1
fi

cd "$BASE_DIR"

# Instalar dependencias si falta la CLI de tauri
if [ ! -d "$BASE_DIR/node_modules/@tauri-apps" ]; then
    echo "Instalando herramientas de Tauri..."
    npm install
fi

# Lanzar la aplicación nativa con Tauri
npx tauri dev
