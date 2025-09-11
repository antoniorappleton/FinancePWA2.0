import { db } from "../firebase-config.js";
import {
  collection,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/* ===============================
   Helpers (podes importar do outro ficheiro se modularizares)
   =============================== */
function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isFiniteNum(v) {
  return Number.isFinite(Number(v));
}

/* ===============================
   INIT (screen)
   =============================== */
export async function initScreen() {
  const tbody = document.getElementById("analysisTableBody");
  if (!tbody) return;

  tbody.innerHTML = "<tr><td colspan='11'>A carregar…</td></tr>";

  try {
    const snap = await getDocs(collection(db, "acoesDividendos"));
    if (snap.empty) {
      tbody.innerHTML = "<tr><td colspan='11'>Sem dados.</td></tr>";
      return;
    }

    const arr = [];
    snap.forEach((d) => arr.push(d.data()));

    // KPIs agregados
    const totalInvest = arr.reduce((a, d) => a + toNum(d.valorStock || 0), 0); // simplificação
    const pePond =
      arr.reduce((a, d) => a + (toNum(d.peRatio) || 0), 0) / arr.length;
    const yieldPond =
      arr.reduce((a, d) => {
        const y = (toNum(d.dividendo) / toNum(d.valorStock)) * 100;
        return a + y;
      }, 0) / arr.length;

    document.getElementById("anPEpond").textContent = pePond.toFixed(1);
    document.getElementById("anYieldPond").textContent =
      yieldPond.toFixed(2) + "%";

    // Tabela
    tbody.innerHTML = arr
      .map((d) => {
        const price = toNum(d.valorStock);
        const yNow =
          price > 0
            ? ((toNum(d.dividendo) / price) * 100).toFixed(2) + "%"
            : "—";
        const y24 =
          price > 0
            ? ((toNum(d.dividendoMedio24m) / price) * 100).toFixed(2) + "%"
            : "—";
        const delta50 = d.sma50
          ? (((price - d.sma50) / d.sma50) * 100).toFixed(1) + "%"
          : "—";
        const delta200 = d.sma200
          ? (((price - d.sma200) / d.sma200) * 100).toFixed(1) + "%"
          : "—";

        return `<tr>
        <td>${d.ticker}</td>
        <td>${yNow}</td>
        <td>${y24}</td>
        <td>${d.peRatio || "—"}</td>
        <td>${delta50}</td>
        <td>${delta200}</td>
        <td>${d.taxaCrescimento_1semana || "—"}</td>
        <td>${d.taxaCrescimento_1mes || "—"}</td>
        <td>${d.taxaCrescimento_1ano || "—"}</td>
        <td>${d.periodicidade || "—"}</td>
        <td>${d.mes || "—"}</td>
      </tr>`;
      })
      .join("");

    // TODO: chamar funções para desenhar gráficos chartYieldPE e chartDivCal
  } catch (e) {
    console.error("Erro análise:", e);
    tbody.innerHTML = "<tr><td colspan='11'>Erro ao carregar dados.</td></tr>";
  }
}