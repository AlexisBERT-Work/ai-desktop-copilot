import { useEffect, useState, type RefObject } from 'react';

/**
 * Renvoie l'id de la section active — la première, dans l'ordre fourni, qui
 * intersecte la bande de lecture du conteneur scrollable.
 *
 * `ids` doit être stable (constante de module) : c'est une dépendance de
 * l'effet, un tableau recréé à chaque rendu rebrancherait l'observateur en
 * boucle.
 */
export function useScrollSpy(
  ids: readonly string[],
  rootRef: RefObject<HTMLElement | null>,
): string {
  const [active, setActive] = useState(ids[0] ?? '');

  useEffect(() => {
    const root = rootRef.current;
    // Pas d'observateur (environnement de test, moteur ancien) : le sommaire
    // reste utilisable, il ne suit simplement pas la lecture.
    if (root === null || typeof IntersectionObserver === 'undefined') return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = ids.find(id => visible.has(id));
        if (first !== undefined) setActive(first);
      },
      // Bande étroite en haut du conteneur : la section « active » est celle
      // qu'on est en train de lire, pas celle qui dépasse en bas de l'écran.
      { root, rootMargin: '-12% 0px -70% 0px' },
    );

    for (const id of ids) {
      const el = document.getElementById(id);
      if (el !== null) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids, rootRef]);

  return active;
}
