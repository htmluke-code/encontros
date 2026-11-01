# Explicação simples: o que eu fiz e como funciona

Este arquivo é para quem quer entender a ideia sem ler o código.

## O problema

Tenho um arquivo enorme onde cada linha diz: *"a pessoa X estava na latitude/longitude Y no horário Z"*. Preciso descobrir quando duas pessoas estiveram **a menos de 20 metros** uma da outra no **mesmo horário**.

Os encontros têm três tipos:

| Tipo | Quando |
|---|---|
| `protetiva` | uma vítima perto de um agressor que consta na lista de restrição dela |
| `faccao` | dois monitorados da mesma facção |
| `generico` | dois monitorados quaisquer |

## A ideia mais simples (e por que não serve)

O jeito direto é pegar cada pessoa e comparar com todas as outras. Se há 1.000 pessoas num horário, são quase 500.000 comparações por horário. E o horário muda a cada 5 segundos, então isso se repete milhares de vezes. Nos datasets grandes, ficaria lento demais.

## O que eu fiz

### 1. Separar por horário

Primeiro junto todas as linhas que têm o **mesmo timestamp**. Pessoas em horários diferentes nunca são comparadas, e isso já corta muito trabalho. É também o que o enunciado pede.

### 2. Dividir o mapa em quadradinhos (a grade)

Dentro de cada horário, imagino o mapa dividido em quadradinhos de mais ou menos 21 metros de lado. Cada pessoa cai em um quadradinho.

Se duas pessoas estão a menos de 20 m, elas só podem estar **no mesmo quadradinho ou em quadradinhos vizinhos** (são 9 no total: o dele e os 8 em volta). Então, para cada pessoa, só olho esses 9 quadradinhos e ignoro o resto do mapa. Em vez de comparar com todo mundo, comparo com poucas pessoas.

### 3. Medir a distância de verdade

Os candidatos que sobraram passam pela **fórmula de Haversine**, que calcula a distância entre dois pontos da superfície da Terra a partir de latitude e longitude. Usei o raio da Terra pedido no enunciado (6.371.000 m). Um simples "teorema de Pitágoras" no mapa daria erro, porque a Terra é curva e um grau de longitude vale menos metros quanto mais longe do equador.

Só conta como encontro se a distância for **menor que 20 m** (exatamente 20 não conta).

### 4. Definir o tipo e evitar repetição

Para cada par que passou, decido o tipo:

1. Se uma das pessoas é vítima: só vale se a outra estiver na lista de restrição dela. Aí é `protetiva`. Senão, ignoro.
2. Se as duas são monitoradas e da mesma facção: `faccao`.
3. Senão: `generico`.

Cada par aparece só uma vez por horário.

## Um exemplo real

No dataset 1, o gabarito tem este encontro:

- pessoas **4 e 6**, às **00:05:15**, a **9,33 m** uma da outra, tipo `generico`.

Meu código encontrou exatamente o mesmo par, no mesmo horário, com a mesma distância.

## Cuidados com arquivos grandes

Os datasets são grandes (o último passa de 500 MB). Por isso:

- leio o arquivo em **pedaços**, e não de uma vez só;
- guardo os números em **arrays numéricos**, que ocupam bem menos memória do que milhões de objetos.

A primeira versão lia tudo de uma vez e travou no dataset 7. Foi a partir desse erro que mudei a leitura.

## A interface gráfica

Além dos comandos, o projeto tem uma tela no navegador (`npm run gui` ou dois cliques em `iniciar.bat`). Ela não muda a lógica: por baixo usa o mesmo código. Serve para baixar os datasets, processar com um clique, ver os encontros em tabela e conferir cada um num desenho com os dois monitorados dentro do círculo de 20 m.

## Como saber se está certo

- Os datasets 1 e 2 têm gabarito. O script `scripts/comparar.js` compara a minha saída com ele, e deu 100% de acerto nos dois.
- O arquivo `test/teste.js` gera dados inventados e confere que a versão com grade acha exatamente os mesmos encontros que a versão "compara todo mundo com todo mundo". Se a grade perdesse algum encontro, o teste falharia.

## Limites e dúvidas

- Os datasets 3 a 7 não têm gabarito, então não consegui conferir esses resultados.
- Algumas regras de tipo foram uma interpretação minha do enunciado (por exemplo, um par da mesma facção gera só `faccao`, e não `faccao` e `generico`). Funcionou nos exemplos, mas pode haver casos que eles não mostram.

## Perguntas que podem aparecer

**Por que a grade e não comparar todo mundo?**
Porque evita milhões de comparações inúteis. Quem está longe nunca chega a ser comparado.

**Por que a célula tem ~21 m e não 20?**
É uma pequena folga de segurança, para ninguém a menos de 20 m ficar fora dos quadradinhos vizinhos.

**Por que usar Haversine depois da grade, se a grade já é aproximada?**
A grade só descarta quem está claramente longe. A decisão final, com a distância exata, é do Haversine.

**O que acontece se o mesmo par aparecer duas vezes no mesmo horário?**
Registro só uma vez, usando uma chave do tipo `menorId:maiorId`.

**Onde mudar uma regra de tipo?**
Na função `classificarPar`, em `src/detect.js`.

**Por que ler o arquivo em pedaços?**
Porque o Node não consegue criar uma string maior que uns 512 MB, e o dataset 7 passa disso.
