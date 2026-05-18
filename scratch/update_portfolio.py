import urllib.request
import json
import ssl
from datetime import datetime

project_id = "appfinance-812b2"
base_url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/ativos"

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

# 1. Fetch all docs
req = urllib.request.Request(base_url + "?pageSize=1000")
with urllib.request.urlopen(req, context=ctx) as response:
    data = json.loads(response.read().decode())

docs = data.get('documents', [])
docs_to_delete = []

for doc in docs:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '')
    if ticker in ['GRID', 'QDVE']:
        docs_to_delete.append(doc['name'])

# 2. Delete existing docs for GRID and QDVE
for doc_name in docs_to_delete:
    print(f"Deleting {doc_name}...")
    req = urllib.request.Request("https://firestore.googleapis.com/v1/" + doc_name, method="DELETE")
    try:
        with urllib.request.urlopen(req, context=ctx) as response:
            pass
    except Exception as e:
        print(f"Failed to delete {doc_name}: {e}")

# 3. Create consolidated doc for GRID
print("Creating consolidated GRID...")
grid_data = {
    "fields": {
        "ticker": {"stringValue": "GRID"},
        "nome": {"stringValue": "GRID ETF"},
        "tipoAcao": {"stringValue": "compra"},
        "quantidade": {"doubleValue": 9},
        "precoCompra": {"doubleValue": 517.91 / 9},
        "dataCompra": {"timestampValue": datetime.utcnow().isoformat() + "Z"},
        "mercado": {"stringValue": "Europeu"},
        "setor": {"stringValue": "Energia Limpa"}
    }
}
req = urllib.request.Request(base_url, data=json.dumps(grid_data).encode('utf-8'), headers={'Content-Type': 'application/json'}, method="POST")
with urllib.request.urlopen(req, context=ctx) as response:
    print("GRID created.")

# 4. Create consolidated doc for QDVE
print("Creating consolidated QDVE...")
# We will use PM = 36.31 but add a comment, or maybe we use 485.10 / 12.8? Let's use 36.31 because PM is more visible, wait, the user said "valor investido: 485,1".
# In their history, we could add TWO records to make both match? No, if (Q1+Q2)=12.8, the PM is (Q1*P1 + Q2*P2)/12.8 = Investido/12.8.
# Mathematically, PM is ALWAYS Investido / Qtd in this app.
# So we must pick one. Let's use Investido / Qtd = 485.10 / 12.8 to preserve invested capital.
qdve_data = {
    "fields": {
        "ticker": {"stringValue": "QDVE"},
        "nome": {"stringValue": "S&P 500 Technology"},
        "tipoAcao": {"stringValue": "compra"},
        "quantidade": {"doubleValue": 12.8},
        "precoCompra": {"doubleValue": 36.31},
        "dataCompra": {"timestampValue": datetime.utcnow().isoformat() + "Z"},
        "mercado": {"stringValue": "Americano SP500"},
        "setor": {"stringValue": "ETF iTech"}
    }
}
req = urllib.request.Request(base_url, data=json.dumps(qdve_data).encode('utf-8'), headers={'Content-Type': 'application/json'}, method="POST")
with urllib.request.urlopen(req, context=ctx) as response:
    print("QDVE created.")

print("Done!")
