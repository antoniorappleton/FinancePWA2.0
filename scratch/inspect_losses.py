import urllib.request
import json
import ssl

project_id = "appfinance-812b2"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def fetch_collection(col_name):
    url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/{col_name}?pageSize=1000"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            data = json.loads(response.read().decode())
            return data.get('documents', [])
    except Exception as e:
        print(f"Error fetching {col_name}: {e}")
        return []

print("Fetching 'ativos'...")
ativos = fetch_collection("ativos")

target_tickers = ['SOL', 'NUKL', 'QDVF', 'IS0D']
txs_by_ticker = {t: [] for t in target_tickers}

for doc in ativos:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '').upper().strip()
    if ticker in target_tickers:
        qty = float(fields.get('quantidade', {}).get('doubleValue') or fields.get('quantidade', {}).get('integerValue') or 0)
        pr = float(fields.get('precoCompra', {}).get('doubleValue') or fields.get('precoCompra', {}).get('integerValue') or 0)
        tp = fields.get('tipoAcao', {}).get('stringValue', '')
        dt = fields.get('dataCompra', {}).get('timestampValue') or fields.get('dataCompra', {}).get('stringValue', '')
        txs_by_ticker[ticker].append((dt, tp, qty, pr, doc['name'].split('/')[-1]))

for ticker in target_tickers:
    print(f"\n=================== {ticker} TRANSACTIONS ===================")
    txs_by_ticker[ticker].sort()
    for tx in txs_by_ticker[ticker]:
        print(f"Date: {tx[0]} | Type: {tx[1]:<8} | Qty: {tx[2]:<10.4f} | Price: {tx[3]:<10.2f} | Doc ID: {tx[4]}")
