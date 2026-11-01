#!/usr/bin/env node
'use strict';

// Interface gráfica local: sobe um servidor em http://localhost:3000 (só nesta máquina),
// serve a página de gui/index.html e expõe uma pequena API. Sem dependências externas.
//   node src/server.js        (ou: npm run gui, ou clique em iniciar.bat no Windows)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { exec } = require('child_process');
const { pipeline } = require('stream/promises');
const P = require('./pipeline');
const { comparar } = require('./comparar');

const PAGINA = path.join(P.RAIZ, 'gui', 'index.html');
const NOME_VALIDO = /^[A-Za-z0-9_][A-Za-z0-9_.\- ]{0,100}\.txt$/;

// ---------------------------------------------------------------------------
// Tarefas (baixar / processar) executadas uma de cada vez, em fila
// ---------------------------------------------------------------------------

const jobs = new Map();
const fila = [];
let seq = 0;
let ocupado = false;
const resumos = new Map(); // nome do JSON de saída -> { total, porTipo, ms }

function novoJob(tipo, alvo, executar) {
  const job = { id: ++seq, tipo, alvo, estado: 'espera', etapa: 'Na fila', pct: 0, erro: null, resumo: null };
  jobs.set(job.id, job);
  for (const id of [...jobs.keys()].slice(0, Math.max(0, jobs.size - 40))) jobs.delete(id); // guarda só os últimos
  fila.push({ job, executar });
  proximo();
  return job;
}

async function proximo() {
  if (ocupado) return;
  const item = fila.shift();
  if (!item) return;
  ocupado = true;
  const { job, executar } = item;
  job.estado = 'rodando';
  job.etapa = 'Iniciando';
  try {
    await executar(job);
    job.estado = 'ok';
    job.etapa = 'Concluído';
    job.pct = 100;
  } catch (e) {
    job.estado = 'erro';
    job.erro = e.message;
  }
  ocupado = false;
  proximo();
}

function rodarWorker(job, entrada, saida) {
  return new Promise((resolve, reject) => {
    let terminou = false;
    const w = new Worker(path.join(__dirname, 'worker.js'), { workerData: { entrada, saida } });
    w.on('message', (m) => {
      if (m.tipo === 'progresso') {
        job.etapa = m.etapa;
        job.pct = m.pct;
      } else if (m.tipo === 'fim') {
        terminou = true;
        job.resumo = m.resumo;
        resolve();
      } else if (m.tipo === 'erro') {
        terminou = true;
        reject(new Error(m.mensagem));
      }
    });
    w.on('error', (e) => {
      if (!terminou) reject(e);
    });
    w.on('exit', (codigo) => {
      if (!terminou) reject(new Error(`O processamento parou inesperadamente (código ${codigo}). Pode ter faltado memória.`));
    });
  });
}

// ---------------------------------------------------------------------------
// Dados
// ---------------------------------------------------------------------------

function lerSaida(nomeJson) {
  return JSON.parse(fs.readFileSync(path.join(P.DIR_SAIDA, nomeJson), 'utf8'));
}

function contar(lista) {
  const porTipo = { protetiva: 0, faccao: 0, generico: 0 };
  for (const e of lista) porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1;
  return porTipo;
}

function resumoDe(nomeJson) {
  if (resumos.has(nomeJson)) return resumos.get(nomeJson);
  const caminho = path.join(P.DIR_SAIDA, nomeJson);
  if (!fs.existsSync(caminho)) return null;
  try {
    const lista = lerSaida(nomeJson);
    const r = { total: lista.length, porTipo: contar(lista), ms: null };
    resumos.set(nomeJson, r);
    return r;
  } catch {
    return null;
  }
}

