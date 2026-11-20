// /api/ia  — recursos de inteligência da Central de Talentos (Claude, da Anthropic).
// POST { tarefa: "perfil" | "resposta" | "chat" | "resumo", dados: {...} }
// Requer a variável de ambiente ANTHROPIC_API_KEY. Modelo opcional em ANTHROPIC_MODEL.
import { json, requireUser, parseBody } from "../lib/util.mjs";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";
const ADDRESS = "Alameda Grajaú, 129 – 1º andar, Alphaville Industrial, Barueri";
const RULES = `Regras obrigatórias: português do Brasil, tom cordial e direto, mensagens curtas de WhatsApp em nome do Vinicius (gestor comercial da Ademicon Alphaville). Nunca prometa contemplação, valores de ganho ou renda garantida. A remuneração é variável, por comissão. Os únicos horários de conversa são terça 19h, quinta 19h e sábado 9h, no escritório ${ADDRESS}. Avalie apenas experiência profissional, competências e localização; nunca considere idade, gênero, religião, estado civil, aparência ou origem.`;

const clip = (s, n) => String(s ?? "").slice(0, n);

function prompt(tarefa, d) {
  if (tarefa === "perfil") {
    return {
      json: true, max: 700,
      text: `Você é a SDR de recrutamento da Ademicon Alphaville avaliando um candidato a consultor de consórcio (vaga comercial, remuneração variável, presencial em Alphaville/Barueri).
Candidato: ${clip(d.nome, 120)}
Cidade: ${clip(d.cidade, 120) || "não informada"}
Etapa atual: ${clip(d.etapa, 40)}
Resumo do currículo: ${clip(d.experiencia, 1500) || "sem resumo"}

Responda SOMENTE um JSON com as chaves: "resumo" (1 frase), "fortes" (até 3 itens curtos), "atencao" (até 3 pontos a confirmar na conversa, como deslocamento, disponibilidade, abertura a remuneração variável), "mensagem" (mensagem de WhatsApp curta e personalizada para a etapa atual, citando algo concreto do currículo, sem prometer ganhos).`,
    };
  }
  if (tarefa === "resposta") {
    const horarios = (d.horarios || []).slice(0, 3).map((h, i) => `[${i}] ${clip(h, 60)}`).join("; ");
    return {
      json: true, max: 600,
      text: `Você é a SDR de recrutamento. O candidato ${clip(d.nome, 120)} (etapa atual: ${clip(d.etapa, 40)}${d.agendamento ? ", agendado " + clip(d.agendamento, 60) : ""}) respondeu no WhatsApp:
"""${clip(d.texto, 1500)}"""

Próximos horários disponíveis: ${horarios}.

Responda SOMENTE um JSON: {"intencao": uma de "interesse"|"duvida_ganhos"|"duvida"|"escolheu_horario"|"remarcar"|"sem_interesse"|"outro", "explicacao": 1 frase curta para a SDR, "horario": índice do horário escolhido (0, 1 ou 2) ou null, "proxima_etapa": uma de "interessado"|"agendado"|"descartado"|"retornar"|"aguardando", "resposta": mensagem curta de WhatsApp para enviar agora (se escolheu horário, confirme dia, hora e o endereço completo; se não tem interesse, agradeça com cordialidade)}.`,
    };
  }
  if (tarefa === "chat" || tarefa === "resumo") {
    const ctx = clip(JSON.stringify(d.contexto || {}), 60000);
    const historico = (d.historico || []).slice(-10).map((m) => `${m.role === "user" ? "Vinicius" : "Assistente"}: ${clip(m.content, 2000)}`).join("\n");
    const pedido = tarefa === "resumo"
      ? `Escreva as prioridades de hoje em no máximo 5 linhas curtas, cada uma começando com "- ". Cite nomes reais da base. Termine com uma meta numérica simples para o dia.`
      : `Responda à última mensagem do Vinicius de forma curta e prática, com listas quando ajudar. Ao citar candidatos, dê nome, cidade, nota e o motivo.`;
    return {
      json: false, max: 900,
      text: `Você é o assistente de recrutamento do Vinicius dentro da Central de Talentos. Hoje é ${clip(d.hoje, 60)}.
Use SOMENTE os dados abaixo; nunca invente nomes ou números. Se a resposta não estiver nos dados, diga isso.

DADOS DA BASE (JSON):
${ctx}

${historico ? "CONVERSA:\n" + historico + "\n\n" : ""}${pedido}`,
    };
  }
  return null;
}

function parseJSON(text) {
  const t = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

export const handler = async (event, context) => {
  if (event.httpMethod !== "POST") return json(405, { erro: "Método não permitido." });
  const { error } = requireUser(context);
  if (error) return error;
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { erro: "A IA ainda não foi configurada. O gestor precisa cadastrar a chave ANTHROPIC_API_KEY no Netlify.", semChave: true });

  const body = parseBody(event);
  const p = body && prompt(body.tarefa, body.dados || {});
  if (!p) return json(400, { erro: "Pedido inválido." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: p.max, system: RULES, messages: [{ role: "user", content: p.text }] }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic", r.status, JSON.stringify(data).slice(0, 500));
      if (r.status === 429) return json(429, { erro: "Muitos pedidos seguidos. Espere um minuto e tente de novo." });
      if (r.status === 401) return json(503, { erro: "A chave da IA é inválida. Confira ANTHROPIC_API_KEY no Netlify.", semChave: true });
      return json(502, { erro: "A IA não respondeu agora. Tente de novo em instantes." });
    }
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("").trim();
    if (p.json) {
      try { return json(200, { resultado: parseJSON(text) }); }
      catch { return json(502, { erro: "A IA respondeu num formato inesperado. Tente de novo." }); }
    }
    return json(200, { texto: text });
  } catch (e) {
    console.error(e);
    return json(502, { erro: "Não foi possível falar com a IA agora." });
  }
};
