// app/api/caisse/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierRoles } from "../../../lib/supabaseAdmin";
import { envoyerMail } from "../../../lib/mailer";

const ROLES_SAISIE = ["secretaire", "benevole", "admin", "comptable"];
const GMAIL = process.env.GMAIL_USER!;

function fr(s: string) { const [a, m, j] = s.split("-"); return `${j}/${m}/${a}`; }
function eur(n: number) { return n.toFixed(2).replace(".", ",") + " €"; }

export async function POST(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();
    const { access_token, action } = body;
    const auth = await verifierRoles(access_token, ROLES_SAISIE);
    if (!auth) return NextResponse.json({ ok: false, error: "Accès non autorisé." }, { status: 403 });

    const estComptableOuAdmin = auth.roles.includes("comptable") || auth.roles.includes("admin");

    if (action === "charger_journee") {
      const { date_caisse } = body;
      if (!date_caisse) return NextResponse.json({ ok: false, error: "Date manquante." }, { status: 400 });
      let { data: journee } = await sb.from("caisse_journees").select("*").eq("date_caisse", date_caisse).single();
      if (!journee) {
        const { data: nouvelle, error } = await sb.from("caisse_journees")
          .insert({ date_caisse, cree_par: auth.user.id }).select("*").single();
        if (error) throw error;
        journee = nouvelle;
      }
      const { data: lignes } = await sb.from("caisse_lignes").select("*").eq("journee_id", journee.id).order("cree_le");
      return NextResponse.json({ ok: true, journee, lignes: lignes ?? [], peutModifier: journee.statut === "ouverte" || estComptableOuAdmin });
    }

    if (action === "ajouter_ligne") {
      const { journee_id, ligne } = body;
      const { data: j } = await sb.from("caisse_journees").select("statut").eq("id", journee_id).single();
      if (!j) return NextResponse.json({ ok: false, error: "Journée introuvable." }, { status: 404 });
      if (j.statut === "soumise" && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée déjà soumise : modification réservée au comptable." }, { status: 403 });
      }
      if (!ligne.payeur_nom?.trim() || !ligne.montant || !ligne.type) {
        return NextResponse.json({ ok: false, error: "Type, montant et payeur obligatoires." }, { status: 400 });
      }
      const { error } = await sb.from("caisse_lignes").insert({
        journee_id, type: ligne.type, categorie: ligne.categorie || null,
        montant: Number(ligne.montant), moyen: ligne.moyen || null,
        num_cheque: ligne.moyen === "cheque" ? (ligne.num_cheque || null) : null,
        payeur_nom: ligne.payeur_nom.trim(), commentaire: ligne.commentaire || null,
        justificatif_url: ligne.justificatif_url || null, cree_par: auth.user.id,
      });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "modifier_ligne") {
      const { ligne_id, ligne } = body;
      const { data: l } = await sb.from("caisse_lignes").select("journee_id").eq("id", ligne_id).single();
      if (!l) return NextResponse.json({ ok: false, error: "Ligne introuvable." }, { status: 404 });
      const { data: j } = await sb.from("caisse_journees").select("statut").eq("id", l.journee_id).single();
      if (j?.statut === "soumise" && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée soumise : modification réservée au comptable." }, { status: 403 });
      }
      const { error } = await sb.from("caisse_lignes").update({
        type: ligne.type, categorie: ligne.categorie || null, montant: Number(ligne.montant),
        moyen: ligne.moyen || null, num_cheque: ligne.moyen === "cheque" ? (ligne.num_cheque || null) : null,
        payeur_nom: ligne.payeur_nom?.trim(), commentaire: ligne.commentaire || null,
        justificatif_url: ligne.justificatif_url ?? null,
        modifie_par: auth.user.id, modifie_le: new Date().toISOString(),
      }).eq("id", ligne_id);
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }

    if (action === "supprimer_ligne") {
      const { ligne_id } = body;
      const { data: l } = await sb.from("caisse_lignes").select("journee_id").eq("id", ligne_id).single();
      if (!l) return NextResponse.json({ ok: false, error: "Ligne introuvable." }, { status: 404 });
      const { data: j } = await sb.from("caisse_journees").select("statut").eq("id", l.journee_id).single();
      if (j?.statut === "soumise" && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée soumise : suppression réservée au comptable." }, { status: 403 });
      }
      await sb.from("caisse_lignes").delete().eq("id", ligne_id);
      return NextResponse.json({ ok: true });
    }

    if (action === "soumettre") {
      const { journee_id } = body;
      const { data: journee } = await sb.from("caisse_journees").select("*").eq("id", journee_id).single();
      if (!journee) return NextResponse.json({ ok: false, error: "Journée introuvable." }, { status: 404 });
      if (journee.statut === "soumise") return NextResponse.json({ ok: false, error: "Journée déjà soumise." }, { status: 400 });
      const { data: lignes } = await sb.from("caisse_lignes").select("*").eq("journee_id", journee_id).order("cree_le");
      if (!lignes || lignes.length === 0) return NextResponse.json({ ok: false, error: "Aucune ligne à soumettre." }, { status: 400 });

      const pdfBuffer = await genererPDF(journee, lignes);

      const dest = new Set<string>([GMAIL]);
      const { data: cpae } = await sb.from("membres_cpae").select("email").eq("actif", true);
      (cpae ?? []).forEach((c: any) => c.email && dest.add(c.email));
      const { data: admins } = await sb.from("profiles").select("email").contains("roles", ["admin"]);
      (admins ?? []).forEach((a: any) => a.email && dest.add(a.email));

      await envoyerMail({
        to: Array.from(dest),
        subject: `Caisse du ${fr(journee.date_caisse)} — récapitulatif`,
        html: `<div style="font-family:Arial,sans-serif"><h2>Caisse du ${fr(journee.date_caisse)}</h2>
          <p>La caisse du jour a été soumise par ${auth.nom}. Le récapitulatif est en pièce jointe (PDF).</p></div>`,
        attachments: [{ filename: `caisse-${journee.date_caisse}.pdf`, content: pdfBuffer }],
      });

      await sb.from("caisse_journees").update({
        statut: "soumise", soumise_par: auth.user.id, soumise_le: new Date().toISOString(),
      }).eq("id", journee_id);

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "Action inconnue." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function genererPDF(journee: any, lignes: any[]): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Caisse du jour — Paroisse Notre Dame du Bon Secours", { align: "center" });
    doc.moveDown(0.3);
    doc.fontSize(13).fillColor("#555").text(`Journée du ${fr(journee.date_caisse)}`, { align: "center" });
    doc.moveDown();

    const entrees = lignes.filter((l) => l.type === "entree");
    const sorties = lignes.filter((l) => l.type === "sortie");
    const totalE = entrees.reduce((s, l) => s + Number(l.montant), 0);
    const totalS = sorties.reduce((s, l) => s + Number(l.montant), 0);

    doc.fillColor("#000").fontSize(13).text("Détail des opérations", { underline: true });
    doc.moveDown(0.3);
    doc.fontSize(9);
    lignes.forEach((l) => {
      const signe = l.type === "entree" ? "+" : "−";
      const ligneTxt = `${signe} ${eur(Number(l.montant))}  |  ${l.categorie || "—"}  |  ${l.moyen || "—"}${l.num_cheque ? " n°" + l.num_cheque : ""}  |  ${l.payeur_nom}${l.commentaire ? "  |  " + l.commentaire : ""}${l.justificatif_url ? "  | [justif.]" : ""}`;
      doc.fillColor(l.type === "entree" ? "#15803d" : "#b91c1c").text(ligneTxt);
    });
    doc.moveDown();

    doc.fillColor("#000").fontSize(12).text(`Total entrées : ${eur(totalE)}`);
    doc.text(`Total sorties : ${eur(totalS)}`);
    doc.font("Helvetica-Bold").text(`Solde du jour : ${eur(totalE - totalS)}`).font("Helvetica");
    doc.moveDown();

    doc.fontSize(13).text("Récapitulatif par moyen de paiement", { underline: true });
    doc.moveDown(0.3).fontSize(10);
    const moyens = ["especes", "cheque", "virement", "carte"];
    const libMoyen: any = { especes: "Espèces", cheque: "Chèques", virement: "Virements", carte: "Carte" };
    moyens.forEach((m) => {
      const concernees = lignes.filter((l) => l.moyen === m);
      const nb = concernees.length;
      const tot = concernees.reduce((s, l) => s + Number(l.montant), 0);
      doc.text(`${libMoyen[m]} : ${nb} opération(s) — ${eur(tot)}`);
    });

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999").text(`Document généré le ${new Date().toLocaleString("fr-FR")} — Alexandre FAMARE © 2026`, { align: "center" });
    doc.end();
  });
}
