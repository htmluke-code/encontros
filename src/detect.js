'use strict';

const fs = require('fs');
const { StringDecoder } = require('string_decoder');

const RAIO_TERRA_M = 6371000;
const LIMITE_M = 20;
const RAD = Math.PI / 180;

/** Distância de Haversine em metros (raio da Terra = 6.371.000 m). */
function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_TERRA_M * Math.asin(Math.sqrt(a));
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Dataset em formato colunar (arrays tipados): leve em memória mesmo com milhões de linhas. */
function novoDataset() {
  return {
    n: 0,
    cap: 0,
    ids: null, // Float64Array
    faccao: null, // Int32Array (-1 = sem facção)
    ts: null, // Int32Array: índice em tsLista
    lat: null, // Float64Array
    lon: null, // Float64Array
    vitima: null, // Uint8Array
    tsLista: [], // timestamps distintos (strings)
    restr: new Map(), // idVitima -> Set<idAgressor>
    maxAbsLat: 0,
  };
}

function garantir(ds) {
  if (ds.n < ds.cap) return;
  const cap = ds.cap ? ds.cap * 2 : 1 << 20;
  const cresce = (A, Tipo) => {
    const B = new Tipo(cap);
    if (A) B.set(A);
    return B;
  };
  ds.ids = cresce(ds.ids, Float64Array);
  ds.faccao = cresce(ds.faccao, Int32Array);
  ds.ts = cresce(ds.ts, Int32Array);
  ds.lat = cresce(ds.lat, Float64Array);
  ds.lon = cresce(ds.lon, Float64Array);
  ds.vitima = cresce(ds.vitima, Uint8Array);
  ds.cap = cap;
}

/**
 * Lê o arquivo em pedaços (sem carregar o texto inteiro numa string, o que
 * estoura o limite de ~512 MB do Node em datasets grandes).
 * Remove aspas dos campos (ex.: timestamp vem como "2024-01-01 00:05:15").
 */
