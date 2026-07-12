# Checklist de Ativacao em Producao

Build: 4.5.4

Antes de ativar:

- revisar `.github/workflows/live-snapshot-capture.yml`;
- confirmar branch principal;
- confirmar GitHub Actions habilitado;
- confirmar Workflow permissions com `contents: write`;
- confirmar Render auto deploy a partir do GitHub;
- confirmar que o Web Service nao executa captura no startup;
- confirmar que `push` nao e gatilho do workflow;
- confirmar endpoint publico apos deploy;
- executar `workflow_dispatch` com `dry_run=true`;
- revisar logs e Step Summary;
- executar `workflow_dispatch` real;
- confirmar commit do bot;
- confirmar deploy no Render, se auto deploy estiver ativo;
- confirmar endpoints `/live-snapshots/2026/production-health`, `/storage-health` e `/automation-status`;
- acompanhar a proxima execucao agendada.

Rollback:

- desabilitar o workflow no GitHub Actions;
- reverter o ultimo commit automatico se ele contiver apenas dados de snapshot incorretos;
- nunca usar push force;
- auditar `data/live-snapshots/2026` antes de nova ativacao.

Status apos esta build:

```text
productionAutomationStatus=READY
workflowActivationStatus=ACTIVE
renderAutoDeployConfirmed=true
renderAutoDeployMode=ON_COMMIT
```
