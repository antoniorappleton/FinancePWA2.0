/**
 * alerts.js — sistema de alertas configuráveis para o portfólio.
 * Persiste em localStorage. Verifica triggers após cada atualização de dados.
 * Tipos suportados:
 *   - "preco_alvo"   : dispara quando preçoAtual >= targetPrice
 *   - "preco_queda"  : dispara quando preçoAtual <= targetPrice
 *   - "rsi_compra"   : dispara quando RSI <= threshold (zona de sobrevenda)
 *   - "rsi_venda"    : dispara quando RSI >= threshold (zona de sobrecompra)
 *   - "alocacao"     : dispara quando desvio do alvo > threshold %
 */

const STORAGE_KEY = "fin_alerts_v1";
const FIRED_KEY   = "fin_alerts_fired_v1";

export function loadAlerts() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); }
  catch { return []; }
}

export function saveAlerts(alerts) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(alerts)); } catch {}
}

export function addAlert(alert) {
  const alerts = loadAlerts();
  alerts.push({ ...alert, id: `${Date.now()}_${Math.random().toString(36).slice(2)}`, createdAt: new Date().toISOString(), fired: false });
  saveAlerts(alerts);
  return alerts;
}

export function deleteAlert(id) {
  const alerts = loadAlerts().filter(a => a.id !== id);
  saveAlerts(alerts);
  return alerts;
}

export function resetAlert(id) {
  const alerts = loadAlerts().map(a => a.id === id ? { ...a, fired: false, firedAt: null } : a);
  saveAlerts(alerts);
  return alerts;
}

/**
 * Verifica todos os alertas contra os dados atuais.
 * gruposArr: array de posições do portfólio (do aggregatePortfolioPositions)
 * infoMap: Map<ticker, acaoData> com rsi_14, valorStock, etc.
 * Devolve array de alertas disparados [{alert, message}].
 */
export function checkAlerts(gruposArr, infoMap) {
  const alerts = loadAlerts();
  if (!alerts.length) return [];

  const triggered = [];
  const updated = alerts.map(alert => {
    if (alert.fired) return alert;

    const ticker = (alert.ticker || "").toUpperCase();
    const g = gruposArr?.find(x => x.ticker === ticker);
    const info = infoMap?.get(ticker) || {};
    const precoAtual = Number(g?.precoAtual ?? info.valorStock ?? 0);
    const rsi = Number(info.rsi_14 ?? 0);

    let fire = false;
    let message = "";

    switch (alert.type) {
      case "preco_alvo":
        if (precoAtual > 0 && precoAtual >= Number(alert.value)) {
          fire = true;
          message = `${ticker} atingiu o alvo de ${Number(alert.value).toFixed(2)}€ (atual: ${precoAtual.toFixed(2)}€)`;
        }
        break;
      case "preco_queda":
        if (precoAtual > 0 && precoAtual <= Number(alert.value)) {
          fire = true;
          message = `${ticker} caiu para ${precoAtual.toFixed(2)}€ (alerta: ≤${Number(alert.value).toFixed(2)}€)`;
        }
        break;
      case "rsi_compra":
        if (rsi > 0 && rsi <= Number(alert.value)) {
          fire = true;
          message = `${ticker} entrou em zona de sobrevenda — RSI ${rsi.toFixed(0)} ≤ ${alert.value}`;
        }
        break;
      case "rsi_venda":
        if (rsi > 0 && rsi >= Number(alert.value)) {
          fire = true;
          message = `${ticker} em sobrecompra — RSI ${rsi.toFixed(0)} ≥ ${alert.value}`;
        }
        break;
      case "alocacao": {
        const totalInvestido = (gruposArr || []).filter(x => x.qtd > 0).reduce((s, x) => s + (x.investido || 0), 0);
        if (g && totalInvestido > 0) {
          const curW = ((g.investido || 0) / totalInvestido) * 100;
          const diff = Math.abs(curW - Number(alert.value));
          if (diff >= Number(alert.threshold || 5)) {
            fire = true;
            message = `${ticker} desviou ${diff.toFixed(1)}% do alvo de alocação ${Number(alert.value).toFixed(1)}% (atual: ${curW.toFixed(1)}%)`;
          }
        }
        break;
      }
    }

    if (fire) {
      triggered.push({ alert, message });
      return { ...alert, fired: true, firedAt: new Date().toISOString(), lastMessage: message };
    }
    return alert;
  });

  saveAlerts(updated);
  return triggered;
}

/** Mostra notificação nativa do browser (requer permissão) ou toast de fallback. */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export function notifyAlert(message, ticker) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(`📊 Alerta: ${ticker}`, {
      body: message,
      icon: "/icons/icon-192.png",
    });
  } else if (typeof window.showToast === "function") {
    window.showToast(`🔔 ${message}`, "info");
  }
}
