#!/usr/bin/env node
'use strict';

const path = require('path');
const P = require('./pipeline');

// Uso:
//   node src/index.js --all                 baixa o que faltar e processa dataset1..7 -> output/respostaN.json
//   node src/index.js --baixar              só baixa datasets 1-7 e respostas 1-2 para data/
//   node src/index.js <arquivo|URL> [saida.json]
// Para usar com botões e gráficos: npm run gui

function relatar(entrada, saida) {
  const r = P.processar(entrada, saida);
  console.log(
    `${path.basename(entrada)} -> ${path.relative(process.cwd(), saida)}: ${r.encontros} encontros ${JSON.stringify(r.porTipo)} em ${r.msTotal.toFixed(0)} ms`
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--baixar') {
    await P.baixarTudo();
  } else if (args[0] === '--all') {
    await P.baixarTudo();
    for (const nome of P.DATASETS_OFICIAIS) {
      try {
        relatar(path.join(P.DIR_DATA, nome), path.join(P.DIR_SAIDA, P.nomeSaida(nome)));
      } catch (e) {
        console.error(`${nome} falhou: ${e.message}`); // um erro não impede os demais
      }
    }
  } else if (args[0]) {
    let entrada = args[0];
    if (/^https?:\/\//.test(entrada)) {
      const nome = path.basename(new URL(entrada).pathname);
      entrada = path.join(P.DIR_DATA, nome);
      await P.baixar(args[0], entrada);
    }
    const saida = args[1] || path.join(P.DIR_SAIDA, P.nomeSaida(path.basename(entrada)));
    relatar(entrada, saida);
  } else {
    console.error('Uso: node src/index.js --all | --baixar | <arquivo|URL> [saida.json]');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
