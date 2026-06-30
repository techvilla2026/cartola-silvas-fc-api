const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const CARTOLA_COPA_ATLETAS_URL = "https://api.cartolafc.globo.com/copa/atletas/mercado";
const CARTOLA_STATUS_URL = "https://api.cartolafc.globo.com/mercado/status";
const CARTOLA_PARTIDAS_URL = "https://api.cartolafc.globo.com/partidas";
const COPA_JOGOS_URL = "https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json";

function clamp(valor, minimo, maximo) {
  return Math.max(minimo, Math.min(maximo, valor));
}

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

const ALIASES_SELECOES = {
  "brasil": "Brazil",
  "brazil": "Brazil",
  "argentina": "Argentina",
  "franca": "France",
  "france": "France",
  "espanha": "Spain",
  "spain": "Spain",
  "portugal": "Portugal",
  "alemanha": "Germany",
  "germany": "Germany",
  "inglaterra": "England",
  "england": "England",
  "holanda": "Netherlands",
  "netherlands": "Netherlands",
  "paises baixos": "Netherlands",
  "belgica": "Belgium",
  "belgium": "Belgium",
  "croacia": "Croatia",
  "croatia": "Croatia",
  "uruguai": "Uruguay",
  "uruguay": "Uruguay",
  "marrocos": "Morocco",
  "morocco": "Morocco",
  "mexico": "Mexico",
  "estados unidos": "United States",
  "usa": "United States",
  "united states": "United States",
  "japao": "Japan",
  "japan": "Japan",
  "suica": "Switzerland",
  "switzerland": "Switzerland",
  "dinamarca": "Denmark",
  "denmark": "Denmark",
  "servia": "Serbia",
  "serbia": "Serbia",
  "senegal": "Senegal",
  "colombia": "Colombia",
  "equador": "Ecuador",
  "ecuador": "Ecuador",
  "canada": "Canada",
  "noruega": "Norway",
  "norway": "Norway",
  "paraguai": "Paraguay",
  "paraguay": "Paraguay",
  "australia": "Australia",
  "coreia do sul": "South Korea",
  "south korea": "South Korea",
  "polonia": "Poland",
  "poland": "Poland",
  "austria": "Austria",
  "escocia": "Scotland",
  "scotland": "Scotland",
  "turquia": "Turkey",
  "turkey": "Turkey",
  "costa do marfim": "Ivory Coast",
  "ivory coast": "Ivory Coast",
  "egito": "Egypt",
  "egypt": "Egypt",
  "gana": "Ghana",
  "ghana": "Ghana",
  "africa do sul": "South Africa",
  "south africa": "South Africa",
  "tunisia": "Tunisia",
  "tunisía": "Tunisia",
  "republica democratica do congo": "DR Congo",
  "rd congo": "DR Congo",
  "dr congo": "DR Congo",
  "congo dr": "DR Congo",
  "nova zelandia": "New Zealand",
  "new zealand": "New Zealand",
  "ira": "Iran",
  "iran": "Iran",
  "haiti": "Haiti",
  "cabo verde": "Cape Verde",
  "cape verde": "Cape Verde",
  "bosnia e herzegovina": "Bosnia & Herzegovina",
  "bosnia & herzegovina": "Bosnia & Herzegovina",
  "qatar": "Qatar",
  "catar": "Qatar",
  "republica tcheca": "Czech Republic",
  "czech republic": "Czech Republic",
  "curacao": "Curaçao",
  "curaçao": "Curaçao",
  "suecia": "Sweden",
  "sweden": "Sweden",
  "argelia": "Algeria",
  "algeria": "Algeria",
  "jordania": "Jordan",
  "jordan": "Jordan",
  "iraque": "Iraq",
  "iraq": "Iraq",
  "uzbequistao": "Uzbekistan",
  "uzbekistan": "Uzbekistan",
  "panama": "Panama",
  "arabia saudita": "Saudi Arabia",
  "saudi arabia": "Saudi Arabia"
};

