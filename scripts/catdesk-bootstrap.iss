; CatDesk — installeur "bootstrap" : UN SEUL petit .exe (quelques Mo) à donner
; à un proche. Ne contient PAS le payload (~22 Go) : il le télécharge lui-même
; (PowerShell natif, aucun outil tiers) puis lance l'installeur complet déjà
; validé (scripts/catdesk.iss) en silencieux. Zéro fichier à garder ensemble,
; zéro commande à taper côté destinataire — voir docs/DISTRIBUTION.md.
;
; BaseUrl pointe par défaut sur la release GitHub publique catdesk-releases ;
; surchargeable à la compilation pour tester en local (voir scripts/
; test-bootstrap-local.ps1) : ISCC /DBaseUrl=http://127.0.0.1:8000 ...

#ifndef BaseUrl
#define BaseUrl "https://github.com/AlexisBERT-Work/catdesk-releases/releases/download/v0.1.1"
#endif

#define MyAppName "CatDesk"
#define MyAppVersion "0.1.1"
#define MyAppPublisher "CatDesk"
#define BaseName "CatDesk-0.1.1-offline-setup"
#define MainInstaller BaseName + ".exe"
#define PartCount 12

[Setup]
AppId={{8F2A1C4E-3B6D-4E9A-A1F2-CD7B9E45A013}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
; Même convention de dossier que l'installeur réel (scripts/catdesk.iss) :
; les deux doivent s'accorder puisque celui-ci lance l'autre sans forcer /DIR.
DefaultDirName={localappdata}\Programs\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
; Le bootstrap est un simple relais transitoire (télécharge puis délègue à
; l'installeur réel) — sans ça, il créerait SA PROPRE entrée dans Ajout/
; Suppression de programmes, en plus de celle du vrai CatDesk installé
; ensuite : deux "CatDesk" listés, confusion pour le destinataire (repéré
; en testant en local).
Uninstallable=no
OutputDir=..\dist-bootstrap
OutputBaseFilename=CatDesk-Installer
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern

[Languages]
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Code]
var
  DownloadPage: TOutputProgressWizardPage;

// Une tentative de téléchargement (PowerShell natif — présent sur tout
// Windows moderne, aucun binaire tiers à embarquer/verifier).
// -UseBasicParsing : sans ça, Invoke-WebRequest échoue sur une machine où
// Internet Explorer n'a jamais été lancé une première fois (IE "first run"
// requis sinon) — quasi garanti chez un proche non-tech.
// $ProgressPreference='SilentlyContinue' : sans ça, la barre de progression
// native de PowerShell 5.1 ralentit le téléchargement d'un facteur 10-100x
// (bug connu), critique sur un fichier de ~2 Go.
function TryDownloadOnce(Url, Dest: string; var ResultCode: Integer): Boolean;
var
  Cmd, PsPath: string;
begin
  // Chemin complet obligatoire : Exec('powershell.exe', ...) sans chemin ne
  // se résout pas de façon fiable dans le contexte d'Inno (testé — échoue
  // silencieusement, {sys} donne le System32 réel même en process 64-bit).
  PsPath := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
  Cmd := '-NoProfile -ExecutionPolicy Bypass -Command ' +
    '"$ProgressPreference=''SilentlyContinue''; ' +
    'try { Invoke-WebRequest -Uri ''' + Url + ''' -OutFile ''' + Dest +
    ''' -UseBasicParsing -TimeoutSec 3600 } catch { exit 1 }"';
  Result := Exec(PsPath, Cmd, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

// 3 tentatives (connexion instable chez un particulier n'est pas rare),
// avec une pause entre chaque. Met à jour la page de progression.
function DownloadFile(Url, Dest, Label_: string): Boolean;
var
  Attempt, ResultCode: Integer;
begin
  Result := False;
  for Attempt := 1 to 3 do
  begin
    DownloadPage.SetText(Label_, 'Tentative ' + IntToStr(Attempt) + ' sur 3 — cela peut prendre plusieurs minutes.');
    if TryDownloadOnce(Url, Dest, ResultCode) and (ResultCode = 0) and FileExists(Dest) then
    begin
      Result := True;
      Exit;
    end;
    Sleep(3000);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  i, ResultCode: Integer;
  Url, Dest, MainExePath, TempDir: string;
  Ok: Boolean;
begin
  if CurStep <> ssInstall then Exit;

  TempDir := ExpandConstant('{tmp}');
  DownloadPage := CreateOutputProgressPage(
    'Téléchargement de CatDesk',
    'Récupération des fichiers nécessaires (plusieurs Go) — merci de patienter, ne fermez pas cette fenêtre.');
  DownloadPage.Show;
  try
    Ok := True;

    for i := 1 to {#PartCount} do
    begin
      Url := '{#BaseUrl}/{#BaseName}-' + IntToStr(i) + '.bin';
      Dest := TempDir + '\{#BaseName}-' + IntToStr(i) + '.bin';
      if not DownloadFile(Url, Dest, 'Téléchargement : partie ' + IntToStr(i) + ' sur {#PartCount}') then
      begin
        Ok := False;
        Break;
      end;
    end;

    if Ok then
    begin
      Url := '{#BaseUrl}/{#MainInstaller}';
      Dest := TempDir + '\{#MainInstaller}';
      Ok := DownloadFile(Url, Dest, 'Téléchargement : programme d''installation');
    end;

    if not Ok then
    begin
      MsgBox('Le téléchargement a échoué après plusieurs tentatives.' + #13#10 +
        'Vérifiez votre connexion internet puis relancez cet installeur.', mbError, MB_OK);
      Abort;
    end;

    DownloadPage.SetText('Installation de CatDesk…', 'Cette étape peut aussi prendre quelques minutes.');
    MainExePath := TempDir + '\{#MainInstaller}';
    if not (Exec(MainExePath, '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and (ResultCode = 0)) then
    begin
      MsgBox('L''installation a échoué (code ' + IntToStr(ResultCode) + ').', mbError, MB_OK);
      Abort;
    end;

    // Nettoyage : les fichiers téléchargés dans {tmp} n'ont plus d'utilité
    // (l'installeur réel a déjà copié ce qu'il fallait dans {app}).
    for i := 1 to {#PartCount} do
      DeleteFile(TempDir + '\{#BaseName}-' + IntToStr(i) + '.bin');
    DeleteFile(TempDir + '\{#MainInstaller}');
  finally
    DownloadPage.Hide;
  end;
end;

[Run]
Filename: "{app}\catdesk.exe"; Description: "Lancer {#MyAppName}"; Flags: nowait postinstall skipifsilent
