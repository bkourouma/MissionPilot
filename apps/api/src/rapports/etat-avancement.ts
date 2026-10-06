import {
  formaterJours,
  formaterMontant,
  montant,
  type Devise,
  type NoeudAgrege,
  type StatutCouleur,
} from "@missionpilot/engines";
import type { StatutMission } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { rentabilite } from "../finance/analyses.js";
import { analyserMissions, chargerMissions } from "../finance/donnees.js";
import { calculerSuiviMission, vueNoeud, type SuiviMission } from "../temps/suivi.js";
import { PLAFONDS_MODELE, dateAffichee, type Bloc, type Rapport, type Section } from "./modele.js";
import { niveauDesSections, type NiveauRapport } from "./niveaux.js";

/*
 * Rapport « État d'avancement de mission » (SOC-07, premier rapport réel).
 *
 * PROVENANCE DES CHIFFRES (aucun recalcul ici) :
 * - avancement physique, budget / réalisé / reste à faire / atterrissage en
 *   jours, par phase et par personne, temps en attente : `calculerSuiviMission`
 *   (temps/suivi.ts, moteur @missionpilot/engines), comme GET /missions/:id/suivi ;
 * - jalons : découpage lu par ce même suivi ;
 * - données financières : `analyserMissions` + `rentabilite` (finance/),
 *   comme GET /finance/rentabilite, en devise de la mission.
 * Les nombres sont seulement MIS EN FORME (formateurs du moteur, pourcentages
 * par Intl).
 *
 * DROITS (contrôlés par l'appelant, voir routes/rapports.ts) :
 * - « mission.lire » et mission visible : identité de la mission, avancement
 *   physique, jalons ;
 * - « budget.lire_jours » : sections en jours (budget, réalisé, temps
 *   consommé) ; ABSENTES sinon (expert métier) ;
 * - « finance.lire » : section financière (coûts, taux de marge, marges) ;
 *   ABSENTE sinon, jamais remplacée par des zéros. Le rapport est alors
 *   marqué confidentiel.
 * Le NIVEAU du rapport (rapports/niveaux.ts) est calculé d'après les
 * sections réellement incluses ; il décide qui pourra le relire.
 *
 * TEXTES SAISIS (intitulé, client, noms, libellés) : normalisés NFC puis
 * tronqués (« … ») aux plafonds du modèle, pour qu'un rapport ne soit jamais
 * refusé par `normaliserRapport` à cause d'une saisie longue.
 */

export interface DroitsRapport {
  jours: boolean;
  finance: boolean;
}

interface MissionRapport {
  intitule: string;
  statut: StatutMission;
  devise: Devise;
  date_debut: string | null;
  date_fin: string | null;
  date_signature: string | null;
  client: string;
  directeur: string | null;
  chef: string | null;
  cabinet: string;
}

const LIBELLES_STATUT: Record<StatutMission, string> = {
  opportunite: "Opportunité",
  proposition: "Proposition",
  signee: "Signée",
  en_cours: "En cours",
  a_cloturer: "À clôturer",
  cloturee: "Clôturée",
};

const LIBELLES_COULEUR: Record<StatutCouleur, string> = {
  vert: "Conforme au budget",
  orange: "Vigilance",
  rouge: "Dépassement",
};

const FORMAT_POURCENT = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 1,
});

const pourcent = (ratio: number | null | undefined) =>
  ratio === null || ratio === undefined ? "—" : FORMAT_POURCENT.format(ratio);
const j = (jours: number) => `${formaterJours(jours)} j`;
const signe = (jours: number) => (jours > 0 ? `+${j(jours)}` : j(jours));

/** Longueur maximale de l'intitulé et du client dans le sous-titre, « … » compris. */
export const LONGUEUR_PARTIE_SOUS_TITRE = 90;

/**
 * Texte normalisé NFC (la normalisation peut allonger un texte : elle est
 * faite AVANT la coupe) et tronqué à `max` unités UTF-16, « … » compris,
 * sans couper une paire de substitution.
 */
