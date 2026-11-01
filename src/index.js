#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { lerDataset, detectar } = require('./detect');

const BASE_URL = 'https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com';

// Uso:
//   node src/index.js --all                 processa data/dataset1..7.txt -> output/respostaN.json
//                                           (baixa do bucket os que ainda não existirem em data/)
//   node src/index.js --baixar              só baixa datasets 1-7 e respostas 1-2 para data/
//   node src/index.js <arquivo|URL> [saida.json]

async function baixar(url, destino) {
  if (fs.existsSync(destino)) return destino;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  fs.writeFileSync(destino, Buffer.from(await res.arrayBuffer()));
  console.log(`baixado: ${url} -> ${destino}`);
  return destino;
}

async function baixarTudo() {
  for (let i = 1; i <= 7; i++) await baixar(`${BASE_URL}/dataset${i}.txt`, path.join('data', `dataset${i}.txt`));
  for (let i = 1; i <= 2; i++) await baixar(`${BASE_URL}/respostas${i}.json`, path.join('data', `respostas${i}.json`));
}

function processar(entrada, saida) {
  const t0 = process.hrtime.bigint();
  const encontros = detectar(lerDataset(entrada));
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(encontros));
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const porTipo = {};
  for (const e of encontros) porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
  console.log(`${path.basename(entrada)} -> ${saida}: ${encontros.length} encontros ${JSON.stringify(porTipo)} em ${ms.toFixed(0)} ms`);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--baixar') {
    await baixarTudo();
  } else if (args[0] === '--all') {
    await baixarTudo();
    for (let i = 1; i <= 7; i++) {
      try {
        processar(path.join('data', `dataset${i}.txt`), path.join('output', `resposta${i}.json`));
      } catch (e) {
        console.error(`dataset${i}.txt falhou: ${e.message}`); // um erro não impede os demais
      }
    }
  } else if (args[0]) {
    let entrada = args[0];
    if (/^https?:\/\//.test(entrada)) entrada = await baixar(entrada, path.join('data', path.basename(new URL(entrada).pathname)));
    processar(entrada, args[1] || path.join('output', path.basename(entrada, path.extname(entrada)) + '.json'));
  } else {
    console.error('Uso: node src/index.js --all | --baixar | <arquivo|URL> [saida.json]');
    process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
