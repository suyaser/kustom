//! Finding a running League client from the process list: the first discovery step (parity row 9, plus the
//! M17.5 scope addition), a port of `packages/lcu/src/processDiscovery.ts` with `--install-directory` added.
//!
//! The client's UI process (`LeagueClientUx.exe` on Windows, `LeagueClientUx` on macOS) is started with
//! `--app-port=<port>`, `--remoting-auth-token=<password>`, `--app-pid=<LeagueClient pid>` and
//! `--install-directory=<install dir>` among its arguments. On Windows each argument is double-quoted on its
//! own (`"--install-directory=C:\Riot Games\League of Legends"`); `ps` on macOS prints them bare, so a path
//! with spaces runs up to the next ` --`.
//!
//! The command line carries the client password: it is parsed here and **never logged**, in full or in part.
//! Nothing here panics; a lister that fails answers [`ProcessList::Unavailable`].

use std::path::PathBuf;
use std::time::Duration;

use base64::Engine as _;
use serde::Deserialize;

use super::lockfile::{Credentials, LOCKFILE_NAME};

/// The Windows UI process the companion looks for.
pub const LEAGUE_UX_PROCESS_WINDOWS: &str = "LeagueClientUx.exe";
/// The macOS UI process name.
pub const LEAGUE_UX_PROCESS_MACOS: &str = "LeagueClientUx";

/// One running client UI process, as much as the process list said.
#[derive(Clone, PartialEq, Eq)]
pub struct LeagueProcess {
    /// Its pid, when known.
    pub pid: Option<u32>,
    /// Its executable path, when known (Windows: `ExecutablePath`).
    pub executable_path: Option<String>,
    /// Its full command line. Never logged: it carries `--remoting-auth-token`.
    pub command_line: Option<String>,
}

impl std::fmt::Debug for LeagueProcess {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LeagueProcess")
            .field("pid", &self.pid)
            .field("executable_path", &self.executable_path)
            .field("command_line", &self.command_line.as_ref().map(|_| "[redacted]"))
            .finish()
    }
}

/// What the process list said.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessList {
    /// Read; possibly empty (League is not running).
    Listed(Vec<LeagueProcess>),
    /// Could not be read (no PowerShell, timeout, access denied). A reason, never the output.
    Unavailable(String),
}

/// What a client UI command line says about reaching the client and where it is installed.
#[derive(Clone, PartialEq, Eq)]
pub struct UxArgs {
    /// `--app-port`.
    pub port: u16,
    /// `--remoting-auth-token`. Never logged.
    pub password: String,
    /// `--app-pid`: the `LeagueClient` pid the lockfile would carry.
    pub app_pid: Option<u32>,
    /// `--install-directory`: the folder the lockfile lives in.
    pub install_directory: Option<PathBuf>,
}

impl std::fmt::Debug for UxArgs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("UxArgs")
            .field("port", &self.port)
            .field("password", &"[redacted]")
            .field("app_pid", &self.app_pid)
            .field("install_directory", &self.install_directory)
            .finish()
    }
}

impl UxArgs {
    /// Credentials straight off the command line, for when no lockfile can be read.
    pub fn credentials(&self, fallback_pid: Option<u32>) -> Option<Credentials> {
        Some(Credentials {
            name: "LeagueClient".to_string(),
            pid: self.app_pid.or(fallback_pid)?,
            port: self.port,
            password: self.password.clone(),
        })
    }
}

/// The value of `--<name>=...` in a command line. `spaces` lets a bare value run to the next ` --` (a path on
/// macOS); without it a bare value stops at whitespace, as `processDiscovery.ts` does.
fn arg_value(command_line: &str, name: &str, spaces: bool) -> Option<String> {
    let needle = format!("--{name}=");
    let mut from = 0;
    while let Some(found) = command_line[from..].find(&needle) {
        let at = from + found;
        from = at + needle.len();
        let before = command_line[..at].chars().last();
        let quoted_arg = before == Some('"');
        if !(before.is_none() || quoted_arg || before.is_some_and(char::is_whitespace)) {
            continue;
        }
        let rest = &command_line[from..];
        let value = if let Some(inner) = rest.strip_prefix('"') {
            inner.split('"').next().unwrap_or_default().to_string()
        } else if quoted_arg {
            rest.split('"').next().unwrap_or_default().to_string()
        } else if spaces {
            let end = rest
                .find(" --")
                .or_else(|| rest.find(" \"--"))
                .unwrap_or(rest.len());
            rest[..end].trim_end().to_string()
        } else {
            rest.split(char::is_whitespace)
                .next()
                .unwrap_or_default()
                .trim_end_matches('"')
                .to_string()
        };
        return Some(value);
    }
    None
}

