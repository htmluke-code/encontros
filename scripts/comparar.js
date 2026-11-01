#!/usr/bin/env node
'use strict';

// Uso: node scripts/comparar.js <esperado.json> <obtido.json>
const fs = require('fs');
const { comparar } = require('../src/comparar');

const [esp, obt] = process.argv.slice(2);
if (!esp || !obt) {
  console.error('Uso: node scripts/comparar.js <esperado.json> <obtido.json>');
  process.exit(1);
}

const r = comparar(JSON.parse(fs.readFileSync(esp, 'utf8')), JSON.parse(fs.readFileSync(obt, 'utf8')));
const { amostras, ...resumo } = r;
console.log(resumo);
const divergiu = r.faltando || r.sobrando || r.tipoDiferente;
if (divergiu) console.log(JSON.stringify(amostras, null, 2));
process.exit(divergiu ? 2 : 0);
