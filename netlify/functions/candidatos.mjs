// /api/candidatos
//   GET            → lista todos os candidatos (gestor e sdr)
//   PUT  {candidate} → grava um candidato (gestor e sdr)
//   POST {items}   → importação em lote (só gestor)
//   DELETE ?id=    → remove um candidato (só gestor)
import { json, requireUser, store, parseBody, validId } from "../lib/util.mjs";

const PREFIX = "c/";
const MAX_HISTORY = 200;

function clean(c, user) {
  const out = { ...c };
  delete out.score;
  delete out.reasons;
  delete out._dirty;
  if (Array.isArray(out.history) && out.history.length > MAX_HISTORY) out.history = out.history.slice(-MAX_HISTORY);
  out.updatedAt = new Date().toISOString();
  out.updatedBy = user.email;
  return out;
}

async function inChunks(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export const handler = async (event, context) => {
  const onlyGestor = event.httpMethod === "POST" || event.httpMethod === "DELETE";
  const { user, error } = requireUser(context, onlyGestor);
  if (error) return error;
  const db = store(event);

  try {
    if (event.httpMethod === "GET") {
      const { blobs } = await db.list({ prefix: PREFIX });
      const items = await inChunks(blobs, 40, (b) => db.get(b.key, { type: "json" }));
      return json(200, { items: items.filter(Boolean), user });
    }

    if (event.httpMethod === "PUT") {
      const body = parseBody(event);
      const c = body && body.candidate;
      if (!c || !validId(c.id) || !c.name) return json(400, { erro: "Candidato inválido." });
      const saved = clean(c, user);
      await db.setJSON(PREFIX + c.id, saved);
      return json(200, { ok: true, candidate: saved });
    }

    if (event.httpMethod === "POST") {
      const body = parseBody(event);
      const items = (body && Array.isArray(body.items) ? body.items : []).filter((c) => c && validId(c.id) && c.name);
      if (!items.length) return json(400, { erro: "Nenhum candidato válido na importação." });
      if (items.length > 2000) return json(400, { erro: "Importe no máximo 2.000 candidatos por vez." });
      let created = 0, updated = 0;
      await inChunks(items, 25, async (r) => {
        const old = await db.get(PREFIX + r.id, { type: "json" });
        let c;
        if (old) {
          // Atualiza dados cadastrais sem apagar o trabalho já feito na Central.
          c = { ...old, name: r.name, phone: r.phone || old.phone, city: r.city || old.city, exp: r.exp || old.exp, criteria: Math.max(r.criteria || 0, old.criteria || 0) };
          updated++;
        } else {
          c = { ...r, createdAt: new Date().toISOString() };
          created++;
        }
        await db.setJSON(PREFIX + r.id, clean(c, user));
      });
      return json(200, { ok: true, created, updated });
    }

    if (event.httpMethod === "DELETE") {
      const id = event.queryStringParameters && event.queryStringParameters.id;
      if (!validId(id)) return json(400, { erro: "Informe o id." });
      await db.delete(PREFIX + id);
      return json(200, { ok: true });
    }

    return json(405, { erro: "Método não permitido." });
  } catch (e) {
    console.error(e);
    return json(500, { erro: "Falha ao acessar a base. Tente de novo em instantes." });
  }
};
