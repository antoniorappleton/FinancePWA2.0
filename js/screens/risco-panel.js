// Painel de Risco Sistémico — HY OAS · MOVE · VIX
// Persistência: localStorage (dados pessoais de tracking, não precisam Firestore)
// Auto-fetch: HY OAS via FRED API (chave gratuita). MOVE e VIX são manuais (sem API pública sem CORS).

const LS_KEY = 'appfinance-risk-panel-v1';
const LS_FRED_KEY = 'appfinance-fred-api-key';

const INDICATORS = [
  {
    id: 'hyoas', name: 'HY OAS', full: 'High Yield Spread (%)',
    zones: [
      { max: 3,   label: 'Calmo',   col: '#16a34a' },
      { max: 4.5, label: 'Normal',  col: '#2563eb' },
      { max: 6,   label: 'Elevado', col: '#d97706' },
      { max: 8,   label: 'Stress',  col: '#ea580c' },
      { max: 999, label: 'Crise',   col: '#dc2626' },
    ],
    scaleMax: 8, dflt: 2.63, suffix: '%',
  },
  {
    id: 'move', name: 'MOVE', full: 'ICE BofA MOVE Index',
    zones: [
      { max: 80,  label: 'Calmo',   col: '#16a34a' },
      { max: 120, label: 'Normal',  col: '#2563eb' },
      { max: 150, label: 'Elevado', col: '#d97706' },
      { max: 200, label: 'Stress',  col: '#ea580c' },
      { max: 999, label: 'Extremo', col: '#dc2626' },
    ],
    scaleMax: 200, dflt: 66.79, suffix: '',
  },
  {
    id: 'vix', name: 'VIX', full: 'CBOE Volatility Index',
    zones: [
      { max: 15, label: 'Calmo',   col: '#16a34a' },
      { max: 20, label: 'Normal',  col: '#2563eb' },
      { max: 30, label: 'Elevado', col: '#d97706' },
      { max: 40, label: 'Stress',  col: '#ea580c' },
      { max: 99, label: 'Crise',   col: '#dc2626' },
    ],
    scaleMax: 40, dflt: 18.41, suffix: '',
  },
];

function zoneFor(ind, val) {
  return ind.zones.find(z => val <= z.max) ?? ind.zones.at(-1);
}
function zoneIndex(ind, val) {
  const i = ind.zones.findIndex(z => val <= z.max);
  return i === -1 ? ind.zones.length - 1 : i;
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /**/ }
  return { state: {}, history: [] };
}

function saveData(state, history) {
  localStorage.setItem(LS_KEY, JSON.stringify({ state, history }));
}

function compositeReading(state) {
  const elevated = INDICATORS.filter(ind => zoneIndex(ind, state[ind.id] ?? ind.dflt) >= 2).length;
  const configs = [
    {
      label: 'Sem sinais', icon: '✓', col: '#16a34a',
      desc: 'Os 3 indicadores estão em zona calma ou normal. Sem stress sistémico — manter o plano sem alterações.',
    },
    {
      label: 'Sinal isolado', icon: '◐', col: '#d97706',
      desc: 'Apenas 1 indicador está elevado. Pode ser ruído idiossincrático — vigiar nos próximos dias, não accionar a reserva ainda.',
    },
    {
      label: 'Confirmação parcial', icon: '⚠', col: '#ea580c',
      desc: '2 dos 3 indicadores confirmam stress. Atenção redobrada — reconsiderar timing de novas entradas em satélites de maior beta.',
    },
    {
      label: 'Confirmação total', icon: '⛔', col: '#dc2626',
      desc: 'Os 3 indicadores confirmam stress sistémico em simultâneo. Gatilho real para activar a reserva conforme as regras definidas.',
    },
  ];
  return { ...configs[elevated], elevated };
}

