// js/firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";


// Configurações do teu projeto Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDbSYjVwsOOnBjZe_X8y7gS-W4DhYqHEnE",
  authDomain: "appfinance-812b2.firebaseapp.com",
  projectId: "appfinance-812b2",
  storageBucket: "appfinance-812b2.appspot.com",
  messagingSenderId: "383837988480",
  appId: "1:383837988480:web:dd114574838c6a9dbb2865",
};

export const app = initializeApp(firebaseConfig);
export const db  = getFirestore(app);