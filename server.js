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
    cartola = {
      erro: "Não foi possível buscar dados do Cartola",
      detalhe: e.toString()
    };
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

app.get("/copa", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json"
    );

    const dados = await resposta.json();
    const partidas = Array.isArray(dados.matches) ? dados.matches : [];

    const jogos = [];
    const resultados = [];

    for (const jogo of partidas) {
      const item = {
        mandante: jogo.team1 || "",
        visitante: jogo.team2 || "",
        data: `${jogo.date || ""} ${jogo.time || ""}`.trim(),
        grupo: jogo.group || "",
        estadio: jogo.ground || "",
        rodada: jogo.round || "",
        placar: jogo.score?.ft
          ? `${jogo.score.ft[0]} x ${jogo.score.ft[1]}`
          : ""
      };

      if (item.placar === "") {
        jogos.push(item);
      } else {
        resultados.push(item);
      }
    }

    res.json({
      competicao: dados.name || "World Cup 2026",
      fase: "Automático via API pública",
      totalJogos: jogos.length,
      totalResultados: resultados.length,
      totalGeral: jogos.length + resultados.length,
      jogos,
      resultados,
      grupos: [],
      artilheiros: []
    });
  } catch (erro) {
    res.json({
      competicao: "Copa do Mundo 2026",
      fase: "Erro ao carregar dados automáticos",
      erro: erro.toString(),
      jogos: [],
      resultados: [],
      grupos: [],
      artilheiros: []
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

app.get("/versao6", (req, res) => {
  res.json({
    versao: "6.0",
    mensagem: "Servidor atualizado"
  });
});

app.get("/teste-atletas", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://api.cartolafc.globo.com/atletas/mercado"
    );

    const dados = await resposta.json();

    res.json({
      sucesso: true,
      totalAtletas: dados.atletas ? dados.atletas.length : 0,
      primeiroAtleta: dados.atletas ? dados.atletas[0] : null,
      posicoes: dados.posicoes,
      clubes: dados.clubes,
      status: dados.status
    });
  } catch (erro) {
    res.json({
      sucesso: false,
      erro: erro.toString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
