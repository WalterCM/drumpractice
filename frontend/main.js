const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

let mainWindow;
let pythonProcess = null;

function startBackend() {
  console.log('Iniciando backend de Python...');
  
  // Ruta al ejecutable de python dentro del entorno virtual en modo desarrollo
  const pythonBin = path.join(__dirname, '..', 'backend', 'venv', 'bin', 'python');
  const mainScript = path.join(__dirname, '..', 'backend', 'main.py');
  
  // Iniciamos el proceso FastAPI
  pythonProcess = spawn(pythonBin, [mainScript], {
    cwd: path.join(__dirname, '..', 'backend'),
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });
  
  pythonProcess.stdout.on('data', (data) => {
    console.log(`[Python Stdout]: ${data}`);
  });
  
  pythonProcess.stderr.on('data', (data) => {
    console.error(`[Python Stderr]: ${data}`);
  });
  
  pythonProcess.on('close', (code) => {
    console.log(`El backend de Python termino con codigo ${code}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Permitir integracion directa para desarrollo rapido
      webSecurity: false
    },
    title: "Drum Practice Tool"
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  // Esperar 1.5s a que el backend levante
  setTimeout(createWindow, 1500);
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (pythonProcess) {
    console.log('Deteniendo backend de Python...');
    pythonProcess.kill();
    pythonProcess = null;
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  if (pythonProcess) {
    pythonProcess.kill();
    pythonProcess = null;
  }
});
