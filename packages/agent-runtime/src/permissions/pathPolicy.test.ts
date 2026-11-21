import { describe, expect, it } from 'vitest';
import { expandPathEntry, isPathAllowed, pathEnv } from './pathPolicy';

const ENV = { userProfile: 'C:\\Users\\Moi', temp: 'C:\\Users\\Moi\\AppData\\Local\\Temp' };
const WHITELIST = ['%USERPROFILE%\\Documents', '%TEMP%'];

describe('pathPolicy', () => {
  it('expanse %USERPROFILE% et %TEMP%, sans souci de casse', () => {
    expect(expandPathEntry('%userprofile%\\Documents', ENV)).toBe('C:\\Users\\Moi\\Documents');
    expect(expandPathEntry('%Temp%', ENV)).toBe(ENV.temp);
  });

  it('lit l’environnement : TEMP, sinon TMP', () => {
    expect(pathEnv({ USERPROFILE: 'D:\\U', TMP: 'D:\\T' })).toEqual({
      userProfile: 'D:\\U',
      temp: 'D:\\T',
    });
  });

  it('autorise sous une racine, quels que soient casse et séparateurs', () => {
    expect(isPathAllowed('c:/users/moi/documents/a/b.pdf', WHITELIST, ENV)).toBe(true);
    expect(isPathAllowed('C:\\Users\\Moi\\Documents', WHITELIST, ENV)).toBe(true);
    expect(isPathAllowed(`${ENV.temp}\\x.txt`, WHITELIST, ENV)).toBe(true);
  });

  it('refuse le voisin, la remontée et l’extérieur', () => {
    expect(isPathAllowed('C:\\Users\\Moi\\Documents-evil\\x', WHITELIST, ENV)).toBe(false);
    expect(isPathAllowed('C:\\Users\\Moi\\Documents\\..\\.ssh\\id_rsa', WHITELIST, ENV)).toBe(
      false,
    );
    expect(isPathAllowed('C:\\Windows\\win.ini', WHITELIST, ENV)).toBe(false);
  });

  it('liste vide : tout passe ; entrée vide : rien ne passe par elle', () => {
    expect(isPathAllowed('C:\\Windows\\win.ini', [], ENV)).toBe(true);
    expect(isPathAllowed('C:\\Windows\\win.ini', [''], ENV)).toBe(false);
  });
});
