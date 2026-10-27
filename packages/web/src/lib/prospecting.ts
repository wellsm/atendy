export const PROSPECTING_EXAMPLE = `{
  "leads": [
    {
      "name": "Pizzaria Exemplo",
      "phone": "11987654321",
      "messages": ["Oi, tudo bem? ...", "Oi! ..."],
      "info": { "bairro": "Penha", "categoria": "Pizzaria" },
      "category": "Pizzaria",
      "neighborhood": "Penha",
      "zone": "Zona Leste",
      "city": "São Paulo",
      "postal_code": "03610-000",
      "situation": "marketplace",
      "systems": [{ "name": "iFood", "kind": "market", "source": "Google Maps" }],
      "rating": 4.6,
      "reviews": 312,
      "score": 8,
      "site": "pizzariaexemplo.com.br",
      "mobile": true
    }
  ]
}`;

export const PROSPECTING_AI_PROMPT = `Você vai transformar a lista de leads abaixo em um arquivo JSON para eu importar numa ferramenta de envio.

Responda SOMENTE com JSON, exatamente neste formato: { "leads": [ ... ] }. Cada item de "leads" tem:
- "name": nome do estabelecimento (obrigatório);
- "phone": telefone com DDD, só números (ex.: 11987654321);
- "messages": de 2 a 4 variações da primeira mensagem de WhatsApp, cada uma com no máximo 500 caracteres;
- "info": (opcional) objeto simples, só com textos ou números, ex.: { "bairro": "Penha", "categoria": "Pizzaria" };
- campos opcionais, preencha só os que você realmente souber e omita os outros:
  - "category": tipo do negócio (ex.: "Pizzaria");
  - "neighborhood", "zone", "city", "postal_code": bairro, zona (ex.: "Zona Leste"), cidade e CEP;
  - "situation": como o lead atende hoje, uma destas chaves: "whatsapp" (pede no WhatsApp), "online_order" (pedir on-line sem plataforma), "marketplace" (só marketplace), "competitor" (usa concorrente), "none" (nada detectado);
  - "systems": lista de { "name": nome do sistema, "kind": "bot" | "market" | "whats" | "other", "source": onde você viu };
  - "rating" (nota, ex.: 4.6) e "reviews" (número de avaliações);
  - "score": encaixe com o nosso perfil, número de 0 a 10; nunca invente, omita se não tiver base;
  - "site": endereço do site, sem https://;
  - "mobile": true se o telefone é celular (WhatsApp provável), false se é fixo.

Regras das mensagens:
- curtas e naturais, como uma pessoa escrevendo no celular;
- sem nenhum link (nada de http, www. ou wa.me);
- cada mensagem faz uma pergunta;
- sem tom de venda e sem oferecer nada;
- nunca sugira que um robô ou sistema vai substituir as pessoas;
- varie a primeira frase entre as variações e use o que souber do lead (bairro, iFood, Anota AI etc.).

Siga o tom destes três exemplos ([nome] é o meu nome):
1. "Oi, tudo bem? Aqui é [nome]. Tô conversando com pizzarias da região sobre atendimento no WhatsApp. Pergunta rápida: sábado à noite, quantas conversas vocês chegam a ter abertas ao mesmo tempo?"
2. "Oi! Aqui é [nome]. Vi que vocês usam o Anota AI. Tô montando um atendimento de WhatsApp para pizzarias da região e queria entender: o que mais incomoda nele hoje?"
3. "Oi! Aqui é [nome]. Vi vocês no iFood. Vocês também recebem pedido direto pelo WhatsApp, ou fica tudo lá pela comissão?"

Ordene os leads do que mais combina com o nosso perfil para o que menos combina (nada é enviado até o admin colocar na fila; a ordem só desempata quando não há nota).

Lista de leads:
`;
