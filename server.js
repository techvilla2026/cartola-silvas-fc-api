const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

async function buscarStatusCartola() {
  const resposta = await fetch("https://api.cartolafc.globo.com/mercado/status");
  const dados = await resposta.json();

  return {
    rodadaAtual: dados.rodada_atual,
    nomeRodada: dados.nome_rodada,
    statusMercado: dados.status_mercado,
    mercadoAberto: dados.status_mercado === 1,
    timesEscalados: dados.times_escalados,
    rodadaFinal: dados.rodada_final,
    gameOver: dados.game_over
  };
}

app.get("/", async (req, res) => {
  let cartola = null;

  try {
    cartola = await buscarStatusCartola();
  } catch (e) {
    cartola = {
      erro: "Não foi possível buscar dados do Cartola",
      detalhe: e.toString()
    };
  }

  res.json({
    status: "online",
    versao: "5.0",
    app: "Cartola Silvas FC",
    mensagem: "Servidor com dados reais do Cartola",
    ultimaAtualizacao: new Date().toISOString(),
    cartola,
    noticias: [
      {
        titulo: "Atacante Favorito pode ser poupado",
        clube: "Brasil",
        jogador: "Atacante Favorito",
        nivel: "alto",
        fonte: "Teste manual do servidor",
        resumo: "Jogador aparece como risco alto para testar a Central de Notícias."
      },
      {
        titulo: "Meia Bola Parada treinou parcialmente",
        clube: "Argentina",
        jogador: "Meia Bola Parada",
        nivel: "medio",
        fonte: "Teste manual do servidor",
        resumo: "Situação exige atenção antes de confirmar nos 25 times."
      },
      {
        titulo: "Centroavante Forte treinou normalmente",
        clube: "França",
        jogador: "Centroavante Forte",
        nivel: "baixo",
        fonte: "Teste manual do servidor",
        resumo: "Jogador aparece como opção segura para a rodada."
      }
    ]
  });
});

app.get("/teste-partidas", async (req, res) => {
  try {

    const resposta = await fetch(
      "https://api.cartolafc.globo.com/partidas"
    );

    const dados = await resposta.json();

    res.json(dados);

  } catch (erro) {

    res.json({
      erro: erro.toString()
    });

  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
