// app/login/page.tsx
"use client";
export const dynamic = "force-dynamic";
import { useState } from "react";
import { getSupabase } from "../../lib/supabaseClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [msg, setMsg] = useState("");

  async function seConnecter() {
    setMsg("");
    const { error } = await getSupabase().auth.signInWithPassword({ email, password: mdp });
    if (error) setMsg("Identifiants incorrects.");
    else window.location.href = "/";
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: 16 }}>
        <img src="/logo.png" alt="Logo paroisse" style={{ height: 90 }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={card}>
          <h1 style={{ fontSize: 20, lineHeight: 1.3 }}>Caisse du jour<br /><span style={{ fontSize: 14, color: "#666" }}>Connexion requise</span></h1>
          <input style={input} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input style={input} type="password" placeholder="Mot de passe" value={mdp} onChange={(e) => setMdp(e.target.value)} />
          <button style={btn} onClick={seConnecter}>Se connecter</button>
          {msg && <p style={{ color: "#dc2626" }}>{msg}</p>}
          <p style={{ marginTop: 12 }}><a href="https://intranet-ndbs.vercel.app" style={{ color: "#2563eb", fontSize: 14 }}>← Retour à l'intranet</a></p>
        </div>
      </div>
      <footer style={pied}>Alexandre FAMARE © 2026</footer>
    </div>
  );
}
const card: React.CSSProperties = { maxWidth: 400, margin: "40px auto", background: "#fff", padding: 28, borderRadius: 12, boxShadow: "0 1px 4px rgba(0,0,0,.1)" };
const input: React.CSSProperties = { display: "block", width: "100%", padding: 10, margin: "8px 0", borderRadius: 6, border: "1px solid #ccc", boxSizing: "border-box" };
const btn: React.CSSProperties = { width: "100%", padding: 11, background: "#2563eb", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 15, marginTop: 6 };
const pied: React.CSSProperties = { textAlign: "center", padding: 14, fontSize: 12, color: "#999" };
