// app/layout.tsx
export const metadata = {
  title: "Caisse du jour — Paroisse Notre Dame du Bon Secours",
  description: "Saisie de la caisse quotidienne",
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body style={{ margin: 0, fontFamily: "Arial, sans-serif", background: "#f3f4f6" }}>{children}</body>
    </html>
  );
}
