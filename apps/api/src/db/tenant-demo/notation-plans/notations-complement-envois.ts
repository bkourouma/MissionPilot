import type { DefinitionQuestionnaire } from "@missionpilot/engines";
import { hacherJeton, nouveauJeton } from "../../../auth/session.js";
import type { CleCompteCabinet } from "../cles.js";
import { MOT_DE_PASSE_DEMO_TENANT } from "../constantes.js";
import {
  attendre,
  ouvrirSessionTenant,
  type ContexteTenantDemo,
  type SessionDemo,
} from "../contexte.js";
import { COMPTES_PORTAIL } from "../donnees-comptes.js";
import type { MissionTrouvee } from "./casting.js";
import type { DefComplement, DefRepondantComplement } from "./notations-complement-donnees.js";
import { exiger, lire } from "./outils.js";
import { versionDe } from "./questionnaires-modeles.js";
import { creerProfil, genererReponses } from "./questionnaires-reponses.js";

/*
 * Envoi de NOTATION d'une notation complémentaire : comptes de portail des trois répondants
 * (invitation et acceptation par les vraies routes si le compte n'existe pas ; clé naturelle =
 * e-mail), envoi du modèle « notation_generique » en mode « par_fonction », réponses saisies puis
 * soumises depuis le portail, date limite passée, clôture. Même mécanique que l'étape
 * « questionnaires » (questionnaires-envois.ts, dont les fonctions internes ne sont pas
 * exportées : recopiées ici, réduites au cas de la notation). Reprise idempotente : chaque étape
 * regarde l'état déjà atteint ; les tirages du hasard à graine sont consommés même si la réponse
 * existe déjà, pour un résultat stable à la reprise.
 */

export interface RepondantComplement {
  utilisateurId: string;
  fonction: string;
  session: SessionDemo;
  biais: number;
}

/** Invitation par la vraie route, jeton connu du seed (il n'existe que dans l'e-mail), acceptation. */
async function inviterEtAccepter(
  ctx: ContexteTenantDemo,
  clientId: string,
  def: DefRepondantComplement,
): Promise<string> {
  const email = def.email as string;
  const inv = await ctx.session("associe").post("/api/portail/invitations", {
    email,
    client_id: clientId,
    roles: [def.role],
  });
  attendre(201, inv, `invitation portail ${email}`);
  const jeton = nouveauJeton();
  await ctx.database.withTenant(ctx.cabinetId, (db) =>
    db.query("UPDATE invitations SET jeton_hash = $1 WHERE id = $2 AND acceptee_le IS NULL", [
      hacherJeton(jeton),
      inv.json().id,
    ]),
  );
  const acceptation = await ctx.app.inject({
    method: "POST",
    url: "/api/portail/invitations/accepter",
    payload: { jeton, nom: def.nom, mot_de_passe: MOT_DE_PASSE_DEMO_TENANT },
  });
  attendre(201, acceptation, `acceptation portail ${email}`);
  return acceptation.json().utilisateur.id as string;
}

/** Comptes de portail des répondants (créés au besoin) ; `crees` compte les comptes ouverts ici. */
export async function assurerRepondants(
  ctx: ContexteTenantDemo,
  clientId: string,
  defs: readonly DefRepondantComplement[],
  crees: { n: number },
): Promise<RepondantComplement[]> {
  const resultat: RepondantComplement[] = [];
  for (const def of defs) {
    if (def.existant) {
      const compte = COMPTES_PORTAIL.find((c) => c.cle === def.existant);
      resultat.push({
        utilisateurId: ctx.utilisateurs[def.existant] as string,
        fonction: compte?.fonction ?? "",
        session: ctx.session(def.existant),
        biais: def.biais,
      });
      continue;
    }
    const email = def.email as string;
    const lignes = await lire<{ id: string }>(
      ctx,
      "SELECT id FROM utilisateurs WHERE cabinet_id = $1 AND lower(email) = lower($2)",
      [ctx.cabinetId, email],
    );
    let id = lignes[0]?.id;
    if (!id) {
      id = await inviterEtAccepter(ctx, clientId, def);
      crees.n++;
      // Compte ouvert avant le début de la mission du client (les routes créent tout « maintenant »).
      await ctx.proprietaire.query(
        "UPDATE utilisateurs SET cree_le = $1::timestamptz WHERE id = $2",
        [`${def.depuis}T12:00:00Z`, id],
      );
    }
    resultat.push({
      utilisateurId: id,
      fonction: def.fonction as string,
      session: await ouvrirSessionTenant(ctx.app, email, id),
      biais: def.biais,
    });
  }
  return resultat;
}