function listarDatasets() {
  const nomes = new Set(P.DATASETS_OFICIAIS);
  if (fs.existsSync(P.DIR_DATA)) {
    for (const f of fs.readdirSync(P.DIR_DATA)) if (NOME_VALIDO.test(f)) nomes.add(f);
  }
  return [...nomes]
    .sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map((nome) => {
      const caminho = path.join(P.DIR_DATA, nome);
      const existe = fs.existsSync(caminho);
      const gab = P.nomeGabarito(nome);
      return {
        nome,
        existe,
        tamanho: existe ? fs.statSync(caminho).size : 0,
        oficial: P.DATASETS_OFICIAIS.includes(nome),
        resumo: resumoDe(P.nomeSaida(nome)),
        temGabarito: !!gab && fs.existsSync(path.join(P.DIR_DATA, gab)),
      };
    });
}

let cacheSaida = { chave: '', lista: [] };
function saidaEmCache(nomeJson) {
  const caminho = path.join(P.DIR_SAIDA, nomeJson);
  const chave = caminho + ':' + fs.statSync(caminho).mtimeMs;
  if (cacheSaida.chave !== chave) cacheSaida = { chave, lista: lerSaida(nomeJson) };
  return cacheSaida.lista;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function json(res, status, corpo) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

function lerCorpoJson(req, limite = 1e6) {
  return new Promise((resolve, reject) => {
    let tam = 0;
    const partes = [];
    req.on('data', (c) => {
      tam += c.length;
      if (tam > limite) {
        reject(new Error('Requisição grande demais.'));
        req.destroy();
      } else partes.push(c);
    });
    req.on('end', () => {
      try {
        resolve(partes.length ? JSON.parse(Buffer.concat(partes).toString('utf8')) : {});
      } catch {
        reject(new Error('Corpo da requisição inválido.'));
      }
    });
    req.on('error', reject);
  });
}

function nomeDoParametro(url) {
  const nome = url.searchParams.get('arquivo') || '';
  return NOME_VALIDO.test(nome) ? nome : null;
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const rota = `${req.method} ${url.pathname}`;

    // Bloqueia envios feitos por outros sites: o cabeçalho x-gui só a nossa página manda.
    if (req.method === 'POST' && req.headers['x-gui'] !== '1') {
      return json(res, 403, { erro: 'Requisição não permitida.' });
    }

    if (rota === 'GET /' || rota === 'GET /index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(PAGINA));
    }

    if (rota === 'GET /api/estado') {
      return json(res, 200, { datasets: listarDatasets(), jobs: [...jobs.values()] });
    }

    if (rota === 'POST /api/baixar') {
      const emAndamento = [...jobs.values()].find((j) => j.tipo === 'baixar' && (j.estado === 'espera' || j.estado === 'rodando'));
      if (emAndamento) return json(res, 200, { job: emAndamento.id });
      const job = novoJob('baixar', 'datasets oficiais', async (j) => {
        await P.baixarTudo((nome, f) => {
          j.etapa = nome ? `Baixando ${nome}` : 'Concluindo';
          j.pct = Math.round(f * 100);
        });
      });
      return json(res, 200, { job: job.id });
    }

    if (rota === 'POST /api/processar') {
      const corpo = await lerCorpoJson(req);
      const nomes = Array.isArray(corpo.arquivos) ? corpo.arquivos : [];
      const ids = [];
      for (const nome of nomes) {
        if (!NOME_VALIDO.test(nome) || !fs.existsSync(path.join(P.DIR_DATA, nome))) {
          return json(res, 400, { erro: `Arquivo não encontrado em data/: ${nome}` });
        }
      }
      for (const nome of nomes) {
        const jaNaFila = [...jobs.values()].find((j) => j.tipo === 'processar' && j.alvo === nome && (j.estado === 'espera' || j.estado === 'rodando'));
        if (jaNaFila) {
          ids.push(jaNaFila.id);
          continue;
        }
        const saidaNome = P.nomeSaida(nome);
        const job = novoJob('processar', nome, async (j) => {
          await rodarWorker(j, path.join(P.DIR_DATA, nome), path.join(P.DIR_SAIDA, saidaNome));
          resumos.set(saidaNome, { total: j.resumo.encontros, porTipo: j.resumo.porTipo, ms: j.resumo.msTotal });
        });
        ids.push(job.id);
      }
      return json(res, 200, { jobs: ids });
    }

    if (rota === 'POST /api/upload') {
      const nome = path.basename(url.searchParams.get('nome') || '');
      if (!NOME_VALIDO.test(nome)) {
        return json(res, 400, { erro: 'Use um arquivo .txt com nome simples (letras, números, _ - e espaço).' });
      }
      fs.mkdirSync(P.DIR_DATA, { recursive: true });
      const destino = path.join(P.DIR_DATA, nome);
      const tmp = destino + '.part';
      await pipeline(req, fs.createWriteStream(tmp));
      fs.renameSync(tmp, destino);
      resumos.delete(P.nomeSaida(nome));
      return json(res, 200, { ok: true, nome });
    }

    if (rota === 'GET /api/resultado') {
      const nome = nomeDoParametro(url);
      if (!nome) return json(res, 400, { erro: 'Nome de arquivo inválido.' });
      const saidaNome = P.nomeSaida(nome);
      if (!fs.existsSync(path.join(P.DIR_SAIDA, saidaNome))) {
        return json(res, 404, { erro: 'Este dataset ainda não foi processado.' });
      }
      const lista = saidaEmCache(saidaNome);
      const tipo = url.searchParams.get('tipo') || '';
      const inicio = Math.max(0, Number(url.searchParams.get('inicio')) || 0);
      const limite = Math.min(1000, Math.max(1, Number(url.searchParams.get('limite')) || 200));
      const filtrada = tipo ? lista.filter((e) => e.tipo === tipo) : lista;

      let comparacao = null;
      const gab = P.nomeGabarito(nome);
      if (gab && fs.existsSync(path.join(P.DIR_DATA, gab))) {
        try {
          const esperado = JSON.parse(fs.readFileSync(path.join(P.DIR_DATA, gab), 'utf8'));
          const { amostras, ...r } = comparar(esperado, lista);
          comparacao = r;
        } catch {
          comparacao = null;
        }
      }
      return json(res, 200, {
        arquivo: nome,
        total: lista.length,
        porTipo: contar(lista),
        filtrados: filtrada.length,
        inicio,
        itens: filtrada.slice(inicio, inicio + limite),
        resumo: resumoDe(saidaNome),
        comparacao,
      });
    }

    if (rota === 'GET /api/saida') {
      const nome = nomeDoParametro(url);
      if (!nome) return json(res, 400, { erro: 'Nome de arquivo inválido.' });
      const saidaNome = P.nomeSaida(nome);
      const caminho = path.join(P.DIR_SAIDA, saidaNome);
      if (!fs.existsSync(caminho)) return json(res, 404, { erro: 'Este dataset ainda não foi processado.' });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${saidaNome}"`,
        'Content-Length': fs.statSync(caminho).size,
      });
      return fs.createReadStream(caminho).pipe(res);
    }

    return json(res, 404, { erro: 'Não encontrado.' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { erro: e.message });
    else res.end();
  }
});

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

function abrirNavegador(url) {
  if (process.env.NO_OPEN) return;
  const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

function iniciar(porta, tentativas = 10) {
  const aoErrar = (e) => {
    if (e.code === 'EADDRINUSE' && tentativas > 0) iniciar(porta + 1, tentativas - 1);
    else {
      console.error(`Não consegui iniciar o servidor: ${e.message}`);
      process.exit(1);
    }
  };
  servidor.once('error', aoErrar);
  servidor.listen(porta, '127.0.0.1', () => {
    servidor.removeListener('error', aoErrar);
    const url = `http://localhost:${porta}`;
    console.log(`Interface pronta em ${url}`);
    console.log('Deixe esta janela aberta enquanto usa. Para encerrar, feche-a ou aperte Ctrl+C.');
    abrirNavegador(url);
  });
}

iniciar(Number(process.env.PORT) || 3000);