function lerDataset(caminho, tamBuffer = 1 << 24) {
  const ds = novoDataset();
  const tsMapa = new Map();
  const faccaoMapa = new Map();
  const rawPorId = new Map();

  const tratarLinha = (linha) => {
    if (linha.charCodeAt(linha.length - 1) === 13) linha = linha.slice(0, -1); // \r
    if (linha.length === 0) return;
    if (linha.indexOf('"') !== -1) linha = linha.replace(/"/g, '');
    const c = linha.split(';');
    if (c.length < 6) return;
    const idTxt = c[0].trim();
    const id = Number(idTxt);
    if (idTxt === '' || !Number.isFinite(id)) return; // cabeçalho ou linha inválida
    const lat = parseFloat(c[3]);
    const lon = parseFloat(c[4]);
    if (lat !== lat || lon !== lon) return;

    const tsStr = c[2].trim();
    let ti = tsMapa.get(tsStr);
    if (ti === undefined) {
      ti = ds.tsLista.length;
      ds.tsLista.push(tsStr);
      tsMapa.set(tsStr, ti);
    }
    const f = c[1].trim();
    let fi = -1;
    if (f !== '') {
      fi = faccaoMapa.get(f);
      if (fi === undefined) {
        fi = faccaoMapa.size;
        faccaoMapa.set(f, fi);
      }
    }
    const medida = c[5].trim().toLowerCase();
    const vit = medida === 'true' || medida === '1';

    garantir(ds);
    const k = ds.n++;
    ds.ids[k] = id;
    ds.faccao[k] = fi;
    ds.ts[k] = ti;
    ds.lat[k] = lat;
    ds.lon[k] = lon;
    ds.vitima[k] = vit ? 1 : 0;
    const al = lat < 0 ? -lat : lat;
    if (al > ds.maxAbsLat) ds.maxAbsLat = al;

    if (vit) {
      const raw = (c[6] || '').trim();
      if (rawPorId.get(id) !== raw) {
        rawPorId.set(id, raw);
        let s = ds.restr.get(id);
        if (!s) ds.restr.set(id, (s = new Set()));
        if (raw) {
          for (const p of raw.split(',')) {
            const t = p.trim();
            const v = Number(t);
            if (t !== '' && v === v) s.add(v);
          }
        }
      }
    }
  };

  const fd = fs.openSync(caminho, 'r');
  try {
    const buf = Buffer.allocUnsafe(tamBuffer);
    const dec = new StringDecoder('utf8');
    let resto = '';
    for (;;) {
      const lidos = fs.readSync(fd, buf, 0, tamBuffer, null);
      if (lidos === 0) break;
      const texto = resto + dec.write(buf.subarray(0, lidos));
      let ini = 0;
      for (;;) {
        const fim = texto.indexOf('\n', ini);
        if (fim === -1) break;
        tratarLinha(texto.slice(ini, fim));
        ini = fim + 1;
      }
      resto = texto.slice(ini);
    }
    resto += dec.end();
    if (resto) tratarLinha(resto);
  } finally {
    fs.closeSync(fd);
  }
  return ds;
}

// ---------------------------------------------------------------------------
// Classificação
// ---------------------------------------------------------------------------

/**
 * Classifica o par de linhas (i, j). Retorna 'protetiva' | 'faccao' | 'generico' | null.
 * Prioridade: protetiva > faccao > generico (um registro por par/timestamp).
 *  - vítima x agressor listado em idsRestricaoMedida -> protetiva
 *  - vítima x qualquer outro / vítima x vítima        -> não é encontro
 *  - agressor x agressor: mesma facção -> faccao, senão generico
 */
function classificarPar(ds, i, j) {
  const vi = ds.vitima[i] === 1;
  const vj = ds.vitima[j] === 1;
  if (vi || vj) {
    if (vi && vj) return null;
    const v = vi ? i : j;
    const a = vi ? j : i;
    const s = ds.restr.get(ds.ids[v]);
    return s !== undefined && s.has(ds.ids[a]) ? 'protetiva' : null;
  }
  const fi = ds.faccao[i];
  if (fi !== -1 && fi === ds.faccao[j]) return 'faccao';
  return 'generico';
}

// ---------------------------------------------------------------------------
// Detecção
// ---------------------------------------------------------------------------

/**
 * Agrupa por timestamp (counting sort) e, dentro de cada timestamp, usa uma
 * grade espacial de ~21 m: só compara pontos da mesma célula e das 8
 * vizinhas, em vez de todos contra todos.
 */
function detectar(ds) {
  const { n, ids, ts, lat, lon, tsLista } = ds;
  const resultado = [];
  const nTs = tsLista.length;
  if (n === 0) return resultado;

  // counting sort das linhas por índice de timestamp
  const inicio = new Int32Array(nTs + 1);
  for (let i = 0; i < n; i++) inicio[ts[i] + 1]++;
  for (let t = 0; t < nTs; t++) inicio[t + 1] += inicio[t];
  const cursor = inicio.slice(0, nTs);
  const ordem = new Int32Array(n);
  for (let i = 0; i < n; i++) ordem[cursor[ts[i]]++] = i;

  let maxGrupo = 0;
  for (let t = 0; t < nTs; t++) {
    const m = inicio[t + 1] - inicio[t];
    if (m > maxGrupo) maxGrupo = m;
  }

  // Célula em graus. Em longitude, usa o cos da maior |lat| do dataset:
  // a célula nunca fica menor que 20 m em metros.
  const celLat = (LIMITE_M * 1.05) / (RAIO_TERRA_M * RAD);
  const celLon = celLat / Math.max(Math.cos(Math.min(ds.maxAbsLat, 89) * RAD), 1e-6);

  const CX = new Int32Array(maxGrupo);
  const CY = new Int32Array(maxGrupo);
  const prox = new Int32Array(maxGrupo);
  const cabeca = new Map();

  // processa timestamps em ordem cronológica
  const seq = Array.from({ length: nTs }, (_, i) => i);
  seq.sort((a, b) => (tsLista[a] < tsLista[b] ? -1 : tsLista[a] > tsLista[b] ? 1 : 0));

  for (const t of seq) {
    const s = inicio[t];
    const m = inicio[t + 1] - s;
    if (m < 2) continue;

    cabeca.clear();
    for (let q = 0; q < m; q++) {
      const r = ordem[s + q];
      const cx = Math.floor(lat[r] / celLat);
      const cy = Math.floor(lon[r] / celLon);
      CX[q] = cx;
      CY[q] = cy;
      const k = cx * 4294967296 + cy;
      const h = cabeca.get(k);
      prox[q] = h === undefined ? -1 : h;
      cabeca.set(k, q);
    }

    let vistos = null; // unicidade por par de ids (protege contra linhas duplicadas)
    for (let qi = 0; qi < m; qi++) {
      const i = ordem[s + qi];
      const cx = CX[qi];
      const cy = CY[qi];
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          let qj = cabeca.get((cx + dx) * 4294967296 + (cy + dy));
          if (qj === undefined) continue;
          for (; qj !== -1; qj = prox[qj]) {
            if (qj <= qi) continue;
            const j = ordem[s + qj];
            if (ids[i] === ids[j]) continue;
            const d = haversine(lat[i], lon[i], lat[j], lon[j]);
            if (!(d < LIMITE_M)) continue;
            const tipo = classificarPar(ds, i, j);
            if (tipo === null) continue;
            const lo = ids[i] < ids[j] ? i : j;
            const hi = lo === i ? j : i;
            const chave = ids[lo] + ':' + ids[hi];
            if (vistos === null) vistos = new Set();
            if (vistos.has(chave)) continue;
            vistos.add(chave);
            resultado.push({
              tipo,
              monitoradosEncontro: [ids[lo], ids[hi]],
              timestamp: tsLista[t],
              posicoes: {
                [ids[lo]]: { lat: lat[lo], lon: lon[lo] },
                [ids[hi]]: { lat: lat[hi], lon: lon[hi] },
              },
              distanciaMetros: d,
            });
          }
        }
      }
    }
  }
  return resultado;
}

module.exports = { haversine, lerDataset, classificarPar, detectar, LIMITE_M };
