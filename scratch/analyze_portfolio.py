import urllib.request
import json
import ssl
from datetime import datetime

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

print("Fetching transaction records ('ativos')...")
ativos_docs = fetch_collection("ativos")
print(f"Fetched {len(ativos_docs)} transaction records.")

print("Fetching asset metadata ('acoesDividendos')...")
metadata_docs = fetch_collection("acoesDividendos")
print(f"Fetched {len(metadata_docs)} metadata records.")

# Parse current prices
prices = {}
for doc in metadata_docs:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '').upper().strip()
    price_val = fields.get('valorStock', {}).get('doubleValue') or fields.get('valorStock', {}).get('integerValue') or fields.get('valorStock', {}).get('stringValue')
    if price_val is not None:
        try:
            prices[ticker] = float(price_val)
        except ValueError:
            pass

# Parse transactions and sort them chronologically
parsed_txs = []
for doc in ativos_docs:
    fields = doc.get('fields', {})
    ticker = fields.get('ticker', {}).get('stringValue', '').upper().strip()
    if not ticker:
        continue
    
    qty = float(fields.get('quantidade', {}).get('doubleValue') or fields.get('quantidade', {}).get('integerValue') or 0)
    preco = float(fields.get('precoCompra', {}).get('doubleValue') or fields.get('precoCompra', {}).get('integerValue') or 0)
    
    # Parse timestamp
    dt_str = fields.get('dataCompra', {}).get('timestampValue') or fields.get('dataCompra', {}).get('stringValue') or ""
    dt = datetime.min
    if dt_str:
        try:
            # strip trailing Z and fractional seconds if necessary
            clean_dt = dt_str.replace("Z", "")
            if "." in clean_dt:
                clean_dt = clean_dt.split(".")[0]
            dt = datetime.fromisoformat(clean_dt)
        except Exception:
            pass
            
    parsed_txs.append({
        'ticker': ticker,
        'qtd': qty,
        'preco': preco,
        'date': dt
    })

# SORT CHRONOLOGICALLY
parsed_txs.sort(key=lambda x: x['date'])

# Process sorted transactions
grupos = {}
for tx in parsed_txs:
    ticker = tx['ticker']
    qty = tx['qtd']
    preco = tx['preco']
    
    if ticker not in grupos:
        grupos[ticker] = {
            'ticker': ticker,
            'qtd': 0.0,
            'investido': 0.0,
            'realizado': 0.0,
            'lots': []
        }
    
    g = grupos[ticker]
    
    if qty > 0:
        g['lots'].append({'qty': qty, 'preco': preco})
        g['qtd'] += qty
    elif qty < 0:
        sell_qty = abs(qty)
        remaining_to_sell = min(sell_qty, g['qtd'])
        custo_base_venda = 0.0
        efetiva_venda = 0.0
        
        while remaining_to_sell > 0 and len(g['lots']) > 0:
            lot = g['lots'][0]
            if lot['qty'] <= remaining_to_sell:
                custo_base_venda += lot['qty'] * lot['preco']
                efetiva_venda += lot['qty']
                remaining_to_sell -= lot['qty']
                g['lots'].pop(0)
            else:
                custo_base_venda += remaining_to_sell * lot['preco']
                efetiva_venda += remaining_to_sell
                lot['qty'] -= remaining_to_sell
                remaining_to_sell = 0
                
        if efetiva_venda > 0:
            lucro = (preco * efetiva_venda) - custo_base_venda
            g['realizado'] += lucro
        g['qtd'] -= sell_qty
        if g['qtd'] <= 0:
            g['qtd'] = 0.0
            g['lots'] = []

    # Recalculate cost basis
    if len(g['lots']) > 0:
        tc = sum(lot['qty'] * lot['preco'] for lot in g['lots'])
        tq = sum(lot['qty'] for lot in g['lots'])
        g['custoMedio'] = tc / tq if tq > 0 else 0
    else:
        g['custoMedio'] = 0
        
    g['investido'] = g['qtd'] * g['custoMedio']

# Sum everything up
total_investido = 0.0
total_lucro_aberto = 0.0
total_realizado = 0.0

print("\n--- CHRONOLOGICAL PORTFOLIO ANALYSIS ---")
print(f"{'TICKER':<10} | {'QTY':<10} | {'AVG PRICE':<10} | {'CUR PRICE':<10} | {'INVESTED':<12} | {'OPEN PROFIT':<12} | {'REALIZED':<12}")
print("-" * 90)

for ticker, g in sorted(grupos.items()):
    if g['qtd'] <= 0 and g['realizado'] == 0:
        continue
    
    cur_price = prices.get(ticker, 0.0)
    open_profit = 0.0
    
    # Mirror JEDI and LON:JEDI mapping if the app does it, or let's keep it exact as in database.
    # In database JEDI has no current price because it uses LON:JEDI.
    # Let's write the exact value to be 100% true to db.
    if g['qtd'] > 0:
        open_profit = (cur_price - g['custoMedio']) * g['qtd'] if cur_price > 0 else 0.0
        
    total_investido += g['investido']
    total_lucro_aberto += open_profit
    total_realizado += g['realizado']
    
    print(f"{ticker:<10} | {g['qtd']:<10.4f} | {g['custoMedio']:<10.2f} | {cur_price:<10.2f} | {g['investido']:<12.2f} | {open_profit:<12.2f} | {g['realizado']:<12.2f}")

total_lucro_total = total_lucro_aberto + total_realizado
retorno_pct = (total_lucro_total / total_investido * 100) if total_investido > 0 else 0.0

print("-" * 90)
print(f"TOTAL INVESTED:       {total_investido:.2f} €")
print(f"TOTAL OPEN PROFIT:    {total_lucro_aberto:.2f} €")
print(f"TOTAL REALIZED:       {total_realizado:.2f} €")
print(f"TOTAL PROFIT (ALL):   {total_lucro_total:.2f} €")
print(f"PORTFOLIO RETURN (%): {retorno_pct:.2f} %")
