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

app.get("/teste-cartola-copa", async (req, res) => {
  const urls = [
    "https://api.cartolafc.globo.com/copa/atletas/mercado",
    "https://api.cartolafc.globo.com/cartola-copa/atletas/mercado",
    "https://api.cartolafc.globo.com/competicoes/copa/atletas/mercado",
    "https://api.cartolafc.globo.com/fifa/atletas/mercado",
    "https://api.cartolafc.globo.com/world-cup/atletas/mercado",
    "https://api.cartolafc.globo.com/atletas/mercado?competicao=copa",
    "https://api.cartolafc.globo.com/atletas/mercado?game=copa"
  ];

  const resultados = [];

  for (const url of urls) {
    try {
      const resposta = await fetch(url);
      const texto = await resposta.text();

      resultados.push({
        url,
        status: resposta.status,
        contentType: resposta.headers.get("content-type"),
        inicioResposta: texto.substring(0, 300)
      });
    } catch (erro) {
      resultados.push({
        url,
        erro: erro.toString()
      });
    }
  }

  res.json({
    sucesso: true,
    resultados
  });
});

app.get("/teste-atletas-copa", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://api.cartolafc.globo.com/copa/atletas/mercado"
    );

    const dados = await resposta.json();

    res.json({
      totalAtletas: dados.atletas?.length ?? 0,
      primeiroAtleta: dados.atletas?.[0] ?? null,
      chaves: Object.keys(dados),
      posicoes: dados.posicoes,
      status: dados.status,
      clubes: Object.keys(dados.clubes || {}).length
    });

  } catch (e) {
    res.json({
      erro: e.toString()
    });
  }
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

app.get("/ia-copa", async (req, res) => {
  try {
    const resposta = await fetch(
      "https://api.cartolafc.globo.com/copa/atletas/mercado"
    );

    const dados = await resposta.json();

    const atletas = Array.isArray(dados.atletas) ? dados.atletas : [];
    const clubes = dados.clubes || {};
    const posicoes = dados.posicoes || {};
    const status = dados.status || {};
    const FORCA_SELECOES = {
      "Argentina": 98,
      "França": 97,
      "Brasil": 96,
      "Espanha": 95,
      "Portugal": 93,
      "Alemanha": 92,
      "Inglaterra": 92,
      "Holanda": 90,
      "Bélgica": 88,
      "Croácia": 86,
      "Uruguai": 85,
      "Marrocos": 84,
      "México": 82,
      "Estados Unidos": 82,
      "Japão": 81,
      "Suíça": 80,
      "Dinamarca": 80,
      "Sérvia": 79,
      "Senegal": 79,
      "Colômbia": 78,
      "Equador": 77,
      "Canadá": 76,
      "Noruega": 76,
      "Paraguai": 75,
      "Austrália": 74,
      "Coreia do Sul": 73,
      "Polônia": 73,
      "Áustria": 72,
      "Escócia": 72,
      "Turquia": 72,
      "Nigéria": 71,
      "Costa do Marfim": 71,
      "Chile": 70,
      "Egito": 70,
      "Gana": 69,
      "África do Sul": 68,
      "Tunísia": 67,
      "Camarões": 67,
      "RD Congo": 66,
      "Nova Zelândia": 64,
      "Irã": 64,
      "Costa Rica": 63,
      "Haiti": 60
    };
    function forcaSelecao(nome) {
      return FORCA_SELECOES[nome] ?? 70;
    }
    
    function calcularNotaIA(jogador) {
      let nota = 0;
      const forca = forcaSelecao(
        clubes[jogador.clube_id]?.nome_fantasia ||
        clubes[jogador.clube_id]?.nome ||
        ""
      );
      
      nota += (jogador.media_num || 0) * 3.2;
      nota += (jogador.pontos_num || 0) * 0.35;
      nota += (jogador.jogos_num || 0) * 2;
      nota += forca * 0.18;
      
      if (jogador.status_id === 7) nota += 10;
      if (jogador.status_id === 2) nota -= 10;
      if (jogador.status_id === 3) nota -= 25;
      if (jogador.status_id === 5) nota -= 25;
      if (jogador.status_id === 6) nota -= 30;

      nota -= (jogador.preco_num || 0) * 0.12;

      if (nota > 100) nota = 100;
      if (nota < 0) nota = 0;

      return Number(nota.toFixed(1));
    }

    function atletaFormatado(jogador) {
      const clube = clubes[jogador.clube_id] || {};
      const posicao = posicoes[jogador.posicao_id] || {};
      const situacao = status[jogador.status_id] || {};

      return {
        nome: jogador.nome || "",
        apelido: jogador.apelido || "",
        foto: jogador.foto || "",
        clube: clube.nome || "",
        selecao: clube.nome_fantasia || clube.nome || "",
        escudo: clube.escudos?.["60x60"] || "",
        posicao: posicao.nome || "",
        posicaoAbreviacao: posicao.abreviacao || "",
        status: situacao.nome || "",
        preco: jogador.preco_num || 0,
        media: jogador.media_num || 0,
        pontos: jogador.pontos_num || 0,
        jogos: jogador.jogos_num || 0,
        notaIA: calcularNotaIA(jogador)
      };
    }

    const ranking = atletas
      .map(atletaFormatado)
      .filter(j => j.status !== "Contundido" && j.status !== "Suspenso")
      .sort((a, b) => b.notaIA - a.notaIA);

    function topPorPosicao(abreviacao, limite) {
      return ranking
        .filter(j => j.posicaoAbreviacao === abreviacao)
        .slice(0, limite);
    }

    const baratos = ranking
      .filter(j => j.preco > 0 && j.preco <= 6)
      .slice(0, 20);

    const capitaes = ranking
      .filter(j => ["ata", "mei"].includes(j.posicaoAbreviacao))
      .slice(0, 20);

    res.json({
      versao: "7.0",
      origem: "Cartola da Copa",
      totalAtletas: atletas.length,
      totalAnalisados: ranking.length,
      capitaes,
      atacantes: topPorPosicao("ata", 20),
      meias: topPorPosicao("mei", 20),
      laterais: topPorPosicao("lat", 20),
      zagueiros: topPorPosicao("zag", 20),
      goleiros: topPorPosicao("gol", 20),
      tecnicos: topPorPosicao("tec", 10),
      baratos,
      topGeral: ranking.slice(0, 30)
    });

  } catch (erro) {
    res.json({
      erro: erro.toString()
    });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
