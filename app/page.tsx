// app/page.tsx — Entrée caisse du jour
"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";

const ROLES_OK = ["secretaire", "benevole", "admin", "comptable"];

export default function Caisse() {
  const [token, setToken] = useState("");
  const [autorise, setAutorise] = useState<boolean | null>(null);
  const [profil, setProfil] = useState<any>(null);
  const [dateCaisse, setDateCaisse] = useState(new Date().toISOString().slice(0, 10));
  const [journee, setJournee] = useState<any>(null);
  const [lignes, setLignes] = useState<any[]>([]);
  const [peutModifier, setPeutModifier] = useState(true);
  const [categories, setCategories] = useState<any[]>([]);
  const [moyens, setMoyens] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const [enCours, setEnCours] = useState(false);
  const [rolesUser, setRolesUser] = useState<string[]>([]);
  const [espace, setEspace] = useState<{ octets: number; nb: number } | null>(null);
  const [estComptableOuAdmin, setEstComptableOuAdmin] = useState(false);
  const [correctifsEnAttente, setCorrectifsEnAttente] = useState(0);

  const ligneVide = { type: "entree", categorie: "", montant: "", moyen: "", num_cheque: "", payeur_nom: "", commentaire: "", justificatif_url: "" };
  const [form, setForm] = useState<any>(ligneVide);
  const [fichier, setFichier] = useState<File | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      if (typeof window !== "undefined" && window.location.hash.includes("sso_at")) {
        const params = new URLSearchParams(window.location.hash.slice(1));
        const at = params.get("sso_at"); const rt = params.get("sso_rt");
        if (at && rt) {
          await getSupabase().auth.setSession({ access_token: at, refresh_token: rt });
          window.history.replaceState(null, "", window.location.pathname);
        }
      }
      const { data } = await getSupabase().auth.getUser();
      if (!data.user) { window.location.href = "/login"; return; }
      const { data: sess } = await getSupabase().auth.getSession();
      const tk = sess.session?.access_token ?? "";
      setToken(tk);
      const { data: prof } = await getSupabase().from("profiles").select("nom_complet, roles").eq("id", data.user.id).single();
      const roles: string[] = prof?.roles ?? [];
      setProfil(prof);
      setRolesUser(roles);
      if (!ROLES_OK.some((r) => roles.includes(r))) { setAutorise(false); return; }
      setAutorise(true);
      const { data: cats } = await getSupabase().from("caisse_categories").select("*").eq("actif", true).order("ordre");
      setCategories(cats ?? []);
      const { data: moys } = await getSupabase().from("caisse_moyens").select("*").eq("actif", true).order("ordre");
      setMoyens(moys ?? []);
      chargerJournee(tk, dateCaisse);
      if (roles.includes("admin") || roles.includes("comptable")) chargerEspace(tk);
    }
    init();
  }, []);

  async function chargerEspace(tk: string) {
    const r = await fetch("/api/caisse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "espace_justificatifs", access_token: tk }),
    }).then((r) => r.json()).catch(() => null);
    if (r?.ok) setEspace({ octets: r.octets, nb: r.nb });
  }

  async function chargerJournee(tk: string, date: string) {
    setMsg("");
    const r = await fetch("/api/caisse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "charger_journee", access_token: tk, date_caisse: date }),
    }).then((r) => r.json());
    if (r.ok) { setJournee(r.journee); setLignes(r.lignes); setPeutModifier(r.peutModifier); setEstComptableOuAdmin(!!r.estComptableOuAdmin); setCorrectifsEnAttente(r.correctifsEnAttente || 0); }
    else setMsg("Erreur : " + r.error);
  }

  function changerDate(d: string) {
    setDateCaisse(d); setEditId(null); setForm(ligneVide); setFichier(null);
    chargerJournee(token, d);
  }

  async function uploaderSiBesoin(): Promise<string | null> {
    if (!fichier) return form.justificatif_url || null;
    const fd = new FormData();
    fd.append("access_token", token);
    fd.append("file", fichier);
    fd.append("date_caisse", dateCaisse);
    const r = await fetch("/api/upload", { method: "POST", body: fd }).then((r) => r.json());
    if (!r.ok) { setMsg("Erreur upload : " + r.error); return null; }
    return r.chemin;
  }

  async function ajouterOuModifier() {
    setMsg("");
    if (!form.payeur_nom.trim()) { setMsg("Le nom du payeur est obligatoire."); return; }
    if (!form.montant || Number(form.montant) <= 0) { setMsg("Montant invalide."); return; }
    if (!form.categorie) { setMsg("Choisissez une catégorie."); return; }
    if (!form.moyen) { setMsg("Choisissez un moyen de paiement."); return; }
    setEnCours(true);
    const justif = await uploaderSiBesoin();
    const ligne = { ...form, justificatif_url: justif };
    let r;
    if (editId) {
      r = await fetch("/api/caisse", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "modifier_ligne", access_token: token, ligne_id: editId, ligne }) }).then((r) => r.json());
    } else {
      r = await fetch("/api/caisse", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ajouter_ligne", access_token: token, journee_id: journee.id, ligne }) }).then((r) => r.json());
    }
    setEnCours(false);
    if (r.ok) { setForm(ligneVide); setFichier(null); setEditId(null); chargerJournee(token, dateCaisse); if (rolesUser.includes("admin") || rolesUser.includes("comptable")) chargerEspace(token); }
    else setMsg("Erreur : " + r.error);
  }

  function editerLigne(l: any) {
    setEditId(l.id);
    setForm({ type: l.type, categorie: l.categorie || "", montant: String(l.montant), moyen: l.moyen || "",
      num_cheque: l.num_cheque || "", payeur_nom: l.payeur_nom, commentaire: l.commentaire || "", justificatif_url: l.justificatif_url || "" });
    setFichier(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function supprimerLigne(id: string) {
    if (!confirm("Supprimer cette ligne ?")) return;
    const r = await fetch("/api/caisse", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "supprimer_ligne", access_token: token, ligne_id: id }) }).then((r) => r.json());
    if (r.ok) chargerJournee(token, dateCaisse); else setMsg("Erreur : " + r.error);
  }

  async function voirJustificatif(chemin: string) {
    const url = `/api/justificatif?t=${encodeURIComponent(token)}&c=${encodeURIComponent(chemin)}`;
    window.open(url, "_blank");
  }

  async function soumettre(reSoumission = false) {
    const message = reSoumission
      ? "Re-soumettre les correctifs ? Un mail détaillant les modifications sera envoyé."
      : "Soumettre la caisse du jour ? Elle sera verrouillée et un récapitulatif PDF sera envoyé par mail.";
    if (!confirm(message)) return;
    setEnCours(true);
    const r = await fetch("/api/caisse", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "soumettre", access_token: token, journee_id: journee.id }) }).then((r) => r.json());
    setEnCours(false);
    if (r.ok) {
      setMsg(r.premiereSoumission ? "Caisse soumise ✅ — récapitulatif envoyé par mail." : "Correctifs re-soumis ✅ — mail envoyé.");
      chargerJournee(token, dateCaisse);
    } else setMsg("Erreur : " + r.error);
  }

  if (autorise === null) return <p style={{ padding: 40 }}>Chargement…</p>;
  if (autorise === false) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h1>Accès refusé</h1>
      <p>Cet espace est réservé au secrétariat, aux bénévoles, comptables et administrateurs.</p>
      <a href="https://intranet-ndbs.vercel.app" style={{ color: "#2563eb" }}>← Retour à l'intranet</a>
    </div>
  );

  const entrees = lignes.filter((l) => l.type === "entree");
  const sorties = lignes.filter((l) => l.type === "sortie");
  const totalE = entrees.reduce((s, l) => s + Number(l.montant), 0);
  const totalS = sorties.reduce((s, l) => s + Number(l.montant), 0);
  const solde = totalE - totalS;
  const eur = (n: number) => n.toFixed(2).replace(".", ",") + " €";
  const soumise = journee?.statut === "soumise";
  const libMoyen = (code: string) => moyens.find((m) => m.code === code)?.libelle ?? code;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: 16, width: "100%", boxSizing: "border-box", flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, lineHeight: 1.3 }}>Caisse du jour<br />
              <span style={{ fontSize: 14, color: "#555" }}>Paroisse Notre Dame du Bon Secours</span></h1>
            {profil && <div style={{ background: "#eff6ff", padding: "6px 10px", borderRadius: 6, marginTop: 6, fontSize: 13 }}>Connecté : <b>{profil.nom_complet}</b></div>}
          </div>
          <img src="/logo.png" alt="Logo paroisse" style={{ height: 70 }} />
        </div>
        <div style={{ textAlign: "right", margin: "8px 0" }}>
          <a href="https://intranet-ndbs.vercel.app" style={{ ...lien, textDecoration: "none", marginRight: 14 }}>⌂ Intranet</a>
          <button style={lien} onClick={() => getSupabase().auth.signOut().then(() => window.location.href = "/login")}>Déconnexion</button>
        </div>

        <div style={carte}>
          <label style={lbl}>Date de la caisse</label>
          <input style={{ ...inp, maxWidth: 220 }} type="date" value={dateCaisse} onChange={(e) => changerDate(e.target.value)} />
          {soumise && <div style={{ background: "#fef3c7", color: "#92400e", padding: "8px 12px", borderRadius: 6, marginTop: 8, fontSize: 14 }}>
            🔒 Journée soumise{peutModifier ? " — modification possible (comptable/admin)." : " — verrouillée."}</div>}
        </div>

        {msg && <div style={{ background: "#eff6ff", color: "#1e40af", padding: 10, borderRadius: 6, margin: "8px 0" }}>{msg}</div>}

        {(peutModifier) && (
          <div style={carte}>
            <h2 style={{ fontSize: 16 }}>{editId ? "Modifier la ligne" : "Ajouter une opération"}</h2>
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <button style={{ ...pill, ...(form.type === "entree" ? pillOn("#15803d") : {}) }} onClick={() => setForm({ ...form, type: "entree" })}>Entrée (+)</button>
              <button style={{ ...pill, ...(form.type === "sortie" ? pillOn("#b91c1c") : {}) }} onClick={() => setForm({ ...form, type: "sortie" })}>Sortie (−)</button>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 160px" }}>
                <label style={lbl}>Catégorie</label>
                <select style={inp} value={form.categorie} onChange={(e) => setForm({ ...form, categorie: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {categories.map((c) => <option key={c.id} value={c.libelle}>{c.libelle}</option>)}
                </select>
              </div>
              <div style={{ flex: "1 1 120px" }}>
                <label style={lbl}>Montant (€)</label>
                <input style={inp} type="number" step="0.01" value={form.montant} onChange={(e) => setForm({ ...form, montant: e.target.value })} />
              </div>
              <div style={{ flex: "1 1 140px" }}>
                <label style={lbl}>Moyen de paiement</label>
                <select style={inp} value={form.moyen} onChange={(e) => setForm({ ...form, moyen: e.target.value })}>
                  <option value="">— Choisir —</option>
                  {moyens.map((m) => <option key={m.id} value={m.code}>{m.libelle}</option>)}
                </select>
              </div>
            </div>
            {form.moyen === "cheque" && (
              <div><label style={lbl}>N° de chèque</label>
                <input style={inp} value={form.num_cheque} onChange={(e) => setForm({ ...form, num_cheque: e.target.value })} /></div>
            )}
            <label style={lbl}>Nom / prénom du payeur (obligatoire)</label>
            <input style={inp} value={form.payeur_nom} onChange={(e) => setForm({ ...form, payeur_nom: e.target.value })} />
            <label style={lbl}>Commentaire (facultatif)</label>
            <input style={inp} value={form.commentaire} onChange={(e) => setForm({ ...form, commentaire: e.target.value })} />
            <label style={lbl}>Justificatif (facultatif — photo ou PDF)</label>
            <input style={inp} type="file" accept="image/*,application/pdf" onChange={(e) => setFichier(e.target.files?.[0] || null)} />
            {editId && form.justificatif_url && !fichier && <p style={{ fontSize: 12, color: "#666" }}>Un justificatif est déjà attaché. Choisir un fichier le remplacera.</p>}
            <div style={{ marginTop: 8 }}>
              <button style={{ ...btn, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={ajouterOuModifier}>
                {enCours ? "…" : editId ? "Enregistrer" : "Ajouter"}</button>
              {editId && <button style={{ ...lien, marginLeft: 10 }} onClick={() => { setEditId(null); setForm(ligneVide); setFichier(null); }}>Annuler</button>}
            </div>
          </div>
        )}

        <div style={carte}>
          <h2 style={{ fontSize: 16 }}>Opérations du {dateCaisse.split("-").reverse().join("/")} ({lignes.length})</h2>
          {lignes.length === 0 && <p style={{ color: "#777" }}>Aucune opération pour cette date.</p>}
          {lignes.map((l) => (
            <div key={l.id} style={{ padding: "10px 0", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", gap: 10 }}>
              <div>
                <b style={{ color: l.type === "entree" ? "#15803d" : "#b91c1c" }}>{l.type === "entree" ? "+" : "−"} {eur(Number(l.montant))}</b>
                <span style={{ fontSize: 13, color: "#555" }}> · {l.categorie || "—"} · {libMoyen(l.moyen)}{l.num_cheque ? ` n°${l.num_cheque}` : ""}</span><br />
                <span style={{ fontSize: 13 }}>{l.payeur_nom}</span>
                {l.commentaire && <span style={{ fontSize: 13, color: "#777" }}> — {l.commentaire}</span>}
                {l.justificatif_url && <button style={{ ...lien, fontSize: 12, marginLeft: 6 }} onClick={() => voirJustificatif(l.justificatif_url)}>📎 justificatif</button>}
              </div>
              {peutModifier && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 90 }}>
                  <button style={btnMini} onClick={() => editerLigne(l)}>Modifier</button>
                  <button style={{ ...btnMini, background: "#b91c1c" }} onClick={() => supprimerLigne(l.id)}>Suppr.</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div style={carte}>
          <h2 style={{ fontSize: 16 }}>Total de la journée</h2>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0" }}><span>Entrées</span><b style={{ color: "#15803d" }}>{eur(totalE)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0" }}><span>Sorties</span><b style={{ color: "#b91c1c" }}>{eur(totalS)}</b></div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, padding: "8px 0", borderTop: "2px solid #eee", marginTop: 4 }}><span><b>Solde du jour</b></span><b>{eur(solde)}</b></div>
        </div>

        <div style={carte}>
          <h2 style={{ fontSize: 16 }}>Récapitulatif par moyen de paiement</h2>
          {moyens.map((m) => {
            const concernees = lignes.filter((l) => l.moyen === m.code);
            const tot = concernees.reduce((s, l) => s + Number(l.montant), 0);
            return (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0", borderBottom: "1px solid #f0f0f0" }}>
                <span>{m.libelle}</span><span>{concernees.length} opération(s) — <b>{eur(tot)}</b></span>
              </div>
            );
          })}
        </div>

        {!soumise && peutModifier && lignes.length > 0 && (
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <button style={{ ...btn, background: "#15803d", fontSize: 16, padding: "12px 24px", opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={() => soumettre(false)}>
              ✓ Soumettre la caisse du jour</button>
            <p style={{ fontSize: 12, color: "#777", marginTop: 6 }}>La journée sera verrouillée et un récapitulatif PDF envoyé par mail (paroisse, CPAE, administrateurs).</p>
          </div>
        )}

        {soumise && estComptableOuAdmin && correctifsEnAttente > 0 && (
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <button style={{ ...btn, background: "#b45309", fontSize: 16, padding: "12px 24px", opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={() => soumettre(true)}>
              ↻ Re-soumettre les correctifs ({correctifsEnAttente})</button>
            <p style={{ fontSize: 12, color: "#777", marginTop: 6 }}>Un mail détaillant les {correctifsEnAttente} modification(s) apportée(s) depuis la dernière soumission sera envoyé.</p>
          </div>
        )}

        {espace && (rolesUser.includes("admin") || rolesUser.includes("comptable")) && (
          <div style={carte}>
            <h2 style={{ fontSize: 15 }}>Espace justificatifs</h2>
            {(() => {
              const LIMITE = 1024 * 1024 * 1024;
              const pct = Math.min(100, Math.round((espace.octets / LIMITE) * 1000) / 10);
              const mo = (espace.octets / (1024 * 1024)).toFixed(1);
              const couleur = pct < 70 ? "#15803d" : pct < 90 ? "#b45309" : "#b91c1c";
              return (
                <>
                  <div style={{ fontSize: 13, color: "#555", marginBottom: 6 }}>
                    {mo} Mo utilisés sur 1024 Mo ({pct}%) — {espace.nb} fichier(s)
                  </div>
                  <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: couleur }} />
                  </div>
                  {pct >= 80 && <div style={{ fontSize: 12, color: "#b91c1c", marginTop: 6 }}>
                    ⚠️ L'espace se remplit. Pensez à archiver les anciens justificatifs.
                  </div>}
                </>
              );
            })()}
          </div>
        )}
      </div>
      <footer style={pied}>Alexandre FAMARE © 2026</footer>
    </div>
  );
}

const carte: React.CSSProperties = { background: "#fff", padding: 18, borderRadius: 12, margin: "12px 0", boxShadow: "0 1px 4px rgba(0,0,0,.08)" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: 9, margin: "4px 0 8px", borderRadius: 6, border: "1px solid #ccc", boxSizing: "border-box" };
const lbl: React.CSSProperties = { fontSize: 13, color: "#555", fontWeight: 600 };
const btn: React.CSSProperties = { padding: "9px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const btnMini: React.CSSProperties = { padding: "5px 10px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 12 };
const lien: React.CSSProperties = { background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 };
const pied: React.CSSProperties = { textAlign: "center", padding: 14, fontSize: 12, color: "#999" };
const pill: React.CSSProperties = { padding: "8px 16px", borderRadius: 20, border: "1px solid #ccc", background: "#fff", cursor: "pointer", fontSize: 14 };
function pillOn(c: string): React.CSSProperties { return { background: c, color: "#fff", borderColor: c }; }
