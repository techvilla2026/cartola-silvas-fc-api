# Auditoria de Paridade do Motor Flutter

## Arquivos auditados

- RuleBasedScorePredictionRepository: lib/features/score_prediction/data/rule_based_score_prediction_repository.dart (f9f9762e8a5bcdc4055373478af330940a26d32f6f2ff49e6f70cc840713619c)
- RuleBasedPlayerAnalysisScoreRepository: lib/features/player_analysis_score/data/rule_based_player_analysis_score_repository.dart (20dda6b0dcf0dc037d696fa7a95383b03a4c1ac568da00b6626c62b8973dfd79)
- RuleBasedSlvsConfidenceRepository: lib/features/slvs_confidence/data/rule_based_slvs_confidence_repository.dart (275f4322be05e341542fb6678d1b8630631bf8e066500d2988b92ae66fb52614)
- RealPlayerSelectionPolicy: lib/features/ideal_team/data/real_player_selection_policy.dart (cbf5090cd719ff5539379219c2296d686d0cf84bddf493b6f6c7bb34761ba11a)
- CartolaIdealTeamRepository: lib/features/ideal_team/data/cartola_ideal_team_repository.dart (3f83db439740d1d69410910506e516891f94139ebf3a8de7a7b0c5ee1b767ddc)
- RuleBasedCentralIntelligenceRepository: lib/features/central_intelligence/data/rule_based_central_intelligence_repository.dart (0f5abfb853e20b83b79eb78e540c167f2e069bed423eecbcd565ed9005401613)
- RealTeamComparisonRepository: lib/features/compare_team/data/real_team_comparison_repository.dart (80dc25a758dc7cfe323143f109774e184dc7ffa1cd72937b12972de6c7962c44)
- SuggestedSwap: lib/features/compare_team/domain/suggested_swap.dart (59f18722ec6cb03f5f8940e53a2b54fb269e115478fd860380a1ae10761b9d96)

## Regras reproduzidas

- Formula de previsao por media, bonus de media alta, bonus de mando, clamp e arredondamento.
- Qualidade dos dados com pesos, redutores, bonus de dados completos e faixas internas.
- Nota da analise com pesos, componentes, limitador por qualidade e faixas.
- Selecao 4-3-3 por status, media, mando, preco e id.
- Capitao e vice por previsao, Nota, qualidade dos dados e media.

## Aproximacoes historicas

- Status historico indisponivel foi mantido vazio, como componente neutro/conservador.
- Dados recentes do mercado Flutter, como pontos_num e variacao_num atuais, foram zerados por nao existirem de forma pre-rodada segura.
- Scouts historicos acumulados nao foram usados na qualidade por divergencia documentada entre fontes.

## Regras nao reproduzidas

- Comparador historico, por falta de elenco real do usuario antes de cada rodada.
- Tecnico na avaliacao do time, por falta de dados historicos seguros suficientes no mesmo contrato.
