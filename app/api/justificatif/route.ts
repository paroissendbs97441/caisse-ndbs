// app/api/justificatif/route.ts — sert un justificatif depuis Drive (via le serveur)
import { NextResponse } from "next/server";
import { verifierRoles } from "../../../lib/supabaseAdmin";
import { contenuDrive } from "../../../lib/drive";

const ROLES_OK = ["secretaire", "benevole", "admin", "comptable", "cure", "diacre"];

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const access_token = searchParams.get("t") || "";
    const chemin = searchParams.get("c") || "";
    const auth = await verifierRoles(access_token, ROLES_OK);
    if (!auth) return new NextResponse("Accès non autorisé", { status: 403 });

    const fileId = chemin.startsWith("drive:") ? chemin.slice(6) : chemin;
    const { data, mimeType, nom } = await contenuDrive(fileId);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${nom}"`,
      },
    });
  } catch (e: any) {
    return new NextResponse("Erreur : " + e.message, { status: 500 });
  }
}
