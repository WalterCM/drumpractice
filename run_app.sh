#!/bin/bash

# Matar procesos en segundo plano al salir
cleanup() {
    echo ""
    echo "Deteniendo el servidor Drum Practice..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
    fi
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "=================================================="
echo "          DRUM PRACTICE TOOL - LOCAL RUN"
echo "=================================================="

# Directorio base
BASE_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Comprobar si existe el venv
if [ ! -d "$BASE_DIR/backend/venv" ]; then
    echo "Error: No se encontro el entorno virtual en $BASE_DIR/backend/venv"
    echo "Por favor, crea el venv y asegura de instalar dependencias."
    exit 1
fi

echo "Iniciando backend FastAPI..."
# Iniciar backend
source "$BASE_DIR/backend/venv/bin/activate"
python "$BASE_DIR/backend/main.py" &
BACKEND_PID=$!

# Esperar un momento para asegurar que levanto
sleep 2

echo "Servidor corriendo. Abre la siguiente URL en tu navegador:"
echo ""
echo "   👉 http://localhost:8000 👈"
echo ""
echo "Presiona Ctrl+C para detener la aplicacion."
echo "=================================================="

# Mantener el script corriendo para capturar Ctrl+C
wait $BACKEND_PID