function buildHTML(state, history) {
  const reading = compositeReading(state);
  const fredKey = localStorage.getItem(LS_FRED_KEY) || '';

  const cards = INDICATORS.map(ind => {
    const val = state[ind.id] ?? ind.dflt;
    const zone = zoneFor(ind, val);
    const pct = Math.min(100, (val / ind.scaleMax) * 100);
    const updated = state[`${ind.id}_updated`] || '—';
    return `
      <div class="rp-card" style="border-top:3px solid ${zone.col}">
        <div class="rp-card-head">
          <div class="rp-lbl">${ind.name}</div>
          <div class="rp-full">${ind.full}</div>
          <div class="rp-val-row">
            <span class="rp-val" style="color:${zone.col}">${val}${ind.suffix}</span>
            <span class="rp-badge" style="color:${zone.col};border-color:${zone.col}55;background:${zone.col}18">${zone.label}</span>
          </div>
        </div>
        <div class="rp-card-body">
          <div class="rp-bar-bg"><div style="height:100%;border-radius:2px;width:${pct}%;background:${zone.col}"></div></div>
          <div class="rp-bar-labels"><span>0</span><span>${ind.scaleMax}+</span></div>
          <div class="rp-input-row">
            <input type="text" id="rp-input-${ind.id}" placeholder="novo valor" inputmode="decimal"
              onkeydown="if(event.key==='Enter') window._rpUpdate('${ind.id}')">
            <button onclick="window._rpUpdate('${ind.id}')">Actualizar</button>
          </div>
          <div class="rp-meta">Última: ${updated}</div>
        </div>
      </div>`;
  }).join('');

  const histRows = history.length === 0
    ? '<tr><td colspan="5" class="rp-empty">Sem histórico — actualiza os valores acima para começar.</td></tr>'
    : history.map(h => {
        const col = h.reading === 'Sem sinais' ? '#16a34a'
          : h.reading === 'Sinal isolado' ? '#d97706'
          : h.reading === 'Confirmação parcial' ? '#ea580c' : '#dc2626';
        return `<tr>
          <td>${h.date}</td><td>${h.hyoas}%</td><td>${h.move}</td><td>${h.vix}</td>
          <td style="color:${col};font-weight:600">${h.reading}</td>
        </tr>`;
      }).join('');

  return `
    <div class="rp-composite" style="border-color:${reading.col}44;background:${reading.col}0D">
      <span class="rp-icon">${reading.icon}</span>
      <div style="flex:1">
        <div style="font-weight:700;color:${reading.col};font-size:14px">${reading.label}</div>
        <div class="rp-meta" style="margin-top:3px">${reading.desc}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;font-size:11px;color:var(--muted-foreground)">
        Elevados<br><b style="font-size:20px;color:${reading.col}">${reading.elevated} / 3</b>
      </div>
    </div>

    <div class="rp-fetch-box">
      <div style="font-size:12px;font-weight:600;margin-bottom:8px">Actualização automática · HY OAS via FRED</div>
      <div class="rp-fetch-row">
        <input type="password" id="rp-fred-key" autocomplete="off"
          placeholder="FRED API Key (gratuita em fred.stlouisfed.org/docs/api/api_key.html)" value="${fredKey}">
        <button id="rp-fetch-btn" class="btn" style="white-space:nowrap;padding:6px 12px;font-size:12px">Actualizar HY OAS</button>
      </div>
      <div class="rp-meta" style="margin-top:6px">
        MOVE e VIX não têm API pública acessível de browser sem CORS — actualiza manualmente nos cards abaixo.
      </div>
      <div id="rp-fetch-status" class="rp-meta" style="margin-top:4px;font-family:monospace"></div>
    </div>

    <div class="rp-cards">${cards}</div>

    <div style="margin-top:20px">
      <div style="font-weight:600;font-size:14px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:10px">
        Histórico de Leituras
      </div>
      <table class="rp-table">
        <thead><tr><th>Data</th><th>HY OAS</th><th>MOVE</th><th>VIX</th><th>Leitura</th></tr></thead>
        <tbody>${histRows}</tbody>
      </table>
      <span class="rp-reset-link" onclick="window._rpResetHistory()">limpar histórico</span>
    </div>

    <div class="rp-meta" style="margin-top:16px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:8px">
      <strong>Zonas de referência:</strong>
      HY OAS — calmo &lt;3% · normal 3–4,5% · elevado 4,5–6% · stress 6–8% · crise &gt;8%.<br>
      MOVE — calmo &lt;80 · normal 80–120 · elevado 120–150 · stress 150–200 · extremo &gt;200.<br>
      VIX — calmo &lt;15 · normal 15–20 · elevado 20–30 · stress 30–40 · crise &gt;40.
    </div>`;
}

