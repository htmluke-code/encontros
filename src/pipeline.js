'use strict';

// Núcleo compartilhado pela linha de comando (src/index.js) e pela interface (src/server.js):
// baixar datasets, processar um arquivo e gravar o JSON de saída.

const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { lerDataset, detectar } = require('./detect');

const RAIZ = path.resolve(__dirname, '..');
const DIR_DATA = path.join(RAIZ, 'data');
const DIR_SAIDA = path.join(RAIZ, 'output');
const BASE_URL = 'https://bucket-projeto-trainee.s3.sa-east-1.amazonaws.com';

const DATASETS_OFICIAIS = [1, 2, 3, 4, 5, 6, 7].map((n) => `dataset${n}.txt`);
const GABARITOS_OFICIAIS = [1, 2].map((n) => `respostas${n}.json`);

/** dataset3.txt -> resposta3.json ; meu.txt -> meu.json */
function nomeSaida(nomeArquivo) {
  const m = /^dataset(\d+)\.txt$/i.exec(nomeArquivo);
  return m ? `resposta${m[1]}.json` : path.basename(nomeArquivo, path.extname(nomeArquivo)) + '.json';
}

/** dataset1.txt -> respostas1.json ; outros -> null */
function nomeGabarito(nomeArquivo) {
  const m = /^dataset(\d+)\.txt$/i.exec(nomeArquivo);
  return m ? `respostas${m[1]}.json` : null;
}

/**
 * Baixa url para destino (em streaming, sem carregar tudo na memória).
 * Escreve num arquivo .part e só renomeia no fim, para nunca deixar um arquivo pela metade.
 * Retorna false se o destino já existia.
 */
async function baixar(url, destino, onProgresso) {
  if (fs.existsSync(destino)) return false;
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('Não consegui acessar o endereço do desafio. Confira sua conexão com a internet e tente de novo.');
  }
  if (!res.ok) throw new Error(`Falha ao baixar ${url}: HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let lido = 0;
  const origem = Readable.fromWeb(res.body);
  origem.on('data', (c) => {
    lido += c.length;
    if (onProgresso && total) onProgresso(lido / total);
  });
  const tmp = destino + '.part';
  await pipeline(origem, fs.createWriteStream(tmp));
  fs.renameSync(tmp, destino);
  return true;
}

/** Baixa os 7 datasets e os 2 gabaritos para data/. onEtapa(nomeArquivo, fracaoGeral 0..1). */
async function baixarTudo(onEtapa) {
  const nomes = [...DATASETS_OFICIAIS, ...GABARITOS_OFICIAIS];
  for (let i = 0; i < nomes.length; i++) {
    const nome = nomes[i];
    if (onEtapa) onEtapa(nome, i / nomes.length);
    const novo = await baixar(`${BASE_URL}/${nome}`, path.join(DIR_DATA, nome), (f) => {
      if (onEtapa) onEtapa(nome, (i + f) / nomes.length);
    });
    if (novo && !onEtapa) console.log(`baixado: ${nome}`);
  }
  if (onEtapa) onEtapa('', 1);
}

/**
 * Lê o dataset, detecta os encontros e grava o JSON.
 * onProgresso(etapa, fracao 0..1) é opcional.
 */
function processar(entrada, saida, onProgresso) {
  const t0 = process.hrtime.bigint();
  const avisa = (etapa, f) => onProgresso && onProgresso(etapa, f);

  avisa('Lendo o arquivo', 0);
  const ds = lerDataset(entrada, undefined, (f) => avisa('Lendo o arquivo', f * 0.6));
  const t1 = process.hrtime.bigint();

  avisa('Procurando encontros', 0.6);
  const encontros = detectar(ds, (f) => avisa('Procurando encontros', 0.6 + f * 0.38));
  const t2 = process.hrtime.bigint();

  avisa('Gravando o resultado', 0.98);
  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(encontros));
  const t3 = process.hrtime.bigint();

  const porTipo = { protetiva: 0, faccao: 0, generico: 0 };
  for (const e of encontros) porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
  const ms = (a, b) => Number(b - a) / 1e6;
  avisa('Concluído', 1);

  return {
    arquivo: path.basename(entrada),
    saida: path.basename(saida),
    linhas: ds.n,
    horarios: ds.tsLista.length,
    encontros: encontros.length,
    porTipo,
    msLeitura: ms(t0, t1),
    msDeteccao: ms(t1, t2),
    msTotal: ms(t0, t3),
  };
}

module.exports = {
  RAIZ,
  DIR_DATA,
  DIR_SAIDA,
  BASE_URL,
  DATASETS_OFICIAIS,
  GABARITOS_OFICIAIS,
  nomeSaida,
  nomeGabarito,
  baixar,
  baixarTudo,
  processar,
};
