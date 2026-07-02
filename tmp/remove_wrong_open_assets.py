import urllib.request, json, ssl
PROJECT='appfinance-812b2'
BASE=f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
CTX=ssl.create_default_context(); CTX.check_hostname=False; CTX.verify_mode=ssl.CERT_NONE
MARKERS={'xrp_open_2026-02-12','xdwf_fraction_2026-04-16','g2x_open_2026-03-23','aldrv_open_2025-07-10'}

def req(url, method='GET'):
    r=urllib.request.Request(url, method=method)
    with urllib.request.urlopen(r, context=CTX) as res:
        txt=res.read().decode()
        return json.loads(txt) if txt else {}

data=req(f'{BASE}/ativos?pageSize=1000')
deleted=[]
for d in data.get('documents',[]):
    f=d.get('fields',{})
    marker=f.get('importMarker',{}).get('stringValue','')
    if marker in MARKERS:
        req('https://firestore.googleapis.com/v1/'+d['name'], method='DELETE')
        deleted.append((marker,d['name'].split('/')[-1]))
print('deleted', len(deleted))
for item in deleted:
    print(item[0], item[1])
