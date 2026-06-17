// app/comptable/page.tsx — Espace comptable CPAE — fenêtre macOS Liquid Glass
"use client";
export const dynamic = "force-dynamic";
import { useEffect, useState } from "react";
import { getSupabase } from "../../lib/supabaseClient";

const ROLES_OK = ["comptable", "admin", "cure", "diacre"];
const URL_INTRANET = "https://intranet-ndbs.vercel.app";
const MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];
const COULEURS = ["#5b6cff", "#2fa36b", "#d68a2e", "#9b59c6", "#d6539a", "#1f9bb5", "#c9a227", "#d6453e", "#5a52d6", "#1f8c80"];

function Camembert({ data, titre }: { data: { nom: string; montant: number }[]; titre: string }) {
  const eur = (n: number) => Number(n).toFixed(2).replace(".", ",") + " €";
  const total = data.reduce((s, d) => s + d.montant, 0);
  if (total <= 0) return (
    <div style={{ flex: "1 1 280px" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1d1d1f", margin: "0 0 8px" }}>{titre}</h2>
      <p style={{ color: "#8a8a92", fontSize: 13 }}>Aucune donnée sur cette période.</p>
    </div>
  );
  const R = 70, CX = 80, CY = 80;
  let angle = -Math.PI / 2;
  const parts = data.map((d, i) => {
    const frac = d.montant / total;
    const a0 = angle;
    const a1 = angle + frac * 2 * Math.PI;
    angle = a1;
    const x0 = CX + R * Math.cos(a0), y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1), y1 = CY + R * Math.sin(a1);
    const grand = frac > 0.5 ? 1 : 0;
    const path = data.length === 1
      ? `M ${CX} ${CY - R} A ${R} ${R} 0 1 1 ${CX - 0.01} ${CY - R} Z`
      : `M ${CX} ${CY} L ${x0} ${y0} A ${R} ${R} 0 ${grand} 1 ${x1} ${y1} Z`;
    return { path, couleur: COULEURS[i % COULEURS.length], ...d, pct: Math.round(frac * 1000) / 10 };
  });
  return (
    <div style={{ flex: "1 1 280px" }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "#1d1d1f", margin: "0 0 10px" }}>{titre}</h2>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <svg width="160" height="160" viewBox="0 0 160 160">
          {parts.map((p, i) => <path key={i} d={p.path} fill={p.couleur} stroke="rgba(255,255,255,.85)" strokeWidth="1.5" />)}
        </svg>
        <div style={{ fontSize: 12, flex: "1 1 140px" }}>
          {parts.map((p, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, margin: "3px 0" }}>
              <span style={{ width: 11, height: 11, background: p.couleur, borderRadius: 3, display: "inline-block", flexShrink: 0 }} />
              <span style={{ flex: 1, color: "#2a2a30" }}>{p.nom}</span>
              <span style={{ color: "#5a5a62" }}>{eur(p.montant)} ({p.pct}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Comptable() {
  const [token, setToken] = useState("");
  const [autorise, setAutorise] = useState<boolean | null>(null);
  const [profil, setProfil] = useState<any>(null);
  const [onglet, setOnglet] = useState<"dashboard" | "archives">("dashboard");
  const [moyens, setMoyens] = useState<any[]>([]);
  const [exportEnCours, setExportEnCours] = useState(false);
  const [horloge, setHorloge] = useState("");
  const [zoom, setZoom] = useState(false);

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

  function fermer() { window.location.href = URL_INTRANET; }

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

  async function exporter(format: "pdf" | "excel", perimetre: any) {
    setExportEnCours(true);
    try {
      const res = await fetch("/api/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ access_token: token, format, perimetre }),
      });
      if (!res.ok) { alert("Erreur lors de l'export."); setExportEnCours(false); return; }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dispo = res.headers.get("Content-Disposition") || "";
      const m = dispo.match(/filename="(.+?)"/);
      a.download = m ? m[1] : `export.${format === "excel" ? "xlsx" : "pdf"}`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) { alert("Erreur lors de l'export."); }
    setExportEnCours(false);
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
            <p style={{ color: "#555", fontSize: 14, margin: "0 0 18px" }}>Cet espace est réservé aux comptables CPAE, au clergé et aux administrateurs.</p>
            <a href={URL_INTRANET} style={pilule}>← Retour à l'intranet</a>
          </div>
        </div>
      </div>
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

  let ecart = 0, labelMoisPrec = "";
  if (db) {
    ecart = db.solde - (db.soldePrecedent ?? 0);
    if (db.moisPrecedentLabel) {
      const [a, m] = db.moisPrecedentLabel.split("-");
      labelMoisPrec = `${MOIS[Number(m) - 1].toLowerCase()} ${a}`;
    }
  }
  const arrondi = Math.round(ecart * 100) / 100;
  let texteComparaison = "", couleurComparaison = "#5a5a62";
  if (db && labelMoisPrec) {
    if (arrondi > 0) { texteComparaison = `Solde en hausse de ${eur(arrondi)} par rapport à ${labelMoisPrec}`; couleurComparaison = "#1b6b44"; }
    else if (arrondi < 0) { texteComparaison = `Solde en baisse de ${eur(Math.abs(arrondi))} par rapport à ${labelMoisPrec}`; couleurComparaison = "#b3261e"; }
    else { texteComparaison = `Solde stable par rapport à ${labelMoisPrec}`; couleurComparaison = "#5a5a62"; }
  }

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
            <img src="/logo.png" alt="" style={{ height: 17, width: 17, objectFit: "contain" }} /> Comptabilité CPAE
          </span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 14 }}>
            <a href={URL_INTRANET} style={menuLien}>⌂ Intranet</a>
            <a href="/" style={menuLien}>Caisse du jour</a>
            <button style={{ ...menuLien, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}
              onClick={() => getSupabase().auth.signOut().then(() => window.location.href = "/login")}>Déconnexion</button>
            <span style={{ opacity: 0.9 }}>{horloge}</span>
          </span>
        </div>

        {/* Fenêtre d'application macOS */}
        <div style={{ ...fenetreWrap, maxWidth: zoom ? "100%" : 920, padding: zoom ? "12px 12px 50px" : "30px 20px 50px", transition: "max-width .3s ease, padding .3s ease" }}>
          <div style={fenetre}>
            {/* Title bar */}
            <div style={titleBar}>
              <span style={feux}>
                <i title="Fermer" onClick={fermer} style={{ ...feu, background: "#ff5f57", cursor: "pointer" }} />
                <i title="Retour à l'intranet" onClick={fermer} style={{ ...feu, background: "#febc2e", cursor: "pointer" }} />
                <i title="Plein écran" onClick={() => setZoom(!zoom)} style={{ ...feu, background: "#28c840", cursor: "pointer" }} />
              </span>
              <span style={titreFenetre}>Espace comptable CPAE</span>
              <img src="/logo.png" alt="" style={{ marginLeft: "auto", height: 26, objectFit: "contain" }} />
            </div>

            {/* Contenu */}
            <div style={corps}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, color: "#1d1d1f", letterSpacing: "-.4px" }}>Espace comptable CPAE</h1>
                  <p style={{ fontSize: 14, color: "#5a5a62", margin: "3px 0 0" }}>Paroisse Notre-Dame du Bon Secours</p>
                </div>
              </div>
              {profil && <div style={infoBox}>Connecté : <b style={{ color: "#1d1d1f" }}>{profil.nom_complet}</b></div>}

              {/* Segmented control */}
              <div style={segmented}>
                <button onClick={() => setOnglet("dashboard")} style={ongletStyle(onglet === "dashboard")}>Tableau de bord</button>
                <button onClick={ouvrirArchives} style={ongletStyle(onglet === "archives")}>Archives</button>
              </div>

              {onglet === "dashboard" && (
                <>
                  <div style={carte}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
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
                      <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                        <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("pdf", { type: "mois", annee: dbAnnee, mois: dbMois })}>📄 PDF</button>
                        <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("excel", { type: "mois", annee: dbAnnee, mois: dbMois })}>📊 Excel</button>
                      </div>
                    </div>
                    <p style={{ fontSize: 12, color: "#8a8a92", margin: "10px 0 0" }}>Les exports portent sur le mois sélectionné (récapitulatif + détail).</p>
                  </div>

                  {dbChargement && <div style={carte}><p style={{ color: "#8a8a92", margin: 0 }}>Chargement…</p></div>}

                  {!dbChargement && db && (
                    <>
                      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <div style={{ ...statCard, flex: "1 1 150px" }}>
                          <div style={{ fontSize: 13, color: "#5a5a62" }}>Entrées</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#1b6b44" }}>{eur(db.totalE)}</div>
                        </div>
                        <div style={{ ...statCard, flex: "1 1 150px" }}>
                          <div style={{ fontSize: 13, color: "#5a5a62" }}>Sorties</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: "#b3261e" }}>{eur(db.totalS)}</div>
                        </div>
                        <div style={{ ...statCard, flex: "1 1 150px" }}>
                          <div style={{ fontSize: 13, color: "#5a5a62" }}>Solde du mois</div>
                          <div style={{ fontSize: 24, fontWeight: 700, color: db.solde >= 0 ? "#1b6b44" : "#b3261e" }}>{eur(db.solde)}</div>
                        </div>
                      </div>
                      {texteComparaison && (
                        <div style={{ ...carte, padding: "12px 16px", textAlign: "center", fontSize: 14.5, color: couleurComparaison, fontWeight: 600 }}>
                          {arrondi > 0 ? "↑ " : arrondi < 0 ? "↓ " : ""}{texteComparaison}
                        </div>
                      )}
                      <p style={{ fontSize: 12, color: "#8a8a92", textAlign: "center", margin: "6px 0" }}>{db.nbJournees} journée(s) sur la période</p>

                      <div style={carte}>
                        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                          <Camembert titre="Entrées par catégorie" data={db.categoriesE || []} />
                          <Camembert titre="Dépenses par catégorie" data={db.categoriesS || []} />
                        </div>
                      </div>
                    </>
                  )}
                </>
              )}

              {onglet === "archives" && (
                <>
                  <div style={carte}>
                    <h2 style={h2}>Archives des journées</h2>
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
                    <div style={{ marginTop: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#8a8a92" }}>Exporter la période filtrée :</span>
                      <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("pdf", { type: "periode", annee, mois })}>📄 PDF</button>
                      <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("excel", { type: "periode", annee, mois })}>📊 Excel</button>
                      <span style={{ fontSize: 11, color: "#b0b0b8" }}>(la recherche texte n'est pas appliquée à l'export)</span>
                    </div>
                  </div>

                  {!chargement && journees.length > 0 && (
                    <div style={{ ...carte, background: "rgba(120,110,200,.12)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, flexWrap: "wrap", gap: 8 }}>
                        <span>{journees.length} journée(s)</span>
                        <span>Entrées : <b style={{ color: "#1b6b44" }}>{eur(totE)}</b> · Sorties : <b style={{ color: "#b3261e" }}>{eur(totS)}</b> · Solde : <b>{eur(totE - totS)}</b></span>
                      </div>
                    </div>
                  )}

                  <div style={carte}>
                    {chargement && <p style={{ color: "#8a8a92" }}>Chargement…</p>}
                    {!chargement && journees.length === 0 && <p style={{ color: "#8a8a92" }}>Aucune journée pour ce filtre.</p>}
                    {journees.map((j) => (
                      <div key={j.id} style={{ borderBottom: "1px solid rgba(60,60,67,.08)" }}>
                        <div onClick={() => ouvrirDetail(j.id)} style={{ padding: "12px 0", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                          <div>
                            <b style={{ color: "#1d1d1f" }}>{frDate(j.date_caisse)}</b>
                            <span style={{ marginLeft: 8, fontSize: 11.5, padding: "3px 9px", borderRadius: 999, fontWeight: 600,
                              background: j.statut === "soumise" ? "rgba(52,168,108,.16)" : "rgba(214,158,46,.18)",
                              color: j.statut === "soumise" ? "#1b6b44" : "#8a5a08",
                              border: j.statut === "soumise" ? "1px solid rgba(52,168,108,.4)" : "1px solid rgba(214,158,46,.42)" }}>
                              {j.statut === "soumise" ? "Soumise" : "Ouverte"}</span>
                            <span style={{ fontSize: 12, color: "#8a8a92", marginLeft: 8 }}>{j.nbLignes} opération(s)</span>
                          </div>
                          <div style={{ textAlign: "right", fontSize: 13 }}>
                            <span style={{ color: "#1b6b44" }}>+{eur(j.totalE)}</span> &nbsp;
                            <span style={{ color: "#b3261e" }}>−{eur(j.totalS)}</span><br />
                            <b style={{ color: "#1d1d1f" }}>Solde : {eur(j.solde)}</b> <span style={{ color: "#6a5acd", fontSize: 12 }}>{detailId === j.id ? "▲" : "▼"}</span>
                          </div>
                        </div>
                        {detailId === j.id && (
                          <div style={{ padding: "4px 0 12px", background: "rgba(255,255,255,.4)", borderRadius: 12, marginBottom: 8 }}>
                            {detailLignes.length === 0 && <p style={{ color: "#8a8a92", fontSize: 13, padding: "0 10px" }}>Aucune opération.</p>}
                            {detailLignes.map((l) => (
                              <div key={l.id} style={{ padding: "8px 12px", borderBottom: "1px solid rgba(60,60,67,.06)", fontSize: 13 }}>
                                <b style={{ color: l.type === "entree" ? "#1b6b44" : "#b3261e" }}>{l.type === "entree" ? "+" : "−"} {eur(Number(l.montant))}</b>
                                <span style={{ color: "#5a5a62" }}> · {l.categorie || "—"} · {libMoyen(l.moyen)}{l.num_cheque ? ` n°${l.num_cheque}` : ""} · {l.payeur_nom}</span>
                                {l.commentaire && <span style={{ color: "#8a8a92" }}> — {l.commentaire}</span>}
                                {l.justificatif_url && <button style={{ ...lien, fontSize: 12, marginLeft: 6 }} onClick={() => voirJustificatif(l.justificatif_url)}>📎 justificatif</button>}
                              </div>
                            ))}
                            <div style={{ padding: "10px 12px 0", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                              <span style={{ fontSize: 12, color: "#8a8a92" }}>Exporter cette journée :</span>
                              <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("pdf", { type: "journee", journee_id: j.id })}>📄 PDF</button>
                              <button style={btnExport} disabled={exportEnCours} onClick={() => exporter("excel", { type: "journee", journee_id: j.id })}>📊 Excel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </>
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
  background: "radial-gradient(circle at 14% 16%, #d8cdec 0%, rgba(216,205,236,0) 46%), radial-gradient(circle at 86% 12%, #e5cfe2 0%, rgba(229,207,226,0) 48%), radial-gradient(circle at 84% 88%, #cdd0ee 0%, rgba(205,208,238,0) 46%), linear-gradient(160deg, #ece4f3 0%, #e0d8ee 55%, #d4cfe8 100%)",
};
const menubar: React.CSSProperties = {
  position: "sticky", top: 0, zIndex: 10, display: "flex", alignItems: "center", gap: 18,
  height: 28, padding: "0 16px", fontSize: 12.5, fontWeight: 500, color: "#2a2a30",
  background: "rgba(255,255,255,.5)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)",
  borderBottom: "1px solid rgba(255,255,255,.55)",
};
const menuLien: React.CSSProperties = { color: "#2a2a30", textDecoration: "none", fontWeight: 500 };
const fenetreWrap: React.CSSProperties = { position: "relative", zIndex: 1, maxWidth: 920, margin: "0 auto", padding: "30px 20px 50px", width: "100%", boxSizing: "border-box" };
const fenetre: React.CSSProperties = {
  borderRadius: 16, overflow: "hidden",
  background: "rgba(255,255,255,.5)", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.6)",
  boxShadow: "0 30px 80px rgba(70,50,110,.26), 0 4px 14px rgba(70,50,110,.14), inset 0 1px 0 rgba(255,255,255,.7)",
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
const segmented: React.CSSProperties = { display: "flex", gap: 4, margin: "16px 0", padding: 4, borderRadius: 12, background: "rgba(120,110,160,.16)", border: "1px solid rgba(255,255,255,.5)" };
const carte: React.CSSProperties = {
  background: "rgba(255,255,255,.6)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.7)", borderRadius: 16, padding: 18, margin: "14px 0",
  boxShadow: "0 8px 26px rgba(70,50,110,.1), inset 0 1px 0 rgba(255,255,255,.7)",
};
const statCard: React.CSSProperties = {
  background: "rgba(255,255,255,.65)", border: "1px solid rgba(255,255,255,.75)", borderRadius: 16, padding: "16px 18px", textAlign: "center",
  boxShadow: "0 6px 20px rgba(70,50,110,.1), inset 0 1px 0 rgba(255,255,255,.7)",
};
const h2: React.CSSProperties = { fontSize: 16.5, fontWeight: 700, margin: "0 0 10px", color: "#1d1d1f" };
const inp: React.CSSProperties = { display: "block", width: "100%", padding: 10, margin: "4px 0 0", borderRadius: 10, border: "1px solid rgba(60,60,67,.18)", boxSizing: "border-box", fontSize: 14, fontFamily: "inherit", background: "rgba(255,255,255,.7)", color: "#1d1d1f", outline: "none" };
const lbl: React.CSSProperties = { fontSize: 13, color: "#5a5a62", fontWeight: 600 };
const btn: React.CSSProperties = { padding: "10px 18px", background: "linear-gradient(180deg,#7b5cc4,#5f44a8)", color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", fontSize: 14, fontWeight: 600, fontFamily: "inherit", boxShadow: "0 4px 12px rgba(95,68,168,.3)" };
const btnExport: React.CSSProperties = { padding: "8px 13px", background: "rgba(255,255,255,.7)", color: "#4a3a6b", border: "1px solid rgba(120,100,170,.3)", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "inherit", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)" };
const lien: React.CSSProperties = { background: "none", border: "none", color: "#5f44a8", cursor: "pointer", fontSize: 14, fontFamily: "inherit", padding: 0 };
const pied: React.CSSProperties = { textAlign: "center", padding: "20px 14px 0", fontSize: 12, color: "#8a8a92" };
function ongletStyle(actif: boolean): React.CSSProperties {
  return { flex: 1, padding: "8px 14px", border: "none", cursor: "pointer", fontSize: 14, fontFamily: "inherit",
    background: actif ? "rgba(255,255,255,.9)" : "transparent",
    color: actif ? "#1d1d1f" : "#5a5a62", borderRadius: 8, fontWeight: actif ? 600 : 500,
    boxShadow: actif ? "0 1px 4px rgba(70,50,110,.15)" : "none", transition: "background .15s" };
}
const pilule: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", textDecoration: "none", color: "#5f44a8", fontSize: 13, fontWeight: 500,
  padding: "7px 14px", borderRadius: 999, background: "rgba(255,255,255,.6)",
  backdropFilter: "blur(18px) saturate(180%)", WebkitBackdropFilter: "blur(18px) saturate(180%)",
  border: "1px solid rgba(255,255,255,.7)", boxShadow: "0 4px 14px rgba(70,50,110,.12)",
};
