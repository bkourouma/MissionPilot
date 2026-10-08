import {
  analyserBancabilite,
  CLES_RATIOS_BANCAIRES,
  type AnalyseBancabilite,
  type CleRatioBancaire,
  type Devise,
  type RatioBancaire,
} from "@missionpilot/engines";
import { STATUT_RATIO_LIBELLES, VERDICT_BANCABILITE_LIBELLES } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { exigerPlanVisible } from "../plans/acces.js";
import { versionValidee } from "../plans/bancabilite.js";
import type { ElementCourant } from "../plans/elements.js";
import { donneesRapport } from "../plans/rapport.js";
import { sousTitreRapport, tronquer } from "./etat-avancement.js";
import { dateAffichee, PLAFONDS_MODELE, type Bloc, type Section } from "./modele.js";
import type { Rapport } from "./modele.js";
import {
  borner,
  cellule,
  lireEnteteMission,
  montantAffiche,
  NON_DISPONIBLE,
  paragraphe,
  section,
} from "./outils.js";
import { sectionsFinancieres, type SourcePlan } from "./plan.js";

/*
 * Dossier bancaire (PLA-17) : synthèse du projet, ratios bancaires, plan de
 * financement, échéanciers d'emprunts et états prévisionnels, rendu en PDF ou
 * Word par l'infrastructure des rapports (routes/rapports.ts : débit, mission
 * visible et ouverte, mention du cabinet, enregistrement et suivi qualité).
 *
 * PROVENANCE : uniquement le résultat FIGÉ d'une version VALIDÉE du modèle
 * financier (plans/bancabilite.ts `versionValidee`, 409 MODELE_NON_VALIDE
 * sinon ; doublé en base, MPR03) ; ratios et plan de financement par le
 * moteur (analyserBancabilite) ; textes : seuls les contenus VALIDÉS du plan
 * (vision, initiatives). Aucune arithmétique ici : mise en forme seulement.
 *
 * DESTINATAIRE EXTERNE : ce dossier part vers une banque. Il ne reprend donc PAS l'annexe
 * « Sources » du rapport de plan (`sectionSources`, registre des preuves de la mission : verbatims,
 * références d'entretiens, assertions internes du cabinet) : rien du registre des preuves n'y
 * figure. Le générateur doit avoir `plan.valider` (routes/rapports.ts) : seul qui peut valider
 * une version du modèle financier (associé, chef de mission) émet le dossier qui s'appuie sur
 * elle ; un consultant ou un expert métier, qui n'ont que `plan.lire`, ne l'émettent pas.
 */

const LIBELLES_RATIOS: Record<CleRatioBancaire, string> = {
  couverture_service_dette: "Couverture du service de la dette",
  endettement: "Dettes financières / capitaux propres",
  dette_nette_sur_ebe: "Dette nette / EBE",
  capacite_remboursement: "Capacité de remboursement",
  bfr_jours: "BFR en jours de chiffre d'affaires",
};

const DECIMAL = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });
const ENTIER = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** Valeur entière du moteur affichée : points de base en multiple ou en années, jours en jours. */
function valeurRatio(cle: CleRatioBancaire, valeur: number | null): string {
  if (valeur === null) return NON_DISPONIBLE;
  if (cle === "bfr_jours") return `${ENTIER.format(valeur)} j`;
  const decimal = DECIMAL.format(valeur / 10_000);
  return cle === "capacite_remboursement" ? `${decimal} an(s)` : `${decimal} x`;
}

const celluleRatio = (cle: CleRatioBancaire, r: RatioBancaire) =>
  r.valeur === null
    ? STATUT_RATIO_LIBELLES[r.statut]
    : `${valeurRatio(cle, r.valeur)}${r.statut === "hors_seuil" ? " (hors seuil)" : ""}`;

function sectionSynthese(
  a: AnalyseBancabilite,
  version: number,
  valideLe: string | null,
  horizon: number,
  devise: Devise,
): Section {
  const horsSeuil = CLES_RATIOS_BANCAIRES.filter((c) => a.horsSeuil[c].length > 0).map(
    (c) => `${LIBELLES_RATIOS[c]} : exercice(s) ${a.horsSeuil[c].join(", ")}`,
  );
  return section("Synthèse", [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Appréciation indicative", valeur: VERDICT_BANCABILITE_LIBELLES[a.verdict] },
        {
          libelle: "Modèle financier",
          valeur: `Version ${version}`,
          detail: `Validée le ${dateAffichee(valideLe)}`,
        },
        { libelle: "Horizon", valeur: `${horizon} ans` },
        {
          libelle: "Solde cumulé du plan de financement",
          valeur: montantAffiche(a.totaux.solde, devise),
        },
      ],
    },
    horsSeuil.length
      ? { type: "liste", elements: horsSeuil.map(cellule) }
      : paragraphe("Tous les ratios calculables respectent les seuils indicatifs."),
  ]);
}

