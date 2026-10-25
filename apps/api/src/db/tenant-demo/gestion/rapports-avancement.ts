import { ajouterJours } from "@missionpilot/engines";
import type { ContexteTenantDemo, SessionDemo } from "../contexte.js";
import { lundisEntre } from "../horloge.js";
import type { Casting, MissionLue } from "./casting.js";
import { MISSIONS_EN_COURS } from "./casting.js";
import { commentaire, introduction, SEMAINES_HEBDO } from "./donnees-rapports.js";
import { sessionDe } from "./rapports-outils.js";
import { ok } from "./outils.js";

/*
 * Rapports d'avancement HEBDOMADAIRES (AUT-10) des missions en cours : brouillon produit par la
 * route de génération avec la session du chef de mission, introduction et commentaire rédigés par
 * le chef (jamais les chiffres, qui sortent du moteur), puis VALIDATION par le directeur de la
 * mission (validateur différent de l'auteur). Le rapport de la semaine en cours reste en brouillon.
 *
 * Reprise : un rapport existant (mission, semaine) n'est pas recréé ; un brouillon d'une semaine
 * passée est repris à l'étape manquante (commentaire puis validation).
 *
 * Antidatage : `genere_le` et `valide_le` sont remontés par SQL littéral, déclencheur de contrôle
 * (rapport validé figé) désactivé le temps d'UNE transaction, réactivé avant le COMMIT ; seules
 * les dates changent, jamais le contenu. LIMITE : le contenu chiffré est celui d'aujourd'hui.
 */

interface VueRapport {
  id: string;
  statut: string;
  version: number;
  statut_commentaire: string;
  introduction: string | null;
}

const midi = (date: string, heure: string): string => `${date}T${heure}Z`;

/** Antidate un rapport d'avancement (déclencheurs ignorés le temps de la transaction, dates seulement). */
async function antedaterRapport(
  ctx: ContexteTenantDemo,
  id: string,
  genere: string,
  valide: string | null,
): Promise<void> {
  const c = ctx.proprietaire;
  await c.query("BEGIN");
  try {
    await c.query("SET LOCAL session_replication_role = replica");
    await c.query(
      `UPDATE avancement_rapports SET genere_le = $2::timestamptz, modifie_le = $3::timestamptz
         WHERE id = $1`,
      [id, genere, valide ?? genere],
    );
    if (valide !== null) {
      await c.query("UPDATE avancement_rapports SET valide_le = $2::timestamptz WHERE id = $1", [
        id,
        valide,
      ]);
    }
    await c.query("COMMIT");
  } catch (error) {
    await c.query("ROLLBACK");
    throw error;
  }
}

async function rapportDeLaSemaine(
  chef: SessionDemo,
  missionId: string,
  semaine: string,
): Promise<VueRapport | null> {
  const liste = await chef.get(`/api/missions/${missionId}/avancement?limite=60`);
  ok(200, liste, "liste des rapports d'avancement");
  const ligne = (liste.json().elements as { id: string; semaine: string }[]).find(
    (l) => l.semaine === semaine,
  );
  if (!ligne) return null;
  const detail = await chef.get(`/api/avancement/${ligne.id}`);
  ok(200, detail, "rapport d'avancement");
  return detail.json() as VueRapport;
}

async function traiterSemaine(
  ctx: ContexteTenantDemo,
  m: MissionLue,
  chef: SessionDemo,
  directeur: SessionDemo,
  semaine: string,
  rang: number,
  courante: boolean,
): Promise<boolean> {
  let rapport = await rapportDeLaSemaine(chef, m.id, semaine);
  let cree = false;
  if (!rapport) {
    const r = await chef.post(`/api/missions/${m.id}/avancement`, { semaine });
    if (r.statusCode !== 201) {
      ctx.journal(
        `  [rapports] avancement ${m.cle} ${semaine} : HTTP ${r.statusCode} ${r.body.slice(0, 160)}`,
      );
      return false;
    }
    rapport = r.json() as VueRapport;
    cree = true;
  }
  if (rapport.statut === "valide") return cree;
  let version = rapport.version;
  if (rapport.statut_commentaire !== "redige") {
    const p = await chef.patch(`/api/avancement/${rapport.id}`, {
      version,
      introduction: introduction(rang),
      commentaire: commentaire(m.cle, rang),
    });
    ok(200, p, "rédaction du rapport d'avancement");
    version = (p.json() as VueRapport).version;
  }
  const genere = midi(semaine, "06:30:00");
  if (courante) {
    await antedaterRapport(ctx, rapport.id, genere, null);
    return cree;
  }
  const v = await directeur.post(`/api/avancement/${rapport.id}/valider`, { version });
  ok(200, v, "validation du rapport d'avancement");
  await antedaterRapport(ctx, rapport.id, genere, midi(ajouterJours(semaine, 2), "09:10:00"));
  return cree;
}

/** Rapports hebdomadaires de toutes les missions en cours du casting ; renvoie le nombre créé. */
export async function semerAvancementHebdo(
  ctx: ContexteTenantDemo,
  casting: Casting,
): Promise<number> {
  let crees = 0;
  for (const cle of MISSIONS_EN_COURS) {
    const m = casting.missions[cle];
    if (!m || m.statut !== "en_cours" || !m.debut) {
      ctx.journal(
        `  [rapports] avancement hebdomadaire : mission ${cle} absente ou non en cours, sautée.`,
      );
      continue;
    }
    const chef = sessionDe(ctx, m.chefId);
    const directeur = sessionDe(ctx, m.directeurId);
    if (!chef || !directeur || m.chefId === m.directeurId) {
      ctx.journal(
        `  [rapports] avancement hebdomadaire ${cle} : chef ou directeur distinct introuvable, sautée.`,
      );
      continue;
    }
    const lundis = lundisEntre(m.debut, ctx.aujourdhui).slice(-SEMAINES_HEBDO);
    for (const [i, semaine] of lundis.entries()) {
      const courante = i === lundis.length - 1;
      if (await traiterSemaine(ctx, m, chef, directeur, semaine, i, courante)) crees += 1;
    }
  }
  return crees;
}
