// scripts/alerts/check-reentry-alerts.mjs
//
// Corre fora da app (GitHub Actions, cron diário) para enviar um alerta por
// email quando um ativo em `reentryWatch` (posições fechadas de "boas
// empresas", ver js/screens/dashboard.js:syncReentryWatchlist) cai -7%/-10%/
// -15% desde o preço a que a posição foi vendida.
//
// Variáveis de ambiente obrigatórias:
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço (Firebase Admin SDK)
//   EMAIL_USER                conta de email que envia (ex: a tua Gmail)
//   EMAIL_APP_PASSWORD        palavra-passe de aplicação dessa conta (não é a
//                              palavra-passe normal de login — ver README)
//   EMAIL_TO                  para onde enviar os alertas (pode ser a mesma
//                              conta de EMAIL_USER)
//
// Opcionais (por omissão assume Gmail):
//   SMTP_HOST   (default smtp.gmail.com)
//   SMTP_PORT   (default 465)
//
// Para confirmar que o envio de email está bem configurado sem esperar por um
// alerta real, corre com --test-email: envia logo um email de confirmação e
// sai, sem tocar no Firestore/reentryWatch.
//
// Para ver o modelo/estrutura exata do email de alerta real, corre com
// --preview-email: envia um email com 3 empresas de exemplo (dados
// inventados mas plausíveis), construído pela mesma função que gera o
// email real — não toca no Firestore.

import admin from "firebase-admin";
import nodemailer from "nodemailer";