function sectionRatios(a: AnalyseBancabilite): Section {
  const colonnes = ["Ratio", ...a.exercices.map((e) => String(e.exercice))];
  const s = a.seuils;
  return section("Ratios bancaires", [
    {
      type: "tableau",
      colonnes,
      alignements: colonnes.map((_, j) => (j === 0 ? "gauche" : "droite")),
      lignes: CLES_RATIOS_BANCAIRES.map((cle) => [
        LIBELLES_RATIOS[cle],
        ...a.exercices.map((e) => celluleRatio(cle, e.ratios[cle])),
      ]),
    },
    paragraphe(
      `Seuils indicatifs : couverture du service de la dette d'au moins ` +
        `${valeurRatio("couverture_service_dette", s.couvertureServiceDetteMinPb)}, endettement d'au plus ` +
        `${valeurRatio("endettement", s.endettementMaxPb)}, dette nette d'au plus ` +
        `${valeurRatio("dette_nette_sur_ebe", s.detteNetteSurEbeMaxPb)} l'EBE, remboursement en ` +
        `${valeurRatio("capacite_remboursement", s.capaciteRemboursementMaxPb)} au plus, BFR d'au plus ` +
        `${valeurRatio("bfr_jours", s.bfrJoursMax)} de chiffre d'affaires. « Sans objet » : pas de ` +
        `dette ; « hors seuil » sans valeur : capitaux propres, EBE ou CAF nuls ou négatifs.`,
    ),
  ]);
}

function sectionPlanFinancement(a: AnalyseBancabilite, devise: Devise): Section {
  const p = a.planFinancement;
  const ligne = (libelle: string, valeurs: number[]) => [
    libelle,
    ...valeurs.map((v) => montantAffiche(v, devise)),
  ];
  const colonnes = ["Rubrique", ...p.map((x) => String(x.exercice))];
  const lignes = [
    ligne(
      "Capacité d'autofinancement",
      p.map((x) => x.ressources.capaciteAutofinancement),
    ),
    ligne(
      "Apports en capital",
      p.map((x) => x.ressources.augmentationsCapital),
    ),
    ligne(
      "Emprunts nouveaux",
      p.map((x) => x.ressources.empruntsNouveaux),
    ),
    ligne(
      "Diminution du BFR",
      p.map((x) => x.ressources.diminutionBfr),
    ),
    ligne(
      "Total des ressources",
      p.map((x) => x.ressources.total),
    ),
    ligne(
      "Investissements",
      p.map((x) => x.emplois.investissements),
    ),
    ligne(
      "Augmentation du BFR",
      p.map((x) => x.emplois.augmentationBfr),
    ),
    ligne(
      "Remboursements d'emprunts",
      p.map((x) => x.emplois.remboursementsEmprunts),
    ),
    ligne(
      "Dividendes",
      p.map((x) => x.emplois.dividendes),
    ),
    ligne(
      "Total des emplois",
      p.map((x) => x.emplois.total),
    ),
    ligne(
      "Solde de l'exercice",
      p.map((x) => x.solde),
    ),
    ligne(
      "Solde cumulé",
      p.map((x) => x.soldeCumule),
    ),
  ];
  return section("Plan de financement", [
    {
      type: "tableau",
      colonnes,
      alignements: colonnes.map((_, j) => (j === 0 ? "gauche" : "droite")),
      lignes,
    },
  ]);
}

type Echeanciers = NonNullable<
  Awaited<ReturnType<typeof donneesRapport>>["financier"]
>["echeanciers"];

