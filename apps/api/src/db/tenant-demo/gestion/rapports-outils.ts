import { cheminNavigateur } from "../../../rapports/pdf.js";
import type { CleCompte } from "../cles.js";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { cleDeCompte } from "./casting.js";

/*
 * Outils du module RAPPORTS : session d'un utilisateur du cabinet, choix du format de rendu et
 * génération d'un rapport par la VRAIE route, avec reprise sans doublon (clé naturelle : mission,
 * modèle, source, jour de génération) et antidatage de `genere_le`.
 *
 * Antidatage : `rapports_mission` est en ajout seul pour le rôle applicatif (REVOKE UPDATE), mais
 * aucun déclencheur ne protège `genere_le` pour le propriétaire : requête SQL littérale. LIMITE
 * assumée : le CONTENU du rapport (avancement, chiffres du jour) est celui d'aujourd'hui et le nom
 * du fichier porte la date réelle de génération ; seule la date enregistrée est remontée.
 */

export type FormatRapportSeed = "pdf" | "docx" | "pptx";

/** Session du compte portant cet utilisateur (cabinet), ou null. */
export function sessionDe(
  ctx: ContexteTenantDemo,
  utilisateurId: string | null,
): SessionDemo | null {
  if (!utilisateurId) return null;
  const cle = cleDeCompte(ctx, utilisateurId) as CleCompte | undefined;
  return cle ? (ctx.sessions[cle] ?? null) : null;
}

/** Le rendu PDF est-il possible dans cet environnement (navigateur configuré ou trouvé) ? */
export const pdfDisponible = (ctx: ContexteTenantDemo): boolean =>
  cheminNavigateur(ctx.config) !== null;

/** Format du rang `i` : alternance déterministe ; le PDF n'est choisi que s'il est disponible. */
export function formatDuRang(
  ctx: ContexteTenantDemo,
  i: number,
  admis: readonly FormatRapportSeed[] = ["pdf", "docx", "pptx"],
): FormatRapportSeed {
  const possibles = admis.filter((f) => f !== "pdf" || pdfDisponible(ctx));
  return possibles[i % possibles.length] as FormatRapportSeed;
}

export interface DemandeRapport {
  missionId: string;
  modele:
    "etat_avancement" | "notation" | "plan_strategique" | "dossier_bancaire" | "etat_financier";
  session: SessionDemo;
  /** Chemin de la route (sans `?format=`). */
  url: string;
  /** Paramètres de requête supplémentaires (déjà encodés), sans `format`. */
  requete?: string;
  format: FormatRapportSeed;
  corps?: Record<string, unknown>;
  /** Jour FICTIF de génération (AAAA-MM-JJ). */
  date: string;
  /** Source (notation ou plan) pour la clé naturelle. */
  sourceId?: string | null;
  /** Une absence de source ou un refus de l'autre domaine ne bloque pas : avertissement et saut. */
  tolerant: boolean;
}

/** Heure fictive de génération : matinée, légèrement variable selon le jour (déterministe). */
const heureDe = (date: string): string => {
  const h = 7 + (Number(date.slice(-2)) % 5);
  return `${String(h).padStart(2, "0")}:15:00Z`;
};

async function dejaGenere(ctx: ContexteTenantDemo, d: DemandeRapport): Promise<boolean> {
  const r = await ctx.proprietaire.query(
    `SELECT 1 FROM rapports_mission
      WHERE cabinet_id = $1 AND mission_id = $2 AND modele = $3
        AND genere_le >= $4::timestamptz AND genere_le < $4::timestamptz + interval '1 day'
        AND COALESCE(notation_id, plan_id) IS NOT DISTINCT FROM $5::uuid
      LIMIT 1`,
    [ctx.cabinetId, d.missionId, d.modele, `${d.date}T00:00:00Z`, d.sourceId ?? null],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Génère un rapport par la route réelle (repli en DOCX si le rendu PDF est indisponible) puis
 * remonte sa date. Renvoie l'identifiant du rapport, ou null si déjà fait / sauté (tolérant).
 */
export async function genererRapport(
  ctx: ContexteTenantDemo,
  d: DemandeRapport,
): Promise<string | null> {
  if (await dejaGenere(ctx, d)) return null;
  const essai = async (format: FormatRapportSeed) =>
    d.session.post(`${d.url}?format=${format}${d.requete ? `&${d.requete}` : ""}`, d.corps ?? {});
  let r = await essai(d.format);
  if (r.statusCode === 503 && d.format === "pdf") r = await essai("docx");
  if (r.statusCode !== 201) {
    const msg = `rapport ${d.modele} (${d.url}) : HTTP ${r.statusCode} ${r.body.slice(0, 200)}`;
    if (d.tolerant) {
      ctx.journal(`  [rapports] avertissement, ${msg}`);
      return null;
    }
    throw new Error(msg);
  }
  const id = (r.json().rapport as { id: string }).id;
  await ctx.proprietaire.query(
    "UPDATE rapports_mission SET genere_le = $1::timestamptz WHERE id = $2",
    [`${d.date}T${heureDe(d.date)}`, id],
  );
  return id;
}
