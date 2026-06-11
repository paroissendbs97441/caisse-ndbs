// app/api/upload/route.ts — upload du justificatif vers Google Drive
import { NextResponse } from "next/server";
import { verifierRoles } from "../../../lib/supabaseAdmin";
import { uploadVersDrive } from "../../../lib/drive";

const ROLES_SAISIE = ["secretaire", "benevole", "admin", "comptable"];

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const access_token = form.get("access_token") as string;
    const file = form.get("file") as File;
    const date_caisse = (form.get("date_caisse") as string) || "";

    const auth = await verifierRoles(access_token, ROLES_SAISIE);
    if (!auth) return NextResponse.json({ ok: false, error: "Accès non autorisé." }, { status: 403 });
    if (!file) return NextResponse.json({ ok: false, error: "Aucun fichier." }, { status: 400 });

    const ext = (file.name.split(".").pop() || "bin").toLowerCase();
    const nom = `caisse-${date_caisse || "sansdate"}-${Date.now()}.${ext}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const fileId = await uploadVersDrive(nom, file.type || "application/octet-stream", bytes);
    return NextResponse.json({ ok: true, chemin: `drive:${fileId}` });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