const FORCA_SELECOES = {
  "Argentina": 98,
  "France": 97,
  "Brazil": 96,
  "Spain": 95,
  "Portugal": 93,
  "Germany": 92,
  "England": 92,
  "Netherlands": 90,
  "Belgium": 88,
  "Croatia": 86,
  "Uruguay": 85,
  "Morocco": 84,
  "Mexico": 82,
  "United States": 82,
  "Japan": 81,
  "Switzerland": 80,
  "Denmark": 80,
  "Serbia": 79,
  "Senegal": 79,
  "Colombia": 78,
  "Ecuador": 77,
  "Canada": 76,
  "Norway": 76,
  "Paraguay": 75,
  "Australia": 74,
  "South Korea": 73,
  "Poland": 73,
  "Austria": 72,
  "Scotland": 72,
  "Turkey": 72,
  "Ivory Coast": 71,
  "Egypt": 70,
  "Ghana": 69,
  "South Africa": 68,
  "Tunisia": 67,
  "DR Congo": 66,
  "New Zealand": 64,
  "Iran": 64,
  "Haiti": 60,
  "Cape Verde": 67,
  "Bosnia & Herzegovina": 69,
  "Qatar": 63,
  "Czech Republic": 72,
  "Curaçao": 60,
  "Sweden": 78,
  "Algeria": 70,
  "Jordan": 62,
  "Iraq": 62,
  "Uzbekistan": 63,
  "Panama": 61,
  "Saudi Arabia": 64
};

function selecaoCanonica(nome) {
  const chave = normalizarTexto(nome);
  return ALIASES_SELECOES[chave] || nome || "";
}

function forcaSelecao(nome) {
  const canonica = selecaoCanonica(nome);
  return FORCA_SELECOES[canonica] ?? 70;
}

function traduzirSelecao(nome) {
  const canonica = selecaoCanonica(nome);
  const mapa = {
    "Brazil": "Brasil",
    "Argentina": "Argentina",
    "France": "França",
    "Spain": "Espanha",
    "Portugal": "Portugal",
    "Germany": "Alemanha",
    "England": "Inglaterra",
    "Netherlands": "Holanda",
    "Belgium": "Bélgica",
    "Croatia": "Croácia",
    "Uruguay": "Uruguai",
    "Morocco": "Marrocos",
    "Mexico": "México",
    "United States": "Estados Unidos",
    "Japan": "Japão",
    "Switzerland": "Suíça",
    "Denmark": "Dinamarca",
    "Serbia": "Sérvia",
    "Senegal": "Senegal",
    "Colombia": "Colômbia",
    "Ecuador": "Equador",
    "Canada": "Canadá",
    "Norway": "Noruega",
    "Paraguay": "Paraguai",
    "Australia": "Austrália",
    "South Korea": "Coreia do Sul",
    "Poland": "Polônia",
    "Austria": "Áustria",
    "Scotland": "Escócia",
    "Turkey": "Turquia",
    "Ivory Coast": "Costa do Marfim",
    "Egypt": "Egito",
    "Ghana": "Gana",
    "South Africa": "África do Sul",
    "Tunisia": "Tunísia",
    "DR Congo": "República Democrática do Congo",
    "New Zealand": "Nova Zelândia",
    "Iran": "Irã",
    "Haiti": "Haiti",
    "Cape Verde": "Cabo Verde",
    "Bosnia & Herzegovina": "Bósnia e Herzegovina",
    "Qatar": "Catar",
    "Czech Republic": "República Tcheca",
    "Curaçao": "Curaçao",
    "Sweden": "Suécia",
    "Algeria": "Argélia",
    "Jordan": "Jordânia",
    "Iraq": "Iraque",
    "Uzbekistan": "Uzbequistão",
    "Panama": "Panamá",
    "Saudi Arabia": "Arábia Saudita"
  };

  return mapa[canonica] || nome || "";
}

