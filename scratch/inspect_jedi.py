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

print("--- JEDI TRANSACTION RECORDS ---")
ativos = fetch_collection("ativos")
for doc in ativos:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '').upper().strip()
    if 'JEDI' in ticker:
        qty = fields.get('quantidade', {}).get('doubleValue') or fields.get('quantidade', {}).get('integerValue') or 0
        pr = fields.get('precoCompra', {}).get('doubleValue') or fields.get('precoCompra', {}).get('integerValue') or 0
        tp = fields.get('tipoAcao', {}).get('stringValue', '')
        dt = fields.get('dataCompra', {}).get('timestampValue') or fields.get('dataCompra', {}).get('stringValue', '')
        print(f"Doc ID: {doc['name'].split('/')[-1]:<20} | Ticker: {ticker:<10} | Type: {tp:<8} | Qty: {qty:<8} | Price: {pr:<8} | Date: {dt}")

print("\n--- JEDI METADATA RECORDS ---")
metadata = fetch_collection("acoesDividendos")
for doc in metadata:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '').upper().strip()
    if 'JEDI' in ticker:
        print(f"Doc ID: {doc['name'].split('/')[-1]:<20} | Ticker: {ticker:<10}")
        for k, v in fields.items():
            val = v.get('stringValue') or v.get('integerValue') or v.get('doubleValue') or v.get('timestampValue') or v.get('nullValue')
            print(f"  {k}: {val}")
        print("-" * 40)
