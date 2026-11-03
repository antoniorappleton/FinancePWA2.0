// scripts/alerts/check-reentry-alerts.mjs
//
// Corre fora da app (GitHub Actions, cron diário) para enviar um alerta
// Telegram quando um ativo em `reentryWatch` (posições fechadas de "boas
// empresas", ver js/screens/dashboard.js:syncReentryWatchlist) cai -7%/-10%/
// -15% desde o preço a que a posição foi vendida.
//
// Variáveis de ambiente obrigatórias:
//   FIREBASE_SERVICE_ACCOUNT  JSON da conta de serviço (Firebase Admin SDK)
//   TELEGRAM_BOT_TOKEN        token do bot (@BotFather)
//   TELEGRAM_CHAT_ID          chat para onde enviar as mensagens

import admin from "firebase-admin";

const THRESHOLDS = [7, 10, 15];

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Variável de ambiente em falta: ${name}`);
    process.exit(1);
  }
  return value;
}

async function sendTelegramMessage(token, chatId, text) {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Telegram sendMessage falhou (${res.status}): ${body.slice(0, 500)}`);
  }
}

function formatEUR(value) {
  return new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(value);
}

// Telegram parse_mode "HTML" interpreta &, < e > como marcação — nomes de
// ativos reais contêm "&" com frequência (ex: "S&P 500 Information Tech"),
// por isso tudo o que vem dos dados tem de ser escapado antes de entrar no texto.
function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function main() {
  const serviceAccountRaw = requireEnv("FIREBASE_SERVICE_ACCOUNT");
  const botToken = requireEnv("TELEGRAM_BOT_TOKEN");
  const chatId = requireEnv("TELEGRAM_CHAT_ID");

  const serviceAccount = JSON.parse(serviceAccountRaw);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  const db = admin.firestore();

  const watchSnap = await db.collection("reentryWatch").where("active", "==", true).get();
  console.log(`🔎 ${watchSnap.size} ativo(s) ativo(s) em reentryWatch.`);

  let sent = 0;
  let checked = 0;
  let errors = 0;

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
      const tickerSafe = escapeHtml(ticker);
      const nomeSafe = escapeHtml(nome);
      for (const threshold of newlyCrossed) {
        const text =
          `📉 <b>Oportunidade de reentrada: ${tickerSafe}</b>\n` +
          `${nomeSafe}\n\n` +
          `Caiu <b>${dropPct.toFixed(1)}%</b> desde a saída (atingiu o nível -${threshold}%).\n` +
          `Preço de saída: ${formatEUR(exitPrice)}\n` +
          `Preço atual: ${formatEUR(currentPrice)}`;
        await sendTelegramMessage(botToken, chatId, text);
        sent++;
      }

      await watchDoc.ref.update({
        notifiedThresholds: [...new Set([...notified, ...newlyCrossed])],
      });
    } catch (err) {
      errors++;
      console.error(`❌ Erro ao processar ${ticker}:`, err.message || err);
    }
  }

  console.log(`✅ Verificados: ${checked} | Alertas enviados: ${sent} | Erros: ${errors}`);
}

main().catch((err) => {
  console.error("❌ Falha fatal:", err);
  process.exit(1);
});
