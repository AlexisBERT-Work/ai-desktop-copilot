//! Arbre de processus tué d'un bloc (Windows : Job Object « kill on close »).
//!
//! Windows ne tue pas les enfants avec le parent. `Child::kill()` sur
//! `ollama.exe` laissait vivants ses `llama-server.exe`, et avec eux ~9 Go de
//! VRAM jusqu'au redémarrage du PC — à chaque fermeture de CatDesk et avant
//! chaque mise à jour (constaté le 2026-10-09 : 4,1 Go tenus par un runner
//! orphelin, le modèle suivant ne tenait plus sur la carte). L'ancien
//! `taskkill /IM ollama.exe` avait le même défaut depuis que les runners
//! d'Ollama s'appellent `llama-server.exe`.
//!
//! Un processus rattaché à un Job Object y entraîne tous ceux qu'il lance
//! ensuite. `kill()` tue tout l'arbre à l'arrêt normal ; et si CatDesk plante,
//! Windows ferme le handle du job avec le processus, ce qui tue l'arbre aussi
//! (`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`).

use std::process::Child;

/// Un arbre de processus rattaché à un Job Object. Le lâcher (drop) tue l'arbre.
pub struct ProcessTree {
    #[cfg(windows)]
    job: imp::Job,
}

impl ProcessTree {
    /// Rattache `child` — et tout ce qu'il lancera — à un arbre tué d'un bloc.
    /// `None` si Windows refuse (l'appelant retombe sur `Child::kill`) ou hors
    /// Windows. Les processus que `child` aurait lancés AVANT l'appel restent
    /// hors de l'arbre : appeler juste après `spawn`.
    pub fn adopt(child: &Child) -> Option<Self> {
        #[cfg(windows)]
        {
            let job = imp::Job::kill_on_close()?;
            job.assign(child).then_some(ProcessTree { job })
        }
        #[cfg(not(windows))]
        {
            let _ = child;
            None
        }
    }

    /// Tue tout l'arbre maintenant.
    pub fn kill(&self) {
        #[cfg(windows)]
        self.job.terminate();
    }
}

#[cfg(windows)]
mod imp {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);

    // Un handle de job s'utilise depuis n'importe quel thread (API Win32 sans
    // affinité de thread) ; seul le pointeur brut empêche l'auto-dérivation.
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close() -> Option<Self> {
            // SAFETY : appels Win32 documentés ; le handle est fermé par Drop,
            // et sur échec de configuration avant de rendre None.
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    std::ptr::from_ref(&info).cast(),
                    std::mem::size_of_val(&info) as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Job(handle))
            }
        }

        pub fn assign(&self, child: &Child) -> bool {
            // SAFETY : le handle de processus appartient à `child`, vivant ici.
            unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle()) != 0 }
        }

        pub fn terminate(&self) {
            // SAFETY : handle de job valide jusqu'au Drop.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY : fermé une seule fois ; la fermeture tue l'arbre (KILL_ON_JOB_CLOSE).
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    /// PID des enfants directs de `pid` (via PowerShell : pas de dépendance de plus).
    fn children_of(pid: u32) -> Vec<u32> {
        let out = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Get-CimInstance Win32_Process -Filter 'ParentProcessId={pid}' | ForEach-Object {{ $_.ProcessId }}"
                ),
            ])
            .output()
            .expect("powershell");
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| l.trim().parse().ok())
            .collect()
    }

    fn is_alive(pid: u32) -> bool {
        let out = Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH"])
            .output()
            .expect("tasklist");
        String::from_utf8_lossy(&out.stdout).contains(&pid.to_string())
    }

    /// Le cas Ollama en miniature : un parent qui lance un enfant de longue
    /// durée. `kill()` doit emporter les DEUX — c'est l'enfant que
    /// `Child::kill()` laissait derrière lui.
    #[test]
    fn kill_emporte_aussi_les_petits_enfants() {
        let mut parent = Command::new("cmd")
            .args(["/c", "ping -n 60 127.0.0.1 > nul"])
            .stdout(Stdio::null())
            .spawn()
            .expect("cmd");
        let tree = ProcessTree::adopt(&parent).expect("job object");

        // Attendre que `ping` (le petit-enfant) soit lancé.
        let started = Instant::now();
        let mut grandchildren = Vec::new();
        while grandchildren.is_empty() && started.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(200));
            grandchildren = children_of(parent.id());
        }
        assert!(!grandchildren.is_empty(), "ping n'a pas démarré");

        tree.kill();
        let _ = parent.wait();
        std::thread::sleep(Duration::from_millis(300));
        for pid in grandchildren {
            assert!(!is_alive(pid), "le petit-enfant {pid} a survécu");
        }
    }

    /// Plantage de CatDesk : le handle du job se ferme (ici, drop) et Windows
    /// tue l'arbre sans qu'aucun code d'arrêt ne tourne.
    #[test]
    fn lacher_le_job_tue_l_arbre() {
        let mut parent = Command::new("cmd")
            .args(["/c", "ping -n 60 127.0.0.1 > nul"])
            .stdout(Stdio::null())
            .spawn()
            .expect("cmd");
        let tree = ProcessTree::adopt(&parent).expect("job object");
        drop(tree);
        let started = Instant::now();
        while parent.try_wait().expect("try_wait").is_none() {
            assert!(
                started.elapsed() < Duration::from_secs(5),
                "le parent a survécu"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}
