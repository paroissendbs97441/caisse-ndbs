// app/page.tsx — Entrée caisse du jour — fenêtre macOS Liquid Glass
"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { getSupabase } from "../lib/supabaseClient";

const ROLES_OK = ["secretaire", "benevole", "admin", "comptable"];
const URL_INTRANET = "https://intranet-ndbs.vercel.app";

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
  const [horloge, setHorloge] = useState("");
  const [zoom, setZoom] = useState(false);

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

  useEffect(() => {
    const maj = () => {
      const d = new Date();
      const jours = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
      const mois = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
      setHorloge(`${jours[d.getDay()]} ${d.getDate()} ${mois[d.getMonth()]}  ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    };
    maj();
    const id = setInterval(maj, 10000);
    return () => clearInterval(id);
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

  function fermer() { window.location.href = URL_INTRANET; }

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

  // —— États habillés ——
  if (autorise === null) return (
    <div style={pageWrap}><div style={wall} />
      <div style={{ position: "relative", zIndex: 1, textAlign: "center", paddingTop: 100, color: "#3a3a40", fontSize: 15 }}>Chargement…</div>
    </div>
  );
  if (autorise === false) return (
    <div style={pageWrap}><div style={wall} />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 460, margin: "0 auto", padding: "100px 24px" }}>
        <div style={fenetre}>
          <div style={titleBar}><span style={feux}><i style={{ ...feu, background: "#ff5f57" }} /><i style={{ ...feu, background: "#febc2e" }} /><i style={{ ...feu, background: "#28c840" }} /></span></div>
          <div style={{ padding: "30px 28px 34px", textAlign: "center" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🔒</div>
            <h1 style={{ fontSize: 20, margin: "0 0 6px", fontWeight: 700, color: "#1d1d1f" }}>Accès refusé</h1>
            <p style={{ color: "#555", fontSize: 14, margin: "0 0 18px" }}>Cet espace est réservé au secrétariat, aux bénévoles, comptables et administrateurs.</p>
            <a href={URL_INTRANET} style={pilule}>← Retour à l'intranet</a>
          </div>
        </div>
      </div>
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
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />

      <div style={pageWrap}>
        <div style={wall} />

        {/* Barre de menu système */}
        <div style={menubar}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
            <img src="/logo.png" alt="" style={{ height: 17, width: 17, objectFit: "contain" }} /> Caisse du jour
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <a href={URL_INTRANET} style={menuLien}>⌂ Intranet</a>
            <button style={{ ...menuLien, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}
              onClick={() => getSupabase().auth.signOut().then(() => window.location.href = "/login")}>Déconnexion</button>
            <span style={{ opacity: 0.9 }}>{horloge}</span>
          </span>
        </div>

        {/* Fenêtre d'application macOS */}
        <div style={{ ...fenetreWrap, maxWidth: zoom ? "100%" : 840, padding: zoom ? "12px 12px 50px" : "30px 20px 50px", transition: "max-width .3s ease, padding .3s ease" }}>
          <div style={fenetre}>
            {/* Title bar */}
            <div style={titleBar}>
              <span style={feux}>
                <i title="Fermer" onClick={fermer} style={{ ...feu, background: "#ff5f57", cursor: "pointer" }} />
                <i title="Retour à l'intranet" onClick={fermer} style={{ ...feu, background: "#febc2e", cursor: "pointer" }} />
                <i title="Plein écran" onClick={() => setZoom(!zoom)} style={{ ...feu, background: "#28c840", cursor: "pointer" }} />
              </span>
              <span style={titreFenetre}>Caisse du jour</span>
              <img src="/logo.png" alt="" style={{ marginLeft: "auto", height: 26, objectFit: "contain" }} />
            </div>

            {/* Contenu */}
            <div style={corps}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#1d1d1f", letterSpacing: "-.4px" }}>Caisse du jour</h1>
                  <p style={{ fontSize: 14, color: "#5a5a62", margin: "3px 0 0" }}>Paroisse Notre-Dame du Bon Secours</p>
                </div>
              </div>
              {profil && <div style={infoBox}>Connecté : <b style={{ color: "#1d1d1f" }}>{profil.nom_complet}</b></div>}

              {/* Date */}
              <div style={carte}>
                <label style={lbl}>Date de la caisse</label>
                <input style={{ ...inp, maxWidth: 220 }} type="date" value={dateCaisse} onChange={(e) => changerDate(e.target.value)} />
                {soumise && <div style={bandeauVerrou}>
                  🔒 Journée soumise{peutModifier ? " — modification possible (comptable/admin)." : " — verrouillée."}</div>}
              </div>

              {msg && <div style={infoMsg}>{msg}</div>}

              {(peutModifier) && (
                <div style={carte}>
                  <h2 style={h2}>{editId ? "Modifier la ligne" : "Ajouter une opération"}</h2>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                    <button style={{ ...pill, ...(form.type === "entree" ? pillOn("#1b6b44") : {}) }} onClick={() => setForm({ ...form, type: "entree" })}>Entrée (+)</button>
                    <button style={{ ...pill, ...(form.type === "sortie" ? pillOn("#b3261e") : {}) }} onClick={() => setForm({ ...form, type: "sortie" })}>Sortie (−)</button>
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
                  <div style={{ marginTop: 10 }}>
                    <button style={{ ...btn, opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={ajouterOuModifier}>
                      {enCours ? "…" : editId ? "Enregistrer" : "Ajouter"}</button>
                    {editId && <button style={{ ...lien, marginLeft: 10 }} onClick={() => { setEditId(null); setForm(ligneVide); setFichier(null); }}>Annuler</button>}
                  </div>
                </div>
              )}

              <div style={carte}>
                <h2 style={h2}>Opérations du {dateCaisse.split("-").reverse().join("/")} ({lignes.length})</h2>
                {lignes.length === 0 && <p style={{ color: "#8a8a92" }}>Aucune opération pour cette date.</p>}
                {lignes.map((l) => (
                  <div key={l.id} style={{ padding: "10px 0", borderBottom: "1px solid rgba(60,60,67,.08)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div>
                      <b style={{ color: l.type === "entree" ? "#1b6b44" : "#b3261e" }}>{l.type === "entree" ? "+" : "−"} {eur(Number(l.montant))}</b>
                      <span style={{ fontSize: 13, color: "#5a5a62" }}> · {l.categorie || "—"} · {libMoyen(l.moyen)}{l.num_cheque ? ` n°${l.num_cheque}` : ""}</span><br />
                      <span style={{ fontSize: 13, color: "#2a2a30" }}>{l.payeur_nom}</span>
                      {l.commentaire && <span style={{ fontSize: 13, color: "#8a8a92" }}> — {l.commentaire}</span>}
                      {l.justificatif_url && <button style={{ ...lien, fontSize: 12, marginLeft: 6 }} onClick={() => voirJustificatif(l.justificatif_url)}>📎 justificatif</button>}
                    </div>
                    {peutModifier && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 92, flexShrink: 0 }}>
                        <button style={btnMini} onClick={() => editerLigne(l)}>Modifier</button>
                        <button style={{ ...btnMini, ...btnRouge }} onClick={() => supprimerLigne(l.id)}>Suppr.</button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div style={carte}>
                <h2 style={h2}>Total de la journée</h2>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0" }}><span>Entrées</span><b style={{ color: "#1b6b44" }}>{eur(totalE)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0" }}><span>Sorties</span><b style={{ color: "#b3261e" }}>{eur(totalS)}</b></div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 17, padding: "10px 0 2px", borderTop: "2px solid rgba(60,60,67,.12)", marginTop: 6 }}><span><b>Solde du jour</b></span><b style={{ color: solde < 0 ? "#b3261e" : "#1b6b44" }}>{eur(solde)}</b></div>
              </div>

              <div style={carte}>
                <h2 style={h2}>Récapitulatif par moyen de paiement</h2>
                {moyens.map((m) => {
                  const concernees = lignes.filter((l) => l.moyen === m.code);
                  const tot = concernees.reduce((s, l) => s + Number(l.montant), 0);
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "5px 0", borderBottom: "1px solid rgba(60,60,67,.06)" }}>
                      <span>{m.libelle}</span><span style={{ color: "#3a3a40" }}>{concernees.length} opération(s) — <b>{eur(tot)}</b></span>
                    </div>
                  );
                })}
              </div>

              {!soumise && peutModifier && lignes.length > 0 && (
                <div style={{ textAlign: "center", margin: "18px 0 6px" }}>
                  <button style={{ ...btn, ...btnVert, fontSize: 16, padding: "12px 26px", opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={() => soumettre(false)}>
                    ✓ Soumettre la caisse du jour</button>
                  <p style={{ fontSize: 12, color: "#8a8a92", marginTop: 8 }}>La journée sera verrouillée et un récapitulatif PDF envoyé par mail (paroisse, CPAE, administrateurs).</p>
                </div>
              )}

              {soumise && estComptableOuAdmin && correctifsEnAttente > 0 && (
                <div style={{ textAlign: "center", margin: "18px 0 6px" }}>
                  <button style={{ ...btn, ...btnAmbre, fontSize: 16, padding: "12px 26px", opacity: enCours ? 0.6 : 1 }} disabled={enCours} onClick={() => soumettre(true)}>
                    ↻ Re-soumettre les correctifs ({correctifsEnAttente})</button>
                  <p style={{ fontSize: 12, color: "#8a8a92", marginTop: 8 }}>Un mail détaillant les {correctifsEnAttente} modification(s) apportée(s) depuis la dernière soumission sera envoyé.</p>
                </div>
              )}

              {espace && (rolesUser.includes("admin") || rolesUser.includes("comptable")) && (
                <div style={carte}>
                  <h2 style={{ ...h2, fontSize: 15 }}>Espace justificatifs</h2>
                  {(() => {
                    const LIMITE = 1024 * 1024 * 1024;
                    const pct = Math.min(100, Math.round((espace.octets / LIMITE) * 1000) / 10);
                    const mo = (espace.octets / (1024 * 1024)).toFixed(1);
                    const couleur = pct < 70 ? "#1b6b44" : pct < 90 ? "#9a5b0e" : "#b3261e";
                    return (
                      <>
                        <div style={{ fontSize: 13, color: "#5a5a62", marginBottom: 6 }}>
                          {mo} Mo utilisés sur 1024 Mo ({pct}%) — {espace.nb} fichier(s)
                        </div>
                        <div style={{ height: 10, background: "rgba(60,60,67,.12)", borderRadius: 6, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: couleur }} />
                        </div>
                        {pct >= 80 && <div style={{ fontSize: 12, color: "#b3261e", marginTop: 6 }}>
                          ⚠️ L'espace se remplit. Pensez à archiver les anciens justificatifs.
                        </div>}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          <p style={pied}>Alexandre FAMARE © 2026</p>
        </div>
      </div>
    </>
  );
}

const pageWrap: React.CSSProperties = { position: "relative", minHeight: "100vh", fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", color: "#1d1d1f", WebkitFontSmoothing: "antialiased" };
const wall: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 0,
  background: "radial-gradient(circle at 16% 16%, #c5dfe0 0%, rgba(197,223,224,0) 45%), radial-gradient(circle at 84% 14%, #cae0e6 0%, rgba(202,224,230,0) 48%), radial-gradient(circle at 82% 86%, #c3dcde 0%, rgba(195,220,222,0) 46%), linear-gradient(160deg, #e3eef0 0%, #d6e6e9 55%, #cadfe2 100%)",
};
const menubar: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: 18,
  height: 28, padding: "0 16px", fontSize: 12.5, fontWeight: 500, color: "#2a2a30",
  background: "rgba(255,255,255,.5)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
  borderBottom: "1px solid rgba(255,255,255,.55)",
};
const menuLien: React.CSSProperties = { color: "#2a2a30", textDecoration: "none", fontWeight: 500 };
const fenetreWrap: React.CSSProperties = { position: "relative", zIndex: 1, maxWidth: 840, margin: "0 auto", padding: "30px 20px 50px", width: "100%", boxSizing: "border-box" };
const fenetre: React.CSSProperties = {
  borderRadius: 16, overflow: "hidden",
  background: "rgba(255,255,255,.5)", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.6)",
  boxShadow: "0 30px 80px rgba(30,70,80,.24), 0 4px 14px rgba(30,70,80,.13), inset 0 1px 0 rgba(255,255,255,.7)",
};
const titleBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 14, height: 46, padding: "0 16px",
  background: "rgba(255,255,255,.4)", borderBottom: "1px solid rgba(60,60,67,.1)",
};
const feux: React.CSSProperties = { display: "flex", gap: 8, flexShrink: 0 };
const feu: React.CSSProperties = { width: 12, height: 12, borderRadius: "50%", display: "inline-block", boxShadow: "inset 0 0 0 .5px rgba(0,0,0,.12)" };
const titreFenetre: React.CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "#3a3a40", whiteSpace: "nowrap" };
const corps: React.CSSProperties = { padding: "20px 22px", background: "rgba(255,255,255,.3)" };
const infoBox: React.CSSProperties = { background: "rgba(255,255,255,.55)", border: "1px solid rgba(255,255,255,.7)", padding: "8px 12px", borderRadius: 12, marginTop: 12, fontSize: 13, color: "#3a3a40" };
const carte: React.CSSProperties = {
  background: "rgba(255,255,255,.6)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.7)", borderRadius: 16, padding: 18, margin: "14px 0",
  boxShadow: "0 8px 26px rgba(30,70,80,.1), inset 0 1px 0 rgba(255,255,255,.7)",
};
const h2: React.CSSProperties = { fontSize: 16.5, fontWeight: 700, margin: "0 0 10px", color: "#1d1d1f" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: 10, margin: "4px 0 8px", borderRadius: 10, border: "1px solid rgba(60,60,67,.18)", boxSizing: "border-box", fontSize: 14, fontFamily: "inherit", background: "rgba(255,255,255,.7)", color: "#1d1d1f", outline: "none" };
const lbl: React.CSSProperties = { fontSize: 13, color: "#5a5a62", fontWeight: 600 };
const btn: React.CSSProperties = { padding: "10px 18px", background: "linear-gradient(180deg,#2c8a9a,#1f6f7e)", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", boxShadow: "0 4px 12px rgba(31,111,126,.3)" };
const btnMini: React.CSSProperties = { padding: "6px 12px", background: "linear-gradient(180deg,#2c8a9a,#1f6f7e)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "inherit", whiteSpace: "nowrap" };
const btnRouge: React.CSSProperties = { background: "linear-gradient(180deg,#d0453e,#b3261e)" };
const btnVert: React.CSSProperties = { background: "linear-gradient(180deg,#3f9c63,#2f8050)" };
const btnAmbre: React.CSSProperties = { background: "linear-gradient(180deg,#c98a2e,#a86f18)" };
const lien: React.CSSProperties = { background: "none", border: "none", color: "#1f6f7e", cursor: "pointer", fontSize: 14, fontFamily: "inherit", padding: 0 };
const pied: React.CSSProperties = { textAlign: "center", padding: "20px 14px 0", fontSize: 12, color: "#8a8a92" };
const pill: React.CSSProperties = { padding: "8px 16px", borderRadius: 999, border: "1px solid rgba(60,60,67,.2)", background: "rgba(255,255,255,.6)", cursor: "pointer", fontSize: 14, fontFamily: "inherit", fontWeight: 500, color: "#3a3a40" };
function pillOn(c: string): React.CSSProperties { return { background: c, color: "#fff", borderColor: c, fontWeight: 600 }; }
const bandeauVerrou: React.CSSProperties = { background: "rgba(214,158,46,.18)", color: "#8a5a08", border: "1px solid rgba(214,158,46,.4)", padding: "8px 12px", borderRadius: 10, marginTop: 8, fontSize: 14 };
const infoMsg: React.CSSProperties = { background: "rgba(44,138,154,.14)", color: "#1f6f7e", border: "1px solid rgba(44,138,154,.32)", padding: 11, borderRadius: 12, margin: "10px 0", fontSize: 14 };
const pilule: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#1f6f7e", fontSize: 13, fontWeight: 500,
  padding: "7px 14px", borderRadius: 999, background: "rgba(255,255,255,.6)",
  backdropFilter: "blur(18px) saturate(180%)", WebkitBackdropFilter: "blur(18px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.7)", boxShadow: "0 4px 14px rgba(30,70,80,.12)",
};
