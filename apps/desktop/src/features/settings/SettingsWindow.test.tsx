import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsWindow } from './SettingsWindow';

describe('SettingsWindow', () => {
  it("s'ouvre sur l'onglet Modèle", () => {
    render(<SettingsWindow />);
    expect(screen.getByText('Paramètres')).toBeInTheDocument();
    expect(screen.getByText('Modèle Ollama')).toBeInTheDocument();
  });

  it("l'onglet Sécurité montre le mode sans danger et le catalogue des outils", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('Sécurité'));
    expect(screen.getByText('Mode sans danger')).toBeInTheDocument();
    expect(screen.getByText(/Catalogue des outils \(\d+ outils\)/)).toBeInTheDocument();
  });

  it("l'onglet À propos décrit la stack réelle (sans LanceDB)", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('À propos'));
    expect(screen.getByText(/Local-first AI Desktop Copilot/)).toBeInTheDocument();
    expect(screen.queryByText(/LanceDB/)).not.toBeInTheDocument();
  });

  it("l'onglet Voix montre l'interrupteur et l'état des moteurs, sans modèles", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('Voix'));
    expect(screen.getByText('Parler à CatDesk')).toBeInTheDocument();
    // Sans `voice_status` (pas de Tauri en test), rien n'est disponible et
    // l'onglet doit le dire plutôt que planter.
    expect(screen.getByText(/modèles absents — micro désactivé/)).toBeInTheDocument();
    expect(screen.getByText(/voix Windows en secours/)).toBeInTheDocument();
  });

  it("l'onglet Raccourcis liste le raccourci global", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('Raccourcis'));
    expect(screen.getByText('Ouvrir / fermer CatDesk')).toBeInTheDocument();
  });
});
