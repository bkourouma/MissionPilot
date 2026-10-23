import { redirect } from "next/navigation";
import { aPermission } from "@missionpilot/shared";
import { chargerServeur } from "./api-serveur";
import { chargerToutesLesPages } from "./pagination";
import {
  cheminEchantillon,
  cheminMesRevues,
  LIMITE_MES_REVUES,
  pageMesRevues,
  type MaRevue,
  droitsQualiteFroide,
  libelleGravite,
  type LigneEchantillon,
  type VueEchantillon,
} from "./qualite-froide";
import { chargerPersonnes, chargerTypesActifs, type OptionChoix } from "./referentiels-serveur";
import { obtenirSession, type Session } from "./session";
import { optionsPersonnes } from "./personnes";
import type { Utilisateur } from "./utilisateurs";

/**
 * Garde serveur et listes de choix de la revue à froid (QUA-05). À n'importer que côté serveur.
 * Les droits sont un confort d'affichage : l'API juge chaque appel.
 */

/** Gérer (associé) ou relire (relecteur indépendant) ; sinon « Accès refusé ». */
export async function exigerAccesFroide(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsQualiteFroide(session.utilisateur.roles).acces) redirect("/acces-refuse");
  return session;
}

/** Tirage, affectation, clôture et plan : associé seulement. */
export async function exigerGestionFroide(): Promise<Session> {
  const session = await obtenirSession();
  if (!droitsQualiteFroide(session.utilisateur.roles).gerer) redirect("/acces-refuse");
  return session;
}

/** Types de mission actifs, pour filtrer le tirage ; vide si la liste est indisponible. */
export async function chargerTypesPourTirage(session: Session): Promise<OptionChoix[]> {
  const types = await chargerTypesActifs(session.utilisateur.roles);
  return types.map(({ valeur, libelle }) => ({ valeur, libelle }));
}

async function chargerUtilisateursActifs(session: Session) {
  if (!aPermission(session.utilisateur.roles, "cabinet.gerer")) return null;
  const r = await chargerServeur<{ elements: Utilisateur[] }>("/api/utilisateurs");
  return r.ok ? r.donnees.elements.filter((u) => u.actif) : null;
}

/** Directeurs de mission (et associés, qui peuvent l'être) : liste `/api/utilisateurs`, sinon collaborateurs. */
export async function chargerDirecteurs(session: Session): Promise<OptionChoix[]> {
  const utilisateurs = await chargerUtilisateursActifs(session);
  if (utilisateurs) {
    return utilisateurs
      .filter((u) => u.roles.includes("directeur_mission") || u.roles.includes("associe"))
      .map((u) => ({ valeur: u.id, libelle: u.nom }));
  }
  return optionsPersonnes(await chargerPersonnes(session.utilisateur.roles));
}

/** Responsables possibles d'une action : collaborateurs liés à un compte, sinon utilisateurs actifs. */
export async function chargerResponsables(session: Session): Promise<OptionChoix[]> {
  const personnes = optionsPersonnes(await chargerPersonnes(session.utilisateur.roles));
  if (personnes.length > 0) return personnes;
  const utilisateurs = await chargerUtilisateursActifs(session);
  return (utilisateurs ?? []).map((u) => ({ valeur: u.id, libelle: u.nom }));
}

/**
 * Constats des revues terminées d'une campagne, proposés comme origine d'une action du plan. Un
 * échantillon dont la lecture échoue est ignoré (la liste est un confort : le constat reste
 * facultatif).
 */
export async function chargerConstatsCampagne(
  echantillons: readonly Pick<LigneEchantillon, "id" | "statut" | "mission_intitule">[],
): Promise<OptionChoix[]> {
  const terminees = echantillons.filter((e) => e.statut === "terminee");
  const lectures = await Promise.all(
    terminees.map(async (e) => ({
      mission: e.mission_intitule,
      r: await chargerServeur<Pick<VueEchantillon, "constats">>(cheminEchantillon(e.id)),
    })),
  );
  return lectures.flatMap(({ mission, r }) =>
    r.ok
      ? r.donnees.constats.map((c) => ({
          valeur: c.id,
          libelle: `${mission} (${libelleGravite(c.gravite).toLowerCase()}) : ${c.description.slice(0, 80)}`,
        }))
      : [],
  );
}

/** Toutes les revues affectées à l'appelant : le curseur est suivi page après page. */
export function chargerMesRevues() {
  return chargerToutesLesPages<MaRevue>(
    async (chemin) => {
      const r = await chargerServeur<{ elements: MaRevue[]; curseur_suivant: string | null }>(
        chemin,
      );
      return r.ok ? { ok: true, donnees: pageMesRevues(r.donnees) } : r;
    },
    cheminMesRevues(),
    { limiteMax: LIMITE_MES_REVUES },
  );
}
