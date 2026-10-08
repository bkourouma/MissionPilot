import {
  BAREME_CLASSES,
  constatsPerception,
  expliquerNote,
  rangClasse,
  simulerPassage,
  type Classe,
  type EcartRepondants,
} from "@missionpilot/engines";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { chargerVersion, type Notation } from "./notations.js";
import { calculerConfiance, vueConfiance } from "./confiance.js";

/*
 * Lectures augmentées d'une version de notation (NOT-10 à NOT-12) : constats de perception,
 * indice de confiance, contributions et simulateur. Tous les chiffres viennent des moteurs
 * (`constatsPerception`, `indiceConfiance`, `expliquerNote`, `simulerPassage`) appliqués à la
 * version FIGÉE (grille, résultat, écarts, ajustements) ; cette couche charge et traduit.
 * Notation déjà vérifiée visible par l'appelant.
 */

type VersionChargee = NonNullable<Awaited<ReturnType<typeof chargerVersion>>>;

export async function versionOu404(db: Db, notation: Notation, numero?: number) {
  const v = await chargerVersion(db, notation.id, numero);
  if (!v) throw introuvable("Version de notation");
  return v;
}

/** Libellé de population d'un répondant : fonction déclarée à l'envoi, sinon rôle du portail. */
const POPULATION_PAR_ROLE: Record<string, string> = {
  client_dirigeant: "Dirigeants",
  client_contributeur: "Contributeurs",
};

async function populations(db: Db, envoiId: string) {
  const r = await db.query(
    `SELECT r.id, r.fonction, u.roles FROM questionnaire_repondants r
     JOIN utilisateurs u ON u.id = r.utilisateur_id WHERE r.envoi_id = $1`,
    [envoiId],
  );
  return r.rows.map((l) => ({
    repondant: l.id as string,
    population:
      (l.fonction as string | null) ??
      (l.roles as string[]).map((x) => POPULATION_PAR_ROLE[x]).find(Boolean) ??
      "",
  }));
}

/** Écarts de perception (moteur `detecterEcarts` au calcul) rédigés en constats (NOT-10). */
export async function constatsVersion(db: Db, v: VersionChargee) {
  const constats = constatsPerception(
    v.version.ecarts as EcartRepondants[],
    await populations(db, v.version.envoi_id),
  );
  return {
    numero: v.version.numero,
    statut: v.statut,
    constats: constats.map((c) => ({
      question: c.question,
      libelle: c.libelle,
      type: c.type,
      gravite: c.gravite,
      ecart: c.ecart,
      niveau_bas: c.niveauBas,
      niveau_haut: c.niveauHaut,
      populations_basses: c.populationsBasses,
      populations_hautes: c.populationsHautes,
      nombre_repondants: c.nombreRepondants,
      enonce: c.enonce,
    })),
  };
}

/** Indice de confiance d'une version (NOT-11), affiché avec la note. */
export async function confianceVersion(db: Db, notation: Notation, v: VersionChargee) {
  const c = await calculerConfiance(db, notation.mission_id, v.version);
  return { numero: v.version.numero, statut: v.statut, ...vueConfiance(c) };
}

/** Classe visée par défaut : la classe immédiatement supérieure (null si déjà A). */
function cibleParDefaut(classe: Classe | null): Classe | null {
  if (classe === null) return null;
  const rang = rangClasse(classe);
  return BAREME_CLASSES.find((b) => rangClasse(b.classe) === rang + 1)?.classe ?? null;
}

/** Contributions à la note et simulateur de passage à la classe visée (NOT-12). */
export function explicationVersion(v: VersionChargee, cible?: Classe) {
  const e = expliquerNote(v.etat, v.version.grille);
  const visee = cible ?? cibleParDefaut(e.classe);
  const s = visee ? simulerPassage(v.etat, v.version.grille, visee) : null;
  return {
    numero: v.version.numero,
    statut: v.statut,
    score: e.score,
    classe: e.classe,
    strategie: e.strategie,
    somme_contributions: e.sommeContributions,
    dimensions: e.dimensions.map((d) => ({
      dimension: d.dimension,
      libelle: d.libelle,
      notable: d.notable,
      poids: d.poids,
      score: d.score,
      contribution: d.contribution,
      ajustement: d.ajustement,
      ecart_arrondi: d.ecartArrondi,
      pratiques: d.pratiques,
    })),
    simulation: s
      ? {
          classe_actuelle: s.classeActuelle,
          score_actuel: s.scoreActuel,
          cible: s.cible,
          seuil: s.seuil,
          deja_atteinte: s.dejaAtteinte,
          atteignable: s.atteignable,
          gain_necessaire: s.gainNecessaire,
          score_projete: s.scoreProjete,
          classe_projetee: s.classeProjetee,
          tronquee: s.tronquee,
          etapes: s.etapes.map((x) => ({
            dimension: x.dimension,
            libelle: x.libelle,
            indicateur: x.indicateur,
            question: x.question,
            points_avant: x.pointsAvant,
            points_apres: x.pointsApres,
            paliers: x.paliers,
            gain: x.gain,
          })),
        }
      : null,
  };
}