async function buscarStatusCartola() {
  const resposta = await fetch(CARTOLA_STATUS_URL);
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
  const resposta = await fetch(CARTOLA_PARTIDAS_URL);
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

async function buscarJogosCopa() {
  const resposta = await fetch(COPA_JOGOS_URL);
  const dados = await resposta.json();
  const partidas = Array.isArray(dados.matches) ? dados.matches : [];

  return partidas.map((jogo) => {
    const placar = jogo.score?.ft
      ? `${jogo.score.ft[0]} x ${jogo.score.ft[1]}`
      : "";

    return {
      mandante: jogo.team1 || "",
      visitante: jogo.team2 || "",
      mandantePt: traduzirSelecao(jogo.team1 || ""),
      visitantePt: traduzirSelecao(jogo.team2 || ""),
      data: `${jogo.date || ""} ${jogo.time || ""}`.trim(),
      grupo: jogo.group || "",
      estadio: jogo.ground || "",
      rodada: jogo.round || "",
      placar
    };
  });
}

async function buscarAtletasCopa() {
  const resposta = await fetch(CARTOLA_COPA_ATLETAS_URL);
  return await resposta.json();
}

function proximoJogoDaSelecao(selecao, jogos) {
  const canonica = selecaoCanonica(selecao);

  return jogos.find((jogo) =>
    jogo.placar === "" &&
    (
      selecaoCanonica(jogo.mandante) === canonica ||
      selecaoCanonica(jogo.visitante) === canonica
    )
  );
}

function infoConfronto(selecao, jogos) {
  const canonica = selecaoCanonica(selecao);
  const jogo = proximoJogoDaSelecao(canonica, jogos);

  if (!jogo) {
    return {
      temJogo: false,
      adversario: "",
      adversarioPt: "",
      jogo: null,
      forcaSelecao: forcaSelecao(canonica),
      forcaAdversario: 70,
      diferenca: 0,
      classificacao: "Sem jogo próximo",
      confrontoScore: 10,
      chanceSG: 45,
      ajusteAtacante: 0,
      ajusteDefensor: 0
    };
  }

  const adversario = selecaoCanonica(jogo.mandante) === canonica
    ? jogo.visitante
    : jogo.mandante;

  const minhaForca = forcaSelecao(canonica);
  const forcaAdv = forcaSelecao(adversario);
  const diferenca = minhaForca - forcaAdv;

  let classificacao = "Equilibrado";
  let confrontoScore = 12;
  let chanceSG = 45;

  if (diferenca >= 20) {
    classificacao = "Muito favorável";
    confrontoScore = 20;
    chanceSG = 78;
  } else if (diferenca >= 12) {
    classificacao = "Favorável";
    confrontoScore = 17;
    chanceSG = 68;
  } else if (diferenca >= 6) {
    classificacao = "Leve vantagem";
    confrontoScore = 15;
    chanceSG = 58;
  } else if (diferenca >= 0) {
    classificacao = "Equilibrado com vantagem";
    confrontoScore = 13;
    chanceSG = 50;
  } else if (diferenca <= -20) {
    classificacao = "Muito difícil";
    confrontoScore = 4;
    chanceSG = 18;
  } else if (diferenca <= -12) {
    classificacao = "Difícil";
    confrontoScore = 7;
    chanceSG = 26;
  } else if (diferenca <= -6) {
    classificacao = "Desafiador";
    confrontoScore = 9;
    chanceSG = 35;
  } else {
    classificacao = "Equilibrado";
    confrontoScore = 11;
    chanceSG = 43;
  }

  return {
    temJogo: true,
    adversario,
    adversarioPt: traduzirSelecao(adversario),
    jogo,
    forcaSelecao: minhaForca,
    forcaAdversario: forcaAdv,
    diferenca,
    classificacao,
    confrontoScore,
    chanceSG,
    ajusteAtacante: Math.round((confrontoScore - 10) * 0.9),
    ajusteDefensor: Math.round((chanceSG - 45) / 5)
  };
}

function nivelIndice(indice) {
  if (indice >= 96) return "LENDÁRIO";
  if (indice >= 90) return "ELITE";
  if (indice >= 85) return "MUITO FORTE";
  if (indice >= 80) return "BOA APOSTA";
  if (indice >= 70) return "ARRISCADO";
  if (indice >= 60) return "EVITE";
  return "FUJA";
}

function emojiNivel(indice) {
  if (indice >= 96) return "🟣";
  if (indice >= 90) return "🟢";
  if (indice >= 85) return "🔵";
  if (indice >= 80) return "🟠";
  if (indice >= 70) return "🟡";
  if (indice >= 60) return "🔴";
  return "⚫";
}

function estrelasIndice(indice) {
  if (indice >= 90) return "⭐⭐⭐⭐⭐";
  if (indice >= 80) return "⭐⭐⭐⭐☆";
  if (indice >= 70) return "⭐⭐⭐☆☆";
  if (indice >= 60) return "⭐⭐☆☆☆";
  return "⭐☆☆☆☆";
}

function calcularIndiceSilvas(jogador, selecao, posicaoAbreviacao, confronto) {
  const media = jogador.media_num || 0;
  const pontos = jogador.pontos_num || 0;
  const jogos = jogador.jogos_num || 0;
  const preco = jogador.preco_num || 0;

  const mediaNorm = clamp(media / 20 * 100, 0, 100);
  const pontosNorm = clamp(pontos / 120 * 100, 0, 100);
  const regularidadeNorm = clamp(jogos / 7 * 100, 0, 100);
  const forcaNorm = clamp((forcaSelecao(selecao) - 55) / 45 * 100, 0, 100);
  const confrontoNorm = clamp(confronto.confrontoScore / 20 * 100, 0, 100);
  const sgNorm = clamp(confronto.chanceSG, 0, 100);
  const custoNorm = preco > 0 ? clamp((media / preco) * 65, 0, 100) : 35;

  let statusNorm = 100;
  if (jogador.status_id === 2) statusNorm = 45;
  if ([3, 5, 6].includes(jogador.status_id)) statusNorm = 0;

  // Pesos por posição:
  // Copa: não força zaga fechada. A IA busca o melhor atleta individual por posição.
  let indice = 0;

  if (posicaoAbreviacao === "gol") {
    indice =
      sgNorm * 0.35 +
      forcaNorm * 0.20 +
      mediaNorm * 0.25 +
      custoNorm * 0.10 +
      statusNorm * 0.10;
  } else if (posicaoAbreviacao === "zag") {
    indice =
      sgNorm * 0.30 +
      mediaNorm * 0.25 +
      forcaNorm * 0.15 +
      confrontoNorm * 0.10 +
      custoNorm * 0.10 +
      statusNorm * 0.10;
  } else if (posicaoAbreviacao === "lat") {
    indice =
      sgNorm * 0.22 +
      confrontoNorm * 0.20 +
      mediaNorm * 0.25 +
      regularidadeNorm * 0.10 +
      custoNorm * 0.13 +
      statusNorm * 0.10;
  } else if (posicaoAbreviacao === "mei") {
    indice =
      mediaNorm * 0.30 +
      confrontoNorm * 0.25 +
      pontosNorm * 0.15 +
      regularidadeNorm * 0.10 +
      custoNorm * 0.10 +
      statusNorm * 0.10;
  } else if (posicaoAbreviacao === "ata") {
    indice =
      confrontoNorm * 0.32 +
      mediaNorm * 0.28 +
      pontosNorm * 0.15 +
      forcaNorm * 0.10 +
      custoNorm * 0.05 +
      statusNorm * 0.10;
  } else if (posicaoAbreviacao === "tec") {
    indice =
      sgNorm * 0.30 +
      forcaNorm * 0.30 +
      confrontoNorm * 0.20 +
      custoNorm * 0.05 +
      statusNorm * 0.15;
  } else {
    indice =
      mediaNorm * 0.30 +
      confrontoNorm * 0.20 +
      pontosNorm * 0.15 +
      forcaNorm * 0.15 +
      custoNorm * 0.10 +
      statusNorm * 0.10;
  }

  return Number(clamp(indice, 0, 100).toFixed(1));
}

function gerarMotivos(jogador, selecao, posicaoAbreviacao, confronto, indice) {
  const motivos = [];

  motivos.push(`${emojiNivel(indice)} ${nivelIndice(indice)} pelo Índice Silvas`);
  motivos.push(`⚔️ Confronto: ${confronto.classificacao}`);

  if (confronto.temJogo) {
    motivos.push(`🆚 Próximo jogo: ${traduzirSelecao(selecao)} x ${confronto.adversarioPt}`);
  } else {
    motivos.push("⏳ Sem jogo próximo encontrado na base da Copa");
  }

  if (["gol", "zag", "lat", "tec"].includes(posicaoAbreviacao)) {
    motivos.push(`🛡️ Chance estimada de SG: ${confronto.chanceSG}%`);
  }

  if (["ata", "mei"].includes(posicaoAbreviacao) && confronto.confrontoScore >= 15) {
    motivos.push("⚽ Boa oportunidade ofensiva pelo confronto");
  }

  if ((jogador.media_num || 0) >= 10) {
    motivos.push("📈 Média alta no Cartola da Copa");
  }

  if ((jogador.preco_num || 0) > 0 && (jogador.media_num || 0) / (jogador.preco_num || 1) >= 0.8) {
    motivos.push("💰 Bom custo-benefício");
  }

  if (jogador.status_id === 7) {
    motivos.push("✅ Status provável");
  }

  if (jogador.status_id === 2) {
    motivos.push("⚠️ Status de dúvida");
  }

  return motivos;
}


function radarSilvas(jogador, posicaoAbreviacao, confronto, indice) {
  if (["Contundido", "Suspenso"].includes(jogador.status || "")) return "EVITAR";
  if (indice >= 90 && confronto.classificacao !== "Muito difícil") return "EXPLODIR";
  if (indice >= 80) return "SEGURO";
  if (indice >= 70) return "APOSTA";
  if (indice >= 60) return "ARRISCADO";
  return "EVITAR";
}

function recomendacaoFinal(indice) {
  if (indice >= 90) return "ESCALAR";
  if (indice >= 80) return "ESCALAR COM CONFIANÇA";
  if (indice >= 70) return "USAR COM CAUTELA";
  if (indice >= 60) return "SÓ SE PRECISAR";
  return "NÃO RECOMENDADO";
}

function atletaFormatado(jogador, clubes, posicoes, status, jogos) {
  const clube = clubes[jogador.clube_id] || {};
  const posicao = posicoes[jogador.posicao_id] || {};
  const situacao = status[jogador.status_id] || {};

  const selecaoOriginal = clube.nome_fantasia || clube.nome || "";
  const selecao = selecaoCanonica(selecaoOriginal);
  const selecaoPt = traduzirSelecao(selecaoOriginal);
  const posicaoAbreviacao = posicao.abreviacao || "";

  const confronto = infoConfronto(selecao, jogos);
  const indiceSilvas = calcularIndiceSilvas(jogador, selecao, posicaoAbreviacao, confronto);

  return {
    nome: jogador.nome || "",
    apelido: jogador.apelido || "",
    foto: jogador.foto || "",
    clube: clube.nome || "",
    selecao: selecaoPt,
    selecaoOriginal,
    escudo: clube.escudos?.["60x60"] || clube.escudos?.["45x45"] || "",
    posicao: posicao.nome || "",
    posicaoAbreviacao,
    status: situacao.nome || "",
    preco: jogador.preco_num || 0,
    media: jogador.media_num || 0,
    pontos: jogador.pontos_num || 0,
    jogos: jogador.jogos_num || 0,

    // Mantém compatibilidade com o Flutter atual.
    notaIA: indiceSilvas,

    indiceSilvas,
    nivel: nivelIndice(indiceSilvas),
    emojiNivel: emojiNivel(indiceSilvas),
    estrelas: estrelasIndice(indiceSilvas),
    confronto: {
      classificacao: confronto.classificacao,
      adversario: confronto.adversarioPt,
      chanceSG: confronto.chanceSG,
      forcaSelecao: confronto.forcaSelecao,
      forcaAdversario: confronto.forcaAdversario,
      diferenca: confronto.diferenca,
      data: confronto.jogo?.data || "",
      rodada: confronto.jogo?.rodada || ""
    },
    motivos: gerarMotivos(jogador, selecao, posicaoAbreviacao, confronto, indiceSilvas),
    radar: radarSilvas({ status: situacao.nome || "" }, posicaoAbreviacao, confronto, indiceSilvas),
    recomendacao: recomendacaoFinal(indiceSilvas)
  };
}

function ordenarPorIndice(lista) {
  return [...lista].sort((a, b) => b.indiceSilvas - a.indiceSilvas);
}

function topPorPosicao(ranking, abreviacao, limite) {
  return ranking
    .filter(j => j.posicaoAbreviacao === abreviacao)
    .slice(0, limite);
}

function montarTimeIdeal(ranking) {
  const pegar = (pos, qtd) => ranking.filter(j => j.posicaoAbreviacao === pos).slice(0, qtd);

  return {
    estrategia: "Copa: melhor atleta por posição. Não força zaga fechada.",
    esquema: "4-3-3",
    goleiros: pegar("gol", 1),
    laterais: pegar("lat", 2),
    zagueiros: pegar("zag", 2),
    meias: pegar("mei", 3),
    atacantes: pegar("ata", 3),
    tecnicos: pegar("tec", 1)
  };
}

function montarCategorias(ranking) {
  const atletasValidos = ranking.filter(j => !["Contundido", "Suspenso"].includes(j.status));

  const capitaes = atletasValidos
    .filter(j => ["ata", "mei"].includes(j.posicaoAbreviacao))
    .sort((a, b) => {
      const bonusA = a.confronto.classificacao.includes("favorável") || a.confronto.classificacao.includes("Favorável") ? 3 : 0;
      const bonusB = b.confronto.classificacao.includes("favorável") || b.confronto.classificacao.includes("Favorável") ? 3 : 0;
      return (b.indiceSilvas + bonusB) - (a.indiceSilvas + bonusA);
    })
    .slice(0, 20);

  const custoBeneficio = atletasValidos
    .filter(j => j.preco > 0 && j.indiceSilvas >= 65)
    .sort((a, b) => (b.indiceSilvas / b.preco) - (a.indiceSilvas / a.preco))
    .slice(0, 20);

  const baratos = atletasValidos
    .filter(j => j.preco > 0 && j.preco <= 6 && j.indiceSilvas >= 60)
    .slice(0, 20);

  const apostas = atletasValidos
    .filter(j =>
      j.indiceSilvas >= 75 &&
      j.indiceSilvas < 90 &&
      j.confronto.classificacao !== "Muito difícil" &&
      j.confronto.classificacao !== "Difícil"
    )
    .slice(0, 20);

  const diferenciais = atletasValidos
    .filter(j =>
      j.indiceSilvas >= 70 &&
      j.preco > 0 &&
      j.preco <= 12 &&
      !capitaes.slice(0, 8).some(c => c.apelido === j.apelido)
    )
    .slice(0, 20);

  const evitar = ranking
    .filter(j =>
      ["Contundido", "Suspenso", "Dúvida"].includes(j.status) ||
      j.indiceSilvas < 60 ||
      (j.preco >= 18 && j.indiceSilvas < 75) ||
      j.confronto.classificacao === "Muito difícil"
    )
    .slice(0, 20);

  const defesasDaRodada = atletasValidos
    .filter(j => ["gol", "zag", "lat", "tec"].includes(j.posicaoAbreviacao))
    .sort((a, b) => {
      const sgA = a.confronto?.chanceSG || 0;
      const sgB = b.confronto?.chanceSG || 0;
      return (sgB + b.indiceSilvas / 4) - (sgA + a.indiceSilvas / 4);
    })
    .slice(0, 30);

  return {
    capitaes,
    atacantes: topPorPosicao(atletasValidos, "ata", 20),
    meias: topPorPosicao(atletasValidos, "mei", 20),
    laterais: topPorPosicao(atletasValidos, "lat", 20),
    zagueiros: topPorPosicao(atletasValidos, "zag", 20),
    goleiros: topPorPosicao(atletasValidos, "gol", 20),
    tecnicos: topPorPosicao(atletasValidos, "tec", 10),
    baratos,
    custoBeneficio,
    apostas,
    diferenciais,
    evitar,
    defesasDaRodada,
    topGeral: atletasValidos.slice(0, 30),
    timeIdeal: montarTimeIdeal(atletasValidos)
  };
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
    versao: "8.5",
    app: "Cartola Silvas FC",
    mensagem: "Servidor com IA Silvas 8.5",
    ultimaAtualizacao: new Date().toISOString(),
    cartola,
    partidas,
    noticias: [
      {
        titulo: "IA Silvas 8.5 ativa",
        clube: "Cartola da Copa",
        jogador: "Índice Silvas",
        nivel: "alto",
        fonte: "Servidor Cartola Silvas FC",
        resumo: "Nova IA cruza atletas, confronto, força da seleção, custo-benefício e status."
      }
    ]
  });
});