export function tronquer(brut: string, max: number): string {
  const texte = brut.normalize("NFC");
  if (texte.length <= max) return texte;
  let coupe = texte.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(coupe)) coupe = coupe.slice(0, -1);
  return `${coupe.trimEnd()}…`;
}

/** « Intitulé — Client », toujours dans le plafond du titre (2 × 90 + 3 ≤ 200). */
export function sousTitreRapport(intitule: string, client: string): string {
  const n = LONGUEUR_PARTIE_SOUS_TITRE;
  return `${tronquer(intitule, n)} — ${tronquer(client, n)}`;
}

/** Texte saisi placé dans une cellule de tableau. */
const cellule = (texte: string) => tronquer(texte, PLAFONDS_MODELE.longueurCellule);

async function lireMission(db: Db, id: string): Promise<MissionRapport> {
  const r = await db.query(
    `SELECT m.intitule, m.statut, m.devise, m.date_debut::text AS date_debut,
       m.date_fin::text AS date_fin, m.date_signature::text AS date_signature,
       cl.raison_sociale AS client, d.nom AS directeur, c.nom AS chef, cab.nom AS cabinet
     FROM missions m JOIN clients cl ON cl.id = m.client_id
     JOIN cabinets cab ON cab.id = m.cabinet_id
     LEFT JOIN utilisateurs d ON d.id = m.directeur_id
     LEFT JOIN utilisateurs c ON c.id = m.chef_id
     WHERE m.id = $1`,
    [id],
  );
  return r.rows[0] as MissionRapport;
}

/** Lignes d'un tableau bornées au plafond du modèle, avec la mention des lignes omises. */
function borner(lignes: string[][]): { lignes: string[][]; note: Bloc[] } {
  const max = PLAFONDS_MODELE.lignesParTableau;
  if (lignes.length <= max) return { lignes, note: [] };
  return {
    lignes: lignes.slice(0, max),
    note: [
      {
        type: "paragraphe",
        texte: `${lignes.length - max} ligne(s) supplémentaire(s) non reproduite(s) : voir l'application.`,
      },
    ],
  };
}

function sectionSynthese(m: MissionRapport, s: SuiviMission, droits: DroitsRapport): Section {
  const perf = s.performance;
  const suivi = s.arbre.suivi;
  const elements = [
    { libelle: "Statut de la mission", valeur: LIBELLES_STATUT[m.statut] },
    {
      libelle: "Avancement physique",
      valeur: perf ? pourcent(perf.avancement as number) : "Non mesurable",
      detail: perf
        ? `${perf.elements as number} élément(s) : jalons et livrables`
        : "Aucun jalon ni livrable défini",
    },
    ...(droits.jours
      ? [
          { libelle: "Budget", valeur: j(suivi.budget) },
          { libelle: "Réalisé (temps validés)", valeur: j(suivi.realise) },
          { libelle: "Reste à faire", valeur: j(suivi.resteAFaire) },
          {
            libelle: "Atterrissage",
            valeur: j(suivi.atterrissage),
            detail: `Écart ${signe(suivi.ecart)} (${pourcent(suivi.ecartRelatif)})`,
          },
          {
            libelle: "Consommation du budget",
            valeur: pourcent(suivi.consommation),
            detail: LIBELLES_COULEUR[s.arbre.couleur],
          },
          ...(perf && perf.indice !== null
            ? [
                {
                  libelle: "Indice avancement / consommation",
                  valeur: String(perf.indice).replace(".", ","),
                },
              ]
            : []),
        ]
      : []),
  ];
  return { titre: "Synthèse", blocs: [{ type: "indicateurs", elements }] };
}

