use std::{
    env, fs,
    path::PathBuf,
    process::{exit, Command},
};

fn resources_dir() -> PathBuf {
    let exe = env::current_exe().expect("resolve exe path");
    let bin_dir = exe.parent().expect("resolve bin dir");

    #[cfg(target_os = "macos")]
    {
        bin_dir.join("../Resources/resources")
    }
    #[cfg(not(target_os = "macos"))]
    {
        bin_dir.join("resources")
    }
}

fn write_log(path: &PathBuf, lines: &[String], extra: &str) {
    let content = if extra.is_empty() {
        lines.join("\n")
    } else {
        format!("{}\n{extra}", lines.join("\n"))
    };
    let _ = fs::write(path, content);
}

fn main() {
    let res = resources_dir();
    let node = if cfg!(windows) {
        res.join("node.exe")
    } else {
        res.join("node")
    };
    let script = res.join("server.cjs");

    let log_path = res.join("mc-backend.log");
    let log_lines: Vec<String> = vec![
        format!("exe: {:?}", env::current_exe().unwrap_or_default()),
        format!("resources_dir: {}", res.display()),
        format!("node: {} (exists={})", node.display(), node.exists()),
        format!("script: {} (exists={})", script.display(), script.exists()),
        format!(
            "node_modules: {} (exists={})",
            res.join("node_modules").display(),
            res.join("node_modules").exists()
        ),
        format!("env TAURI_DATA_DIR: {:?}", env::var("TAURI_DATA_DIR").ok()),
        format!("args: {:?}", env::args().collect::<Vec<_>>()),
    ];
    write_log(&log_path, &log_lines, "");

    if !node.exists() {
        eprintln!("Node binary not found at: {}", node.display());
        write_log(&log_path, &log_lines, "FATAL: node binary missing");
        exit(1);
    }
    if !script.exists() {
        eprintln!("Server script not found at: {}", script.display());
        write_log(&log_path, &log_lines, "FATAL: server.cjs missing");
        exit(1);
    }

    let status = Command::new(&node)
        .arg(&script)
        .args(env::args().skip(1))
        .env("NODE_PATH", res.join("node_modules"))
        .envs(env::vars())
        .status()
        .unwrap_or_else(|e| {
            let msg = format!("Failed to start backend: {e}");
            eprintln!("{msg}");
            write_log(&log_path, &log_lines, &format!("FATAL: {msg}"));
            exit(1);
        });

    let code = status.code().unwrap_or(1);
    if code != 0 {
        write_log(&log_path, &log_lines, &format!("Exit code: {code}"));
    }
    exit(code);
}
