// lib/mailer.ts
import nodemailer from "nodemailer";
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.GMAIL_USER!, pass: process.env.GMAIL_APP_PASSWORD! },
});
export async function envoyerMail(opts: { to: string[]; subject: string; html: string; attachments?: any[] }) {
  return transporter.sendMail({
    from: `"Caisse Paroisse" <${process.env.GMAIL_USER}>`,
    to: opts.to.join(","),
    subject: opts.subject,
    html: opts.html,
    attachments: opts.attachments,
  });
}
