#!/usr/bin/env node
'use strict';

// Uso: node scripts/comparar.js <esperado.json> <obtido.json>
// Chave de comparação: tipo + timestamp + par de ids (ordenado).
const fs = require('fs');

const [esp, obt] = process.argv.slice(2);
if (!esp || !obt) {
  console.error('Uso: node scripts/comparar.js <esperado.json> <obtido.json>');
  process.exit(1);
}
const chaveSemTipo = (e) =>
  e.timestamp + '|' + [...e.monitoradosEncontro].map(Number).sort((a, b) => a - b).join(',');
const mapa = (arr) => {
  const m = new Map();
  let dup = 0;
  for (const e of arr) {
    const k = chaveSemTipo(e);
    if (m.has(k)) dup++;
    m.set(k, e);
  }
  return { m, dup };
};
const E = mapa(JSON.parse(fs.readFileSync(esp, 'utf8')));
const O = mapa(JSON.parse(fs.readFileSync(obt, 'utf8')));

let certos = 0, tipoDiferente = 0, faltando = 0, sobrando = 0, difDist = 0;
const amostras = { faltando: [], sobrando: [], tipo: [] };
for (const [k, e] of E.m) {
  const o = O.m.get(k);
  if (!o) { faltando++; if (amostras.faltando.length < 5) amostras.faltando.push(e); continue; }
  if (o.tipo !== e.tipo) { tipoDiferente++; if (amostras.tipo.length < 5) amostras.tipo.push({ esperado: e.tipo, obtido: o.tipo, k }); continue; }
  certos++;
  if (Math.abs(o.distanciaMetros - e.distanciaMetros) > 1e-6) difDist++;
}
for (const [k, o] of O.m) if (!E.m.has(k)) { sobrando++; if (amostras.sobrando.length < 5) amostras.sobrando.push(o); }

console.log({ esperados: E.m.size, obtidos: O.m.size, certos, tipoDiferente, faltando, sobrando, duplicadosEsperado: E.dup, duplicadosObtido: O.dup, distanciasDiferentes: difDist });
if (faltando || sobrando || tipoDiferente) console.log(JSON.stringify(amostras, null, 2));
process.exit(faltando || sobrando || tipoDiferente ? 2 : 0);
