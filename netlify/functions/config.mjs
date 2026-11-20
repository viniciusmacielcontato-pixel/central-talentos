// /api/config
//   GET → mensagens prontas e preferências (gestor e sdr)
//   PUT {config} → salva (só gestor)
import { json, requireUser, store, parseBody } from "../lib/util.mjs";

export const handler = async (event, context) => {
  const { user, error } = requireUser(context, event.httpMethod === "PUT");
  if (error) return error;
  const db = store(event);
  try {
    if (event.httpMethod === "GET") {
      const cfg = (await db.get("config", { type: "json" })) || {};
      return json(200, { config: cfg, user });
    }
    if (event.httpMethod === "PUT") {
      const body = parseBody(event);
      if (!body || typeof body.config !== "object") return json(400, { erro: "Configuração inválida." });
      const text = JSON.stringify(body.config);
      if (text.length > 50000) return json(400, { erro: "Configuração grande demais." });
      await db.setJSON("config", { ...body.config, updatedAt: new Date().toISOString(), updatedBy: user.email });
      return json(200, { ok: true });
    }
    return json(405, { erro: "Método não permitido." });
  } catch (e) {
    console.error(e);
    return json(500, { erro: "Falha ao acessar a configuração." });
  }
};