app.get("/copa", async (req, res) => {
  try {
    const jogos = await buscarJogosCopa();

    const futuros = [];
    const resultados = [];

    for (const jogo of jogos) {
      if (jogo.placar === "") {
        futuros.push(jogo);
      } else {
        resultados.push(jogo);
      }
    }

    res.json({
      competicao: "World Cup 2026",
      fase: "Automático via API pública",
      totalJogos: futuros.length,
      totalResultados: resultados.length,
      totalGeral: jogos.length,
      jogos: futuros,
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
    const [dadosAtletas, jogos] = await Promise.all([
      buscarAtletasCopa(),
      buscarJogosCopa()
    ]);

    const atletas = Array.isArray(dadosAtletas.atletas) ? dadosAtletas.atletas : [];
    const clubes = dadosAtletas.clubes || {};
    const posicoes = dadosAtletas.posicoes || {};
    const status = dadosAtletas.status || {};

    const ranking = ordenarPorIndice(
      atletas.map(jogador => atletaFormatado(jogador, clubes, posicoes, status, jogos))
    );

    const categorias = montarCategorias(ranking);

    res.json({
      versao: "8.5",
      origem: "Cartola da Copa",
      modo: "Copa",
      estrategia: "Na Copa, a IA não força zaga fechada. Ela prioriza o melhor atleta por posição.",
      totalAtletas: atletas.length,
      totalAnalisados: ranking.length,
      atualizadoEm: new Date().toISOString(),
      resumo: {
        lendarios: ranking.filter(j => j.indiceSilvas >= 96).length,
        elite: ranking.filter(j => j.indiceSilvas >= 90 && j.indiceSilvas < 96).length,
        muitoFortes: ranking.filter(j => j.indiceSilvas >= 85 && j.indiceSilvas < 90).length,
        boaAposta: ranking.filter(j => j.indiceSilvas >= 80 && j.indiceSilvas < 85).length,
        arriscados: ranking.filter(j => j.indiceSilvas >= 70 && j.indiceSilvas < 80).length,
        evitar: ranking.filter(j => j.indiceSilvas < 60).length
      },
      ...categorias
    });

  } catch (erro) {
    res.json({
      versao: "8.5",
      erro: erro.toString()
    });
  }
});

app.get("/time-ideal", async (req, res) => {
  try {
    const [dadosAtletas, jogos] = await Promise.all([
      buscarAtletasCopa(),
      buscarJogosCopa()
    ]);

    const atletas = Array.isArray(dadosAtletas.atletas) ? dadosAtletas.atletas : [];
    const clubes = dadosAtletas.clubes || {};
    const posicoes = dadosAtletas.posicoes || {};
    const status = dadosAtletas.status || {};

    const ranking = ordenarPorIndice(
      atletas
        .map(jogador => atletaFormatado(jogador, clubes, posicoes, status, jogos))
        .filter(j => !["Contundido", "Suspenso"].includes(j.status))
    );

    res.json({
      versao: "8.5",
      modo: "Copa",
      ...montarTimeIdeal(ranking)
    });
  } catch (erro) {
    res.json({
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

app.get("/teste-atletas-copa", async (req, res) => {
  try {
    const dados = await buscarAtletasCopa();

    res.json({
      totalAtletas: dados.atletas?.length ?? 0,
      primeiroAtleta: dados.atletas?.[0] ?? null,
      chaves: Object.keys(dados),
      posicoes: dados.posicoes,
      status: dados.status,
      clubes: Object.keys(dados.clubes || {}).length
    });
  } catch (erro) {
    res.json({
      erro: erro.toString()
    });
  }
});

app.get("/versao85", (req, res) => {
  res.json({
    versao: "8.5",
    mensagem: "IA Silvas 8.5 ativa"
  });
});

app.get("/versao8", (req, res) => {
  res.json({
    versao: "8.5",
    mensagem: "IA Silvas 8.5 ativa"
  });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