/// Pulls the connection details out of a client UI command line. `None` when the port or the token is
/// missing, or the port is not a port.
pub fn parse_ux_command_line(command_line: &str) -> Option<UxArgs> {
    let port: u16 = arg_value(command_line, "app-port", false)?
        .parse()
        .ok()
        .filter(|p| *p > 0)?;
    let password = arg_value(command_line, "remoting-auth-token", false).filter(|p| !p.is_empty())?;
    super::lockfile::register_password(&password);
    let app_pid = arg_value(command_line, "app-pid", false)
        .and_then(|p| p.parse().ok())
        .filter(|p| *p > 0);
    let install_directory = arg_value(command_line, "install-directory", true)
        .map(|d| d.trim().trim_end_matches(['\\', '/']).to_string())
        .filter(|d| !d.is_empty())
        .map(PathBuf::from);
    Some(UxArgs {
        port,
        password,
        app_pid,
        install_directory,
    })
}

/// `C:\Games\Riot\League of Legends\LeagueClientUx.exe` -> `C:\Games\Riot\League of Legends\lockfile`.
/// Windows path rules on every host (the executable path only comes from the Windows lister).
pub fn lockfile_path_from_executable(executable_path: &str) -> Option<PathBuf> {
    let trimmed = executable_path.trim().trim_matches('"');
    let cut = trimmed.rfind(['\\', '/'])?;
    let dir = &trimmed[..cut];
    if dir.is_empty() {
        return None;
    }
    let sep = if trimmed[cut..].starts_with('\\') {
        '\\'
    } else {
        '/'
    };
    Some(PathBuf::from(format!("{dir}{sep}{LOCKFILE_NAME}")))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct PowerShellRow {
    #[serde(default)]
    process_id: Option<i64>,
    #[serde(default)]
    executable_path: Option<String>,
    #[serde(default)]
    command_line: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum PowerShellOutput {
    One(PowerShellRow),
    Many(Vec<PowerShellRow>),
}

fn row_to_process(row: PowerShellRow) -> LeagueProcess {
    LeagueProcess {
        pid: row
            .process_id
            .and_then(|p| u32::try_from(p).ok())
            .filter(|p| *p > 0),
        executable_path: row.executable_path.filter(|p| !p.is_empty()),
        command_line: row.command_line.filter(|c| !c.is_empty()),
    }
}

/// Parses `Get-CimInstance ... | ConvertTo-Json -Compress`: one object for one process, an array for
/// several, nothing for none.
pub fn parse_powershell_process_list(stdout: &str) -> ProcessList {
    let text = stdout.trim_start_matches('\u{feff}').trim();
    if text.is_empty() {
        return ProcessList::Listed(Vec::new());
    }
    match serde_json::from_str::<PowerShellOutput>(text) {
        Ok(PowerShellOutput::One(row)) => ProcessList::Listed(vec![row_to_process(row)]),
        Ok(PowerShellOutput::Many(rows)) => {
            ProcessList::Listed(rows.into_iter().map(row_to_process).collect())
        }
        Err(_) => ProcessList::Unavailable("PowerShell output had an unexpected shape".to_string()),
    }
}

/// Parses `wmic process where name='LeagueClientUx.exe' get CommandLine,ExecutablePath,ProcessId
/// /format:list`: blank-line separated `Key=Value` blocks; `No Instances Available.` is "not running".
pub fn parse_wmic_process_list(stdout: &str) -> ProcessList {
    let text = stdout.replace('\r', "");
    let text = text.trim();
    if text.is_empty() || text.to_ascii_lowercase().contains("no instances available") {
        return ProcessList::Listed(Vec::new());
    }
    let mut processes = Vec::new();
    for block in text.split("\n\n") {
        let mut pid = None;
        let mut exe = None;
        let mut cmd = None;
        let mut any = false;
        for line in block.lines() {
            let Some((key, value)) = line.split_once('=') else {
                continue;
            };
            if key.trim().is_empty() {
                continue;
            }
            any = true;
            let value = value.trim();
            match key.trim() {
                "ProcessId" => pid = value.parse::<u32>().ok().filter(|p| *p > 0),
                "ExecutablePath" if !value.is_empty() => exe = Some(value.to_string()),
                "CommandLine" if !value.is_empty() => cmd = Some(value.to_string()),
                _ => {}
            }
        }
        if any {
            processes.push(LeagueProcess {
                pid,
                executable_path: exe,
                command_line: cmd,
            });
        }
    }
    ProcessList::Listed(processes)
}

/// Parses `ps -axww -o pid=,command=` on macOS, keeping the client UI processes only.
pub fn parse_ps_process_list(stdout: &str) -> ProcessList {
    let processes = stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, command) = line.split_once(char::is_whitespace)?;
            let command = command.trim();
            let program = command.split(" --").next().unwrap_or(command).trim_end();
            if !program.ends_with(&format!("/{LEAGUE_UX_PROCESS_MACOS}"))
                && program != LEAGUE_UX_PROCESS_MACOS
            {
                return None;
            }
            Some(LeagueProcess {
                pid: pid.parse().ok().filter(|p| *p > 0),
                executable_path: Some(program.to_string()),
                command_line: Some(command.to_string()),
            })
        })
        .collect();
    ProcessList::Listed(processes)
}

