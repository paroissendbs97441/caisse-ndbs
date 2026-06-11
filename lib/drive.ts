// lib/drive.ts — accès au Google Drive de la paroisse via compte de service
import { google } from "googleapis";
import { Readable } from "stream";

function getDrive() {
  const email = process.env.GOOGLE_SA_EMAIL!;
  // La clé privée est stockée avec des \n littéraux dans la variable d'env : on les restaure.
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  return google.drive({ version: "v3", auth });
}

// Envoie un fichier dans le dossier Drive et renvoie son ID.
export async function uploadVersDrive(nom: string, mimeType: string, contenu: Buffer): Promise<string> {
  const drive = getDrive();
  const dossier = process.env.GOOGLE_DRIVE_FOLDER_ID!;
  const res = await drive.files.create({
    requestBody: { name: nom, parents: [dossier] },
    media: { mimeType, body: Readable.from(contenu) },
    fields: "id",
  });
  return res.data.id!;
}

// Génère un lien de consultation (webViewLink) si disponible.
export async function lienDrive(fileId: string): Promise<string> {
  const drive = getDrive();
  const res = await drive.files.get({ fileId, fields: "webViewLink, webContentLink" });
  return res.data.webViewLink || res.data.webContentLink || "";
}

// Récupère le contenu d'un fichier (pour le servir via notre propre route).
export async function contenuDrive(fileId: string): Promise<{ data: Buffer; mimeType: string; nom: string }> {
  const drive = getDrive();
  const meta = await drive.files.get({ fileId, fields: "name, mimeType" });
  const res = await drive.files.get(
    { fileId, alt: "media" },
    { responseType: "arraybuffer" }
  );
  return {
    data: Buffer.from(res.data as ArrayBuffer),
    mimeType: meta.data.mimeType || "application/octet-stream",
    nom: meta.data.name || "justificatif",
  };
}
