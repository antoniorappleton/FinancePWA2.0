// One-off importer: recria o histórico completo de movimentos do ticker NUKL
// (VanEck ETFs-Uran.Nuclear) a partir do extrato colado pelo utilizador em
// 2026-09-14. O ticker NUKL não tinha nenhum movimento na coleção "ativos"
// no momento da execução (posição foi apagada anteriormente).
//
// Uso:
//   node tmp/import_nukl_statement_2026-09-14.mjs --dry-run   (só mostra o que seria escrito)
//   node tmp/import_nukl_statement_2026-09-14.mjs             (escreve mesmo na Firestore)

const PROJECT = "appfinance-812b2";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const SOURCE = "nukl_statement_2026-09-14";
const DRY_RUN = process.argv.includes("--dry-run");

// Metadados herdados dos movimentos NUKL anteriores (já removidos da BD) e
// da ficha de mercado em acoesDividendos/NUKL — mantidos para consistência
// com o resto da carteira.
const META = {
  nome: "VanEck ETFs-Uran.Nuclear",
  setor: "ETF Energia",
  mercado: "Americano SP500",
  linkExterno: "https://www.justetf.com/en/etf-profile.html?isin=IE000M7V94E1",
  objetivoFinanceiro: 100,
};

// Extrato colado pelo utilizador (Data | Movimento | Quantidade | Valor da operação | Saldo).
// A quantidade de cada linha foi derivada validando a coluna "Saldo" (soma cumulativa
// bate certo em todas as 24 linhas, incluindo a posição fracionária de 0,281056 un.
// e o fecho exato a 0 em 18/05/2026).
const ROWS = [
  ["2026-03-23", "compra", 2,        94.88],
  ["2026-03-23", "compra", 2,        94.00],
  ["2026-03-23", "compra", 15,      735.70],
  ["2026-03-25", "venda",  2,        98.41],
  ["2026-03-26", "venda",  4,       198.90],
  ["2026-03-26", "compra", 2,        98.74],
  ["2026-04-13", "venda",  7,       345.75],
  ["2026-04-16", "compra", 2,       108.58],
  ["2026-04-16", "compra", 0.281056, 15.00],
  ["2026-04-24", "venda",  2,       106.80],
  ["2026-04-24", "venda",  0.281056, 15.15],
  ["2026-04-29", "compra", 2,       104.50],
  ["2026-05-11", "venda",  2,       109.60],
  ["2026-05-11", "compra", 6,       333.28],
  ["2026-05-12", "venda",  3,       161.66],
  ["2026-05-18", "venda",  4,       198.44],
  ["2026-05-18", "compra", 3,       151.30],
  ["2026-05-18", "venda",  7,       348.90],
  ["2026-05-18", "venda",  3,       149.06],
  ["2026-07-23", "compra", 8,       355.84],
  ["2026-07-29", "compra", 4,       169.04],
  ["2026-08-05", "compra", 7,       325.04],
  ["2026-08-26", "venda",  4,       196.70],
  ["2026-09-02", "compra", 7,       324.83],
];

function fv(value) {
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") {
    return Number.isInteger(value) ? { doubleValue: value } : { doubleValue: value };
  }
  return { stringValue: String(value) };
}

function docFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields)) out[k] = fv(v);
  return { fields: out };
}

async function reqJson(url, method = "GET", body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : {};
}

async function currentMarkers() {
  const data = await reqJson(`${BASE}/ativos?pageSize=1000`);
  const out = new Set();
  for (const d of data.documents || []) {
    const f = d.fields || {};
    const marker = f.importMarker?.stringValue;
    if (marker) out.add(marker);
  }
  return out;
}

async function main() {
  const existingMarkers = await currentMarkers();
  let saldo = 0;
  let created = 0;
  for (let i = 0; i < ROWS.length; i++) {
    const [dateStr, tipo, qtyAbs, valor] = ROWS[i];
    const signedQty = tipo === "venda" ? -qtyAbs : qtyAbs;
    saldo += signedQty;
    const preco = valor / qtyAbs;
    const marker = `${SOURCE}_${i.toString().padStart(2, "0")}`;
    // Espaça os movimentos do mesmo dia por minuto para preservar a ordem
    // cronológica original do extrato quando há vários movimentos na mesma data.
    const sameDayIndex = ROWS.slice(0, i).filter((r) => r[0] === dateStr).length;
    const iso = `${dateStr}T00:${String(sameDayIndex).padStart(2, "0")}:00Z`;

    const fields = {
      ticker: "NUKL",
      nome: META.nome,
      tipoAcao: tipo,
      quantidade: signedQty,
      precoCompra: preco,
      dataCompra: iso,
      mercado: META.mercado,
      setor: META.setor,
      linkExterno: META.linkExterno,
      objetivoFinanceiro: META.objetivoFinanceiro,
      sourceStatementId: SOURCE,
      importMarker: marker,
    };

    const label = `${dateStr} ${tipo.padEnd(6)} ${qtyAbs.toString().padStart(9)} un. @ ${preco.toFixed(4)} € (saldo ${saldo.toFixed(6)})`;

    if (existingMarkers.has(marker)) {
      console.log("[SKIP already imported]", label);
      continue;
    }
    if (DRY_RUN) {
      console.log("[DRY] ADD", label);
      continue;
    }
    const fieldsPayload = docFields(fields);
    // dataCompra precisa ser timestampValue, não stringValue — corrige antes de enviar.
    fieldsPayload.fields.dataCompra = { timestampValue: iso };
    const res = await reqJson(`${BASE}/ativos`, "POST", fieldsPayload);
    console.log("[OK] ADD", label, "->", res.name.split("/").pop());
    created++;
  }
  console.log(DRY_RUN ? "\nDry-run concluído (nada escrito)." : `\nConcluído: ${created} movimentos criados.`);
  console.log(`Saldo final calculado: ${saldo.toFixed(6)} unidades.`);
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