const POWERSHELL_SCRIPT: &str = "Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe'\" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress";

/// The PowerShell arguments: the script goes in as UTF-16LE base64 (`-EncodedCommand`), so no quoting rules
/// apply. Same invocation as `processDiscovery.ts`.
pub fn powershell_args() -> Vec<String> {
    let utf16: Vec<u8> = POWERSHELL_SCRIPT
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect();
    vec![
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-ExecutionPolicy".into(),
        "Bypass".into(),
        "-EncodedCommand".into(),
        base64::engine::general_purpose::STANDARD.encode(utf16),
    ]
}

/// `wmic` arguments, for a PC where PowerShell cannot start.
pub const WMIC_ARGS: [&str; 6] = [
    "process",
    "where",
    "name='LeagueClientUx.exe'",
    "get",
    "CommandLine,ExecutablePath,ProcessId",
    "/format:list",
];

/// Lists the running client UI processes. Injected in tests; the real one shells out.
pub trait ProcessLister: Send + Sync {
    /// One listing. Never panics; a failure is [`ProcessList::Unavailable`].
    fn list(&self) -> impl std::future::Future<Output = ProcessList> + Send;
}

/// The lister for this host: PowerShell then `wmic` on Windows, `ps` on macOS, nothing elsewhere.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemProcessLister;

const LIST_TIMEOUT: Duration = Duration::from_secs(15);

async fn run(program: &str, args: &[String]) -> Result<String, String> {
    let mut command = tokio::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    {
        // CREATE_NO_WINDOW: no console flashes on a friend's screen every 15 s.
        command.creation_flags(0x0800_0000);
    }
    match tokio::time::timeout(LIST_TIMEOUT, command.output()).await {
        Err(_) => Err("timed out".to_string()),
        Ok(Err(error)) => Err(error.kind().to_string()),
        Ok(Ok(output)) if output.status.success() => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
        Ok(Ok(output)) => Err(format!("exit {}", output.status.code().unwrap_or(-1))),
    }
}

