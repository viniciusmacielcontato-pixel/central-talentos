// Utilidades compartilhadas pelas funções da Central de Talentos.
import { connectLambda, getStore } from "@netlify/blobs";

export const ROLES = ["gestor", "sdr"];

export function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

/** Lê o usuário do Netlify Identity (enviado como Bearer token pelo navegador). */
export function getUser(context) {
  const u = context && context.clientContext && context.clientContext.user;
  if (!u) return null;
  const roles = (u.app_metadata && u.app_metadata.roles) || [];
  return { id: u.sub, email: u.email, name: (u.user_metadata && u.user_metadata.full_name) || u.email, roles };
}

/** Exige login e um papel válido. Retorna { user } ou { error }. */
export function requireUser(context, onlyGestor = false) {
  const user = getUser(context);
  if (!user) return { error: json(401, { erro: "Faça login para continuar." }) };
  if (!user.roles.some((r) => ROLES.includes(r)))
    return { error: json(403, { erro: "Seu acesso ainda não foi liberado. Peça ao gestor para definir seu papel (gestor ou sdr)." }) };
  if (onlyGestor && !user.roles.includes("gestor"))
    return { error: json(403, { erro: "Somente o gestor pode fazer isso." }) };
  return { user };
}

export function store(event) {
  connectLambda(event);
  return getStore({ name: "talentos", consistency: "strong" });
}

export function parseBody(event) {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "";
    return JSON.parse(raw || "{}");
  } catch {
    return null;
  }
}

export const validId = (id) => typeof id === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(id);
