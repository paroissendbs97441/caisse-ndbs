// app/api/export/route.ts — exports PDF / Excel pour l'espace comptable
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierRoles } from "../../../lib/supabaseAdmin";

const ROLES_OK = ["comptable", "admin", "cure", "diacre"];

function fr(s: string) { const [a, m, j] = s.split("-"); return `${j}/${m}/${a}`; }
function eur(n: number) { return Number(n).toFixed(2).replace(".", ",") + " €"; }
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const libMoyenMap: any = { especes: "Espèces", cheque: "Chèque", virement: "Virement", carte: "Carte" };

export async function POST(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();
    const { access_token, format, perimetre } = body;
    const auth = await verifierRoles(access_token, ROLES_OK);
    if (!auth) return NextResponse.json({ ok: false, error: "Accès réservé." }, { status: 403 });

    const { data: toutes } = await sb.from("caisse_journees").select("*").order("date_caisse");
    let journees = toutes ?? [];
    let titrePeriode = "";

    if (perimetre.type === "mois") {
      const pref = `${perimetre.annee}-${perimetre.mois}`;
      journees = journees.filter((j) => j.date_caisse.startsWith(pref));
      titrePeriode = `${MOIS[Number(perimetre.mois) - 1]} ${perimetre.annee}`;
    } else if (perimetre.type === "journee") {
      journees = journees.filter((j) => j.id === perimetre.journee_id);
      titrePeriode = journees[0] ? `Journée du ${fr(journees[0].date_caisse)}` : "Journée";
    } else if (perimetre.type === "periode") {
      if (perimetre.annee) journees = journees.filter((j) => j.date_caisse.startsWith(perimetre.annee));
      if (perimetre.mois) journees = journees.filter((j) => j.date_caisse.slice(5, 7) === perimetre.mois);
      const parts = [];
      if (perimetre.mois) parts.push(MOIS[Number(perimetre.mois) - 1]);
      if (perimetre.annee) parts.push(perimetre.annee);
      titrePeriode = parts.length ? parts.join(" ") : "Toutes les journées";
    }

    const ids = journees.map((j) => j.id);
    let lignes: any[] = [];
    if (ids.length > 0) {
      const { data } = await sb.from("caisse_lignes").select("*").in("journee_id", ids).order("cree_le");
      lignes = data ?? [];
    }
    const dateParJournee: Record<string, string> = {};
    journees.forEach((j) => { dateParJournee[j.id] = j.date_caisse; });
    lignes.forEach((l) => { l._date = dateParJournee[l.journee_id] || ""; });
    lignes.sort((a, b) => (a._date < b._date ? -1 : a._date > b._date ? 1 : 0));

    const totalE = lignes.filter((l) => l.type === "entree").reduce((s, l) => s + Number(l.montant), 0);
    const totalS = lignes.filter((l) => l.type === "sortie").reduce((s, l) => s + Number(l.montant), 0);
    const parCatE: Record<string, number> = {};
    const parCatS: Record<string, number> = {};
    const parMoyen: Record<string, number> = {};
    for (const l of lignes) {
      const cat = l.categorie || "Sans catégorie";
      if (l.type === "entree") parCatE[cat] = (parCatE[cat] || 0) + Number(l.montant);
      else parCatS[cat] = (parCatS[cat] || 0) + Number(l.montant);
      const m = l.moyen || "—";
      parMoyen[m] = (parMoyen[m] || 0) + Number(l.montant);
    }

    const nomFichier = `caisse-${titrePeriode.replace(/[^a-zA-Z0-9]/g, "_")}`;

    if (format === "excel") {
      const ExcelJS = (await import("exceljs")).default;
      const wb = new ExcelJS.Workbook();
      wb.creator = "Caisse Paroisse NDBS";

      const ws = wb.addWorksheet("Détail");
      ws.columns = [
        { header: "Date", key: "date", width: 12 },
        { header: "Type", key: "type", width: 10 },
        { header: "Catégorie", key: "categorie", width: 18 },
        { header: "Montant", key: "montant", width: 12 },
        { header: "Moyen", key: "moyen", width: 12 },
        { header: "N° chèque", key: "num_cheque", width: 12 },
        { header: "Payeur", key: "payeur", width: 22 },
        { header: "Commentaire", key: "commentaire", width: 30 },
      ];
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF6FF" } };
      lignes.forEach((l) => {
        ws.addRow({
          date: fr(l._date), type: l.type === "entree" ? "Entrée" : "Sortie",
          categorie: l.categorie || "—", montant: Number(l.montant),
          moyen: libMoyenMap[l.moyen] || l.moyen || "—", num_cheque: l.num_cheque || "",
          payeur: l.payeur_nom || "", commentaire: l.commentaire || "",
        });
      });
      ws.getColumn("montant").numFmt = '#,##0.00 "€"';

      const wr = wb.addWorksheet("Récapitulatif");
      wr.addRow([`Caisse — ${titrePeriode}`]);
      wr.getRow(1).font = { bold: true, size: 14 };
      wr.addRow([]);
      wr.addRow(["Total entrées", totalE]);
      wr.addRow(["Total sorties", totalS]);
      wr.addRow(["Solde", totalE - totalS]);
      wr.addRow([]);
      wr.addRow(["Entrées par catégorie"]); wr.getRow(wr.rowCount).font = { bold: true };
      Object.entries(parCatE).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => wr.addRow([k, v]));
      wr.addRow([]);
      wr.addRow(["Dépenses par catégorie"]); wr.getRow(wr.rowCount).font = { bold: true };
      Object.entries(parCatS).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => wr.addRow([k, v]));
      wr.addRow([]);
      wr.addRow(["Par moyen de paiement"]); wr.getRow(wr.rowCount).font = { bold: true };
      Object.entries(parMoyen).forEach(([k, v]) => wr.addRow([libMoyenMap[k] || k, v]));
      wr.getColumn(2).numFmt = '#,##0.00 "€"';
      wr.getColumn(1).width = 26; wr.getColumn(2).width = 14;

      const buf = await wb.xlsx.writeBuffer();
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${nomFichier}.xlsx"`,
        },
      });
    }

    const PDFDocument = (await import("pdfkit")).default;
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(17).text("Caisse — Paroisse Notre Dame du Bon Secours", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(13).fillColor("#555").text(titrePeriode, { align: "center" });
      doc.moveDown();

      doc.fillColor("#000").fontSize(13).text("Récapitulatif", { underline: true });
      doc.moveDown(0.3).fontSize(11);
      doc.text(`Total entrées : ${eur(totalE)}`);
      doc.text(`Total sorties : ${eur(totalS)}`);
      doc.font("Helvetica-Bold").text(`Solde : ${eur(totalE - totalS)}`).font("Helvetica");
      doc.moveDown(0.5);

      doc.fontSize(12).text("Entrées par catégorie", { underline: true });
      doc.fontSize(10);
      Object.entries(parCatE).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => doc.text(`${k} : ${eur(v)}`));
      doc.moveDown(0.3);
      doc.fontSize(12).text("Dépenses par catégorie", { underline: true });
      doc.fontSize(10);
      const depCats = Object.entries(parCatS).sort((a, b) => b[1] - a[1]);
      if (depCats.length === 0) doc.text("Aucune dépense.");
      depCats.forEach(([k, v]) => doc.text(`${k} : ${eur(v)}`));
      doc.moveDown(0.3);
      doc.fontSize(12).text("Par moyen de paiement", { underline: true });
      doc.fontSize(10);
      Object.entries(parMoyen).forEach(([k, v]) => doc.text(`${libMoyenMap[k] || k} : ${eur(v)}`));
      doc.moveDown();

      doc.fontSize(13).text("Détail des opérations", { underline: true });
      doc.moveDown(0.3).fontSize(8);
      lignes.forEach((l) => {
        const signe = l.type === "entree" ? "+" : "−";
        const txt = `${fr(l._date)}  ${signe}${eur(Number(l.montant))}  |  ${l.categorie || "—"}  |  ${libMoyenMap[l.moyen] || l.moyen || "—"}${l.num_cheque ? " n°" + l.num_cheque : ""}  |  ${l.payeur_nom}${l.commentaire ? "  |  " + l.commentaire : ""}`;
        doc.fillColor(l.type === "entree" ? "#15803d" : "#b91c1c").text(txt);
      });

      doc.moveDown(2);
      doc.fontSize(8).fillColor("#999").text(`Document généré le ${new Date().toLocaleString("fr-FR")} — Alexandre FAMARE © 2026`, { align: "center" });
      doc.end();
    });

    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${nomFichier}.pdf"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
