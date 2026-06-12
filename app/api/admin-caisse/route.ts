// app/api/admin-caisse/route.ts — gestion catégories & moyens de paiement de la caisse
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierAdmin } from "../../../lib/supabaseAdmin";

function genererCode(libelle: string): string {
  return libelle.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "moyen";
}

export async function POST(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();
    const { access_token, action } = body;

    const admin = await verifierAdmin(access_token);
    if (!admin) return NextResponse.json({ ok: false, error: "Accès réservé aux administrateurs." }, { status: 403 });

    if (action === "tout_charger") {
      const { data: categories } = await sb.from("caisse_categories").select("*").order("ordre");
      const { data: moyens } = await sb.from("caisse_moyens").select("*").order("ordre");
      return NextResponse.json({ ok: true, categories: categories ?? [], moyens: moyens ?? [] });
    }

    // ===== CATÉGORIES =====
    if (action === "cat_ajouter") {
      const { libelle } = body;
      if (!libelle?.trim()) return NextResponse.json({ ok: false, error: "Libellé obligatoire." }, { status: 400 });
      const { data: max } = await sb.from("caisse_categories").select("ordre").order("ordre", { ascending: false }).limit(1).single();
      const ordre = (max?.ordre ?? 0) + 1;
      const { error } = await sb.from("caisse_categories").insert({ libelle: libelle.trim(), actif: true, ordre });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "cat_renommer") {
      const { id, libelle } = body;
      if (!libelle?.trim()) return NextResponse.json({ ok: false, error: "Libellé obligatoire." }, { status: 400 });
      const { error } = await sb.from("caisse_categories").update({ libelle: libelle.trim() }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "cat_actif") {
      const { id, actif } = body;
      const { error } = await sb.from("caisse_categories").update({ actif }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "cat_deplacer") {
      const { id, sens } = body;
      const { data: toutes } = await sb.from("caisse_categories").select("*").order("ordre");
      const liste = toutes ?? [];
      const idx = liste.findIndex((c) => c.id === id);
      if (idx === -1) return NextResponse.json({ ok: false, error: "Catégorie introuvable." }, { status: 404 });
      const cible = sens === "haut" ? idx - 1 : idx + 1;
      if (cible < 0 || cible >= liste.length) return NextResponse.json({ ok: true });
      const a = liste[idx], b = liste[cible];
      await sb.from("caisse_categories").update({ ordre: b.ordre }).eq("id", a.id);
      await sb.from("caisse_categories").update({ ordre: a.ordre }).eq("id", b.id);
      return NextResponse.json({ ok: true });
    }

    // ===== MOYENS DE PAIEMENT =====
    if (action === "moy_ajouter") {
      const { libelle } = body;
      if (!libelle?.trim()) return NextResponse.json({ ok: false, error: "Libellé obligatoire." }, { status: 400 });
      let code = genererCode(libelle);
      const { data: existants } = await sb.from("caisse_moyens").select("code");
      const codes = new Set((existants ?? []).map((m) => m.code));
      if (codes.has(code)) { let i = 2; while (codes.has(`${code}_${i}`)) i++; code = `${code}_${i}`; }
      const { data: max } = await sb.from("caisse_moyens").select("ordre").order("ordre", { ascending: false }).limit(1).single();
      const ordre = (max?.ordre ?? 0) + 1;
      const { error } = await sb.from("caisse_moyens").insert({ code, libelle: libelle.trim(), actif: true, ordre });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "moy_renommer") {
      const { id, libelle } = body;
      if (!libelle?.trim()) return NextResponse.json({ ok: false, error: "Libellé obligatoire." }, { status: 400 });
      const { error } = await sb.from("caisse_moyens").update({ libelle: libelle.trim() }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (action === "moy_actif") {
      const { id, actif } = body;
      const { error } = await sb.from("caisse_moyens").update({ actif }).eq("id", id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Action inconnue." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
