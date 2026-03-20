import { db } from "../firebase-config.js";
import { 
  collection, 
  getDocs, 
  updateDoc, 
  doc 
} from "https://www.gstatic.com/firebasejs/11.4.0/firebase-firestore.js";

/**
 * Função de Manutenção: Sanea a base de dados Firestore.
 * Converte campos de string complexos (ex: "288.62 -14.26%") em campos numéricos atómicos.
 */
export async function repairFirestoreData() {
  console.log("🚀 Iniciando reparação de dados no Firestore...");
  const colRef = collection(db, "acoesDividendos");
  const snap = await getDocs(colRef);
  
  let count = 0;
  let fixed = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const updates = {};

    const parsePt = (s) => {
      if (!s) return null;
      let x = s.trim().replace(/\s+/g, "").replace(/'/g, "");
      if (x.includes(",")) {
        x = x.replace(/\./g, "").replace(",", ".");
      }
      const n = Number(x);
      return isFinite(n) ? n : null;
    };

    const parsePct = (s) => {
      if (!s) return null;
      const m = s.match(/^(-?[\d.,]+)%$/);
      if (!m) return null;
      const n = parsePt(m[1]);
      return n !== null ? n / 100 : null;
    };

    // 1. 52w High / Low
    if (data["52w_high"] && !data.high_52w_price) {
      const parts = String(data["52w_high"]).split(/\s+/);
      if (parts.length >= 2) {
        updates.high_52w_price = parsePt(parts[0]);
        updates.high_52w_dist = parsePct(parts[1]);
      }
    }
    if (data["52w_low"] && !data.low_52w_price) {
      const parts = String(data["52w_low"]).split(/\s+/);
      if (parts.length >= 2) {
        updates.low_52w_price = parsePt(parts[0]);
        updates.low_52w_dist = parsePct(parts[1]);
      }
    }

    // 2. Growth metrics
    if (data.dividend_gr_3_5y && !data.div_grow_5y) {
      const parts = String(data.dividend_gr_3_5y).split(/\s+/);
      if (parts.length >= 2) {
        updates.div_grow_3y = parsePct(parts[0]);
        updates.div_grow_5y = parsePct(parts[1]);
      }
    }
    if (data.eps_past_3_5y && !data.eps_grow_5y) {
      const parts = String(data.eps_past_3_5y).split(/\s+/);
      if (parts.length >= 2) {
        updates.eps_grow_3y = parsePct(parts[0]);
        updates.eps_grow_5y = parsePct(parts[1]);
      }
    }

    if (Object.keys(updates).length > 0) {
      await updateDoc(doc(db, "acoesDividendos", d.id), updates);
      fixed++;
    }
    count++;
    if (count % 50 === 0) console.log(`... processados ${count} registos`);
  }

  console.log(`✅ Concluído! ${count} analisados, ${fixed} reparados.`);
}
