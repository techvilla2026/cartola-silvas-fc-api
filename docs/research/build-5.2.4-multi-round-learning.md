# Build 5.2.4 - Multi-round Learning

Relatorio experimental. Nao altera o Motor SLVS oficial, formulas, snapshots ou backtests.

## Capitao

A Build 5.2.3 reportou Ivan como capitao ao ler o maior score geral do time ideal/posicao, sem aplicar a regra de elegibilidade do capitao. Ivan era GOL e nunca deveria ser candidato a capitao SLVS.

Capitao correto pre-R19: Danilo dos Santos de Oliveira (MEI), real N/A.
Vice: Carlos Renê de Sousa Ferreira - Souza, real 18.1.
Terceira opcao: Agustín Canobbio Graviz, real N/A.

## Clean Sheet Multirrodada

Rodadas validas: 17; partidas validas: 167.
V1 Top1/Top3/Top5: 0.2941/0.2941/0.2706.
V2 Top1/Top3/Top5: 0.2353/0.2941/0.2588.
Status V2: EXPERIMENTAL.

## Shadow Mode

- GOL_V2: oficial Top5 3.6824; shadow Top5 3.7635; improved=true.
- LAT_V2: oficial Top5 5.4435; shadow Top5 5.3471; improved=false.
- ZAG_V2: oficial Top5 3.1094; shadow Top5 3.1682; improved=true.
- MEI_V2: oficial Top5 4.72; shadow Top5 4.7729; improved=true.
- ATA_V2: oficial Top5 6.1753; shadow Top5 5.6647; improved=false.
- TEC_V2: oficial Top5 null; shadow Top5 null; improved=false.

## Time Ideal

SLVS R19: 83.3 sem capitao; 93.5 com capitao.
Best Predicted XI: 72.4 sem capitao; 72.4 com capitao.
Best Actual XI: 190.4 sem capitao; 208.5 com capitao.

## Promotion Gate

- clean-sheet-v2: EXPERIMENTAL; promoted=false; Sem melhora consistente sobre V1.
- gol-v2: EXPERIMENTAL; promoted=false; Shadow melhorou alguma metrica agregada, mas segue sem promocao automatica.
- lat-v2: REJECTED; promoted=false; Nao superou o oficial no agregado Top5.
- zag-v2: EXPERIMENTAL; promoted=false; Shadow melhorou alguma metrica agregada, mas segue sem promocao automatica.
- mei-v2: EXPERIMENTAL; promoted=false; Shadow melhorou alguma metrica agregada, mas segue sem promocao automatica.
- ata-v2: REJECTED; promoted=false; Nao superou o oficial no agregado Top5.
- tec-v2: REJECTED; promoted=false; Nao superou o oficial no agregado Top5.
- captain-v2: EXPERIMENTAL; promoted=false; Corrige auditoria de elegibilidade, mas nao altera a politica oficial sem mais rodadas.

## Limitacoes

- COR x REM so fecha quando a API oficial de partidas trouxer placar para o jogo.
- Shadow mode usa apenas sinais ja presentes nos snapshots/backtests; scouts marcados como divergentes nao sao convertidos em certeza.
- Pontuacao de atletas da Rodada 19 depende do snapshot/live market disponivel, nao de base historica final imutavel.
- Nenhum candidato foi promovido para o motor oficial nesta build.

