use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

struct BackendProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(BackendProcess(Mutex::new(None)))
        .setup(|app| {
            let app_handle = app.handle().clone();
            
            // Iniciar backend en segundo plano sin bloquear la carga de la interfaz
            std::thread::spawn(move || {
                start_backend(&app_handle);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle();
                if let Some(state) = app.try_state::<BackendProcess>() {
                    if let Ok(mut lock) = state.0.lock() {
                        if let Some(mut child) = lock.take() {
                            println!("[Tauri] Deteniendo proceso backend de Python...");
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn find_free_port(start: u16) -> u16 {
    for p in start..start + 50 {
        if let Ok(listener) = std::net::TcpListener::bind(("127.0.0.1", p)) {
            drop(listener);
            return p;
        }
    }
    start
}

fn start_backend(app: &tauri::AppHandle) {
    let mut command: Option<Command> = None;
    let free_port = find_free_port(8000);
    println!("[Tauri] Puerto seleccionado para Drum Practice: {}", free_port);

    // 1. En producción en Windows, buscar el binario empaquetado del sidecar
    if let Ok(resource_dir) = app.path().resource_dir() {
        let sidecar_candidates = [
            resource_dir.join("binaries/drum-backend-x86_64-pc-windows-msvc.exe"),
            resource_dir.join("drum-backend.exe"),
            resource_dir.join("binaries/drum-backend"),
            resource_dir.join("drum-backend"),
        ];

        for path in &sidecar_candidates {
            if path.exists() {
                println!("[Tauri] Encontrado binario backend en: {:?}", path);
                let mut cmd = Command::new(path);
                cmd.arg("--port").arg(free_port.to_string());
                command = Some(cmd);
                break;
            }
        }
    }

    // 2. Si no se encontró binario compilado (modo desarrollo local), usar el entorno virtual
    if command.is_none() {
        let cur = std::env::current_dir().unwrap_or_default();
        let roots = [
            cur.clone(),
            cur.join(".."),
        ];

        for root in &roots {
            let py_candidates = [
                root.join("backend/venv/bin/python"),
                root.join("backend/venv/Scripts/python.exe"),
            ];
            let script = root.join("backend/server_entry.py");

            for py in &py_candidates {
                if py.exists() && script.exists() {
                    println!("[Tauri Dev] Iniciando backend con: {:?} {:?}", py, script);
                    let mut cmd = Command::new(py);
                    cmd.arg(&script);
                    cmd.arg("--port").arg(free_port.to_string());
                    cmd.current_dir(root.join("backend"));
                    command = Some(cmd);
                    break;
                }
            }
            if command.is_some() {
                break;
            }
        }
    }

    if let Some(mut cmd) = command {
        #[cfg(windows)]
        {
            // CREATE_NO_WINDOW = 0x08000000 para no abrir consola negra en Windows
            cmd.creation_flags(0x08000000);
        }

        match cmd.spawn() {
            Ok(child) => {
                println!("[Tauri] Backend iniciado correctamente (PID: {:?})", child.id());
                if let Some(state) = app.try_state::<BackendProcess>() {
                    if let Ok(mut lock) = state.0.lock() {
                        *lock = Some(child);
                    }
                }
            }
            Err(e) => {
                eprintln!("[Tauri Error] No se pudo lanzar el backend: {:?}", e);
            }
        }
    } else {
        println!("[Tauri] No se encontró backend para arrancar (se asume backend externo en http://127.0.0.1:8000)");
    }
}