impl ProcessLister for SystemProcessLister {
    async fn list(&self) -> ProcessList {
        if cfg!(windows) {
            let powershell = match run("powershell.exe", &powershell_args()).await {
                Ok(stdout) => return parse_powershell_process_list(&stdout),
                Err(reason) => reason,
            };
            let wmic_args: Vec<String> = WMIC_ARGS.iter().map(|a| (*a).to_string()).collect();
            match run("wmic.exe", &wmic_args).await {
                Ok(stdout) => parse_wmic_process_list(&stdout),
                Err(reason) => ProcessList::Unavailable(format!("powershell: {powershell}; wmic: {reason}")),
            }
        } else if cfg!(target_os = "macos") {
            let args = ["-axww", "-o", "pid=,command="].map(String::from);
            match run("ps", &args).await {
                Ok(stdout) => parse_ps_process_list(&stdout),
                Err(reason) => ProcessList::Unavailable(format!("ps: {reason}")),
            }
        } else {
            ProcessList::Listed(Vec::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped like a real 16.x Windows `LeagueClientUx.exe` command line: every argument quoted on its own,
    /// spaces in the paths. The token is a stand-in.
    const WINDOWS_CMD: &str = r#""D:\Games\Riot Games\League of Legends\LeagueClientUx.exe" "--riotclient-auth-token=REDACTED-rc-token" "--riotclient-app-port=52311" "--no-rads" "--disable-self-update" "--region=EUNE" "--locale=en_GB" "--remoting-auth-token=REDACTED-token-Ab_9" "--respawn-command=LeagueClient.exe" "--respawn-display-name=League of Legends" "--app-port=61234" "--install-directory=D:\Games\Riot Games\League of Legends\" "--app-name=LeagueClient" "--ux-name=LeagueClientUx" "--ux-helper-name=LeagueClientUxHelper" "--log-dir=LeagueClient Logs" "--crash-reporting=" "--crash-environment=EUW1" "--app-log-file-path=D:/Games/Riot Games/League of Legends/Logs/LeagueClient Logs/2026-10-04T18-00-00_1234_LeagueClient.log" "--app-pid=1234" "--output-base-dir=D:\Games\Riot Games\League of Legends" "--no-proxy-server" "--ignore-certificate-errors""#;

    /// Shaped like `ps -axww -o pid=,command=` on macOS: bare arguments, spaces in the app path.
    const MACOS_PS: &str = "  412 /usr/libexec/trustd\n86512 /Applications/League of Legends.app/Contents/LoL/League of Legends.app/Contents/MacOS/LeagueClientUx --riotclient-auth-token=REDACTED-rc --riotclient-app-port=60001 --remoting-auth-token=REDACTED-mac-token --app-port=60969 --install-directory=/Applications/League of Legends.app/Contents/LoL --app-name=LeagueClient --app-pid=86388 --region=EUNE\n86513 /Applications/League of Legends.app/Contents/LoL/League of Legends.app/Contents/Frameworks/LeagueClientUxHelper.app/Contents/MacOS/LeagueClientUxHelper --type=renderer\n";

    #[test]
    fn windows_command_line_with_quotes_and_spaces() {
        let args = parse_ux_command_line(WINDOWS_CMD).unwrap();
        assert_eq!(args.port, 61234);
        assert_eq!(args.password, "REDACTED-token-Ab_9");
        assert_eq!(args.app_pid, Some(1234));
        assert_eq!(
            args.install_directory,
            Some(PathBuf::from(r"D:\Games\Riot Games\League of Legends"))
        );
        assert_eq!(args.credentials(None).unwrap().port, 61234);
        // The riot client's own port and token are different flags and never confused with the LCU's.
        assert!(!format!("{args:?}").contains("REDACTED-token"));
    }

    #[test]
    fn macos_ps_output_with_bare_arguments() {
        let ProcessList::Listed(processes) = parse_ps_process_list(MACOS_PS) else {
            panic!()
        };
        assert_eq!(
            processes.len(),
            1,
            "only LeagueClientUx, not the helper or trustd"
        );
        assert_eq!(processes[0].pid, Some(86512));
        let args = parse_ux_command_line(processes[0].command_line.as_deref().unwrap()).unwrap();
        assert_eq!(args.port, 60969);
        assert_eq!(args.password, "REDACTED-mac-token");
        assert_eq!(args.app_pid, Some(86388));
        assert_eq!(
            args.install_directory,
            Some(PathBuf::from("/Applications/League of Legends.app/Contents/LoL"))
        );
        assert!(!format!("{:?}", processes[0]).contains("REDACTED"));
    }

    /// Live, 16.19 on macOS: discovery step 1 must carry the Ux `--install-directory` into `install_dir`
    /// (the window's League folder row, and the seen-folder save), whether the lockfile beside it is read or
    /// the credentials come from the command line.
    #[test]
    fn macos_discovery_step_1_reports_the_install_directory() {
        use super::super::discovery::{LcuDiscovery, LockfileReader, from_processes};
        struct Reader(Option<String>);
        impl LockfileReader for Reader {
            fn read(&self, path: &std::path::Path) -> std::io::Result<String> {
                match &self.0 {
                    Some(text) if path.ends_with("LoL/lockfile") => Ok(text.clone()),
                    _ => Err(std::io::ErrorKind::NotFound.into()),
                }
            }
        }
        let ProcessList::Listed(processes) = parse_ps_process_list(MACOS_PS) else {
            panic!()
        };
        let expected = Some(PathBuf::from("/Applications/League of Legends.app/Contents/LoL"));
        for reader in [
            Reader(Some("LeagueClient:86388:60969:pw:https".into())),
            Reader(None),
        ] {
            let mut searched = Vec::new();
            match from_processes(&processes, &reader, &mut searched) {
                Some(LcuDiscovery::Found {
                    install_dir,
                    credentials,
                    ..
                }) => {
                    assert_eq!(install_dir, expected);
                    assert_eq!(credentials.port, 60969);
                }
                other => panic!("expected Found, got {other:?}"),
            }
        }
    }

    #[test]
    fn command_lines_missing_a_piece() {
        assert!(parse_ux_command_line(r#""--app-port=61234""#).is_none());
        assert!(parse_ux_command_line(r#""--remoting-auth-token=x""#).is_none());
        assert!(parse_ux_command_line(r#""--app-port=99999" "--remoting-auth-token=x""#).is_none());
        assert!(parse_ux_command_line(r#""--app-port=1" "--remoting-auth-token=""#).is_none());
        // A flag that merely ends in the name is not the flag.
        assert!(parse_ux_command_line("--riotclient-app-port=5 --remoting-auth-token=x").is_none());
        let bare = parse_ux_command_line("--app-port=5 --remoting-auth-token=abc").unwrap();
        assert_eq!(
            (bare.port, bare.app_pid, bare.install_directory.as_deref()),
            (5, None, None)
        );
        assert!(bare.credentials(None).is_none(), "no pid at all");
        assert_eq!(bare.credentials(Some(7)).unwrap().pid, 7);
    }

    #[test]
    fn lockfile_beside_the_executable() {
        assert_eq!(
            lockfile_path_from_executable(r#""C:\Games\Riot\League of Legends\LeagueClientUx.exe""#),
            Some(PathBuf::from(r"C:\Games\Riot\League of Legends\lockfile"))
        );
        assert_eq!(lockfile_path_from_executable("LeagueClientUx.exe"), None);
        assert_eq!(lockfile_path_from_executable("  "), None);
    }

    #[test]
    fn powershell_output_shapes() {
        assert_eq!(parse_powershell_process_list(""), ProcessList::Listed(vec![]));
        let one = parse_powershell_process_list(
            "\u{feff}{\"ProcessId\":1234,\"ExecutablePath\":\"C:\\\\Riot Games\\\\League of Legends\\\\LeagueClientUx.exe\",\"CommandLine\":\"\\\"--app-port=1\\\" \\\"--remoting-auth-token=t\\\"\"}",
        );
        let ProcessList::Listed(one) = one else { panic!() };
        assert_eq!(one[0].pid, Some(1234));
        assert_eq!(
            one[0].executable_path.as_deref(),
            Some(r"C:\Riot Games\League of Legends\LeagueClientUx.exe")
        );
        assert!(parse_ux_command_line(one[0].command_line.as_deref().unwrap()).is_some());
        let many = parse_powershell_process_list(
            r#"[{"ProcessId":1,"ExecutablePath":null,"CommandLine":null},{"ProcessId":2}]"#,
        );
        let ProcessList::Listed(many) = many else { panic!() };
        assert_eq!(many.len(), 2);
        assert_eq!(many[0].executable_path, None);
        assert!(matches!(
            parse_powershell_process_list("not json"),
            ProcessList::Unavailable(_)
        ));
    }

    #[test]
    fn wmic_output_shapes() {
        assert_eq!(
            parse_wmic_process_list("No Instances Available.\r\n"),
            ProcessList::Listed(vec![])
        );
        let text = "\r\n\r\nCommandLine=\"D:\\LoL\\LeagueClientUx.exe\" \"--app-port=5\" \"--remoting-auth-token=t\"\r\nExecutablePath=D:\\LoL\\LeagueClientUx.exe\r\nProcessId=99\r\n\r\n\r\n";
        let ProcessList::Listed(list) = parse_wmic_process_list(text) else {
            panic!()
        };
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].pid, Some(99));
        assert_eq!(
            list[0].executable_path.as_deref(),
            Some(r"D:\LoL\LeagueClientUx.exe")
        );
    }

    #[test]
    fn powershell_script_is_utf16_base64() {
        let args = powershell_args();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(&args[5])
            .unwrap();
        let units: Vec<u16> = decoded
            .chunks(2)
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        assert_eq!(String::from_utf16(&units).unwrap(), POWERSHELL_SCRIPT);
    }
}
