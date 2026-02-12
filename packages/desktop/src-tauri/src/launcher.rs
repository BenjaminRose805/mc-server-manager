use serde::{Deserialize, Serialize};
use std::process::Command;
use std::sync::{Arc, Mutex};
use tauri::{Manager, State};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameProcess {
    pub instance_id: String,
    pub pid: u32,
    pub started_at: String,
}

pub struct LauncherState {
    pub running_games: Arc<Mutex<Vec<GameProcess>>>,
}

impl LauncherState {
    pub fn new() -> Self {
        Self {
            running_games: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instance {
    id: String,
    mc_version: String,
    version_type: String,
    java_version: i32,
    java_path: Option<String>,
    ram_min: i32,
    ram_max: i32,
    resolution_width: Option<i32>,
    resolution_height: Option<i32>,
    jvm_args: Vec<String>,
    game_args: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Account {
    uuid: String,
    username: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrepareResponse {
    classpath: Vec<String>,
    main_class: String,
    asset_index: String,
    assets_dir: String,
    version_id: String,
    game_jar_path: String,
}

#[tauri::command]
pub async fn launch_game(
    app: tauri::AppHandle,
    state: State<'_, LauncherState>,
    instance_id: String,
    account_id: String,
) -> Result<GameProcess, String> {
    {
        let running = state.running_games.lock().unwrap();
        if running.iter().any(|g| g.instance_id == instance_id) {
            return Err("Game is already running for this instance".to_string());
        }
    }

    let client = reqwest::Client::new();
    let base_url = "http://localhost:3001";

    let instance: Instance = client
        .get(format!("{}/api/launcher/instances/{}", base_url, instance_id))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch instance: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse instance: {}", e))?;

    let mc_token = crate::auth::get_mc_access_token(account_id.clone()).await?;

    let account: Account = client
        .get(format!("{}/api/launcher/accounts/{}", base_url, account_id))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch account: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse account: {}", e))?;

    let prepare_res: PrepareResponse = client
        .post(format!(
            "{}/api/launcher/prepare/{}",
            base_url, instance_id
        ))
        .send()
        .await
        .map_err(|e| format!("Failed to prepare launch: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse prepare response: {}", e))?;

    let java_path = resolve_java_path(&instance).await?;

    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let natives_dir = data_dir
        .join("launcher")
        .join("natives")
        .join(format!(
            "{}-{}",
            instance_id,
            chrono::Utc::now().timestamp()
        ));
    std::fs::create_dir_all(&natives_dir).map_err(|e| e.to_string())?;

    let mut all_classpath = prepare_res.classpath.clone();
    all_classpath.push(prepare_res.game_jar_path.clone());
    let separator = if cfg!(windows) { ";" } else { ":" };
    let classpath_str = all_classpath.join(separator);

    let mut jvm_args = vec![
        format!("-Xms{}G", instance.ram_min),
        format!("-Xmx{}G", instance.ram_max),
        format!(
            "-Djava.library.path={}",
            natives_dir.to_string_lossy()
        ),
        "-Dminecraft.launcher.brand=MCServerManager".to_string(),
        "-Dminecraft.launcher.version=1.0".to_string(),
    ];
    jvm_args.extend(instance.jvm_args.clone());
    jvm_args.push("-cp".to_string());
    jvm_args.push(classpath_str);

    let instance_dir = data_dir
        .join("launcher")
        .join("instances")
        .join(&instance.id);

    let assets_dir = data_dir.join("launcher").join("assets");

    let mut game_args = vec![
        "--username".to_string(),
        account.username.clone(),
        "--version".to_string(),
        instance.mc_version.clone(),
        "--gameDir".to_string(),
        instance_dir.to_string_lossy().to_string(),
        "--assetsDir".to_string(),
        assets_dir.to_string_lossy().to_string(),
        "--assetIndex".to_string(),
        prepare_res.asset_index.clone(),
        "--uuid".to_string(),
        account.uuid.clone(),
        "--accessToken".to_string(),
        mc_token.clone(),
        "--userType".to_string(),
        "msa".to_string(),
        "--versionType".to_string(),
        instance.version_type.clone(),
    ];

    if let (Some(width), Some(height)) =
        (instance.resolution_width, instance.resolution_height)
    {
        game_args.push("--width".to_string());
        game_args.push(width.to_string());
        game_args.push("--height".to_string());
        game_args.push(height.to_string());
    }

    game_args.extend(instance.game_args.clone());

    let child = Command::new(&java_path)
        .args(&jvm_args)
        .arg(&prepare_res.main_class)
        .args(&game_args)
        .current_dir(&instance_dir)
        .spawn()
        .map_err(|e| format!("Failed to spawn Minecraft process: {}", e))?;

    let pid = child.id();
    let started_at = chrono::Utc::now().to_rfc3339();

    let process = GameProcess {
        instance_id: instance_id.clone(),
        pid,
        started_at,
    };

    state
        .running_games
        .lock()
        .unwrap()
        .push(process.clone());

    let running_games = state.running_games.clone();
    let instance_id_clone = instance_id.clone();
    tokio::task::spawn_blocking(move || {
        let mut child = child;
        let _ = child.wait();
        let mut running = running_games.lock().unwrap();
        running.retain(|g| g.instance_id != instance_id_clone);
    });

    Ok(process)
}

#[tauri::command]
pub async fn get_running_games(
    state: State<'_, LauncherState>,
) -> Result<Vec<GameProcess>, String> {
    let running = state.running_games.lock().unwrap();
    Ok(running.clone())
}

#[tauri::command]
pub async fn kill_game(
    state: State<'_, LauncherState>,
    instance_id: String,
) -> Result<(), String> {
    let running = state.running_games.lock().unwrap();
    let process = running
        .iter()
        .find(|g| g.instance_id == instance_id)
        .ok_or("No running game found for this instance")?;

    #[cfg(target_os = "windows")]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/PID", &process.pid.to_string()])
            .output()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill")
            .arg(process.pid.to_string())
            .output()
            .map_err(|e| e.to_string())?;
    }

    drop(running);

    let mut running = state.running_games.lock().unwrap();
    running.retain(|g| g.instance_id != instance_id);

    Ok(())
}

async fn resolve_java_path(instance: &Instance) -> Result<String, String> {
    if let Some(path) = &instance.java_path {
        return Ok(path.clone());
    }

    let installations = crate::java::get_java_installations().await?;
    let matching = installations
        .iter()
        .find(|j| j.version == instance.java_version as u32);

    if let Some(java) = matching {
        Ok(java.path.clone())
    } else {
        Err(format!(
            "Java {} not found. Please install it or specify a custom path.",
            instance.java_version
        ))
    }
}
