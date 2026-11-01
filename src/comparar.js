'use strict';

// Compara a lista de encontros obtida com um gabarito.
// Chave do encontro: timestamp + par de ids (ordenado). O tipo é conferido à parte.

function chave(e) {
  return e.timestamp + '|' + [...e.monitoradosEncontro].map(Number).sort((a, b) => a - b).join(',');
}

function indexar(lista) {
  const mapa = new Map();
  let duplicados = 0;
  for (const e of lista) {
    const k = chave(e);
    if (mapa.has(k)) duplicados++;
    mapa.set(k, e);
  }
  return { mapa, duplicados };
}

function comparar(esperado, obtido, maxAmostras = 5) {
  const E = indexar(esperado);
  const O = indexar(obtido);
  let certos = 0, tipoDiferente = 0, faltando = 0, sobrando = 0, distanciasDiferentes = 0;
  const amostras = { faltando: [], sobrando: [], tipo: [] };

  for (const [k, e] of E.mapa) {
    const o = O.mapa.get(k);
    if (!o) {
      faltando++;
      if (amostras.faltando.length < maxAmostras) amostras.faltando.push(e);
      continue;
    }
    if (o.tipo !== e.tipo) {
      tipoDiferente++;
      if (amostras.tipo.length < maxAmostras) amostras.tipo.push({ esperado: e.tipo, obtido: o.tipo, k });
      continue;
    }
    certos++;
    if (Math.abs(o.distanciaMetros - e.distanciaMetros) > 1e-6) distanciasDiferentes++;
  }
  for (const [k, o] of O.mapa) {
    if (!E.mapa.has(k)) {
      sobrando++;
      if (amostras.sobrando.length < maxAmostras) amostras.sobrando.push(o);
    }
  }

  return {
    esperados: E.mapa.size,
    obtidos: O.mapa.size,
    certos,
    tipoDiferente,
    faltando,
    sobrando,
    duplicadosEsperado: E.duplicados,
    duplicadosObtido: O.duplicados,
    distanciasDiferentes,
    amostras,
  };
}

module.exports = { comparar };
