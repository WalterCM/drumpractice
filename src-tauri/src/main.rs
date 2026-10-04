#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Solucionar el fallo de GBM buffer en WebKitGTK en Linux que causa ventanas en blanco
    #[cfg(target_os = "linux")]
    {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    drum_practice_lib::run();
}
