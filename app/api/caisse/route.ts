// app/api/caisse/route.ts
import { NextResponse } from "next/server";
import { getSupabaseAdmin, verifierRoles } from "../../../lib/supabaseAdmin";
import { envoyerMail } from "../../../lib/mailer";

const ROLES_SAISIE = ["secretaire", "benevole", "admin", "comptable"];
const GMAIL = process.env.GMAIL_USER!;

function fr(s: string) { const [a, m, j] = s.split("-"); return `${j}/${m}/${a}`; }
function eur(n: number) { return Number(n).toFixed(2).replace(".", ",") + " €"; }
function horodatage() {
  return new Date().toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function decrireLigne(l: any) {
  const signe = l.type === "entree" ? "Entrée" : "Sortie";
  return `${signe} ${eur(l.montant)} — ${l.categorie || "—"} (${l.payeur_nom || "?"})`;
}

function detailChangements(av: any, ap: any): string {
  const champs: [string, string][] = [
    ["type", "Type"], ["categorie", "Catégorie"], ["montant", "Montant"],
    ["moyen", "Moyen"], ["num_cheque", "N° chèque"], ["payeur_nom", "Payeur"], ["commentaire", "Commentaire"],
  ];
  const out: string[] = [];
  for (const [k, label] of champs) {
    let avant = av[k] ?? "—";
    let apres = ap[k] ?? "—";
    if (k === "montant") { avant = eur(av[k] ?? 0); apres = eur(ap[k] ?? 0); }
    if (String(avant) !== String(apres)) out.push(`${label} : ${avant} → ${apres}`);
  }
  return out.join(" ; ");
}

export async function POST(req: Request) {
  try {
    const sb = getSupabaseAdmin();
    const body = await req.json();
    const { access_token, action } = body;

    // Actions de l'espace comptable : rôles élargis (comptable/admin/cure/diacre)
    const ACTIONS_COMPTABLE = ["comptable_journees", "comptable_detail", "comptable_dashboard"];
    if (ACTIONS_COMPTABLE.includes(action)) {
      const authC = await verifierRoles(access_token, ["comptable", "admin", "cure", "diacre"]);
      if (!authC) return NextResponse.json({ ok: false, error: "Accès réservé à l'espace comptable." }, { status: 403 });

      // Tableau de bord : synthèse d'un mois (entrées/sorties/solde + répartitions + comparaison mois précédent)
      if (action === "comptable_dashboard") {
        const { annee, mois } = body;
        async function agregatsMois(prefixe: string) {
          const { data: journees } = await sb.from("caisse_journees").select("id, date_caisse");
          const ids = (journees ?? []).filter((j) => j.date_caisse.startsWith(prefixe)).map((j) => j.id);
          let totE = 0, totS = 0;
          const catE: Record<string, number> = {};
          const catS: Record<string, number> = {};
          if (ids.length > 0) {
            const { data: lignes } = await sb.from("caisse_lignes").select("*").in("journee_id", ids);
            for (const l of lignes ?? []) {
              const cat = l.categorie || "Sans catégorie";
              if (l.type === "entree") { totE += Number(l.montant); catE[cat] = (catE[cat] || 0) + Number(l.montant); }
              else { totS += Number(l.montant); catS[cat] = (catS[cat] || 0) + Number(l.montant); }
            }
          }
          const tri = (o: Record<string, number>) => Object.entries(o).map(([nom, montant]) => ({ nom, montant })).sort((a, b) => b.montant - a.montant);
          return { totE, totS, solde: totE - totS, nbJournees: ids.length, categoriesE: tri(catE), categoriesS: tri(catS) };
        }
        const actuel = await agregatsMois(`${annee}-${mois}`);
        let pAn = Number(annee), pMo = Number(mois) - 1;
        if (pMo === 0) { pMo = 12; pAn -= 1; }
        const prefixePrec = `${pAn}-${String(pMo).padStart(2, "0")}`;
        const precedent = await agregatsMois(prefixePrec);
        return NextResponse.json({
          ok: true,
          totalE: actuel.totE, totalS: actuel.totS, solde: actuel.solde, nbJournees: actuel.nbJournees,
          categoriesE: actuel.categoriesE, categoriesS: actuel.categoriesS,
          soldePrecedent: precedent.solde, moisPrecedentLabel: prefixePrec,
        });
      }

      if (action === "comptable_journees") {
        const { annee, mois, recherche } = body;
        const { data: journees } = await sb.from("caisse_journees").select("*").order("date_caisse", { ascending: false });
        const resultat: any[] = [];
        for (const j of journees ?? []) {
          if (annee && !j.date_caisse.startsWith(annee)) continue;
          if (mois && j.date_caisse.slice(5, 7) !== mois) continue;
          const { data: lignes } = await sb.from("caisse_lignes").select("*").eq("journee_id", j.id);
          let totalE = 0, totalS = 0;
          let matchRecherche = !recherche;
          for (const l of lignes ?? []) {
            if (l.type === "entree") totalE += Number(l.montant); else totalS += Number(l.montant);
            if (recherche) {
              const r = recherche.toLowerCase();
              if ((l.payeur_nom || "").toLowerCase().includes(r) || (l.categorie || "").toLowerCase().includes(r)) matchRecherche = true;
            }
          }
          if (!matchRecherche) continue;
          resultat.push({ id: j.id, date_caisse: j.date_caisse, statut: j.statut, totalE, totalS, solde: totalE - totalS, nbLignes: (lignes ?? []).length });
        }
        return NextResponse.json({ ok: true, journees: resultat });
      }

      if (action === "comptable_detail") {
        const { journee_id } = body;
        const { data: lignes } = await sb.from("caisse_lignes").select("*").eq("journee_id", journee_id).order("cree_le");
        return NextResponse.json({ ok: true, lignes: lignes ?? [] });
      }
    }

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
      const { data: modifs } = await sb.from("caisse_modifications").select("id").eq("journee_id", journee.id).eq("notifie", false);
      const correctifsEnAttente = (modifs ?? []).length;
      return NextResponse.json({
        ok: true, journee, lignes: lignes ?? [],
        peutModifier: journee.statut === "ouverte" || estComptableOuAdmin,
        estComptableOuAdmin, correctifsEnAttente,
      });
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
      const nouvelleLigne = {
        journee_id, type: ligne.type, categorie: ligne.categorie || null,
        montant: Number(ligne.montant), moyen: ligne.moyen || null,
        num_cheque: ligne.moyen === "cheque" ? (ligne.num_cheque || null) : null,
        payeur_nom: ligne.payeur_nom.trim(), commentaire: ligne.commentaire || null,
        justificatif_url: ligne.justificatif_url || null, cree_par: auth.user.id,
      };
      const { error } = await sb.from("caisse_lignes").insert(nouvelleLigne);
      if (error) throw error;
      if (j.statut === "soumise") {
        await sb.from("caisse_modifications").insert({
          journee_id, type_action: "ajout", ligne_desc: decrireLigne(nouvelleLigne),
          details: "Nouvelle ligne ajoutée", auteur: auth.nom,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "modifier_ligne") {
      const { ligne_id, ligne } = body;
      const { data: avant } = await sb.from("caisse_lignes").select("*").eq("id", ligne_id).single();
      if (!avant) return NextResponse.json({ ok: false, error: "Ligne introuvable." }, { status: 404 });
      const { data: j } = await sb.from("caisse_journees").select("statut").eq("id", avant.journee_id).single();
      if (j?.statut === "soumise" && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée soumise : modification réservée au comptable." }, { status: 403 });
      }
      const apres = {
        type: ligne.type, categorie: ligne.categorie || null, montant: Number(ligne.montant),
        moyen: ligne.moyen || null, num_cheque: ligne.moyen === "cheque" ? (ligne.num_cheque || null) : null,
        payeur_nom: ligne.payeur_nom?.trim(), commentaire: ligne.commentaire || null,
        justificatif_url: ligne.justificatif_url ?? null,
        modifie_par: auth.user.id, modifie_le: new Date().toISOString(),
      };
      const { error } = await sb.from("caisse_lignes").update(apres).eq("id", ligne_id);
      if (error) throw error;
      if (j?.statut === "soumise") {
        const det = detailChangements(avant, apres);
        if (det) {
          await sb.from("caisse_modifications").insert({
            journee_id: avant.journee_id, type_action: "modification",
            ligne_desc: decrireLigne(avant), details: det, auteur: auth.nom,
          });
        }
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "supprimer_ligne") {
      const { ligne_id } = body;
      const { data: avant } = await sb.from("caisse_lignes").select("*").eq("id", ligne_id).single();
      if (!avant) return NextResponse.json({ ok: false, error: "Ligne introuvable." }, { status: 404 });
      const { data: j } = await sb.from("caisse_journees").select("statut").eq("id", avant.journee_id).single();
      if (j?.statut === "soumise" && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée soumise : suppression réservée au comptable." }, { status: 403 });
      }
      await sb.from("caisse_lignes").delete().eq("id", ligne_id);
      if (j?.statut === "soumise") {
        await sb.from("caisse_modifications").insert({
          journee_id: avant.journee_id, type_action: "suppression",
          ligne_desc: decrireLigne(avant), details: "Ligne supprimée", auteur: auth.nom,
        });
      }
      return NextResponse.json({ ok: true });
    }

    if (action === "soumettre") {
      const { journee_id } = body;
      const { data: journee } = await sb.from("caisse_journees").select("*").eq("id", journee_id).single();
      if (!journee) return NextResponse.json({ ok: false, error: "Journée introuvable." }, { status: 404 });

      const premiereSoumission = journee.statut !== "soumise";
      if (!premiereSoumission && !estComptableOuAdmin) {
        return NextResponse.json({ ok: false, error: "Journée déjà soumise." }, { status: 400 });
      }

      const { data: lignes } = await sb.from("caisse_lignes").select("*").eq("journee_id", journee_id).order("cree_le");
      if (!lignes || lignes.length === 0) return NextResponse.json({ ok: false, error: "Aucune ligne à soumettre." }, { status: 400 });

      let correctifs: any[] = [];
      if (!premiereSoumission) {
        const { data: modifs } = await sb.from("caisse_modifications")
          .select("*").eq("journee_id", journee_id).eq("notifie", false).order("fait_le");
        correctifs = modifs ?? [];
        if (correctifs.length === 0) {
          return NextResponse.json({ ok: false, error: "Aucun correctif à signaler depuis la dernière soumission." }, { status: 400 });
        }
      }

      const pdfBuffer = await genererPDF(journee, lignes, correctifs);

      const pjJustificatifs: any[] = [];
      for (const l of lignes) {
        if (l.justificatif_url) {
          try {
            const { data: dl } = await sb.storage.from("justificatifs").download(l.justificatif_url);
            if (dl) {
              const buf = Buffer.from(await dl.arrayBuffer());
              pjJustificatifs.push({ filename: l.justificatif_url, content: buf });
            }
          } catch (e) { /* justificatif illisible ignoré */ }
        }
      }

      const dest = new Set<string>([GMAIL]);
      const { data: cpae } = await sb.from("membres_cpae").select("email").eq("actif", true);
      (cpae ?? []).forEach((c: any) => c.email && dest.add(c.email));
      const { data: admins } = await sb.from("profiles").select("email").contains("roles", ["admin"]);
      (admins ?? []).forEach((a: any) => a.email && dest.add(a.email));

      let html = `<div style="font-family:Arial,sans-serif"><h2>Caisse du ${fr(journee.date_caisse)}</h2>`;
      if (premiereSoumission) {
        html += `<p>La caisse du jour a été soumise par ${auth.nom}. Le récapitulatif est en pièce jointe (PDF), ainsi que les justificatifs.</p>`;
      } else {
        html += `<p><b>Correctifs apportés</b> à la caisse du ${fr(journee.date_caisse)}, soumis par ${auth.nom} le ${horodatage()} :</p><ul>`;
        for (const c of correctifs) {
          const quand = new Date(c.fait_le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
          const libAction = c.type_action === "ajout" ? "Ajout" : c.type_action === "suppression" ? "Suppression" : "Modification";
          html += `<li><b>${libAction}</b> — ${c.ligne_desc || ""}${c.details ? ` : ${c.details}` : ""} <i>(le ${quand} par ${c.auteur || "?"})</i></li>`;
        }
        html += `</ul><p>Le récapitulatif à jour est en pièce jointe (PDF), ainsi que les justificatifs.</p>`;
      }
      html += `</div>`;

      const sujet = premiereSoumission
        ? `Caisse du ${fr(journee.date_caisse)} — récapitulatif`
        : `Caisse du ${fr(journee.date_caisse)} — CORRECTIFS`;

      await envoyerMail({
        to: Array.from(dest), subject: sujet, html,
        attachments: [{ filename: `caisse-${journee.date_caisse}.pdf`, content: pdfBuffer }, ...pjJustificatifs],
      });

      if (premiereSoumission) {
        await sb.from("caisse_journees").update({
          statut: "soumise", soumise_par: auth.user.id, soumise_le: new Date().toISOString(),
        }).eq("id", journee_id);
      } else {
        await sb.from("caisse_modifications").update({ notifie: true }).eq("journee_id", journee_id).eq("notifie", false);
        await sb.from("caisse_journees").update({ soumise_par: auth.user.id, soumise_le: new Date().toISOString() }).eq("id", journee_id);
      }

      return NextResponse.json({ ok: true, premiereSoumission });
    }

    if (action === "espace_justificatifs") {
      let total = 0; let nb = 0; let offset = 0;
      while (true) {
        const { data, error } = await sb.storage.from("justificatifs").list("", { limit: 100, offset });
        if (error) break;
        if (!data || data.length === 0) break;
        for (const f of data) {
          const taille = (f as any)?.metadata?.size ?? 0;
          total += Number(taille) || 0; nb++;
        }
        if (data.length < 100) break;
        offset += 100;
      }
      return NextResponse.json({ ok: true, octets: total, nb });
    }

    return NextResponse.json({ ok: false, error: "Action inconnue." }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

async function genererPDF(journee: any, lignes: any[], correctifs: any[] = []): Promise<Buffer> {
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

    if (correctifs && correctifs.length > 0) {
      doc.moveDown();
      doc.fillColor("#b45309").fontSize(13).text("Correctifs apportés depuis la dernière soumission", { underline: true });
      doc.moveDown(0.3).fontSize(9).fillColor("#000");
      correctifs.forEach((c) => {
        const quand = new Date(c.fait_le).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const libAction = c.type_action === "ajout" ? "Ajout" : c.type_action === "suppression" ? "Suppression" : "Modification";
        doc.text(`• ${libAction} — ${c.ligne_desc || ""}${c.details ? " : " + c.details : ""} (le ${quand} par ${c.auteur || "?"})`);
      });
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor("#999").text(`Document généré le ${new Date().toLocaleString("fr-FR")} — Alexandre FAMARE © 2026`, { align: "center" });
    doc.end();
  });
}
