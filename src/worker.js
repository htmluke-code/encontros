'use strict';

// Roda o processamento fora da thread principal, para a interface continuar
// respondendo (e mostrando o progresso) enquanto um dataset grande é lido.
const { parentPort, workerData } = require('worker_threads');
const { processar } = require('./pipeline');

let ultimo = -1;
try {
  const resumo = processar(workerData.entrada, workerData.saida, (etapa, f) => {
    const pct = Math.min(100, Math.round(f * 100));
    if (pct !== ultimo) {
      ultimo = pct;
      parentPort.postMessage({ tipo: 'progresso', etapa, pct });
    }
  });
  parentPort.postMessage({ tipo: 'fim', resumo });
} catch (e) {
  parentPort.postMessage({ tipo: 'erro', mensagem: e.message });
}
