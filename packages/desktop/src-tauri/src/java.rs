use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaInstallation {
    pub version: u32,
    pub path: String,
    pub vendor: String,
    pub full_version: String,
}

#[tauri::command]
pub async fn get_java_installations() -> Result<Vec<JavaInstallation>, String> {
    // spawn_blocking: java -version calls are blocking I/O
    let installations = tokio::task::spawn_blocking(|| {
        let mut seen_paths: HashSet<String> = HashSet::new();
        let mut installations: Vec<JavaInstallation> = Vec::new();

        let mut try_add = |java_bin: PathBuf| {
            let canonical = std::fs::canonicalize(&java_bin)
                .unwrap_or_else(|_| java_bin.clone());
            let key = canonical.to_string_lossy().to_string();
            if seen_paths.contains(&key) {
                return;
            }
            if let Ok(inst) = detect_java_at_path(&java_bin.to_string_lossy()) {
                seen_paths.insert(key);
                installations.push(inst);
            }
        };

        if let Ok(java_home) = std::env::var("JAVA_HOME") {
            let bin = java_bin_in_dir(&PathBuf::from(&java_home));
            if bin.exists() {
                try_add(bin);
            }
        }

        if let Some(path_java) = find_java_on_path() {
            try_add(PathBuf::from(path_java));
        }

        for dir in get_java_search_paths() {
            let dir_path = Path::new(&dir);
            if !dir_path.is_dir() {
                continue;
            }
            discover_java_in_dir(dir_path, &mut |bin| try_add(bin));
        }

        installations.sort_by(|a, b| b.version.cmp(&a.version));
        installations
    })
    .await
    .map_err(|e| format!("Task join error: {}", e))?;

    Ok(installations)
}

#[tauri::command]
pub async fn download_java(
    app: tauri::AppHandle,
    version: u32,
) -> Result<JavaInstallation, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let runtime_dir = data_dir
        .join("launcher")
        .join("runtime")
        .join(format!("java-{}", version));
    std::fs::create_dir_all(&runtime_dir).map_err(|e| e.to_string())?;

    let adoptium_os = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "mac",
        "linux" => "linux",
        other => return Err(format!("Unsupported OS: {}", other)),
    };

    let adoptium_arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "aarch64",
        other => return Err(format!("Unsupported architecture: {}", other)),
    };

    let url = format!(
        "https://api.adoptium.net/v3/binary/latest/{}/ga/{}/{}/jdk/hotspot/normal/eclipse",
        version, adoptium_os, adoptium_arch
    );

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download Java {}: HTTP {}",
            version,
            response.status()
        ));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read download body: {}", e))?;

    let rt_dir = runtime_dir.clone();
    let is_windows = cfg!(target_os = "windows");
    tokio::task::spawn_blocking(move || {
        if is_windows {
            extract_zip(&bytes, &rt_dir)
        } else {
            extract_tar_gz(&bytes, &rt_dir)
        }
    })
    .await
    .map_err(|e| format!("Extract task join error: {}", e))?
    .map_err(|e| format!("Extraction failed: {}", e))?;

    let java_binary = find_java_binary_in_dir(&runtime_dir)
        .ok_or_else(|| "Could not find java binary after extraction".to_string())?;

    let installation = detect_java_at_path(&java_binary.to_string_lossy())
        .unwrap_or(JavaInstallation {
            version,
            path: java_binary.to_string_lossy().to_string(),
            vendor: "Eclipse Adoptium".to_string(),
            full_version: format!("{}.0.0", version),
        });

    Ok(installation)
}

fn get_java_search_paths() -> Vec<String> {
    let mut paths = Vec::new();

    #[cfg(target_os = "windows")]
    {
        paths.push(r"C:\Program Files\Java".to_string());
        paths.push(r"C:\Program Files\Eclipse Adoptium".to_string());
        paths.push(r"C:\Program Files\Microsoft\jdk".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        paths.push("/Library/Java/JavaVirtualMachines".to_string());
        paths.push("/opt/homebrew/opt".to_string());
        paths.push("/usr/local/opt".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        paths.push("/usr/lib/jvm".to_string());
        paths.push("/usr/java".to_string());
    }

    paths
}

fn discover_java_in_dir<F>(dir: &Path, on_found: &mut F)
where
    F: FnMut(PathBuf),
{
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // macOS: <name>.jdk/Contents/Home/bin/java
        let macos_java = path.join("Contents").join("Home").join("bin").join("java");
        if macos_java.exists() {
            on_found(macos_java);
            continue;
        }

        // Standard: <jdk-dir>/bin/java
        let bin_java = java_bin_in_dir(&path);
        if bin_java.exists() {
            on_found(bin_java);
        }
    }
}

fn java_bin_in_dir(home: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        home.join("bin").join("java.exe")
    } else {
        home.join("bin").join("java")
    }
}

fn find_java_on_path() -> Option<String> {
    let cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    let output = Command::new(cmd).arg("java").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let first_line = stdout.lines().next()?.trim().to_string();
    if first_line.is_empty() {
        return None;
    }
    Some(first_line)
}

