# Reconciliação do extrato Trade Republic 01 jan - 02 nov 2026 contra a coleção
# `ativos` do Firestore. Já foi corrido e aplicado em 2026-11-03 (ver commit).
# Mantido como registo histórico do que foi alterado e porquê — não é reutilizável
# tal como está para um extrato diferente (cada reconciliação é um diff pontual).
#
# Achados da reconciliação (24 de 26 tickers já batiam certo exatamente):
#   - TDK: venda de 2026-10-15 estava registada como -20.15 un., extrato dizia -20.5 un.
#   - TDK: compra de 2026-10-08 tinha preço unitário arredondado (19.13 vs 19.33 real).
#   - IE00BMTM6B32 (WisdomTree WTI Crude Oil 3x Daily Leveraged) nunca tinha sido
#     registado: 11 transações em falta (ticker novo "WTIO").
#   - IE00BMW42074 (iShares MSCI Europe Consumer Staples Sector) nunca tinha sido
#     registado: 2 transações em falta, net zero (ticker novo "XESC").
#   - `config/strategy.availableCash` NÃO foi tocado: é um valor de gestão de caixa
#     da estratégia (1228 no momento da reconciliação), não espelha 1:1 o saldo em
#     conta do extrato Trade Republic — confirmado antes de qualquer escrita.

import urllib.request, json, sys

PROJECT = 'appfinance-812b2'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
SOURCE = 'trade_republic_statement_2026-07-01_2026-11-02'
DRY_RUN = '--dry-run' in sys.argv

def req_json(url, method='GET', body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                  headers={'Content-Type': 'application/json'} if body is not None else {})
    with urllib.request.urlopen(req, timeout=30) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else {}

def fv(value):
    if isinstance(value, bool): return {'booleanValue': value}
    if isinstance(value, int): return {'integerValue': str(value)}
    if isinstance(value, float): return {'doubleValue': value}
    return {'stringValue': str(value)}

def doc_fields(fields):
    return {'fields': {k: fv(v) for k, v in fields.items()}}

def post_ativo(fields, marker):
    fields = dict(fields)
    fields['sourceStatementId'] = SOURCE
    fields['importMarker'] = marker
    if DRY_RUN:
        print('[DRY] ADD', marker, fields)
        return
    res = req_json(f'{BASE}/ativos', 'POST', doc_fields(fields))
    print('[OK] ADD', marker, '->', res.get('name', '').split('/')[-1])

def patch_doc(doc_id, fields):
    doc_name = f'projects/{PROJECT}/databases/(default)/documents/ativos/{doc_id}'
    url = f'https://firestore.googleapis.com/v1/{doc_name}'
    for m in fields:
        sep = '&' if '?' in url else '?'
        url += f'{sep}updateMask.fieldPaths={m}'
    if DRY_RUN:
        print('[DRY] PATCH', doc_id, fields)
        return
    req_json(url, 'PATCH', doc_fields(fields))
    print('[OK] PATCH', doc_id, fields)

# ---- 1) Correção: venda de TDK em 2026-10-15 estava -20.15, extrato diz -20.5 ----
patch_doc('sLpJodehc8mbXzT8FOFM', {'quantidade': -20.5, 'precoCompra': 328.56 / 20.5})

# ---- 2) Correção: compra de TDK em 2026-10-08, preço unitário vs total 101,04 EUR ----
patch_doc('OEAfw9VkENaZU1SHT5J8', {'quantidade': 5.227391, 'precoCompra': 101.04 / 5.227391})

# ---- 3) Ticker em falta: IE00BMTM6B32 (WisdomTree WTI Crude Oil 3x Daily Leveraged) ----
WTIO = dict(ticker='WTIO', nome='WisdomTree WTI Crude Oil 3x Daily Leveraged',
            mercado='Mundial', setor='Commodities (Petroleo)',
            linkExterno='ISIN IE00BMTM6B32', objetivoFinanceiro=0)

wtio_rows = [
    ('2026-09-29', 'compra', 19.24187, 1001.04),
    ('2026-09-29', 'venda', 19.24187, 994.92),
    ('2026-10-06', 'compra', 4, 205.40),
    ('2026-10-06', 'compra', 4, 197.42),
    ('2026-10-06', 'venda', 8, 421.60),
    ('2026-10-22', 'compra', 2, 143.21),
    ('2026-10-26', 'venda', 2, 149.16),
    ('2026-10-28', 'compra', 6, 492.50),
    ('2026-10-30', 'venda', 6, 494.26),
    ('2026-11-02', 'compra', 5, 375.74),
    ('2026-11-02', 'venda', 2.5, 165.71),
]
for i, (date, kind, qty, total) in enumerate(wtio_rows):
    signed_qty = qty if kind == 'compra' else -qty
    fields = dict(WTIO)
    fields.update(tipoAcao=kind, quantidade=signed_qty, precoCompra=total / qty,
                  dataCompra=f'{date}T00:00:00Z')
    post_ativo(fields, f'wtio_{date}_{i}')

# ---- 4) Ticker em falta: IE00BMW42074 (iShares MSCI Europe Consumer Staples Sector) ----
XESC = dict(ticker='XESC', nome='iShares MSCI Europe Consumer Staples Sector',
            mercado='Europeu', setor='Consumo Defensivo',
            linkExterno='ISIN IE00BMW42074', objetivoFinanceiro=0)

xesc_rows = [
    ('2026-09-29', 'compra', 87.06251, 501.04),
    ('2026-09-29', 'venda', 87.06251, 498.87),
]
for i, (date, kind, qty, total) in enumerate(xesc_rows):
    signed_qty = qty if kind == 'compra' else -qty
    fields = dict(XESC)
    fields.update(tipoAcao=kind, quantidade=signed_qty, precoCompra=total / qty,
                  dataCompra=f'{date}T00:00:00Z')
    post_ativo(fields, f'xesc_{date}_{i}')

print('done', 'dry_run' if DRY_RUN else 'applied')
