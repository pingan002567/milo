// Milo 桌面壳：窗口 + 系统通知 + 托盘常驻。
// 业务逻辑全在 milod 守护进程，这里只做系统集成。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // 托盘常驻：关掉窗口不等于停工——成员仍在 milod 里干活，
            // 有请示时经系统通知触达（桌面端相对 Web 的核心价值）。
            let show = MenuItem::with_id(app, "show", "打开 Milo", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出（数字员工将停止）", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            TrayIconBuilder::new()
                .menu(&menu)
                .tooltip("Milo — 一人公司指挥台")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗 = 收进托盘，不退出进程（任务继续跑）
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running Milo")
        .run(|app, event| {
            // 点系统通知/Dock 图标激活应用时，把藏进托盘的窗口拉回前台——
            // 窗口获得焦点后，前端按"未处理通知"直达对应任务群（lib/notify.ts）
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
