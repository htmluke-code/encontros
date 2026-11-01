# Detecção de encontros (tornozeleiras e medidas protetivas)

## O que é este projeto

Este é o meu trabalho para o desafio técnico de detecção de encontros. A situação do desafio é a seguinte:

- algumas pessoas usam **tornozeleira eletrônica** (os monitorados, também chamados de agressores);
- as **vítimas** com medida protetiva carregam um **rastreador portátil**;
- cada aparelho registra a posição de GPS (latitude e longitude) a cada 5 segundos.

O resultado é um arquivo enorme de linhas do tipo "a pessoa 7 estava neste ponto neste horário". Meu programa lê esse arquivo e descobre **em que momentos duas pessoas estiveram a menos de 20 metros uma da outra**.

## Para que serve

Cada encontro encontrado entra em um destes três tipos:

| Tipo | O que significa |
|---|---|
| `protetiva` | uma vítima ficou perto de um agressor da lista de restrição dela (quebra da medida protetiva) |
| `faccao` | dois monitorados da mesma facção ficaram perto um do outro |
| `generico` | dois monitorados quaisquer ficaram perto um do outro |

Com isso, quem acompanha esses casos consegue ver quando, onde e a que distância as pessoas se encontraram. Importante: o programa analisa arquivos de posições **já gravadas**. Ele não é um sistema de alerta em tempo real.

**Entra** um arquivo de texto com uma linha por posição:

```
idMonitorado;faccaoMonitorado;timestamp;latitude;longitude;medidaProtetiva;idsRestricaoMedida
```

**Sai** um arquivo JSON com a lista de encontros, cada um com tipo, horário, as duas pessoas, as posições e a distância:

```json
{ "tipo": "faccao", "monitoradosEncontro": [40, 44], "timestamp": "2024-01-01 00:01:50",
  "posicoes": { "40": { "lat": -10.07996, "lon": -37.08384 }, "44": { "lat": -10.07987, "lon": -37.08389 } },
  "distanciaMetros": 11.406788673336607 }
```

## Como usar, passo a passo

O jeito mais fácil é pela interface gráfica, sem digitar comandos:

1. Instale o **Node.js** (versão LTS, em nodejs.org). É o único requisito.
2. Abra a pasta do projeto e dê dois cliques em **`iniciar.bat`** (no Windows). Uma janela preta abre e, em seguida, o navegador.
3. Na página, clique em **Baixar oficiais** para trazer os 7 datasets do desafio. Se você tiver um arquivo seu, pode arrastá-lo para a lateral.
4. Clique em **Processar todos**. Aparece uma barra de progresso em cada dataset.
5. Clique no nome de um dataset para ver os encontros em uma tabela. Clicando numa linha, aparece um desenho com as duas pessoas dentro do círculo de 20 metros.
6. Use **Baixar JSON** para guardar o resultado. Os arquivos também ficam salvos na pasta `output/`.
7. Quando terminar, feche a janela preta.

Se preferir o terminal, veja a próxima seção. Para entender a ideia por trás do código, sem entrar em detalhes técnicos, leia o [EXPLICACAO.md](EXPLICACAO.md).

## Como rodar pelo terminal

Precisa do Node 18 ou mais novo.

```bash
node src/index.js --all
```

Esse comando baixa os 7 datasets e os 2 gabaritos do bucket do desafio para a pasta `data/` (só o que ainda não estiver lá) e gera `output/resposta1.json` até `output/resposta7.json`.

Outros comandos que usei:

```bash
node src/index.js --baixar                  # só baixa os arquivos
node src/index.js data/dataset3.txt         # roda um dataset só (também aceita uma URL)
node scripts/comparar.js data/respostas1.json output/resposta1.json   # confere com o gabarito
npm test                                    # testes com dados inventados
```

## Interface gráfica

Para não depender do terminal, fiz uma interface que abre no navegador:

```bash
npm run gui
```

No Windows também dá para dar dois cliques no `iniciar.bat`. A página abre em `http://localhost:3000`. Pelos botões dá para:

- baixar os datasets oficiais ou arrastar um arquivo `.txt` seu;
- processar um dataset ou todos, com barra de progresso;
- ver quantos encontros de cada tipo foram achados e filtrar por tipo;
- clicar em um encontro para ver os dois monitorados dentro do círculo de 20 m, em escala, com as coordenadas e um link para o mapa;
- baixar o JSON de saída;
- nos datasets 1 e 2, ver se o resultado é igual ao gabarito.

