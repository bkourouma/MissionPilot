import { createHash } from "node:crypto";
import {
  AUTOMATISATIONS_STANDARD,
  type DefinitionAutomatisationSaisie,
} from "@missionpilot/shared";
import type { CleCompte } from "../cles.js";

/*
 * Données du module « automatisation » du seed Tenant démo : règles du cabinet, leurs versions,
 * leurs périodes d'activation et les événements métier qu'elles ont vus. Les dates sont des dates
 * ISO fixes ou dérivées des missions du casting (jamais d'horloge réelle). Les identifiants de
 * jalon, de KPI et d'envoi de questionnaire sont des UUID stables dérivés d'un texte : ils ne
 * désignent que des libellés d'événements (la mission, elle, est réelle).
 */

/** UUID stable (déterministe) dérivé d'un texte. */
export function uuidStable(graine: string): string {
  const h = createHash("md5").update(`tenant-demo:${graine}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Période pendant laquelle une règle est active, avec la version appliquée et son responsable. */
export interface PeriodeRegle {
  debut: string;
  /** Date de désactivation (exclue) ; `null` : toujours active. */
  fin: string | null;
  version: number;
  responsable: CleCompte;
}

export interface RegleDemo {
  nom: string;
  description: string;
  standardCode: string | null;
  creeLe: string;
  creePar: CleCompte;
  versions: {
    version: number;
    date: string;
    auteur: CleCompte;
    definition: DefinitionAutomatisationSaisie;
  }[];
  periodes: PeriodeRegle[];
}

const standard = (code: string) => {
  const s = AUTOMATISATIONS_STANDARD.find((x) => x.code === code);
  if (!s) throw new Error(`Automatisation standard « ${code} » introuvable.`);
  return s;
};

const depuisStandard = (
  code: string,
  creeLe: string,
  creePar: CleCompte,
  periodes: PeriodeRegle[],
): RegleDemo => {
  const s = standard(code);
  return {
    nom: s.nom,
    description: s.description,
    standardCode: code,
    creeLe,
    creePar,
    versions: [{ version: 1, date: creeLe, auteur: creePar, definition: s.definition }],
    periodes,
  };
};

const jalonStandard = depuisStandard("jalon_facture_brouillon", "2025-01-20", "directeur.mission", [
  { debut: "2025-01-21", fin: "2026-02-02", version: 1, responsable: "directeur.mission" },
  { debut: "2026-02-02", fin: null, version: 2, responsable: "associe" },
]);
// Version 2 (2026-02-02) : l'associé ajoute le directeur de la mission aux destinataires et devient
// responsable en réactivant la règle (une nouvelle définition désactive, puis le réactivateur prend la main).
const defJalonV1 = jalonStandard.versions[0]!.definition;
jalonStandard.versions.push({
  version: 2,
  date: "2026-02-02",
  auteur: "associe",
  definition: {
    ...defJalonV1,
    actions: (defJalonV1.actions ?? []).map((a) =>
      a.type === "notifier" ? { ...a, destinataires: ["responsable", "directeur_mission"] } : a,
    ),
  },
});

export const REGLES: RegleDemo[] = [
  jalonStandard,
  depuisStandard("questionnaire_sans_reponse_alerte", "2025-06-10", "directeur.mission", [
    { debut: "2025-06-11", fin: null, version: 1, responsable: "directeur.mission" },
  ]),
  depuisStandard("cloture_rappel_checklist", "2025-01-20", "associe", [
    { debut: "2025-01-21", fin: null, version: 1, responsable: "associe" },
  ]),
  depuisStandard("kpi_rouge_note_alerte", "2025-05-05", "directeur.mission", [
    { debut: "2025-05-06", fin: null, version: 1, responsable: "directeur.mission" },
  ]),
  {
    nom: "Clôture demandée : tâche de capitalisation",
    description:
      "Quand la clôture d'une mission est demandée, confie au chef de mission la tâche de déposer le retour d'expérience et les livrables réutilisables.",
    standardCode: null,
    creeLe: "2025-03-03",
    creePar: "associe",
    versions: [
      {
        version: 1,
        date: "2025-03-03",
        auteur: "associe",
        definition: {
          evenement_code: "mission.cloture_demandee",
          condition: null,
          mode_execution: "responsable",
          actions: [
            {
              type: "creer_tache",
              titre: "Capitaliser les enseignements de la mission",
              description:
                "Déposer le retour d'expérience et les livrables réutilisables dans la base de connaissances avant la clôture.",
              assigne: "chef_mission",
              echeance_jours: 14,
            },
          ],
        },
      },
    ],
    periodes: [{ debut: "2025-03-04", fin: null, version: 1, responsable: "associe" }],
  },
  {
    nom: "KPI au rouge trois périodes : escalade à l'associé",
    description:
      "Quand un KPI reste au rouge au moins trois périodes de suite, prévient l'associé responsable et le directeur de la mission.",
    standardCode: null,
    creeLe: "2025-09-15",
    creePar: "associe",
    versions: [
      {
        version: 1,
        date: "2025-09-15",
        auteur: "associe",
        definition: {
          evenement_code: "kpi.rouge_deux_periodes",
          condition: {
            type: "comparaison",
            champ: "periodes_rouges",
            operateur: "superieur_ou_egal",
            valeur: 3,
          },
          mode_execution: "responsable",
          actions: [
            {
              type: "notifier",
              destinataires: ["responsable", "directeur_mission"],
              titre: "Escalade : KPI « {{libelle}} » au rouge depuis {{periodes_rouges}} périodes",
              corps:
                "Le KPI « {{libelle}} » est au rouge depuis {{periodes_rouges}} périodes (dernière : {{periode}}). Un point avec le client est à prévoir.",
            },
          ],
        },
      },
    ],
    periodes: [{ debut: "2025-09-16", fin: null, version: 1, responsable: "associe" }],
  },
  {
    nom: "Questionnaire sans réponse à J+14 : relance automatique",
    description:
      "Relance les répondants d'un questionnaire quatorze jours après l'envoi. Règle préparée, pas encore activée : à simuler sur les événements passés avant de l'activer.",
    standardCode: null,
    creeLe: "2026-10-19",
    creePar: "directeur.mission",
    versions: [
      {
        version: 1,
        date: "2026-10-19",
        auteur: "directeur.mission",
        definition: {
          evenement_code: "questionnaire.sans_reponse",
          condition: {
            type: "comparaison",
            champ: "jours_sans_reponse",
            operateur: "egal",
            valeur: 14,
          },
          mode_execution: "responsable",
          actions: [{ type: "relance_questionnaire" }],
        },
      },
    ],
    periodes: [],
  },
  {
    nom: "Jalon atteint : note de suivi en brouillon",
    description:
      "Quand un jalon est atteint, prépare une note de suivi en brouillon à relire par le chef de mission. Règle désactivée depuis novembre 2025 (remplacée par le point de suivi mensuel).",
    standardCode: null,
    creeLe: "2025-02-10",
    creePar: "directeur.mission",
    versions: [
      {
        version: 1,
        date: "2025-02-10",
        auteur: "directeur.mission",
        definition: {
          evenement_code: "mission.jalon_atteint",
          condition: null,
          mode_execution: "responsable",
          actions: [
            {
              type: "brouillon",
              nature: "note",
              titre: "Jalon « {{libelle}} » atteint : note de suivi",
              corps:
                "Le jalon « {{libelle}} » est atteint. Reporter l'état d'avancement dans le prochain point de suivi avec le client et vérifier les échéances de facturation rattachées.",
            },
          ],
        },
      },
    ],
    periodes: [
      { debut: "2025-02-11", fin: "2025-11-20", version: 1, responsable: "directeur.mission" },
    ],
  },
];
