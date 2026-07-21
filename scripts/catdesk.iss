; Inno Setup script for CatDesk — full offline installer.
;
; NSIS (Tauri's default Windows bundler) caps out around 2 GB and cannot package
; CatDesk's ~5 GB GPU runtime, let alone the multi-GB bundled models. Inno Setup
; has no such limit, so we package the already-built exe + staged resources here.
;
; Paths are injected by scripts/build-inno.ps1 via ISCC /D defines:
;   ExeDir    dir containing the built catdesk.exe
;   ResDir    staged resources dir (agent/ ollama/ ocr/)
;   OutputDir where the installer .exe is written

#define MyAppName "CatDesk"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "CatDesk"
#define MyAppExeName "catdesk.exe"

[Setup]
AppId={{8F2A1C4E-3B6D-4E9A-A1F2-CD7B9E45A012}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Per-user install (no admin elevation needed for a multi-GB payload), mirroring
; Tauri's default. resource_dir() resolves next to the exe, so resources live
; directly under {app} (the Rust side probes {app}\ollama and {app}\resources\ollama).
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputDir={#OutputDir}
OutputBaseFilename=CatDesk-{#MyAppVersion}-offline-setup
; The bundled models are already-quantized GGUF (incompressible). Compressing
; ~15 GB would cost a lot of time for almost no size gain, so ship them stored.
Compression=none
SolidCompression=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
; Windows caps a single Setup.exe near 4 GB. The bundled models push us well past
; that, so split the payload across ~2 GB slices: the build produces a small
; setup.exe plus CatDesk-*-#.bin files that must be kept together to install.
DiskSpanning=yes
DiskSliceSize=2000000000

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "Creer un raccourci sur le Bureau"; GroupDescription: "Raccourcis :"

[Files]
Source: "{#ExeDir}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ResDir}\agent\*";  DestDir: "{app}\agent";  Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ResDir}\ollama\*"; DestDir: "{app}\ollama"; Flags: ignoreversion recursesubdirs createallsubdirs
; OCR est optionnel (build-release.ps1 -SkipOcr laisse resources\ocr\ vide) —
; un Source wildcard qui ne matche aucun fichier fait échouer la compilation
; ISCC, donc cette ligne n'est incluse que si build-inno.ps1 a détecté au
; moins un fichier réel dans resources\ocr\ (define HasOcr).
#ifdef HasOcr
Source: "{#ResDir}\ocr\*";    DestDir: "{app}\ocr";    Flags: ignoreversion recursesubdirs createallsubdirs
#endif

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer {#MyAppName}"; Flags: nowait postinstall skipifsilent