Ela usa exatamente o mesmo código da linha de comando (`src/pipeline.js`). O servidor aceita conexões só da própria máquina e não usa nenhuma dependência. O processamento roda numa thread separada (`src/worker.js`), por isso a tela continua respondendo nos datasets grandes.

## O que ele faz

Para cada timestamp, olha onde cada pessoa estava e procura pares a menos de 20 m um do outro. Cada par vira um encontro de um destes tipos:

- `protetiva`: uma vítima perto de um agressor que está na lista dela (`idsRestricaoMedida`);
- `faccao`: dois monitorados da mesma facção;
- `generico`: dois monitorados quaisquer que não se encaixam nos tipos acima.

Se o mesmo par se encaixa em mais de um tipo, registro uma vez só, com o tipo mais específico (protetiva, depois facção, depois genérico).

## Como funciona, em resumo

1. **Leitura.** Leio o arquivo em blocos de 16 MB e guardo as colunas em arrays numéricos. Tirei as aspas dos campos e tratei quebra de linha do Windows.
2. **Agrupamento por timestamp.** Só comparo posições com exatamente o mesmo horário, como o enunciado pede.
3. **Grade.** Dentro de cada horário, divido o mapa em quadradinhos de uns 21 m. Para cada pessoa, só comparo com quem está no mesmo quadradinho ou nos 8 vizinhos. Quem está mais longe que isso não tem como estar a menos de 20 m.
4. **Haversine.** Para os candidatos que sobraram, calculo a distância exata com a fórmula de Haversine (raio da Terra de 6.371.000 m). Só conta se for **menor que** 20.
5. **Classificação e saída.** Defino o tipo, evito repetir o mesmo par no mesmo horário e monto o JSON no formato pedido.

## Resultados

- Datasets 1 e 2 (com gabarito): bateram 100%, com mesmos pares, tipos, posições e distâncias (4 e 6 encontros).
- Datasets 3 a 7 (sem gabarito): 10, 15, 21, 27 e 35 encontros.
- Tempo de execução na minha máquina, só o processamento: dataset 1 em 25 ms, dataset 5 em ~2 s, dataset 6 em ~16 s e dataset 7 em ~24 s.

## Problemas que apareceram no caminho

- **Aspas nos dados.** Na primeira vez que comparei com o gabarito, deu 0 acertos. Os pares e as distâncias estavam certos, mas o timestamp vem entre aspas no arquivo (`"2024-01-01 00:05:15"`) e eu não estava tirando. Corrigido.
- **Dataset 7 estourando.** A primeira versão lia o arquivo inteiro como uma string, e o dataset 7 passa do limite de texto do Node (~512 MB). Troquei por leitura em blocos e arrays numéricos.

## O que eu assumi e não consegui confirmar

O enunciado não detalha alguns casos de classificação. Escolhi assim:

- um par da mesma facção gera só `faccao` (não também `generico`);
- uma vítima perto de alguém que não é agressor dela não gera encontro;
- duas vítimas perto uma da outra não geram encontro.

Isso bate com os gabaritos dos datasets 1 e 2, mas esses exemplos são pequenos e talvez não cubram todos os casos. Se alguma regra estiver errada, a correção fica concentrada na função `classificarPar`, em `src/detect.js`.

Outra limitação: a grade não trata pontos colados na linha de mudança de data (longitude ±180°). Nos datasets não vi isso acontecer.

## Uso de IA

Usei o Claude (IA) como apoio na construção: para estruturar o código, sugerir a ideia da grade espacial e escrever os testes. Eu rodei tudo nos datasets, comparei com os gabaritos, e os dois problemas acima apareceram nessas execuções. Os arquivos `README.md` e `EXPLICACAO.md` descrevem o que o código faz e o porquê de cada escolha.

## Estrutura

```
src/detect.js          leitura, Haversine, classificação e detecção
src/pipeline.js        baixar e processar (usado pela linha de comando e pela interface)
src/index.js           linha de comando
src/server.js          servidor local da interface gráfica
src/worker.js          processamento em segundo plano para a interface
src/comparar.js        comparação de uma saída com o gabarito
gui/index.html         a página da interface
iniciar.bat            abre a interface no Windows
scripts/comparar.js    comparação pela linha de comando
test/teste.js          testes com dados inventados
output/                os JSONs gerados (resposta1..7)
```