import { useEffect, useState } from 'react';
import { supabase } from '../news/supabaseClient';

export interface AdminSession {
  loading: boolean;
  isAdmin: boolean;
  email: string | null;
}

/** Vrai si le claim `app_metadata.role` vaut 'admin' (posé côté serveur). */
function metaIsAdmin(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as Record<string, unknown>).role === 'admin'
  );
}

/**
 * Suit l'état d'authentification et expose si la session courante est admin.
 * L'admin = un utilisateur dont le JWT porte `app_metadata.role = 'admin'`
 * (impossible à obtenir via la clé anon ; voir supabase/DEPLOY.md §7).
 */
export function useAdminSession(): AdminSession {
  const [state, setState] = useState<AdminSession>({
    loading: true,
    isAdmin: false,
    email: null,
  });

  useEffect(() => {
    if (supabase === null) {
      setState({ loading: false, isAdmin: false, email: null });
      return;
    }
    const client = supabase;
    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      const u = data.session?.user ?? null;
      setState({ loading: false, isAdmin: metaIsAdmin(u?.app_metadata), email: u?.email ?? null });
    });

    const { data: sub } = client.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null;
      setState({ loading: false, isAdmin: metaIsAdmin(u?.app_metadata), email: u?.email ?? null });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}

/** Connexion admin par e-mail/mot de passe. */
export async function signInAdmin(email: string, password: string): Promise<{ error: string | null }> {
  if (supabase === null) return { error: 'Supabase non configuré.' };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: error?.message ?? null };
}

/**
 * Déconnexion admin : on rebascule en session anonyme pour conserver la lecture
 * (news/dailys) côté client.
 */
export async function signOutAdmin(): Promise<void> {
  if (supabase === null) return;
  await supabase.auth.signOut();
  await supabase.auth.signInAnonymously();
}
