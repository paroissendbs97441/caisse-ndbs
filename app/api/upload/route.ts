// app/api/upload/route.ts — upload du justificatif vers Supabase Storage
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierRoles } from "../../../lib/supabaseAdmin";

const ROLES_SAISIE = ["secretaire", "benevole", "admin", "comptable"];

export async function POST(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const form = await req.formData();
    const access_token = form.get("access_token") as string;
    const file = form.get("file") as File;
    const date_caisse = (form.get("date_caisse") as string) || "";

    const auth = await verifierRoles(access_token, ROLES_SAISIE);
    if (!auth) return NextResponse.json({ ok: false, error: "Accès non autorisé." }, { status: 403 });
    if (!file) return NextResponse.json({ ok: false, error: "Aucun fichier." }, { status: 400 });

    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const chemin = `caisse-${date_caisse || "sansdate"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error } = await sb.storage.from("justificatifs").upload(chemin, bytes, {
      contentType: file.type || "application/octet-stream", upsert: false,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, chemin });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
