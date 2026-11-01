'use strict';
// Testes de consistência em dados sintéticos:
//  - Haversine
//  - grade espacial == força bruta
//  - leitura em pedaços minúsculos == leitura normal (bordas de buffer)
//  - campos entre aspas (como nos datasets reais) são lidos sem as aspas
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { haversine, lerDataset, classificarPar, detectar } = require('../src/detect');

// 1) Haversine: 0.0002° de latitude ≈ 22,24 m (> 20) e 0.00017° ≈ 18,9 m (< 20)
assert(Math.abs(haversine(-10, -37, -10 + 0.0002, -37) - 22.24) < 0.1);
assert(haversine(-10, -37, -10 + 0.00017, -37) < 20);

// 2) Dataset sintético reprodutível (com e sem aspas)
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const cab = 'idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida';
const semAspas = [cab];
const comAspas = [cab];
const N_AGR = 60, N_VIT = 10, PASSOS = 40;
for (let t = 0; t < PASSOS; t++) {
  const ts = `2026-10-01 00:${String(Math.floor((t * 5) / 60)).padStart(2, '0')}:${String((t * 5) % 60).padStart(2, '0')}`;
  for (let id = 1; id <= N_AGR; id++) {
    const lat = (-10 + rnd() * 0.002).toFixed(5);
    const lon = (-37 + rnd() * 0.002).toFixed(5);
    const f = id % 4 === 0 ? '' : id % 3;
    semAspas.push(`${id};${f};${ts};${lat};${lon};false;`);
    comAspas.push(`${id};${f};"${ts}";${lat};${lon};false;`);
  }
  for (let v = 0; v < N_VIT; v++) {
    const lat = (-10 + rnd() * 0.002).toFixed(5);
    const lon = (-37 + rnd() * 0.002).toFixed(5);
    semAspas.push(`${1000 + v};;${ts};${lat};${lon};true;${v + 1},${v + 11}`);
    comAspas.push(`${1000 + v};;"${ts}";${lat};${lon};true;"${v + 1},${v + 11}"`);
  }
}
const arqA = path.join(os.tmpdir(), 'sintetico_sem_aspas.txt');
const arqB = path.join(os.tmpdir(), 'sintetico_com_aspas.txt');
fs.writeFileSync(arqA, semAspas.join('\n'));
fs.writeFileSync(arqB, comAspas.join('\r\n')); // CRLF, como no Windows

const ds = lerDataset(arqA);
const rapido = detectar(ds);

// 3) Força bruta com a mesma regra de classificação
const bruto = [];
const porTs = new Map();
for (let i = 0; i < ds.n; i++) {
  const k = ds.tsLista[ds.ts[i]];
  if (!porTs.has(k)) porTs.set(k, []);
  porTs.get(k).push(i);
}
for (const [ts, idx] of porTs)
  for (let x = 0; x < idx.length; x++)
    for (let y = x + 1; y < idx.length; y++) {
      const i = idx[x], j = idx[y];
      const d = haversine(ds.lat[i], ds.lon[i], ds.lat[j], ds.lon[j]);
      if (d < 20 && classificarPar(ds, i, j))
        bruto.push(ts + '|' + [ds.ids[i], ds.ids[j]].sort((a, b) => a - b));
    }
const k = (e) => e.timestamp + '|' + e.monitoradosEncontro;
const A = new Set(rapido.map(k)), B = new Set(bruto);
assert.strictEqual(A.size, rapido.length, 'duplicatas na saída');
assert.deepStrictEqual([...A].sort(), [...B].sort());

// 4) Leitura com buffer minúsculo (testa quebra de linha entre pedaços)
const pequeno = detectar(lerDataset(arqA, 37));
assert.deepStrictEqual(pequeno, rapido);

// 5) Aspas + CRLF produzem o mesmo resultado, sem aspas nos timestamps
const aspas = detectar(lerDataset(arqB, 53));
assert(aspas.every((e) => !e.timestamp.includes('"')));
assert.deepStrictEqual(aspas, rapido);

const tipos = {};
rapido.forEach((e) => (tipos[e.tipo] = (tipos[e.tipo] || 0) + 1));
console.log('OK: grade == força bruta; buffer pequeno e aspas/CRLF idênticos;', rapido.length, 'encontros', tipos);
