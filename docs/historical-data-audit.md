# Auditoria de fontes historicas - Build 4.2.0

Data da auditoria: 2026-07-11.

## Resumo

A auditoria nao escolheu uma fonte antes de verificar disponibilidade, acesso legitimo, licenca e aderencia ao Cartola. A fonte primaria escolhida para esta build foi o projeto aberto caRtola, com validacao secundaria pelos endpoints publicos atuais do Cartola FC quando disponiveis.

| Fonte | Origem | Oficial/nao oficial | Licenca conhecida | Historico 2026 | Scouts por atleta | Pontuacao por rodada | Preco por rodada | Media por rodada | Clube | Posicao | Partidas | Resultados | Mando | Atualizacao | Estabilidade | Risco de dependencia | Adequacao para backtest |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cartola FC API publica | https://api.cartolafc.globo.com | Oficial/publica, sem doc formal completa | Termos Globo nao auditados nesta build | Temporada atual, rodada atual 19; historico parcial por endpoints de rodada | Sim em `/atletas/pontuados/:round` para atletas pontuados | Sim para pontuados | Nao historico pre-rodada | Nao historico pre-rodada | Sim | Sim | Sim em `/partidas/:round` | Sim | Sim | Ativa | Media: endpoints nao documentados formalmente | Medio | Boa para validacao pos-rodada, insuficiente como fonte unica historica |
| Footstats | https://footstats.com.br | Terceiro/fornecedor estatistico | Nao identificada para API publica | Nao confirmado por API publica | Nao identificado via API publica legitima | Nao identificado via API publica legitima | Nao identificado | Nao identificado | Nao identificado | Nao identificado | Nao identificado | Nao identificado | Nao identificado | Site ativo | Baixa para este projeto sem contrato/API | Alto | Nao adequada nesta build; nao ha API publica documentada utilizavel |
| caRtola | https://github.com/henriquepgomide/caRtola | Nao oficial/open source | MIT | Sim, `data/01_raw/2026/rodada-1.csv` ate `rodada-18.csv` | Sim, mas validacao indicou divergencias relevantes contra Cartola oficial | Sim | Sim, como campo historico da fonte | Sim | Sim | Sim | Nao no CSV; complementado por Cartola oficial | Nao no CSV; complementado por Cartola oficial | Nao no CSV; complementado por Cartola oficial | Ativo, push em 2026 | Boa para dataset versionado | Medio | Adequada como PRIMARY_SOURCE, com ressalva de divergencias e risco pre-rodada |
| Kaggle CartolaFC / Cartola FC Brasil Scouts | Kaggle e sites publicos | Nao oficial | Variavel/nao padronizada | Encontrado como fonte historica, mas nao adotado | Sim em alguns datasets/sites | Sim | Variavel | Variavel | Variavel | Variavel | Variavel | Variavel | Variavel | Incerta | Media/baixa | Medio/alto | Fallback documental; nao adotado para coleta automatica |
| APIs genericas de futebol | API-Football, football-data.org, Sportmonks | Terceiros | Planos/termos proprios | Possivel para Brasileirao, nao Cartola | Nao scouts Cartola | Nao pontuacao Cartola | Nao | Nao | Sim | Possivel | Sim | Sim | Sim | Ativa | Boa para futebol, baixa para Cartola | Alto para fantasy | Nao adequada para backtest Cartola |

## Footstats

Nao foi encontrada documentacao oficial publica de API Footstats utilizavel legitimamente para coleta automatica neste projeto. A tentativa de acessar o site publico nao forneceu contrato de API aberto; tambem nao foram usados cookies, credenciais, sessao de usuario, engenharia reversa ou endpoints privados.

Ha mencoes publicas de que a Footstats fornece scouts ao Cartola em anos recentes, mas esta build nao confirmou isso por fonte oficial suficiente para tratar como fato tecnico. Portanto:

- Footstats API publica utilizavel: **nao confirmada / nao encontrada**.
- Confirmacao de que Cartola usa Footstats em 2026: **nao confirmada oficialmente nesta auditoria**.

## caRtola

O reposito caRtola declara dados raw do Cartola FC desde 2014 e possui arquivos de 2026 em `data/01_raw/2026`. A licenca do repositorio e MIT. A revisao usada na coleta foi:

```text
11cd704b2a375d9db273f2b251e3a998b6ead381
```

Arquivos de 2026 encontrados:

```text
rodada-1.csv ... rodada-18.csv
```

Campos relevantes identificados:

```text
atletas.atleta_id, atletas.nome, atletas.apelido, atletas.clube_id,
atletas.posicao_id, atletas.status_id, atletas.preco_num,
atletas.variacao_num, atletas.media_num, atletas.pontos_num,
atletas.jogos_num, atletas.entrou_em_campo, scouts A/CA/CV/DE/DP/DS/...
```

## Escolha de fontes

```text
PRIMARY_SOURCE=caRtola
SECONDARY_VALIDATION_SOURCE=cartola-official-public-api
FALLBACK_SOURCE=Cartola FC Brasil Scouts/Kaggle apenas como referencia manual, nao automatizada
```

## Limitacao central encontrada

A validacao cruzada encontrou 10.254 divergencias entre caRtola e Cartola oficial, concentradas em scouts. Isso indica que os scouts do CSV podem estar em granularidade diferente, possivelmente acumulada ou transformada, e nao devem ser tratados como equivalentes perfeitos aos scouts oficiais da rodada sem investigacao adicional.
