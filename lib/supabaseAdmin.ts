// lib/supabaseAdmin.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js";
let admin: SupabaseClient | null = null;
export function getSupabaseAdmin(): SupabaseClient {
  if (!admin) {
    admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  }
  return admin;
}

// Vérifie l'utilisateur connecté et renvoie {user, roles} ou null.
export async function verifierRoles(access_token?: string, rolesRequis: string[] = []) {
  if (!access_token) return null;
  const sb = getSupabaseAdmin();
  const { data: u } = await sb.auth.getUser(access_token);
  if (!u?.user) return null;
  const { data: prof } = await sb.from("profiles").select("nom_complet, roles").eq("id", u.user.id).single();
  const roles: string[] = prof?.roles ?? [];
  if (rolesRequis.length > 0 && !rolesRequis.some((r) => roles.includes(r))) return null;
  return { user: u.user, roles, nom: prof?.nom_complet ?? "" };
}
