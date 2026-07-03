"use server";

// Optional AI executive summary for the Insights tab. Degrades gracefully: the
// deterministic insights are always shown; this just adds a narrative when an
// ANTHROPIC_API_KEY is configured. Facts are computed server-side (no raw PII
// beyond aggregates leaves the app).

import { canAccessOrAdmin } from "@/lib/permissions";
import type { Insight } from "@/lib/sales/intelligence";

export async function generateNarrative(
  insights: Insight[],
  ctx: { refYear: number; curYTD: number; prevYTD: number; projection: number },
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!(await canAccessOrAdmin(["sales_analytics.view"], { finance: true }))) return { ok: false, error: "Accès refusé." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "Synthèse IA non configurée (ANTHROPIC_API_KEY manquante). Les analyses ci-dessous restent disponibles." };
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const facts = insights.map((i) => `- [${i.kind}] ${i.title} — ${i.detail}`).join("\n");
    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `Tu es directeur financier. À partir de ces faits chiffrés sur nos ventes ${ctx.refYear} (source : registre interne), rédige une synthèse exécutive en français (180-260 mots) : 1) état de la performance, 2) explication des variations, 3) trois décisions prioritaires, 4) risques, 5) opportunités. Direct, actionnable, sans blabla ni chiffres inventés.\n\nCA ${ctx.refYear} à date : ${Math.round(ctx.curYTD)} (vs ${Math.round(ctx.prevYTD)} l'an dernier même période). Projection fin d'année : ${Math.round(ctx.projection)}.\n\nFaits :\n${facts}`,
      }],
    });
    const text = (msg.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return { ok: true, text: text || "(réponse vide)" };
  } catch (e: any) {
    return { ok: false, error: "Synthèse IA indisponible : " + (e?.message ?? String(e)) };
  }
}

async function claude(system: string, user: string, maxTokens = 700): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!(await canAccessOrAdmin(["sales_analytics.view"], { finance: true }))) return { ok: false, error: "Accès refusé." };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { ok: false, error: "IA non configurée (ANTHROPIC_API_KEY manquante)." };
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    const text = (msg.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return { ok: true, text: text || "(réponse vide)" };
  } catch (e: any) { return { ok: false, error: "IA indisponible : " + (e?.message ?? String(e)) }; }
}

/** Natural-language assistant — answers ONLY from the caller-provided (already
 *  filtered) dataset summary; never invents figures. */
export async function askAssistant(question: string, context: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!question.trim()) return { ok: false, error: "Pose une question." };
  return claude(
    "Tu es analyste ventes. Réponds en français, court et précis, UNIQUEMENT à partir des données fournies (jamais de chiffres inventés). Si l'info n'est pas dans les données, dis-le. Termine par une recommandation actionnable quand c'est pertinent.",
    `Données (jeu FILTRÉ courant) :\n${context}\n\nQuestion : ${question}`,
    600,
  );
}

/** One-paragraph AI read of a single customer. */
export async function clientNarrative(context: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  return claude(
    "Tu es directeur commercial. Rédige en français une lecture concise (3-5 phrases) d'un client : trajectoire, dépendances, cycle d'achat, et LA prochaine action. Pas de blabla, uniquement à partir des données fournies.",
    context,
    350,
  );
}
