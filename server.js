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

async function buscarPartidasCartola() {
  const resposta = await fetch("https://api.cartolafc.globo.com/partidas");
  const dados = await resposta.json();

  const clubes = dados.clubes || {};
  const partidas = Array.isArray(dados.partidas) ? dados.partidas : [];

  return partidas.map((p) => {
    const mandante = clubes[p.clube_casa_id] || {};
    const visitante = clubes[p.clube_visitante_id] || {};

    return {
      partidaId: p.partida_id,
      mandante: mandante.nome || mandante.nome_fantasia || `Clube ${p.clube_casa_id}`,
      visitante: visitante.nome || visitante.nome_fantasia || `Clube ${p.clube_visitante_id}`,
      data: p.partida_data || "",
      local: p.local || "Local não informado",
      valida: p.valida === true,
      transmissao: p.transmissao?.label || ""
    };
  });
}

app.get("/", async (req, res) => {
  let cartola = null;
  let partidas = [];

  try {
    cartola = await buscarStatusCartola();
  } catch (e) {
    cartola = { erro: "Não foi possível buscar dados do Cartola", detalhe: e.toString() };
  }

  try {
    partidas = await buscarPartidasCartola();
  } catch (e) {
    partidas = [];
  }

  res.json({
    status: "online",
    versao: "5.1",
    app: "Cartola Silvas FC",
    mensagem: "Servidor com dados reais do Cartola e agenda da rodada",
    ultimaAtualizacao: new Date().toISOString(),
    cartola,
    partidas,
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

app.get("/teste-copa-api", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
    );

    const dados = await resposta.json();

    res.json({
      sucesso: true,
      dados
    });
  } catch (erro) {
    res.json({
      sucesso: false,
      erro: erro.toString()
    });
  }
});

app.get("/teste-cartola", async (req, res) => {
  try {
    const dados = await buscarStatusCartola();
    res.json({ sucesso: true, dados });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.toString() });
  }
});

app.get("/teste-partidas", async (req, res) => {
  try {
    const partidas = await buscarPartidasCartola();
    res.json({ sucesso: true, totalPartidas: partidas.length, partidas });
  } catch (erro) {
    res.json({ sucesso: false, erro: erro.toString() });
  }
});

app.get("/copa", async (req, res) => {

  res.json({
    competicao: "Copa do Mundo 2026",
    fase: "Fase de Grupos",

    jogos: [
      {
        mandante: "Brasil - Teste",
        visitante: "França",
        data: "2026-06-27 21:00"
      },
      {
        mandante: "Argentina",
        visitante: "Espanha",
        data: "2026-06-26 16:00"
      }
    ],

    grupos: [
      {
        grupo: "A",
        times: [
          { nome: "Brasil", pontos: 6 },
          { nome: "Holanda", pontos: 4 },
          { nome: "Japão", pontos: 1 },
          { nome: "Canadá", pontos: 0 }
        ]
      }
    ],

    artilheiros: [
      { jogador: "Mbappé", gols: 5 },
      { jogador: "Vini Jr", gols: 4 },
      { jogador: "Haaland", gols: 3 }
    ]
  });

});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
