// app/api/justificatif/route.ts — redirige vers une URL signée Supabase Storage
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierRoles } from "../../../lib/supabaseAdmin";

const ROLES_OK = ["secretaire", "benevole", "admin", "comptable", "cure", "diacre"];

export async function GET(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const { searchParams } = new URL(req.url);
    const access_token = searchParams.get("t") || "";
    const chemin = searchParams.get("c") || "";
    const auth = await verifierRoles(access_token, ROLES_OK);
    if (!auth) return new NextResponse("Accès non autorisé", { status: 403 });

    const { data, error } = await sb.storage.from("justificatifs").createSignedUrl(chemin, 3600);
    if (error || !data) return new NextResponse("Justificatif introuvable", { status: 404 });
    return NextResponse.redirect(data.signedUrl);
  } catch (e: any) {
    return new NextResponse("Erreur : " + e.message, { status: 500 });
  }
}
