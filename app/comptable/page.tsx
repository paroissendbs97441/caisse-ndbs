// app/comptable/page.tsx — Espace comptable CPAE
"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { getSupabase } from "../../lib/supabaseClient";

const ROLES_OK = ["comptable", "admin", "cure", "diacre"];
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const COULEURS = ["#2563eb", "#15803d", "#b45309", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#0d9488"];

export default function Comptable() {
  const [token, setToken] = useState("");
  const [autorise, setAutorise] = useState<boolean | null>(null);
  const [profil, setProfil] = useState<any>(null);
  const [onglet, setOnglet] = useState<"dashboard" | "archives">("dashboard");
  const [moyens, setMoyens] = useState<any[]>([]);

  const maintenant = new Date();
  const [dbAnnee, setDbAnnee] = useState(String(maintenant.getFullYear()));
  const [dbMois, setDbMois] = useState(String(maintenant.getMonth() + 1).padStart(2, "0"));
  const [db, setDb] = useState<any>(null);
  const [dbChargement, setDbChargement] = useState(false);

  const [journees, setJournees] = useState<any[]>([]);
  const [annee, setAnnee] = useState("");
  const [mois, setMois] = useState("");
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLignes, setDetailLignes] = useState<any[]>([]);

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
      if (!ROLES_OK.some((r) => roles.includes(r))) { setAutorise(false); return; }
      setAutorise(true);
      const { data: moys } = await getSupabase().from("caisse_moyens").select("*").eq("actif", true).order("ordre");
      setMoyens(moys ?? []);
      chargerDashboard(tk, dbAnnee, dbMois);
    }
    init();
  }, []);

  async function chargerDashboard(tk: string, an: string, mo: string) {
    setDbChargement(true);
    const r = await fetch("/api/caisse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "comptable_dashboard", access_token: tk, annee: an, mois: mo }),
    }).then((r) => r.json());
    setDbChargement(false);
    if (r.ok) setDb(r);
  }

  function changerPeriode(an: string, mo: string) {
    setDbAnnee(an); setDbMois(mo);
    chargerDashboard(token, an, mo);
  }

  async function chargerArchives(tk: string, an: string, mo: string, rech: string) {
    setChargement(true);
    const r = await fetch("/api/caisse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "comptable_journees", access_token: tk, annee: an, mois: mo, recherche: rech }),
    }).then((r) => r.json());
    setChargement(false);
    if (r.ok) setJournees(r.journees);
  }

  function ouvrirArchives() {
    setOnglet("archives");
    if (journees.length === 0) chargerArchives(token, "", "", "");
  }

  function appliquerFiltres() {
    setDetailId(null);
    chargerArchives(token, annee, mois, recherche.trim());
  }

  async function ouvrirDetail(id: string) {
    if (detailId === id) { setDetailId(null); return; }
    const r = await fetch("/api/caisse", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "comptable_detail", access_token: token, journee_id: id }),
    }).then((r) => r.json());
    if (r.ok) { setDetailLignes(r.lignes); setDetailId(id); }
  }

  async function voirJustificatif(chemin: string) {
    const url = `/api/justificatif?t=${encodeURIComponent(token)}&c=${encodeURIComponent(chemin)}`;
    window.open(url, "_blank");
  }

  if (autorise === null) return <p style={{ padding: 40 }}>Chargement…</p>;
  if (autorise === false) return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h1>Accès refusé</h1>
      <p>Cet espace est réservé aux comptables CPAE, au clergé et aux administrateurs.</p>
      <a href="https://intranet-ndbs.vercel.app" style={{ color: "#2563eb" }}>← Retour à l'intranet</a>
    </div>
  );

  const eur = (n: number) => Number(n).toFixed(2).replace(".", ",") + " €";
  const frDate = (s: string) => s.split("-").reverse().join("/");
  const libMoyen = (code: string) => moyens.find((m) => m.code === code)?.libelle ?? code;

  const anneesDispo = Array.from(new Set([
    String(new Date().getFullYear()), String(new Date().getFullYear() - 1),
    ...journees.map((j) => j.date_caisse.slice(0, 4)),
  ])).sort().reverse();

  const totE = journees.reduce((s, j) => s + j.totalE, 0);
  const totS = journees.reduce((s, j) => s + j.totalS, 0);
  const maxCat = db?.categories?.length ? db.categories[0].montant : 0;

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 16, width: "100%", boxSizing: "border-box", flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ fontSize: 20, lineHeight: 1.3 }}>Espace comptable CPAE<br />
              <span style={{ fontSize: 14, color: "#555" }}>Paroisse Notre Dame du Bon Secours</span></h1>
            {profil && <div style={{ background: "#eff6ff", padding: "6px 10px", borderRadius: 6, marginTop: 6, fontSize: 13 }}>Connecté : <b>{profil.nom_complet}</b></div>}
          </div>
          <img src="/logo.png" alt="Logo paroisse" style={{ height: 70 }} />
        </div>
        <div style={{ textAlign: "right", margin: "8px 0" }}>
          <a href="https://intranet-ndbs.vercel.app" style={{ ...lien, textDecoration: "none", marginRight: 14 }}>⌂ Intranet</a>
          <a href="/" style={{ ...lien, textDecoration: "none", marginRight: 14 }}>Caisse du jour</a>
          <button style={lien} onClick={() => getSupabase().auth.signOut().then(() => window.location.href = "/login")}>Déconnexion</button>
        </div>

        <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #e5e7eb", marginTop: 8 }}>
          <button onClick={() => setOnglet("dashboard")} style={ongletStyle(onglet === "dashboard")}>Tableau de bord</button>
          <button onClick={ouvrirArchives} style={ongletStyle(onglet === "archives")}>Archives</button>
        </div>

        {onglet === "dashboard" && (
          <>
            <div style={carte}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                <div>
                  <label style={lbl}>Mois</label>
                  <select style={{ ...inp, width: "auto" }} value={dbMois} onChange={(e) => changerPeriode(dbAnnee, e.target.value)}>
                    {MOIS.map((label, i) => { const v = String(i + 1).padStart(2, "0"); return <option key={v} value={v}>{label}</option>; })}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Année</label>
                  <select style={{ ...inp, width: "auto" }} value={dbAnnee} onChange={(e) => changerPeriode(e.target.value, dbMois)}>
                    {anneesDispo.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>
            </div>

            {dbChargement && <div style={carte}><p style={{ color: "#777" }}>Chargement…</p></div>}

            {!dbChargement && db && (
              <>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ ...carte, flex: "1 1 150px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "#555" }}>Entrées</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#15803d" }}>{eur(db.totalE)}</div>
                  </div>
                  <div style={{ ...carte, flex: "1 1 150px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "#555" }}>Sorties</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: "#b91c1c" }}>{eur(db.totalS)}</div>
                  </div>
                  <div style={{ ...carte, flex: "1 1 150px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, color: "#555" }}>Solde</div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: db.solde >= 0 ? "#15803d" : "#b91c1c" }}>{eur(db.solde)}</div>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: "#999", textAlign: "center", margin: "4px 0" }}>{db.nbJournees} journée(s) sur la période</p>

                <div style={carte}>
                  <h2 style={{ fontSize: 16 }}>Répartition des entrées par catégorie</h2>
                  {(!db.categories || db.categories.length === 0) && <p style={{ color: "#777" }}>Aucune entrée sur cette période.</p>}
                  {db.categories && db.categories.map((c: any, i: number) => {
                    const pct = maxCat > 0 ? (c.montant / maxCat) * 100 : 0;
                    const pctTotal = db.totalE > 0 ? Math.round((c.montant / db.totalE) * 1000) / 10 : 0;
                    return (
                      <div key={c.nom} style={{ margin: "10px 0" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 3 }}>
                          <span>{c.nom}</span>
                          <span><b>{eur(c.montant)}</b> <span style={{ color: "#999" }}>({pctTotal}%)</span></span>
                        </div>
                        <div style={{ height: 14, background: "#f1f5f9", borderRadius: 7, overflow: "hidden" }}>
                          <div style={{ width: `${pct}%`, height: "100%", background: COULEURS[i % COULEURS.length], borderRadius: 7 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {onglet === "archives" && (
          <>
            <div style={carte}>
              <h2 style={{ fontSize: 16 }}>Archives des journées</h2>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                <div>
                  <label style={lbl}>Année</label>
                  <select style={{ ...inp, width: "auto" }} value={annee} onChange={(e) => setAnnee(e.target.value)}>
                    <option value="">Toutes</option>
                    {anneesDispo.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label style={lbl}>Mois</label>
                  <select style={{ ...inp, width: "auto" }} value={mois} onChange={(e) => setMois(e.target.value)}>
                    <option value="">Tous</option>
                    {MOIS.map((label, i) => { const v = String(i + 1).padStart(2, "0"); return <option key={v} value={v}>{label}</option>; })}
                  </select>
                </div>
                <div style={{ flex: "1 1 180px" }}>
                  <label style={lbl}>Recherche (payeur, catégorie)</label>
                  <input style={inp} value={recherche} onChange={(e) => setRecherche(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") appliquerFiltres(); }} placeholder="ex. Dupont, Quête…" />
                </div>
                <button style={btn} onClick={appliquerFiltres}>Filtrer</button>
                {(annee || mois || recherche) && (
                  <button style={lien} onClick={() => { setAnnee(""); setMois(""); setRecherche(""); chargerArchives(token, "", "", ""); }}>Réinitialiser</button>
                )}
              </div>
            </div>

            {!chargement && journees.length > 0 && (
              <div style={{ ...carte, background: "#f0f9ff" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span>{journees.length} journée(s)</span>
                  <span>Entrées : <b style={{ color: "#15803d" }}>{eur(totE)}</b> · Sorties : <b style={{ color: "#b91c1c" }}>{eur(totS)}</b> · Solde : <b>{eur(totE - totS)}</b></span>
                </div>
              </div>
            )}

            <div style={carte}>
              {chargement && <p style={{ color: "#777" }}>Chargement…</p>}
              {!chargement && journees.length === 0 && <p style={{ color: "#777" }}>Aucune journée pour ce filtre.</p>}
              {journees.map((j) => (
                <div key={j.id} style={{ borderBottom: "1px solid #eee" }}>
                  <div onClick={() => ouvrirDetail(j.id)} style={{ padding: "12px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <div>
                      <b>{frDate(j.date_caisse)}</b>
                      <span style={{ marginLeft: 8, fontSize: 12, padding: "2px 8px", borderRadius: 12,
                        background: j.statut === "soumise" ? "#dcfce7" : "#fef3c7",
                        color: j.statut === "soumise" ? "#15803d" : "#92400e" }}>
                        {j.statut === "soumise" ? "Soumise" : "Ouverte"}</span>
                      <span style={{ fontSize: 12, color: "#999", marginLeft: 8 }}>{j.nbLignes} opération(s)</span>
                    </div>
                    <div style={{ textAlign: "right", fontSize: 13 }}>
                      <span style={{ color: "#15803d" }}>+{eur(j.totalE)}</span> &nbsp;
                      <span style={{ color: "#b91c1c" }}>−{eur(j.totalS)}</span><br />
                      <b>Solde : {eur(j.solde)}</b> <span style={{ color: "#2563eb", fontSize: 12 }}>{detailId === j.id ? "▲" : "▼"}</span>
                    </div>
                  </div>
                  {detailId === j.id && (
                    <div style={{ padding: "0 0 12px", background: "#fafafa" }}>
                      {detailLignes.length === 0 && <p style={{ color: "#777", fontSize: 13 }}>Aucune opération.</p>}
                      {detailLignes.map((l) => (
                        <div key={l.id} style={{ padding: "8px 10px", borderBottom: "1px solid #eee", fontSize: 13 }}>
                          <b style={{ color: l.type === "entree" ? "#15803d" : "#b91c1c" }}>{l.type === "entree" ? "+" : "−"} {eur(Number(l.montant))}</b>
                          <span style={{ color: "#555" }}> · {l.categorie || "—"} · {libMoyen(l.moyen)}{l.num_cheque ? ` n°${l.num_cheque}` : ""} · {l.payeur_nom}</span>
                          {l.commentaire && <span style={{ color: "#777" }}> — {l.commentaire}</span>}
                          {l.justificatif_url && <button style={{ ...lien, fontSize: 12, marginLeft: 6 }} onClick={() => voirJustificatif(l.justificatif_url)}>📎 justificatif</button>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      <footer style={pied}>Alexandre FAMARE © 2026</footer>
    </div>
  );
}

const carte: React.CSSProperties = { background: "#fff", padding: 18, borderRadius: 12, margin: "12px 0", boxShadow: "0 1px 4px rgba(0,0,0,.08)" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: 9, margin: "4px 0 0", borderRadius: 6, border: "1px solid #ccc", boxSizing: "border-box" };
const lbl: React.CSSProperties = { fontSize: 13, color: "#555", fontWeight: 600 };
const btn: React.CSSProperties = { padding: "9px 16px", background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 };
const lien: React.CSSProperties = { background: "none", border: "none", color: "#2563eb", cursor: "pointer", fontSize: 14 };
const pied: React.CSSProperties = { textAlign: "center", padding: 14, fontSize: 12, color: "#999" };
function ongletStyle(actif: boolean): React.CSSProperties {
  return { padding: "10px 18px", border: "none", background: "none", cursor: "pointer", fontSize: 15,
    fontWeight: actif ? 700 : 400, color: actif ? "#2563eb" : "#555",
    borderBottom: actif ? "3px solid #2563eb" : "3px solid transparent", marginBottom: -2 };
}
