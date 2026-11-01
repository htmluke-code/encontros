# Detecção de Encontros

Detecta encontros físicos (< 20 m) entre monitorados com tornozeleira e vítimas de medidas protetivas, a partir de posicionamentos de GPS. Node.js puro, sem dependências.

## Como executar

```bash
# coloque os datasets em data/ (dataset1.txt ... dataset7.txt)
node src/index.js --all                 # baixa os datasets do bucket (se faltarem em data/) e gera output/resposta1.json ... resposta7.json
node src/index.js --baixar              # só baixa datasets 1-7 e respostas 1-2 para data/
node src/index.js <arquivo ou URL> [saida.json]

# validar contra uma resposta de exemplo (datasets 1 e 2)
node scripts/comparar.js data/respostas1.json output/resposta1.json

npm test                                # grade vs. força bruta, bordas de buffer, aspas/CRLF (dados sintéticos)
```

Requer Node 18+.

## Lógica

1. **Leitura em pedaços**: o arquivo é lido em blocos de 16 MB (sem carregá-lo inteiro numa string, que estoura o limite do Node em datasets grandes) e guardado em arrays tipados (formato colunar). Campos entre aspas e quebras de linha CRLF são tratados. As linhas são agrupadas por `timestamp` exato; só posições com o mesmo timestamp são comparadas, como exige o enunciado.
2. **Grade espacial por timestamp**: em vez de comparar todos os pares (O(n²)), cada ponto vai para uma célula de ~21 m; só se comparam pontos da mesma célula e das 8 vizinhas. Custo médio ≈ O(n) por timestamp. A célula em longitude é alargada pelo cosseno da maior latitude do dataset, então nunca fica menor que 20 m.
3. **Distância**: Haversine com R = 6.371.000 m; encontro se `distância < 20` (estritamente menor).
4. **Unicidade**: um registro por par de IDs por timestamp (`menorId:maiorId`).
5. **Classificação** (`classificarPar` em `src/detect.js`), com prioridade `protetiva > faccao > generico`:
   - vítima × agressor presente em `idsRestricaoMedida` → `protetiva`
   - agressor × agressor da mesma facção → `faccao`
   - agressor × agressor de facções diferentes/sem facção → `generico`
   - vítima × monitorado não restrito, e vítima × vítima → não gera encontro

## Pontos a validar com os datasets de exemplo

As regras de classificação acima são **interpretações** do enunciado (o texto não diz, por exemplo, se um par da mesma facção também deve gerar um registro `generico`, ou se vítima × agressor não restrito conta como `generico`). Devem ser conferidas com `scripts/comparar.js` contra `respostas1.json` e `respostas2.json`; qualquer divergência se resolve alterando apenas a função `classificarPar`.

## Por que esta abordagem

- Escala: 4 milhões de linhas (≈220 MB) processadas em ≈9 s com ≈460 MB de memória, em teste sintético.
- Corretude: o teste compara a saída da grade com força bruta sobre dados sintéticos e exige resultado idêntico.
- Desempate por desempenho: agrupar por timestamp + grade espacial evita o produto cartesiano; leitura única do arquivo e sem dependências.
- Simples de defender: poucas funções pequenas (`lerDataset`, `haversine`, `classificarPar`, `detectar`).

## Estrutura

```
src/detect.js      leitura, Haversine, classificação, detecção
src/index.js       CLI
scripts/comparar.js  comparação com JSON esperado
test/teste.js      teste de consistência
```