fn detect_java_at_path(path: &str) -> Result<JavaInstallation, String> {
    let output = Command::new(path)
        .arg("-version")
        .output()
        .map_err(|e| format!("Failed to execute {}: {}", path, e))?;

    // java -version outputs to stderr (standard Java behavior)
    let stderr = String::from_utf8_lossy(&output.stderr);

    let (major, full_version, vendor) =
        parse_java_version(&stderr).ok_or_else(|| "Could not parse java version output".to_string())?;

    Ok(JavaInstallation {
        version: major,
        path: path.to_string(),
        vendor,
        full_version,
    })
}

// Parses `java -version` stderr. Handles both legacy "1.8.0_xxx" (major=8)
// and modern "17.0.9" (major=17) formats. Returns (major, full_version, vendor).
fn parse_java_version(stderr: &str) -> Option<(u32, String, String)> {
    let full_version = stderr
        .lines()
        .find(|line| line.contains("version"))?
        .split('"')
        .nth(1)?
        .to_string();

    let major = if full_version.starts_with("1.") {
        full_version.split('.').nth(1)?.parse::<u32>().ok()?
    } else {
        full_version.split('.').next()?.parse::<u32>().ok()?
    };
    let vendor = if stderr.contains("Eclipse Adoptium") || stderr.contains("Temurin") {
        "Eclipse Adoptium".to_string()
    } else if stderr.contains("Oracle") || stderr.contains("Java(TM)") {
        "Oracle".to_string()
    } else if stderr.contains("Microsoft") {
        "Microsoft".to_string()
    } else if stderr.contains("GraalVM") {
        "GraalVM".to_string()
    } else if stderr.contains("Azul") || stderr.contains("Zulu") {
        "Azul Zulu".to_string()
    } else if stderr.contains("Amazon") || stderr.contains("Corretto") {
        "Amazon Corretto".to_string()
    } else if stderr.contains("OpenJDK") {
        "OpenJDK".to_string()
    } else {
        "Unknown".to_string()
    };

    Some((major, full_version, vendor))
}

#[cfg(not(target_os = "windows"))]
fn extract_tar_gz(data: &[u8], dest_dir: &Path) -> Result<(), String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    use tar::Archive;

    let cursor = Cursor::new(data);
    let decoder = GzDecoder::new(cursor);
    let mut archive = Archive::new(decoder);

    archive
        .unpack(dest_dir)
        .map_err(|e| format!("tar.gz extraction failed: {}", e))?;

    Ok(())
}

#[cfg(target_os = "windows")]
fn extract_tar_gz(_data: &[u8], _dest_dir: &Path) -> Result<(), String> {
    Err("tar.gz extraction not expected on Windows".to_string())
}

#[cfg(target_os = "windows")]
fn extract_zip(data: &[u8], dest_dir: &Path) -> Result<(), String> {
    use std::io::Cursor;
    use zip::ZipArchive;

    let cursor = Cursor::new(data);
    let mut archive =
        ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive: {}", e))?;

    archive
        .extract(dest_dir)
        .map_err(|e| format!("zip extraction failed: {}", e))?;

    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn extract_zip(_data: &[u8], _dest_dir: &Path) -> Result<(), String> {
    Err("zip extraction not expected on this platform".to_string())
}

fn find_java_binary_in_dir(dir: &Path) -> Option<PathBuf> {
    let java_name = if cfg!(target_os = "windows") {
        "java.exe"
    } else {
        "java"
    };

    let direct = dir.join("bin").join(java_name);
    if direct.exists() {
        return Some(direct);
    }

    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                let candidate = path.join("bin").join(java_name);
                if candidate.exists() {
                    return Some(candidate);
                }
                let mac_candidate = path
                    .join("Contents")
                    .join("Home")
                    .join("bin")
                    .join(java_name);
                if mac_candidate.exists() {
                    return Some(mac_candidate);
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_modern_version() {
        let output = r#"openjdk version "21.0.3" 2024-04-16
OpenJDK Runtime Environment Temurin-21.0.3+9 (build 21.0.3+9)
OpenJDK 64-Bit Server VM Temurin-21.0.3+9 (build 21.0.3+9, mixed mode, sharing)"#;
        let (major, full, vendor) = parse_java_version(output).unwrap();
        assert_eq!(major, 21);
        assert_eq!(full, "21.0.3");
        assert_eq!(vendor, "Eclipse Adoptium");
    }

    #[test]
    fn test_parse_legacy_version() {
        let output = r#"java version "1.8.0_392"
Java(TM) SE Runtime Environment (build 1.8.0_392-b08)
Java HotSpot(TM) 64-Bit Server VM (build 25.392-b08, mixed mode)"#;
        let (major, full, vendor) = parse_java_version(output).unwrap();
        assert_eq!(major, 8);
        assert_eq!(full, "1.8.0_392");
        assert_eq!(vendor, "Oracle");
    }

    #[test]
    fn test_parse_openjdk_generic() {
        let output = r#"openjdk version "17.0.9" 2023-10-17
OpenJDK Runtime Environment (build 17.0.9+9-Ubuntu-122.04)
OpenJDK 64-Bit Server VM (build 17.0.9+9-Ubuntu-122.04, mixed mode, sharing)"#;
        let (major, full, vendor) = parse_java_version(output).unwrap();
        assert_eq!(major, 17);
        assert_eq!(full, "17.0.9");
        assert_eq!(vendor, "OpenJDK");
    }

    #[test]
    fn test_parse_invalid_output() {
        assert!(parse_java_version("not java output").is_none());
        assert!(parse_java_version("").is_none());
    }
}
