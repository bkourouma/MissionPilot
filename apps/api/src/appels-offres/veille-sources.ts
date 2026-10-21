import type { VeilleAvisBrut } from "@missionpilot/engines";

/*
 * Port des sources de veille des appels d'offres (AO-01). Une source collecte des avis BRUTS ;
 * le dédoublonnage, le rapprochement et les décisions sont faits ailleurs (moteur, veille.ts).
 *
 * Les trois adaptateurs ci-dessous sont SIMULÉS : jeux d'avis fictifs, déterministes, dont les
 * dates dérivent de `maintenant` injecté. Ils n'importent ni fetch, ni http, ni aucune clé :
 * l'API ne visite jamais les URL des avis (adresses d'exemple en `.invalid`).
 *
 * Un adaptateur RÉEL (portail de marchés publics, flux d'un bailleur, presse) exige une décision
 * d'architecture (ADR) : choix de la source, contrat de licence, secrets, sortie réseau
 * contrôlée, planification (aujourd'hui, la collecte est déclenchée à la main).
 */

export interface SourceVeille {
  /** Code stable (minuscules, chiffres, tiret bas). */
  readonly code: string;
  readonly libelle: string;
  collecter(entree: { maintenant: Date }): Promise<VeilleAvisBrut[]>;
}

/** Date AAAA-MM-JJ (UTC) décalée de `jours` par rapport à `maintenant`. */
function jour(maintenant: Date, jours: number): string {
  const d = new Date(
    Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate()),
  );
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

function avis(
  maintenant: Date,
  base: Partial<VeilleAvisBrut> & { titre: string },
  publieIlYa: number,
  limiteDans: number,
): VeilleAvisBrut {
  return {
    reference: null,
    objet: null,
    bailleur: null,
    pays: null,
    secteur: null,
    montant_estime: null,
    devise: null,
    url: null,
    mots_cles: [],
    ...base,
    date_publication: jour(maintenant, -publieIlYa),
    date_limite: jour(maintenant, limiteDans),
  };
}

/** Portail national de marchés publics (simulé). */
const portailMarches: SourceVeille = {
  code: "sim_marches_publics",
  libelle: "Portail des marchés publics (simulé)",
  async collecter({ maintenant }) {
    return [
      avis(
        maintenant,
        {
          reference: "SIM-MP-001",
          titre: "Audit des comptes d'un établissement public hospitalier",
          objet: "Audit financier et revue du contrôle interne sur trois exercices.",
          bailleur: "Ministère de la Santé",
          pays: "CI",
          secteur: "Santé",
          montant_estime: 60_000_000,
          devise: "XOF",
          url: "https://marches.exemple.invalid/avis/SIM-MP-001",
          mots_cles: ["audit", "contrôle interne"],
        },
        3,
        30,
      ),
      avis(
        maintenant,
        {
          reference: "SIM-MP-002",
          titre: "Assistance à la gouvernance d'une société d'État de l'énergie",
          objet: "Diagnostic de gouvernance et plan d'action.",
          bailleur: "Ministère de l'Énergie",
          pays: "SN",
          secteur: "Énergie",
          montant_estime: 85_000_000,
          devise: "XOF",
          url: "https://marches.exemple.invalid/avis/SIM-MP-002",
          mots_cles: ["gouvernance", "diagnostic"],
        },
        5,
        21,
      ),
      avis(
        maintenant,
        {
          titre: "Élaboration d'un plan stratégique pour une université",
          bailleur: "Ministère de l'Enseignement supérieur",
          pays: "BF",
          secteur: "Éducation",
          mots_cles: ["plan stratégique"],
        },
        2,
        45,
      ),
    ];
  },
};

/** Avis de bailleurs internationaux (simulé) : recoupe le portail sur SIM-MP-001. */
const bailleurs: SourceVeille = {
  code: "sim_bailleurs",
  libelle: "Bailleurs internationaux (simulé)",
  async collecter({ maintenant }) {
    return [
      avis(
        maintenant,
        {
          reference: "sim mp 001",
          titre: "Audit des comptes d'un établissement public hospitalier",
          bailleur: "Banque mondiale",
          pays: "CI",
          secteur: "Santé",
          url: "https://bailleur.exemple.invalid/appels/sim-mp-001",
        },
        3,
        30,
      ),
      avis(
        maintenant,
        {
          reference: "SIM-BL-010",
          titre: "Évaluation d'un programme de gestion des risques climatiques",
          objet: "Évaluation à mi-parcours d'un programme d'adaptation, gestion des risques.",
          bailleur: "Agence française de développement",
          pays: "SN",
          secteur: "Environnement",
          montant_estime: 120_000,
          devise: "EUR",
          url: "https://bailleur.exemple.invalid/appels/SIM-BL-010",
          mots_cles: ["évaluation", "gestion des risques"],
        },
        7,
        40,
      ),
      avis(
        maintenant,
        {
          titre: "Revue de la gestion financière d'un projet d'eau et assainissement",
          bailleur: "Banque africaine de développement",
          pays: "CI",
          secteur: "Eau",
          devise: "USD",
          montant_estime: 90_000,
        },
        1,
        25,
      ),
    ];
  },
};

/** Veille presse économique (simulée) : recoupe les bailleurs sur l'avis sans référence. */
const presse: SourceVeille = {
  code: "sim_presse",
  libelle: "Presse économique (simulée)",
  async collecter({ maintenant }) {
    return [
      avis(
        maintenant,
        {
          titre: "Revue de la gestion financière d'un projet d'eau et assainissement !",
          bailleur: "Banque Africaine de Développement",
          pays: "CI",
          secteur: "Eau",
        },
        0,
        25,
      ),
      avis(
        maintenant,
        {
          titre: "Appui à la transformation digitale d'une banque régionale",
          objet: "Schéma directeur numérique et gestion du changement.",
          bailleur: "Banque ouest-africaine de développement",
          pays: "TG",
          secteur: "Finance",
          mots_cles: ["transformation digitale"],
        },
        4,
        35,
      ),
    ];
  },
};

export const SOURCES_VEILLE: readonly SourceVeille[] = [portailMarches, bailleurs, presse];

/** Sources « manuelles » : toujours disponibles, sans activation. */
export const SOURCE_SAISIE = { code: "saisie", libelle: "Saisie manuelle" } as const;
export const SOURCE_FICHIER = { code: "fichier", libelle: "Import de fichier" } as const;

export function sourceVeille(code: string): SourceVeille | undefined {
  return SOURCES_VEILLE.find((s) => s.code === code);
}
