import { describe, expect, it } from 'vitest';
import { figuresNotice, findUnsourcedFigures, readings } from './numberCheck';

const market = JSON.stringify({
  symbol: 'AAPL',
  price: 187.4523,
  change: -2.31,
  changePercent: -1.2183,
  volume: 51234567,
  url: 'https://finance.example.com/quote/AAPL',
});

describe('readings', () => {
  it('lit les écritures françaises et anglaises', () => {
    expect(readings('12,5')).toEqual([{ value: 12.5, decimals: 1 }]);
    expect(readings('1 234,56')).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(readings('1,234.56')).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(readings('1.234,56')).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(readings('1.234.567')).toEqual([{ value: 1234567, decimals: 0 }]);
    expect(readings('−3')).toEqual([{ value: -3, decimals: 0 }]);
  });

  it('lit les milliers séparés par une espace insécable ou insécable fine', () => {
    const nbsp = String.fromCharCode(0xa0);
    const thin = String.fromCharCode(0x202f);
    expect(readings(`1${nbsp}234,56`)).toEqual([{ value: 1234.56, decimals: 2 }]);
    expect(
      findUnsourcedFigures(`Le CAC 40 est à 7${thin}412,35 points.`, ['{"value":7412.35}']),
    ).toEqual([]);
  });

  it('garde les deux lectures quand une virgule précède 3 chiffres', () => {
    expect(readings('1,234')).toEqual([
      { value: 1.234, decimals: 3 },
      { value: 1234, decimals: 0 },
    ]);
  });
});

describe('findUnsourcedFigures', () => {
  it('accepte un cours arrondi et une variation sans signe (valeur absolue)', () => {
    expect(
      findUnsourcedFigures("L'action Apple vaut 187,45 $, en baisse de 1,2 % (2,31 $).", [market]),
    ).toEqual([]);
  });

  it('accepte un arrondi à l’entier et une échelle en millions', () => {
    expect(
      findUnsourcedFigures('Environ 187 $, et 51,2 millions de titres échangés.', [market]),
    ).toEqual([]);
  });

  it('signale un cours inventé et un pourcentage faux', () => {
    expect(findUnsourcedFigures('Apple vaut 192,10 $ (+3,4 %).', [market])).toEqual([
      '192,10 $',
      '+3,4 %',
    ]);
  });

  it('accepte un pourcentage donné en fraction par la source', () => {
    expect(findUnsourcedFigures('Taux de 12,3 %.', ['{"rate":0.123}'])).toEqual([]);
  });

  it('ignore les comptes, jours, heures et années', () => {
    expect(
      findUnsourcedFigures('3 articles en parlent depuis le 12 novembre 2026, à 14h30.', [market]),
    ).toEqual([]);
  });

  it('ignore les années, même anciennes, mais pas un montant de quatre chiffres (banc : none-germinal)', () => {
    expect(
      findUnsourcedFigures('La Joconde, peinte de 1503 à 1519 ; Germinal paraît en 1885.', ['']),
    ).toEqual([]);
    expect(findUnsourcedFigures('Prix : 1885 €.', [''])).toEqual(['1885 €']);
  });

  it('accepte une échelle écrite de la même façon dans la source (banc : h-rech-journaux)', () => {
    const source = JSON.stringify({ title: 'Mistral boucle une levée de 1,2 Md€' });
    expect(findUnsourcedFigures('Mistral a levé 1,2 Md€.', [source])).toEqual([]);
    expect(findUnsourcedFigures('Une levée de 1,2 milliard.', ['{"amount":1200000000}'])).toEqual(
      [],
    );
  });

  it('compte la demande parmi les sources', () => {
    expect(
      findUnsourcedFigures('Ton budget de 1 500 € est suffisant.', ['', 'budget 1500 €']),
    ).toEqual([]);
  });

  it('signale un lien et un e-mail absents des sources, accepte ceux qui y sont', () => {
    expect(
      findUnsourcedFigures(
        'Voir https://finance.example.com/quote/AAPL. Ou https://faux.example.org/x, contact@faux.fr.',
        [market],
      ),
    ).toEqual(['https://faux.example.org/x', 'contact@faux.fr']);
  });

  it('ne lit pas les chiffres collés à un mot (versions, ordinaux)', () => {
    expect(findUnsourcedFigures('Le 1er modèle, qwen3.5, sort en v2.', [''])).toEqual([]);
  });
});

describe('figuresNotice', () => {
  it('liste au plus trois données', () => {
    expect(figuresNotice(['192,10 $'])).toBe(
      '(Vérification : « 192,10 $ » ne figure pas dans les sources consultées, à vérifier.)',
    );
    expect(figuresNotice(['1 €', '2 €', '3 €', '4 €', '5 €'])).toBe(
      '(Vérification : « 1 € », « 2 € » et « 3 € » (et 2 autres) ne figurent pas dans les sources consultées, à vérifier.)',
    );
  });
});