const THRESHOLDS = [7, 10, 15];
const TEST_EMAIL_MODE = process.argv.includes("--test-email");
const PREVIEW_EMAIL_MODE = process.argv.includes("--preview-email");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Variável de ambiente em falta: ${name}`);
    process.exit(1);
  }
  return value;
}

function formatEUR(value) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

function makeTransporter(emailUser, emailAppPassword) {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: emailUser, pass: emailAppPassword },
  });
}

// Constrói o assunto + corpo do email a partir da lista de alertas — usado
// tanto pelo envio real como pelo --preview-email, para o modelo ser
// exatamente igual ao que vai sair a sério.
function buildAlertEmail(alerts) {
  const lines = alerts.map(
    (a) =>
      `• ${a.ticker} (${a.nome}): caiu ${a.dropPct.toFixed(1)}% desde a saída ` +
      `(nível -${a.threshold}%). Saída: ${formatEUR(a.exitPrice)} | Atual: ${formatEUR(a.currentPrice)}`,
  );
  const text =
    `${alerts.length} oportunidade(s) de reentrada atingiram um novo nível de queda:\n\n` +
    lines.join("\n");
  const subject = `📉 APPFinance: ${alerts.length} oportunidade(s) de reentrada`;
  return { subject, text };
}

// Empresas de exemplo (tickers reais da carteira, números inventados) só
// para --preview-email — nunca usadas no envio real de alertas.
const PREVIEW_ALERTS = [
  {
    ticker: "NUKL",
    nome: "VanEck Uranium and Nuclear Technologies UCITS ETF",
    threshold: 7,
    dropPct: 8.3,
    exitPrice: 49.6,
    currentPrice: 45.49,
  },
  {
    ticker: "CBRS",
    nome: "First Trust Nasdaq Cybersecurity UCITS ETF",
    threshold: 10,
    dropPct: 11.7,
    exitPrice: 56.09,
    currentPrice: 49.54,
  },
  {
    ticker: "GRID",
    nome: "First Trust Nasdaq Clean Edge Smart Grid Infrastructure UCITS ETF",
    threshold: 15,
    dropPct: 16.2,
    exitPrice: 57.59,
    currentPrice: 48.26,
  },
];

async function main() {
  const emailUser = requireEnv("EMAIL_USER");
  const emailAppPassword = requireEnv("EMAIL_APP_PASSWORD");
  const emailTo = requireEnv("EMAIL_TO");
  const transporter = makeTransporter(emailUser, emailAppPassword);

  if (TEST_EMAIL_MODE) {
    console.log("🧪 Modo de teste: a enviar email de confirmação (sem consultar o Firestore)...");
    await transporter.sendMail({
      from: emailUser,
      to: emailTo,
      subject: "✅ APPFinance: teste de alertas de reentrada",
      text:
        "Se estás a ler isto, o envio de email via SMTP está configurado corretamente.\n\n" +
        "Este foi um email de teste manual (--test-email), não um alerta real de reentrada.",
    });
    console.log("✅ Email de teste enviado com sucesso.");
    return;
  }

  if (PREVIEW_EMAIL_MODE) {
    console.log("🧪 Modo de pré-visualização: a enviar email com 3 empresas de exemplo...");
    const { subject, text } = buildAlertEmail(PREVIEW_ALERTS);
    await transporter.sendMail({
      from: emailUser,
      to: emailTo,
      subject: `[PREVIEW] ${subject}`,
      text: `⚠️ Isto é uma pré-visualização com dados inventados, não um alerta real.\n\n${text}`,
    });
    console.log("✅ Email de pré-visualização enviado com sucesso.");
    return;
  }

  const serviceAccountRaw = requireEnv("FIREBASE_SERVICE_ACCOUNT");
  const serviceAccount = JSON.parse(serviceAccountRaw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const watchSnap = await db.collection("reentryWatch").where("active", "==", true).get();
  console.log(`🔎 ${watchSnap.size} ativo(s) ativo(s) em reentryWatch.`);

  let checked = 0;
  let errors = 0;
  const alerts = []; // { ticker, nome, threshold, dropPct, exitPrice, currentPrice, watchDoc, notified }

  for (const watchDoc of watchSnap.docs) {
    const watch = watchDoc.data();
    const ticker = watch.ticker || watchDoc.id;

    try {
      checked++;
      const exitPrice = Number(watch.exitPrice);
      if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
        console.warn(`⚠️ ${ticker}: exitPrice inválido, a saltar.`);
        continue;
      }

      const priceDoc = await db.collection("acoesDividendos").doc(ticker).get();
      if (!priceDoc.exists) {
        console.warn(`⚠️ ${ticker}: sem documento em acoesDividendos, a saltar.`);
        continue;
      }
      const currentPrice = Number(priceDoc.data()?.valorStock);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
        console.warn(`⚠️ ${ticker}: valorStock inválido, a saltar.`);
        continue;
      }

      const dropPct = ((exitPrice - currentPrice) / exitPrice) * 100;
      const notified = Array.isArray(watch.notifiedThresholds) ? watch.notifiedThresholds : [];
      const newlyCrossed = THRESHOLDS.filter((t) => dropPct >= t && !notified.includes(t));

      if (newlyCrossed.length === 0) continue;

      const nome = watch.nome || ticker;
      for (const threshold of newlyCrossed) {
        alerts.push({ ticker, nome, threshold, dropPct, exitPrice, currentPrice });
      }

      await watchDoc.ref.update({
        notifiedThresholds: [...new Set([...notified, ...newlyCrossed])],
      });
    } catch (err) {
      errors++;
      console.error(`❌ Erro ao processar ${ticker}:`, err.message || err);
    }
  }

  if (alerts.length > 0) {
    // Um único email a resumir todos os alertas desta corrida, em vez de um
    // email por threshold atingido (menos spam do que no Telegram).
    const { subject, text } = buildAlertEmail(alerts);
    await transporter.sendMail({ from: emailUser, to: emailTo, subject, text });
    console.log(`✅ Email enviado com ${alerts.length} alerta(s).`);
  }

  console.log(`✅ Verificados: ${checked} | Alertas enviados: ${alerts.length} | Erros: ${errors}`);
}

main().catch((err) => {
  console.error("❌ Falha fatal:", err);
  process.exit(1);
});
