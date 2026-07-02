import urllib.request, json, ssl, sys
from datetime import datetime
from decimal import Decimal

PROJECT = 'appfinance-812b2'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
CTX = ssl.create_default_context(); CTX.check_hostname = False; CTX.verify_mode = ssl.CERT_NONE
SOURCE = 'trade_republic_statement_2025-01-01_2026-07-01'
DRY_RUN = '--dry-run' in sys.argv

def req_json(url, method='GET', body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={'Content-Type':'application/json'} if body is not None else {})
    with urllib.request.urlopen(req, context=CTX) as r:
        txt = r.read().decode()
        return json.loads(txt) if txt else {}

def fv(value):
    if isinstance(value, bool): return {'booleanValue': value}
    if isinstance(value, int): return {'integerValue': str(value)}
    if isinstance(value, float): return {'doubleValue': value}
    return {'stringValue': str(value)}

def doc_fields(fields):
    return {'fields': {k: fv(v) for k, v in fields.items()}}

def current_docs():
    out = []
    data = req_json(f'{BASE}/ativos?pageSize=1000')
    for d in data.get('documents', []):
        f = d.get('fields', {})
        def get(k):
            v = f.get(k, {})
            return v.get('stringValue') or v.get('integerValue') or v.get('doubleValue') or v.get('timestampValue')
        out.append({'name': d['name'], 'id': d['name'].split('/')[-1], 'ticker': str(get('ticker') or '').upper(), 'qtd': float(get('quantidade') or 0), 'preco': float(get('precoCompra') or 0), 'date': str(get('dataCompra') or ''), 'source': str(get('sourceStatementId') or '')})
    return out

def exists_marker(docs, marker):
    return any(d.get('source') == marker for d in docs)

def post_ativo(fields, marker):
    fields = dict(fields)
    fields['sourceStatementId'] = SOURCE
    fields['importMarker'] = marker
    if DRY_RUN:
        print('[DRY] ADD', marker, fields)
        return
    res = req_json(f'{BASE}/ativos', 'POST', doc_fields(fields))
    print('[OK] ADD', marker, res.get('name','').split('/')[-1])

def patch_doc(doc_name, fields, masks):
    url = f'https://firestore.googleapis.com/v1/{doc_name}'
    for m in masks:
        sep = '&' if '?' in url else '?'
        url += f'{sep}updateMask.fieldPaths={m}'
    if DRY_RUN:
        print('[DRY] PATCH', doc_name.split('/')[-1], fields)
        return
    req_json(url, 'PATCH', doc_fields(fields))
    print('[OK] PATCH', doc_name.split('/')[-1], fields)

missing_open_positions = [
    ('xrp_open_2026-02-12', {
        'ticker':'XRP', 'nome':'XRP', 'tipoAcao':'compra', 'quantidade':13.0, 'precoCompra':16.22/13.0,
        'dataCompra':'2026-02-12T00:00:00Z', 'mercado':'Criptomoedas', 'setor':'Criptomoedas', 'linkExterno':'ISIN XF000XRP0018', 'objetivoFinanceiro':0,
    }),
    ('xdwf_fraction_2026-04-16', {
        'ticker':'XDWF', 'nome':'MSCI World Financials', 'tipoAcao':'compra', 'quantidade':0.53684, 'precoCompra':20.00/0.53684,
        'dataCompra':'2026-04-16T00:00:00Z', 'mercado':'Mundial', 'setor':'ETF Finanças', 'linkExterno':'https://www.justetf.com/en/etf-profile.html?isin=IE00BM67HL84', 'objetivoFinanceiro':0,
    }),
    ('g2x_open_2026-03-23', {
        'ticker':'G2X', 'nome':'VanEck Gold Miners UCITS ETF', 'tipoAcao':'compra', 'quantidade':4.0, 'precoCompra':288.64/4.0,
        'dataCompra':'2026-03-23T00:00:00Z', 'mercado':'Mundial', 'setor':'ETF Mineração (Ouro)', 'linkExterno':'https://www.justetf.com/en/etf-profile.html?isin=IE00BQQP9F84', 'objetivoFinanceiro':0,
    }),
    ('aldrv_open_2025-07-10', {
        'ticker':'ALDRV', 'nome':'Drone Volt', 'tipoAcao':'compra', 'quantidade':1500.0, 'precoCompra':1921.00/1500.0,
        'dataCompra':'2025-07-10T00:00:00Z', 'mercado':'Europeu', 'setor':'Defesa', 'linkExterno':'ISIN FR001400SVN0', 'objetivoFinanceiro':0,
    }),
]

patches_by_id = {
    'VZCPoamMgOr67cnRB04d': {'quantidade': 2.81264, 'precoCompra': 252.00/2.81264},
    '68DHbnsDJSu8hf4QYWB3': {'quantidade': 1.53283, 'precoCompra': 335.92/1.53283},
    'EBCPaFkC2vUCIBxC4Aci': {'precoCompra': 526.78/1.5},
    'EofyU7jXYYBuSBP6RrsG': {'precoCompra': 340.60/4.0},
}

docs = current_docs()
for marker, fields in missing_open_positions:
    if exists_marker(docs, marker):
        print('[SKIP] already added', marker)
    else:
        post_ativo(fields, marker)

by_id = {d['id']: d for d in docs}
for doc_id, fields in patches_by_id.items():
    d = by_id.get(doc_id)
    if not d:
        print('[WARN] patch doc missing', doc_id)
        continue
    patch_doc(d['name'], fields, list(fields.keys()))

strategy_fields = {'availableCash': 2479.46}
patch_doc(f'projects/{PROJECT}/databases/(default)/documents/config/strategy', strategy_fields, ['availableCash'])
print('done', 'dry_run' if DRY_RUN else 'applied')
