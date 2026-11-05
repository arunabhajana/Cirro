fn main() {
    // Desktop client configuration stays in the native binary, never VITE_*.
    println!("cargo:rerun-if-changed=../.env");
    let values: std::collections::HashMap<String, String> = dotenvy::from_path_iter("../.env")
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .collect();
    for key in [
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "CIRRO_UPDATE_ENDPOINT",
        "CIRRO_UPDATER_PUBLIC_KEY",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
        let value = std::env::var(key)
            .ok()
            .or_else(|| values.get(key).cloned())
            .unwrap_or_default();
        assert!(
            !value.contains(['\n', '\r']),
            "OAuth configuration must be one line"
        );
        println!("cargo:rustc-env={key}={value}");
    }
    tauri_build::build()
}
