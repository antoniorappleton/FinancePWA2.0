export const HELP_CONTENT = {
  dashboard: {
    title: "Dashboard de Património",
    sections: [
      {
        icon: "fa-chart-pie",
        label: "Visão Geral",
        text: "Aqui tens o teu Net Worth (Património Líquido). O gráfico mostra como o teu capital está distribuído entre Ativos, Dinheiro e Outros."
      },
      {
        icon: "fa-plus-circle",
        label: "Registo Rápido",
        text: "Usa os botões de atalho para registar compras de ativos ou dividendos sem sair do dashboard."
      },
      {
        icon: "fa-heart-pulse",
        label: "Saúde Financeira",
        text: "Consulta os teus rácios de poupança e liquidez baseados na estratégia que definiste."
      }
    ]
  },
  atividade: {
    title: "Gestão de Portfólio",
    sections: [
      {
        icon: "fa-layer-group",
        label: "Estratégia Core/Satellite",
        text: "Os teus ativos são divididos entre CORE (estabilidade) e SATELLITE (potencial). O sistema avisa-te quando uma categoria sai do peso ideal."
      },
      {
        icon: "fa-bullseye",
        label: "GAP de Alocação",
        text: "Vê exatamente quanto € falta investir em cada ativo para atingires o teu objetivo estratégico individual."
      },
      {
        icon: "fa-filter",
        label: "Filtros e Ordenação",
        text: "Podes ordenar por 'Queda' para ver oportunidades de reforço ou por 'Yield' para ver os melhores pagadores."
      }
    ]
  },
  analise: {
    title: "Análise de Dividendos e Mercado",
    sections: [
      {
        icon: "fa-calendar-alt",
        label: "Heatmap de Pagamentos",
        text: "Vê a intensidade dos pagamentos de dividendos ao longo do ano. Cores mais escuras indicam meses de maior fluxo de caixa."
      },
      {
        icon: "fa-table",
        label: "Ficha Técnica",
        text: "Tabela detalhada com Yield Cur, P/E Ratio e distância às Médias Móveis (SMA50/200)."
      }
    ]
  },
  "portfolio-intel": {
    title: "Portfolio Intelligence V2",
    sections: [
      {
        icon: "fa-dna",
        label: "Structural Clusters",
        text: "Identificamos correlações reais entre os teus ativos. Se tiveres demasiada exposição a um único driver (ex: IA), o sistema avisa."
      },
      {
        icon: "fa-shield-halved",
        label: "Stress Test",
        text: "Simulação de perda máxima e volatilidade estrutural baseada no teu mix atual de ETFs e Ações."
      }
    ]
  },
  simulador: {
    title: "Simulador de Independência",
    sections: [
      {
        icon: "fa-rocket",
        label: "Juros Compostos",
        text: "Projeta o crescimento do teu património a longo prazo. Ajusta o aporte mensal e a taxa de retorno esperada."
      },
      {
        icon: "fa-umbrella-beach",
        label: "Fire Number",
        text: "Descobre quanto precisas de ter investido para viver apenas dos dividendos e rendimentos dos teus ativos."
      }
    ]
  },
  settings: {
    title: "Configurações e Estratégia",
    sections: [
      {
        icon: "fa-file-invoice-dollar",
        label: "Plano Financeiro",
        text: "Define o teu perfil de gastos e poupança. Estes dados alimentam os consultores inteligentes da app."
      },
      {
        icon: "fa-database",
        label: "Gestão de Dados",
        text: "Exporta ou importa os teus dados em JSON. Lembra-te: os dados estão seguros no teu Firebase."
      }
    ]
  }
};