function sectionEmprunts(echeanciers: Echeanciers, devise: Devise): Section | null {
  if (echeanciers.length === 0) return null;
  const { lignes, note } = borner(
    echeanciers.flatMap((e) =>
      e.echeances.map((x) => [
        cellule(e.libelle),
        String(x.annee),
        montantAffiche(x.interets, devise),
        montantAffiche(x.amortissement, devise),
        montantAffiche(x.capitalFin, devise),
      ]),
    ),
  );
  return section("Échéanciers des emprunts", [
    {
      type: "tableau",
      colonnes: ["Emprunt", "Année du plan", "Intérêts", "Amortissement", "Capital restant dû"],
      alignements: ["gauche", "droite", "droite", "droite", "droite"],
      lignes,
    },
    ...note,
  ]);
}

const valides = (elements: readonly ElementCourant[]) =>
  elements.filter((e) => e.statut_contenu === "valide");

/** Projet : vision et initiatives VALIDÉES (titre, échéance, budget saisi). */
function sectionProjet(d: Awaited<ReturnType<typeof donneesRapport>>, devise: Devise): Section {
  const par = (type: string) => valides(d.sections.find((s) => s.type === type)?.elements ?? []);
  const vision = par("vision_mission")[0];
  const initiatives = par("initiative");
  const blocs: Bloc[] = [];
  if (vision) blocs.push(paragraphe(`Vision : ${String(vision.donnees.vision ?? "")}`));
  if (initiatives.length) {
    const t = borner(
      initiatives.map((i) => [
        cellule(String(i.donnees.titre ?? "")),
        dateAffichee(typeof i.donnees.echeance === "string" ? i.donnees.echeance : null),
        montantAffiche(i.donnees.budget, devise),
      ]),
    );
    blocs.push(
      {
        type: "tableau",
        titre: "Initiatives du plan",
        colonnes: ["Initiative", "Échéance", "Budget"],
        alignements: ["gauche", "gauche", "droite"],
        lignes: t.lignes,
      },
      ...t.note,
    );
  }
  if (blocs.length === 0) {
    blocs.push(
      paragraphe(
        "Aucun contenu validé du plan à présenter : seuls les chiffres du modèle validé sont repris.",
      ),
    );
  }
  return section("Le projet", blocs);
}

/** Contenu du dossier bancaire d'un plan visible (version validée du modèle, sinon 409). */
export async function rapportDossierBancaire(
  db: Db,
  auth: Auth,
  planId: string,
  version: number | undefined,
  aujourdhui: string,
): Promise<{ rapport: Rapport; source: SourcePlan }> {
  // Contrôle d'accès et de validation AVANT toute lecture du contenu.
  await exigerPlanVisible(db, auth, planId);
  const reference = await versionValidee(db, planId, version);
  const d = await donneesRapport(db, auth, planId, reference.resume.version);
  const financier = d.financier as NonNullable<typeof d.financier>;
  const devise = financier.devise as Devise;
  const analyse = analyserBancabilite(reference.resultat.base.annees);
  const entete = await lireEnteteMission(db, d.plan.mission_id);
  const valideLe = reference.resume.validation?.valide_le
    ? new Date(reference.resume.validation.valide_le).toISOString().slice(0, 10)
    : null;
  const sections: Section[] = [
    sectionSynthese(analyse, reference.resume.version, valideLe, financier.horizon, devise),
    sectionProjet(d, devise),
    sectionRatios(analyse),
    sectionPlanFinancement(analyse, devise),
  ];
  const emprunts = sectionEmprunts(financier.echeanciers, devise);
  if (emprunts) sections.push(emprunts);
  sections.push(...sectionsFinancieres(financier, devise));
  sections.push(
    section("Méthode", [
      paragraphe(
        `Dossier établi depuis la version ${reference.resume.version} du modèle financier du plan ` +
          `« ${tronquer(d.plan.titre, 150)} », validée par un responsable de la mission. Ratios, plan ` +
          `de financement et états prévisionnels sont calculés par les moteurs de MissionPilot ; ` +
          `l'appréciation et les seuils sont indicatifs et ne préjugent pas de la décision de la ` +
          `banque. Aucun chiffre de ce dossier n'est produit par l'IA.`,
      ),
    ]),
  );
  return {
    source: { missionId: d.plan.mission_id, planId: d.plan.id, version: reference.resume.version },
    rapport: {
      titre: "Dossier bancaire",
      sous_titre: sousTitreRapport(d.plan.titre, entete.client),
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: d.pret_pour_client ? "valide" : "brouillon",
      genere_le: aujourdhui,
      confidentiel: false,
      sections: sections.slice(0, PLAFONDS_MODELE.sections),
    },
  };
}
