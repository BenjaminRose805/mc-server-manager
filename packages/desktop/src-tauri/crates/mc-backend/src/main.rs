use std::{
    env,
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

fn main() {
    let res = resources_dir();
    let node = if cfg!(windows) {
        res.join("node.exe")
    } else {
        res.join("node")
    };
    let script = res.join("server.cjs");

    let status = Command::new(&node)
        .arg(&script)
        .args(env::args().skip(1))
        .env("NODE_PATH", res.join("node_modules"))
        .envs(env::vars())
        .status()
        .unwrap_or_else(|e| {
            eprintln!("Failed to start backend: {e}");
            exit(1);
        });

    exit(status.code().unwrap_or(1));
}
