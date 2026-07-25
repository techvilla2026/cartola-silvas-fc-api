# Build 5.2.6 - Painel de Evidencias SLVS

## 1. Resumo executivo

O painel consolida o motor oficial e os candidatos experimentais. Nenhum candidato foi promovido automaticamente.
Modelos catalogados: 23. EvidenceRecords: 25.
Evidencias positivas: 11; negativas: 8; inconclusivas: 5; limitacoes de dados: 1.
Maior score de evidencia: MEI_V2 (85/100).

## 2. O que o motor oficial faz hoje

O motor oficial permanece intacto: previsao, nota, selecao, capitao e endpoints do app nao foram alterados.

## 3. O que foi testado

- CLEAN_SHEET_V2: EXPERIMENTAL.
- GOL_V2: EXPERIMENTAL.
- LAT_V2: REJECTED.
- ZAG_V2: EXPERIMENTAL.
- MEI_V2: EXPERIMENTAL.
- ATA_V2: REJECTED.
- TEC_V2: REJECTED.
- CAPTAIN_V2: EXPERIMENTAL.
- AVAILABILITY_V1: REJECTED.
- RANKING_AVAILABILITY_AWARE: REJECTED.
- CAPTAIN_AVAILABILITY_AWARE: REJECTED.
- XI_AVAILABILITY_AWARE: REJECTED.
- FORMATION_SHADOW: EXPERIMENTAL.

## 4. O que melhorou

- GOL_V2 position.top3.actualPointsMean: delta 0.0863, confianca LOW.
- GOL_V2 position.top5.actualPointsMean: delta 0.0811, confianca LOW.
- LAT_V2 position.top1.actualPointsMean: delta 0.4177, confianca LOW.
- LAT_V2 position.top3.actualPointsMean: delta 0.0569, confianca LOW.
- ZAG_V2 position.top5.actualPointsMean: delta 0.0588, confianca LOW.
- MEI_V2 position.top1.actualPointsMean: delta 0.8294, confianca LOW.
- MEI_V2 position.top3.actualPointsMean: delta 0.1451, confianca LOW.
- MEI_V2 position.top5.actualPointsMean: delta 0.0529, confianca LOW.
- ATA_V2 position.top1.actualPointsMean: delta 0.6177, confianca LOW.
- XI_AVAILABILITY_AWARE round19.actualPoints: delta 9.8, confianca LOW.
- XI_AVAILABILITY_AWARE round19.didNotPlayCount: delta -4, confianca LOW.

## 5. O que piorou

- CLEAN_SHEET_V2 cleanSheet.top1: delta -0.0588, confianca MEDIUM.
- CLEAN_SHEET_V2 cleanSheet.top5: delta -0.0118, confianca MEDIUM.
- GOL_V2 position.top1.actualPointsMean: delta -0.4412, confianca LOW.
- LAT_V2 position.top5.actualPointsMean: delta -0.0964, confianca LOW.
- ZAG_V2 position.top1.actualPointsMean: delta -0.0176, confianca LOW.
- ZAG_V2 position.top3.actualPointsMean: delta -0.1039, confianca LOW.
- ATA_V2 position.top3.actualPointsMean: delta -0.3706, confianca LOW.
- ATA_V2 position.top5.actualPointsMean: delta -0.5106, confianca LOW.

## 6. O que ainda e inconclusivo

- CLEAN_SHEET_V2 cleanSheet.top3: Clean Sheet V2 top3 comparado ao V1.
- TEC_V2 position.top1.actualPointsMean: TEC_V2 comparado ao ranking oficial por posicao.
- TEC_V2 position.top3.actualPointsMean: TEC_V2 comparado ao ranking oficial por posicao.
- TEC_V2 position.top5.actualPointsMean: TEC_V2 comparado ao ranking oficial por posicao.
- FORMATION_SHADOW formation.hitRate: Formacao recomendada acertou a melhor formacao real em parte das rodadas, mas sem criterio de promocao.

## 7. Qualidade dos dados

- PARTICIPATION_DATA: AVAILABLE, coverage 1, risco: TopK historico pode nao reproduzir R19.
- ACTUAL_POINTS_DATA: PARTIAL, coverage 1, risco: Null deve permanecer null.
- STATUS_DATA: UNAVAILABLE, coverage 0, risco: Majoritariamente indisponivel.
- MATCH_CONTEXT_DATA: AVAILABLE, coverage 1, risco: Nao prova titularidade.
- TEAM_CONTEXT_DATA: PARTIAL, coverage 1, risco: Sem escalação confirmada.
- SCOUT_DATA: UNRELIABLE, coverage null, risco: Risco alto de interpretacao.
- LINEUP_DATA: UNAVAILABLE, coverage 0, risco: Nao inventar titularidade.
- INJURY_DATA: UNAVAILABLE, coverage 0, risco: Nao inventar lesoes.
- SUSPENSION_DATA: UNAVAILABLE, coverage 0, risco: Nao inventar suspensoes.
- OWNERSHIP_DATA: UNAVAILABLE, coverage 0, risco: Nao chamar diferencial real.
- VALUATION_DATA: PARTIAL, coverage 1, risco: Valorizacao futura nao modelada.

## 8. Resultados por posicao

Os modelos por posicao permanecem em Shadow Mode; melhorias pontuais nao sao promocao.

## 9. Capitao

R19 oficial: Danilo dos Santos de Oliveira; availability-aware: Pedro Guilherme Abreu dos Santos.

## 10. Time Ideal

R19 oficial: 83.3; availability-aware: 93.1.

## 11. Disponibilidade

O target historico contem jogadores que nao jogaram, mas o TopK historico avaliado nao selecionou esses casos; a comparacao com a Rodada 19 live fica inconclusiva.

## 12. Clean Sheet

Clean Sheet V2 piorou Top1 e Top5 no agregado, empatou Top3 e segue sem promocao.

## 13. Formacao

Taxa de acerto conhecida: 0.5882.

## 14. Promotion Gate

Nenhum candidato ficou PROMOTABLE.

## 15. Proxima prioridade

EVALUATE_PRE_MATCH_CAPTURE_AFTER_OUTCOME: Avaliacao prospectiva 5.2.12: PENDING_OUTCOME.