const STYLES = `
  .rp-composite{display:flex;gap:12px;align-items:center;padding:14px 16px;border-radius:10px;border:2px solid;margin-bottom:16px}
  .rp-icon{font-size:24px;flex-shrink:0}
  .rp-fetch-box{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:16px}
  .rp-fetch-row{display:flex;gap:8px;align-items:center}
  .rp-fetch-row input{flex:1;min-width:0;background:var(--muted);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--foreground);font-size:12px;font-family:monospace}
  .rp-fetch-row input:focus{outline:none;border-color:var(--primary)}
  .rp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  @media(max-width:640px){.rp-cards{grid-template-columns:1fr}}
  .rp-card{background:var(--card);border:1px solid var(--border);border-radius:10px;overflow:hidden}
  .rp-card-head{padding:12px 14px 8px}
  .rp-lbl{font-size:10px;color:var(--muted-foreground);text-transform:uppercase;letter-spacing:.05em;font-family:monospace}
  .rp-full{font-size:11px;color:var(--muted-foreground);margin-top:2px}
  .rp-val-row{display:flex;align-items:baseline;gap:8px;margin-top:6px}
  .rp-val{font-size:26px;font-weight:700;line-height:1}
  .rp-badge{font-size:10px;padding:2px 8px;border-radius:20px;border:1px solid;text-transform:uppercase;letter-spacing:.04em}
  .rp-card-body{padding:0 14px 12px}
  .rp-bar-bg{height:4px;background:var(--muted);border-radius:2px;overflow:hidden;margin:8px 0 4px}
  .rp-bar-labels{display:flex;justify-content:space-between;font-size:9px;color:var(--muted-foreground);font-family:monospace}
  .rp-input-row{display:flex;gap:6px;margin-top:10px}
  .rp-input-row input{flex:1;min-width:0;background:var(--muted);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--foreground);font-size:13px;font-family:monospace}
  .rp-input-row input:focus{outline:none;border-color:var(--primary)}
  .rp-input-row button{background:var(--primary);border:none;border-radius:6px;padding:6px 10px;color:var(--primary-foreground);font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap}
  .rp-meta{font-size:11px;color:var(--muted-foreground);line-height:1.5}
  .rp-table{width:100%;border-collapse:collapse;font-size:12px;font-family:monospace}
  .rp-table thead th{padding:7px 8px;text-align:left;color:var(--muted-foreground);font-size:10px;text-transform:uppercase;border-bottom:1px solid var(--border)}
  .rp-table tbody td{padding:8px 8px;border-bottom:1px solid var(--muted)}
  .rp-table tbody tr:last-child td{border-bottom:none}
  .rp-empty{text-align:center;padding:24px;color:var(--muted-foreground)}
  .rp-reset-link{font-size:10px;color:var(--muted-foreground);text-decoration:underline;cursor:pointer;margin-top:8px;display:inline-block}
`;

let _stylesInjected = false;
function injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  const el = document.createElement('style');
  el.textContent = STYLES;
  document.head.appendChild(el);
}

export function initRiscoPanel(mount) {
  injectStyles();
  let { state, history } = loadData();
  INDICATORS.forEach(ind => { if (!(ind.id in state)) state[ind.id] = ind.dflt; });

  function save() { saveData(state, history); }

  function addHistoryEntry() {
    const date = new Date().toLocaleDateString('pt-PT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const reading = compositeReading(state);
    const entry = { date, hyoas: state.hyoas, move: state.move, vix: state.vix, reading: reading.label };
    const idx = history.findIndex(h => h.date === date);
    if (idx >= 0) history[idx] = entry; else history.unshift(entry);
    history = history.slice(0, 30);
  }

  function rerender() {
    mount.innerHTML = buildHTML(state, history);
    bindEvents();
  }

  function updateValue(id) {
    const input = document.getElementById(`rp-input-${id}`);
    if (!input) return;
    const v = parseFloat(input.value.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    state[id] = v;
    state[`${id}_updated`] = new Date().toLocaleString('pt-PT', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    addHistoryEntry();
    save();
    rerender();
  }

  async function fetchHYOAS() {
    const keyInput = document.getElementById('rp-fred-key');
    const apiKey = keyInput?.value?.trim();
    const status = document.getElementById('rp-fetch-status');
    if (!apiKey) {
      status.textContent = '⚠ Introduz a chave FRED antes de actualizar.';
      return;
    }
    localStorage.setItem(LS_FRED_KEY, apiKey);
    status.textContent = 'A actualizar HY OAS…';
    try {
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=BAMLH0A0HYM2&api_key=${encodeURIComponent(apiKey)}&file_type=json&sort_order=desc&limit=1`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} — verifica a chave FRED`);
      const data = await res.json();
      if (data.error_message) throw new Error(data.error_message);
      const obs = data.observations?.[0];
      if (!obs || obs.value === '.') throw new Error('Sem dados disponíveis na série BAMLH0A0HYM2');
      const v = parseFloat(obs.value);
      state.hyoas = v;
      state.hyoas_updated = new Date().toLocaleString('pt-PT', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
      });
      addHistoryEntry();
      save();
      rerender();
      document.getElementById('rp-fetch-status').textContent = `✓ HY OAS actualizado: ${v}% (dado de ${obs.date})`;
    } catch (e) {
      if (status) status.textContent = `✗ ${e.message}`;
    }
  }

  function bindEvents() {
    window._rpUpdate = updateValue;
    window._rpResetHistory = () => { history = []; save(); rerender(); };
    document.getElementById('rp-fetch-btn')?.addEventListener('click', fetchHYOAS);
  }

  rerender();
}
