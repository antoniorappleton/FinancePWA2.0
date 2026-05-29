import { canon, cleanTicker } from "./scoring.js";
import { toNumStrict } from "./num.js";

function getMovementDate(data) {
  return data.dataCompra && typeof data.dataCompra.toDate === "function"
    ? data.dataCompra.toDate()
    : null;
}

function getSector(data, fallback = "") {
  const raw =
    data.setor ||
    data.sector ||
    data.Setor ||
    data.Sector ||
    data.industry ||
    data.Industry ||
    data.industria ||
    data.Industria ||
    data.segmento ||
    data.segment ||
    fallback ||
    "";

  let sector = canon(raw);
  if ((!sector || sector === "—") && String(data.ticker || "").includes(":")) {
    const prefix = String(data.ticker).split(":")[0].trim();
    if (prefix.length > 2) sector = canon(prefix);
  }

  return sector || "—";
}

/**
 * Aggregates Firestore "ativos" movements into current open/closed positions.
 * Uses the same FIFO lot logic as the Portfolio screen, so every screen counts
 * positions from the same source of truth.
 */
export function aggregatePortfolioPositions(snapshot) {
  const movements = [];
  const netQtyByTicker = new Map();

  snapshot?.forEach((docu) => {
    const data = docu.data();
    const qtd = toNumStrict(data.quantidade);
    const ticker = cleanTicker(String(data.ticker || "").toUpperCase());
    const quantity = Number.isFinite(qtd) ? qtd : 0;
    if (ticker) {
      netQtyByTicker.set(ticker, (netQtyByTicker.get(ticker) || 0) + quantity);
    }

    movements.push({
      data,
      id: docu.id,
      date: getMovementDate(data) || new Date(0),
      quantity,
    });
  });

  movements.sort((a, b) => {
    const byDate = a.date - b.date;
    if (byDate !== 0) return byDate;

    // Firestore ordering can differ between screens when several movements
    // share the same date. Processing buys first avoids false oversell states.
    const aIsBuy = a.quantity > 0 ? 0 : 1;
    const bIsBuy = b.quantity > 0 ? 0 : 1;
    if (aIsBuy !== bIsBuy) return aIsBuy - bIsBuy;

    return String(a.id || "").localeCompare(String(b.id || ""));
  });

  const groups = new Map();
  const movimentosAsc = [];

  for (const movement of movements) {
    const d = movement.data;
    const tickerRaw = String(d.ticker || "").toUpperCase();
    if (!tickerRaw) continue;

    const ticker = cleanTicker(tickerRaw);
    const qtd = toNumStrict(d.quantidade);
    const preco = toNumStrict(d.precoCompra);
    const safeQtd = Number.isFinite(qtd) ? qtd : 0;
    const safePreco = Number.isFinite(preco) ? preco : 0;

    const g = groups.get(ticker) || {
      ticker,
      nome: d.nome || ticker,
      setor: getSector(d),
      mercado: canon(d.mercado || d.market || d.Market || "") || "—",
      qtd: 0,
      custoMedio: 0,
      investido: 0,
      realizado: 0,
      objetivo: 0,
      link: "",
      anyObjSet: false,
      lastDate: null,
      lastDocId: null,
      lots: [],
      hasOversoldMovement: false,
      lastMovementQty: 0,
    };

    g.lastMovementQty = safeQtd;

    if (safeQtd > 0) {
      g.lots.push({ qty: safeQtd, preco: safePreco });
      g.qtd += safeQtd;
    } else if (safeQtd < 0) {
      const sellQtd = Math.abs(safeQtd);
      if (sellQtd > g.qtd) {
        g.hasOversoldMovement = true;
        console.warn(
          `⚠️ Venda de ${ticker} (${sellQtd}) excede posição atual (${g.qtd.toFixed(2)})`,
        );
      }

      let remainingToSell = Math.min(sellQtd, g.qtd);
      let custoBaseVenda = 0;
      let efetivaVenda = 0;

      while (remainingToSell > 0 && g.lots.length > 0) {
        const lot = g.lots[0];
        if (lot.qty <= remainingToSell) {
          custoBaseVenda += lot.qty * lot.preco;
          efetivaVenda += lot.qty;
          remainingToSell -= lot.qty;
          g.lots.shift();
        } else {
          custoBaseVenda += remainingToSell * lot.preco;
          efetivaVenda += remainingToSell;
          lot.qty -= remainingToSell;
          remainingToSell = 0;
        }
      }

      if (efetivaVenda > 0) {
        g.realizado += safePreco * efetivaVenda - custoBaseVenda;
      }

      g.qtd -= efetivaVenda;
      if (g.qtd <= 0) {
        g.qtd = 0;
        g.lots = [];
      }
    }

    if (g.lots.length > 0) {
      let totalCost = 0;
      let totalQty = 0;
      for (const lot of g.lots) {
        totalCost += lot.qty * lot.preco;
        totalQty += lot.qty;
      }
      g.custoMedio = totalQty > 0 ? totalCost / totalQty : 0;
    } else {
      g.custoMedio = 0;
    }

    g.investido = g.qtd * g.custoMedio;

    const obj = toNumStrict(d.objetivoFinanceiro);
    if (!g.anyObjSet && Number.isFinite(obj) && obj > 0) {
      g.objetivo = obj;
      if (d.linkExterno) g.link = d.linkExterno;
      g.anyObjSet = true;
    } else if (d.linkExterno && !g.link) {
      g.link = d.linkExterno;
    }

    if (!g.lastDate || (movement.date && movement.date > g.lastDate)) {
      g.lastDate = movement.date;
      g.lastDocId = movement.id;
    }

    g.nome = d.nome || g.nome;
    g.setor = getSector(d, g.setor);
    g.mercado = canon(d.mercado || d.market || d.Market || g.mercado) || "—";

    groups.set(ticker, g);
    movimentosAsc.push({
      date: movement.date,
      ticker,
      qtd: safeQtd,
      preco: safePreco,
      id: movement.id,
    });
  }

  const EPSILON = 0.000001;
  for (const [ticker, group] of groups.entries()) {
    const netQty = netQtyByTicker.get(ticker) || 0;

    // Active/closed status usually follows the true net quantity. When old
    // inconsistent oversells exist, a later buy should still reopen the asset
    // (JEDI); a latest sell should close it (NUKL).
    const latestMovementIsBuy = group.lastMovementQty > 0;
    const shouldClose =
      netQty <= EPSILON &&
      (!group.hasOversoldMovement || !latestMovementIsBuy);

    if (shouldClose) {
      group.qtd = 0;
      group.investido = 0;
      group.custoMedio = 0;
      group.lots = [];
      continue;
    }

    if (netQty > EPSILON && Math.abs(group.qtd - netQty) > EPSILON) {
      group.qtd = netQty;

      let remaining = netQty;
      const normalizedLots = [];
      for (let i = group.lots.length - 1; i >= 0 && remaining > EPSILON; i--) {
        const lot = group.lots[i];
        const qty = Math.min(lot.qty, remaining);
        normalizedLots.unshift({ qty, preco: lot.preco });
        remaining -= qty;
      }

      group.lots = normalizedLots;
      const totalCost = group.lots.reduce((sum, lot) => sum + lot.qty * lot.preco, 0);
      group.custoMedio = netQty > 0 ? totalCost / netQty : 0;
      group.investido = group.qtd * group.custoMedio;
    }
  }

  return {
    groups,
    groupsArr: Array.from(groups.values()),
    movimentosAsc,
    openPositions: Array.from(groups.values()).filter((g) => g.qtd > 0),
  };
}