interface LigneEnvoi extends Record<string, unknown> {
  id: string;
  statut: string;
  date_limite: string | null;
  definition: DefinitionQuestionnaire;
}

async function lireEnvoi(
  ctx: ContexteTenantDemo,
  missionId: string,
  versionId: string,
): Promise<LigneEnvoi | undefined> {
  return (
    await lire<LigneEnvoi>(
      ctx,
      `SELECT id, statut, date_limite::text AS date_limite, definition FROM questionnaire_envois
        WHERE cabinet_id = $1 AND mission_id = $2 AND version_id = $3`,
      [ctx.cabinetId, missionId, versionId],
    )
  )[0];
}

async function statutReponse(
  ctx: ContexteTenantDemo,
  envoiId: string,
  utilisateurId: string,
): Promise<string | null> {
  const l = await lire<{ statut: string }>(
    ctx,
    `SELECT q.statut FROM questionnaire_reponses q
       JOIN questionnaire_repondants r ON r.id = q.repondant_id
      WHERE q.envoi_id = $1 AND r.utilisateur_id = $2`,
    [envoiId, utilisateurId],
  );
  return l[0]?.statut ?? null;
}

/** Crée, envoie, fait répondre les trois répondants, fixe la date limite passée et clôt l'envoi. */
export async function assurerEnvoiNotation(
  ctx: ContexteTenantDemo,
  def: DefComplement,
  mission: MissionTrouvee,
  par: CleCompteCabinet,
  repondants: readonly RepondantComplement[],
): Promise<void> {
  const versionId = await versionDe(ctx, "notation_generique", def.versionModele);
  const session = ctx.session(par);
  let envoi = await lireEnvoi(ctx, mission.id, versionId);
  if (!envoi) {
    const r = await session.post(`/api/missions/${mission.id}/questionnaires`, {
      version_id: versionId,
      mode: "par_fonction",
      repondants: repondants.map((x) => ({
        utilisateur_id: x.utilisateurId,
        fonction: x.fonction,
      })),
      relances_auto: true,
      date_limite: null,
    });
    exiger(r, 201, `Envoi de notation ${def.cle}`);
    envoi = await lireEnvoi(ctx, mission.id, versionId);
  }
  if (!envoi) throw new Error(`Envoi ${def.cle} introuvable après création.`);
  if (envoi.statut === "brouillon") {
    exiger(
      await session.post(`/api/questionnaires/envois/${envoi.id}/envoyer`),
      200,
      `Envoi de ${def.cle}`,
    );
    envoi = (await lireEnvoi(ctx, mission.id, versionId)) as LigneEnvoi;
  }
  if (envoi.statut !== "envoye") return; // déjà clos : rien à reprendre

  const alea = ctx.alea.deriver(`questionnaire-${def.cle}`);
  const profil = creerProfil(def.maturite, alea);
  for (const r of repondants) {
    const complet = genererReponses(envoi.definition, profil, r.biais, alea, ctx.jour(-30));
    if ((await statutReponse(ctx, envoi.id, r.utilisateurId)) === "soumise") continue;
    exiger(
      await r.session.patch(`/api/portail/questionnaires/${envoi.id}/reponses`, {
        reponses: complet,
      }),
      200,
      `Saisie de ${r.fonction} (${def.cle})`,
    );
    exiger(
      await r.session.post(`/api/portail/questionnaires/${envoi.id}/soumettre`),
      200,
      `Soumission de ${r.fonction} (${def.cle})`,
    );
  }
  if (envoi.date_limite !== def.limitePassee) {
    exiger(
      await session.patch(`/api/questionnaires/envois/${envoi.id}`, {
        date_limite: def.limitePassee,
      }),
      200,
      `Date limite de ${def.cle}`,
    );
  }
  exiger(
    await session.post(`/api/questionnaires/envois/${envoi.id}/clore`),
    200,
    `Clôture de ${def.cle}`,
  );
}
