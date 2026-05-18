import urllib.request
import json

project_id = "appfinance-812b2"
url = f"https://firestore.googleapis.com/v1/projects/{project_id}/databases/(default)/documents/ativos?pageSize=1000"

req = urllib.request.Request(url)
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())

docs = data.get('documents', [])

for doc in docs:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '')
    if ticker in ['GRID', 'QDVE']:
        print(f"Doc ID: {doc['name'].split('/')[-1]}")
        for k, v in fields.items():
            val = v.get('stringValue') or v.get('integerValue') or v.get('doubleValue') or v.get('timestampValue') or v.get('nullValue')
            print(f"  {k}: {val}")
        print("-" * 20)