function sectionMission(m: MissionRapport): Section {
  return {
    titre: "Mission",
    blocs: [
      {
        type: "tableau",
        colonnes: ["Rubrique", "Valeur"],
        lignes: [
          ["Intitulé", cellule(m.intitule)],
          ["Client", cellule(m.client)],
          ["Statut", LIBELLES_STATUT[m.statut]],
          ["Début prévu", dateAffichee(m.date_debut)],
          ["Fin prévue", dateAffichee(m.date_fin)],
          ["Signature", dateAffichee(m.date_signature)],
          ["Directeur de mission", m.directeur ? cellule(m.directeur) : "—"],
          ["Chef de mission", m.chef ? cellule(m.chef) : "—"],
        ],
      },
    ],
  };
}

function sectionPhases(s: SuiviMission): Section {
  const ligne = (n: NoeudAgrege, libelle: string) => [
    libelle,
    j(n.suivi.budget),
    j(n.suivi.realise),
    j(n.suivi.resteAFaire),
    j(n.suivi.atterrissage),
    signe(n.suivi.ecart),
    LIBELLES_COULEUR[n.couleur],
  ];
  const { lignes, note } = borner(
    s.arbre.enfants.map((p) => ligne(p, p.libelle ? cellule(p.libelle) : "Phase")),
  );
  const attente = vueNoeud(s.arbre, s).en_attente;
  return {
    titre: "Budget en jours par phase",
    blocs: [
      {
        type: "tableau",
        colonnes: ["Phase", "Budget", "Réalisé", "Reste à faire", "Atterrissage", "Écart", "État"],
        alignements: ["gauche", "droite", "droite", "droite", "droite", "droite", "gauche"],
        lignes: [...lignes, ligne(s.arbre, "Total mission")],
      },
      ...note,
      {
        type: "paragraphe",
        texte:
          `Réalisé : temps des feuilles validées et corrections validées. ` +
          `Temps soumis en attente de validation : ${j(attente)}.`,
      },
    ],
  };
}

function sectionJalons(s: SuiviMission, aujourdhui: string): Section {
  const jalons = s.decoupage.jalons;
  if (jalons.length === 0) {
    return { titre: "Jalons", blocs: [{ type: "paragraphe", texte: "Aucun jalon défini." }] };
  }
  const etat = (x: Record<string, unknown>) => {
    if (x.atteint === true) return "Atteint";
    const prevue = x.date_prevue as string | null;
    return prevue && prevue < aujourdhui ? "En retard" : "À venir";
  };
  const { lignes, note } = borner(
    jalons.map((x) => [
      cellule(String(x.libelle ?? "")),
      dateAffichee(x.date_prevue as string | null),
      etat(x),
    ]),
  );
  return {
    titre: "Jalons",
    blocs: [{ type: "tableau", colonnes: ["Jalon", "Date prévue", "État"], lignes }, ...note],
  };
}

function sectionTemps(s: SuiviMission): Section {
  const personnes = s.parPersonne.map((p) => [
    cellule(String(p.nom ?? "—")),
    cellule(String(p.grade_code ?? "—")),
    j(p.realise as number),
    j(p.reste_a_faire as number),
  ]);
  if (personnes.length === 0) {
    return {
      titre: "Temps consommé",
      blocs: [{ type: "paragraphe", texte: "Aucun temps validé ni reste à faire déclaré." }],
    };
  }
  const { lignes, note } = borner(personnes);
  return {
    titre: "Temps consommé",
    blocs: [
      {
        type: "tableau",
        colonnes: ["Collaborateur", "Grade", "Réalisé validé", "Reste à faire déclaré"],
        alignements: ["gauche", "gauche", "droite", "droite"],
        lignes,
      },
      ...note,
    ],
  };
}

