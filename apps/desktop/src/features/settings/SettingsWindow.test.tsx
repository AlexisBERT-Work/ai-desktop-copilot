// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SettingsWindow } from './SettingsWindow';

afterEach(cleanup);

describe('SettingsWindow', () => {
  it("s'ouvre sur l'onglet Modèle", () => {
    render(<SettingsWindow />);
    expect(screen.getByText('Paramètres')).toBeTruthy();
    expect(screen.getByText('Modèle Ollama')).toBeTruthy();
  });

  it("l'onglet Sécurité montre le mode sans danger et le catalogue des outils", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('Sécurité'));
    expect(screen.getByText('Mode sans danger')).toBeTruthy();
    expect(screen.getByText(/Catalogue des outils \(\d+ outils\)/)).toBeTruthy();
  });

  it("l'onglet À propos décrit la stack réelle (sans LanceDB)", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('À propos'));
    expect(screen.getByText(/Local-first AI Desktop Copilot/)).toBeTruthy();
    expect(screen.queryByText(/LanceDB/)).toBeNull();
  });

  it("l'onglet Raccourcis liste le raccourci global", () => {
    render(<SettingsWindow />);
    fireEvent.click(screen.getByText('Raccourcis'));
    expect(screen.getByText('Ouvrir / fermer CatDesk')).toBeTruthy();
  });
});
