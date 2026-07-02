import urllib.request, json, ssl
PROJECT='appfinance-812b2'
CTX=ssl.create_default_context(); CTX.check_hostname=False; CTX.verify_mode=ssl.CERT_NONE
BASE=f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'

def body(fields):
    out={}
    for k,v in fields.items():
        if isinstance(v, float): out[k]={'doubleValue':v}
        elif isinstance(v, int): out[k]={'integerValue':str(v)}
        else: out[k]={'stringValue':str(v)}
    return {'fields':out}

def patch(doc_id, fields):
    url=f'{BASE}/ativos/{doc_id}'
    for k in fields:
        url += ('&' if '?' in url else '?') + 'updateMask.fieldPaths=' + k
    req=urllib.request.Request(url, data=json.dumps(body(fields)).encode(), method='PATCH', headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req, context=CTX) as r: r.read()
    print('[OK]', doc_id, fields)

patches={
    # VWCE: exact Trade Republic quantities/amounts from the statement.
    'ZNuemzjIaLMFh6nSPGfQ': {'quantidade':0.289463, 'precoCompra':45.00/0.289463},
    'C39PxQSq5vg05bTlXvb7': {'quantidade':0.710537, 'precoCompra':113.01/0.710537},
    'UrdSsfjxplsPx2CyqBbj': {'quantidade':2.882189, 'precoCompra':458.00/2.882189},
    '9VQsKLAEtJKhvi7CDKkK': {'quantidade':0.964970, 'precoCompra':153.00/0.964970},
    'DyfPbKnNcxdDAPnbx97d': {'quantidade':2.009791, 'precoCompra':331.00/2.009791, 'dataCompra':'2026-06-03T00:00:00Z'},
    'd3Z51qN3J0JoUo3oFjNG': {'quantidade':1.365788, 'precoCompra':226.00/1.365788},
    # XDWF: May 8 buy amount is 223.87 for 6 units in the statement.
    'XwwkfdjWRB32bRmAzf92': {'precoCompra':223.87/6.0},
}
for doc_id, fields in patches.items(): patch(doc_id, fields)