/** Section financière (FIN-02) : uniquement appelée avec « finance.lire ». */
async function sectionFinance(
  db: Db,
  auth: Auth,
  missionId: string,
  m: MissionRapport,
  s: SuiviMission,
): Promise<Section> {
  const titre = "Données financières (confidentiel)";
  const missions = await chargerMissions(db, auth, [missionId]);
  if (missions.length === 0) {
    return {
      titre,
      blocs: [{ type: "paragraphe", texte: "Mission non signée : aucune donnée financière." }],
    };
  }
  const analyses = await analyserMissions(db, missions, null, null);
  const jours = new Map([
    [
      missionId,
      {
        budget: s.arbre.suivi.budget,
        realise: s.arbre.suivi.realise,
        atterrissage: s.arbre.suivi.atterrissage,
      },
    ],
  ]);
  const e = rentabilite(analyses, "mission", m.devise, jours).elements[0];
  if (!e) {
    return { titre, blocs: [{ type: "paragraphe", texte: "Aucune donnée financière." }] };
  }
  const f = (valeur: unknown) => formaterMontant(montant(valeur as number, m.devise));
  const budget = e.budget as { honoraires: number; marge: number };
  return {
    titre,
    blocs: [
      {
        type: "indicateurs",
        elements: [
          { libelle: "Honoraires facturés (HT)", valeur: f(e.honoraires) },
          {
            libelle: "Valeur produite",
            valeur: f(e.valeur_produite),
            detail: "Temps validés au taux de vente",
          },
          { libelle: "Coûts internes", valeur: f(e.couts_internes) },
          { libelle: "Sous-traitance", valeur: f(e.sous_traitance) },
          { libelle: "Débours non refacturés", valeur: f(e.debours_non_refactures) },
          {
            libelle: "Marge",
            valeur: f(e.marge),
            detail: `Taux de marge ${pourcent(e.taux_marge as number | null)}`,
          },
          { libelle: "Honoraires au budget", valeur: f(budget.honoraires) },
          { libelle: "Marge au budget", valeur: f(budget.marge) },
        ],
      },
    ],
  };
}

/**
 * Contenu du rapport d'état d'avancement d'une mission DÉJÀ contrôlée
 * visible (exigerMissionVisible) dans la transaction `db`, et son niveau
 * (calculé d'après les sections incluses : chacune déclare le sien).
 */
export async function rapportEtatAvancement(
  db: Db,
  auth: Auth,
  missionId: string,
  droits: DroitsRapport,
  aujourdhui: string,
): Promise<{ rapport: Rapport; niveau: NiveauRapport }> {
  const m = await lireMission(db, missionId);
  const s = await calculerSuiviMission(db, auth.cabinetId, missionId);
  const sections: Section[] = [];
  const niveaux: NiveauRapport[] = [];
  const ajouter = (section: Section, niveau: NiveauRapport) => {
    sections.push(section);
    niveaux.push(niveau);
  };
  // La synthèse porte les indicateurs en jours seulement avec « budget.lire_jours ».
  ajouter(sectionSynthese(m, s, droits), droits.jours ? "jours" : "base");
  ajouter(sectionMission(m), "base");
  if (droits.jours) ajouter(sectionPhases(s), "jours");
  ajouter(sectionJalons(s, aujourdhui), "base");
  if (droits.jours) ajouter(sectionTemps(s), "jours");
  if (droits.finance) ajouter(await sectionFinance(db, auth, missionId, m, s), "finance");
  ajouter(
    {
      titre: "Méthode",
      blocs: [
        {
          type: "paragraphe",
          texte:
            `Chiffres calculés par les moteurs de MissionPilot à la date du ${dateAffichee(aujourdhui)} ` +
            `(temps validés, reste à faire déclaré, jalons du découpage). ` +
            `Document généré automatiquement : il reste un brouillon tant qu'un consultant ne l'a pas relu.`,
        },
      ],
    },
    "base",
  );
  const niveau = niveauDesSections(niveaux);
  return {
    niveau,
    rapport: {
      titre: "État d'avancement de mission",
      sous_titre: sousTitreRapport(m.intitule, m.client),
      emetteur: tronquer(m.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: "brouillon",
      genere_le: aujourdhui,
      confidentiel: niveau === "finance",
      sections,
    },
  };
}
