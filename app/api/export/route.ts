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

    // ===== PDF avec vrais tableaux =====
    const PDFDocument = (await import("pdfkit")).default;
    const pdfBuffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: "A4" });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const BLEU = "#2563eb", GRIS = "#475569", VERT = "#15803d", ROUGE = "#b91c1c";
      const pageLeft = doc.page.margins.left;
      const pageRight = doc.page.width - doc.page.margins.right;
      const largeur = pageRight - pageLeft;

      // En-tête
      doc.rect(pageLeft, 40, largeur, 54).fill("#f1f5f9");
      doc.fillColor("#0f172a").fontSize(16).font("Helvetica-Bold")
        .text("Caisse — Paroisse Notre Dame du Bon Secours", pageLeft + 14, 52, { width: largeur - 28 });
      doc.fillColor(GRIS).fontSize(12).font("Helvetica")
        .text(titrePeriode, pageLeft + 14, 73, { width: largeur - 28 });
      doc.y = 110;

      // Cartes de synthèse
      const gap = 10;
      const cardW = (largeur - 2 * gap) / 3;
      const cardY = doc.y;
      const cartes = [
        { label: "Total entrées", valeur: eur(totalE), couleur: VERT },
        { label: "Total sorties", valeur: eur(totalS), couleur: ROUGE },
        { label: "Solde", valeur: eur(totalE - totalS), couleur: (totalE - totalS) >= 0 ? VERT : ROUGE },
      ];
      cartes.forEach((c, i) => {
        const x = pageLeft + i * (cardW + gap);
        doc.roundedRect(x, cardY, cardW, 50, 6).fill("#f8fafc").stroke("#e2e8f0");
        doc.fillColor(GRIS).fontSize(9).font("Helvetica").text(c.label, x + 10, cardY + 9, { width: cardW - 20 });
        doc.fillColor(c.couleur).fontSize(15).font("Helvetica-Bold").text(c.valeur, x + 10, cardY + 24, { width: cardW - 20 });
      });
      doc.y = cardY + 50 + 18;
      doc.fillColor("#000");

      function dessinerTableau(titre: string, colonnes: { libelle: string; largeur: number; align?: "left" | "right" }[], donnees: string[][]) {
        if (doc.y > doc.page.height - 120) doc.addPage();
        doc.fillColor("#0f172a").fontSize(12).font("Helvetica-Bold").text(titre, pageLeft, doc.y);
        doc.moveDown(0.3);
        let y = doc.y;
        const hauteurLigne = 18;
        const totalLarg = colonnes.reduce((s, c) => s + c.largeur, 0);

        doc.rect(pageLeft, y, totalLarg, hauteurLigne).fill(BLEU);
        let x = pageLeft;
        doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
        colonnes.forEach((col) => {
          doc.text(col.libelle, x + 5, y + 5, { width: col.largeur - 10, align: col.align || "left" });
          x += col.largeur;
        });
        y += hauteurLigne;

        doc.font("Helvetica").fontSize(9);
        donnees.forEach((ligne, idx) => {
          if (y > doc.page.height - 60) {
            doc.addPage();
            y = doc.page.margins.top;
            doc.rect(pageLeft, y, totalLarg, hauteurLigne).fill(BLEU);
            let xh = pageLeft;
            doc.fillColor("#fff").fontSize(9).font("Helvetica-Bold");
            colonnes.forEach((col) => {
              doc.text(col.libelle, xh + 5, y + 5, { width: col.largeur - 10, align: col.align || "left" });
              xh += col.largeur;
            });
            y += hauteurLigne;
            doc.font("Helvetica").fontSize(9);
          }
          if (idx % 2 === 0) doc.rect(pageLeft, y, totalLarg, hauteurLigne).fill("#f8fafc");
          let xc = pageLeft;
          doc.fillColor("#1e293b");
          ligne.forEach((cell, ci) => {
            doc.text(cell, xc + 5, y + 5, { width: colonnes[ci].largeur - 10, align: colonnes[ci].align || "left", lineBreak: false });
            xc += colonnes[ci].largeur;
          });
          y += hauteurLigne;
        });
        doc.y = y + 12;
        doc.fillColor("#000");
      }

      const lignesCatE = Object.entries(parCatE).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, eur(v)]);
      if (lignesCatE.length === 0) lignesCatE.push(["Aucune entrée", ""]);
      dessinerTableau("Entrées par catégorie",
        [{ libelle: "Catégorie", largeur: largeur * 0.6 }, { libelle: "Montant", largeur: largeur * 0.4, align: "right" }],
        lignesCatE);

      const lignesCatS = Object.entries(parCatS).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, eur(v)]);
      if (lignesCatS.length === 0) lignesCatS.push(["Aucune dépense", ""]);
      dessinerTableau("Dépenses par catégorie",
        [{ libelle: "Catégorie", largeur: largeur * 0.6 }, { libelle: "Montant", largeur: largeur * 0.4, align: "right" }],
        lignesCatS);

      const lignesMoyen = Object.entries(parMoyen).map(([k, v]) => [libMoyenMap[k] || k, eur(v)]);
      if (lignesMoyen.length === 0) lignesMoyen.push(["—", ""]);
      dessinerTableau("Par moyen de paiement",
        [{ libelle: "Moyen", largeur: largeur * 0.6 }, { libelle: "Montant", largeur: largeur * 0.4, align: "right" }],
        lignesMoyen);

      const lignesDetail = lignes.map((l) => [
        fr(l._date),
        l.type === "entree" ? "Entrée" : "Sortie",
        l.categorie || "—",
        (l.type === "entree" ? "+" : "-") + eur(Number(l.montant)),
        (libMoyenMap[l.moyen] || l.moyen || "—") + (l.num_cheque ? ` n°${l.num_cheque}` : ""),
        l.payeur_nom || "",
      ]);
      if (lignesDetail.length === 0) lignesDetail.push(["—", "—", "—", "—", "—", "—"]);
      dessinerTableau("Détail des opérations",
        [
          { libelle: "Date", largeur: largeur * 0.12 },
          { libelle: "Type", largeur: largeur * 0.11 },
          { libelle: "Catégorie", largeur: largeur * 0.2 },
          { libelle: "Montant", largeur: largeur * 0.16, align: "right" },
          { libelle: "Moyen", largeur: largeur * 0.18 },
          { libelle: "Payeur", largeur: largeur * 0.23 },
        ],
        lignesDetail);

      if (doc.y > doc.page.height - 50) doc.addPage();
      doc.fontSize(8).fillColor("#94a3b8").font("Helvetica")
        .text(`Document généré le ${new Date().toLocaleString("fr-FR")} — Alexandre FAMARE © 2026`, pageLeft, doc.page.height - 50, { width: largeur, align: "center" });
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
