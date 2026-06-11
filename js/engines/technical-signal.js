// js/engines/technical-signal.js
// Composite technical signal for UI decisions. It deliberately avoids single
// indicator calls such as "RSI < 40 = buy" and requires trend confirmation.

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function num(value, fallback = NaN) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value, fallback = NaN) {
  const n = num(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function formatReason(label, value, formatter = (v) => String(v)) {
  if (!Number.isFinite(value)) return null;
  return `${label}: ${formatter(value)}`;
}

export function technicalSignal(asset = {}) {
  const price = num(asset.valorStock ?? asset.price ?? asset.precoAtual, 0);
  const sma50 = num(asset.sma50 ?? asset.SMA50);
  const sma200 = num(asset.sma200 ?? asset.SMA200);
  const rsi = num(asset.rsi_14 ?? asset.rsi14 ?? asset.RSI);
  const g1w = pct(asset.priceChange_1w ?? asset.taxaCrescimento_1semana ?? asset.g1w);
  const g1m = pct(asset.priceChange_1m ?? asset.taxaCrescimento_1mes ?? asset.g1m);
  const g1y = pct(asset.priceChange_1y ?? asset.taxaCrescimento_1ano ?? asset.g1y);
  const volMonth = Math.abs(pct(asset.vol_month ?? asset.volMonth, NaN));

  const delta50 =
    Number.isFinite(price) && price > 0 && Number.isFinite(sma50) && sma50 > 0
      ? (price - sma50) / sma50
      : pct(asset.delta50);
  const delta200 =
    Number.isFinite(price) && price > 0 && Number.isFinite(sma200) && sma200 > 0
      ? (price - sma200) / sma200
      : pct(asset.delta200);

  let score = 50;
  const positives = [];
  const negatives = [];
  const warnings = [];

  if (Number.isFinite(delta200)) {
    if (delta200 > 0) {
      score += 18;
      positives.push("preco acima da SMA200");
    } else {
      score -= 22;
      negatives.push("preco abaixo da SMA200");
    }
  }

  if (Number.isFinite(delta50)) {
    if (delta50 > 0) {
      score += 10;
      positives.push("preco acima da SMA50");
    } else {
      score -= 10;
      negatives.push("preco abaixo da SMA50");
    }
  }

  if (Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 > 0 && sma200 > 0) {
    if (sma50 > sma200) {
      score += 10;
      positives.push("estrutura SMA50>SMA200");
    } else {
      score -= 12;
      negatives.push("estrutura SMA50<SMA200");
    }
  }

  if (Number.isFinite(g1m)) {
    if (g1m > 0.04) {
      score += 10;
      positives.push("momentum 1M positivo");
    } else if (g1m < -0.06) {
      score -= 12;
      negatives.push("momentum 1M negativo");
    }
  }

  if (Number.isFinite(g1y)) {
    if (g1y > 0.10) score += 8;
    else if (g1y < -0.15) score -= 10;
  }

  if (Number.isFinite(g1w) && Number.isFinite(g1m) && g1w > 0.12 && g1m < 0) {
    score -= 12;
    warnings.push("spike semanal sem confirmacao mensal");
  }

  if (Number.isFinite(rsi)) {
    if (rsi >= 75) {
      score -= 16;
      warnings.push("RSI sobrecomprado");
    } else if (rsi >= 60) {
      score += 4;
      positives.push("RSI com forca");
    } else if (rsi >= 45) {
      score += 2;
    } else if (rsi >= 30) {
      if (Number.isFinite(delta200) && delta200 > 0) {
        score += 8;
        positives.push("pullback com tendencia intacta");
      } else {
        score -= 4;
        warnings.push("RSI fraco sem confirmacao de tendencia");
      }
    } else {
      if (Number.isFinite(delta200) && delta200 > 0) {
        score += 4;
        warnings.push("oversold em tendencia positiva");
      } else {
        score -= 12;
        warnings.push("oversold em tendencia negativa");
      }
    }
  }

  score = Math.round(clamp(score, 0, 100));

  let key = "neutral";
  let label = "Neutro";
  let action = "Aguardar";
  if (score >= 78) {
    key = "breakout";
    label = "Breakout / Forca";
    action = "Observar entrada";
  } else if (score >= 64) {
    key = "bullish";
    label = "Tendencia positiva";
    action = "Manter / acumular";
  } else if (score >= 52 && warnings.some((w) => w.includes("oversold") || w.includes("pullback"))) {
    key = "pullback";
    label = "Pullback tecnico";
    action = "Comprar por fases";
  } else if (score <= 32) {
    key = "downtrend";
    label = "Queda estrutural";
    action = "Evitar reforco";
  } else if (score <= 44) {
    key = "weak";
    label = "Tecnico fraco";
    action = "Esperar confirmacao";
  }

  const dynamicDrop1 = Number.isFinite(volMonth)
    ? clamp(volMonth * 0.6, 0.025, 0.08)
    : 0.035;
  const dynamicDrop2 = Number.isFinite(volMonth)
    ? clamp(volMonth * 1.0, 0.045, 0.12)
    : 0.05;

  const support1 = price > 0 ? price * (1 - dynamicDrop1) : 0;
  const support2 = price > 0 ? price * (1 - dynamicDrop2) : 0;

  const metrics = [
    formatReason("RSI", rsi, (v) => v.toFixed(0)),
    formatReason("Delta SMA50", delta50, (v) => `${(v * 100).toFixed(1)}%`),
    formatReason("Delta SMA200", delta200, (v) => `${(v * 100).toFixed(1)}%`),
    formatReason("1M", g1m, (v) => `${(v * 100).toFixed(1)}%`),
  ].filter(Boolean);

  return {
    score,
    key,
    label,
    action,
    className: `technical-signal technical-${key}`,
    positives,
    negatives,
    warnings,
    support1,
    support2,
    drop1: dynamicDrop1,
    drop2: dynamicDrop2,
    tooltip: [...metrics, ...positives, ...negatives, ...warnings].slice(0, 8).join(" | "),
  };
}
