import {
  calculerEtatVoyant,
  motifsPrincipaux,
  synthetiserPortefeuilleVoyants,
  type EtatVoyant,
} from "@missionpilot/engines";
import {
  RED_TABLEAU_MENTION,
  type Devise,
  type RedDossierResume,
  type RedIndicateurTableauVue,
  type RedNiveauAlerte,
  type RedSecteur,
  type RedStatutDossier,
  type RedTableauCausesVue,
  type RedTableauCovenantsVue,
  type RedTableauDossierIdentiteVue,
  type RedTableauDossierVue,
  type RedTableauFinancementVue,
  type RedTableauPlanVue,
  type RedTableauPortefeuilleQuery,
  type RedTableauPortefeuilleVue,
  type RedTableauSuiviVue,
  type RedTableauTresorerieVue,
  type RedVoyant,
  type RedVoyantPilotageVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { introuvable } from "../errors.js";
import { lireDossier, type AccesDossierRed, type DossierRed } from "./acces.js";
import { listerCauses } from "./causes.js";
import { resumeCloture } from "./cloture.js";
import { lireCovenants } from "./covenants.js";
import { resumePassif } from "./creanciers.js";
import { dateDuJour } from "./dates.js";
import { listerDossiers } from "./dossiers.js";
import { lireFinancement } from "./financement.js";
import { lireSuivi } from "./suivi.js";
import { lireTresorerieMensuelle } from "./tresorerie-mensuelle.js";
import { iso, isoOuVide } from "./vues.js";
import { rassemblerDonneesVoyant, type DonneesVoyant } from "./voyant.js";

/*
 * Tableau de bord du redressement (RED-15, version INTERNE : consultants, direction, associés ; le
 * partage au portail n'existe pas). Synthèse de pilotage consolidée d'un dossier, et page du
 * portefeuille des dossiers de missions VISIBLES. L'API ne calcule rien : le voyant et ses motifs
 * sortent du moteur, les autres chiffres des services existants (trésorerie, covenants, plan de
 * financement, plan d'actions, créanciers, suivi). Chaque bloc absent est null. Aucune donnée du
 * cabinet (FIN-02) : les montants sont ceux du client. Lecture seule, non journalisée.
 */

function voyantVue(e: EtatVoyant): RedVoyantPilotageVue {
  return {
    voyant: e.voyant,
    motifs: e.motifs.map((m) => ({ code: m.code, gravite: m.gravite, libelle: m.libelle })),
    indicatif: true,
  };
}

function identiteDepuisResume(
  r: RedDossierResume,
  dossier: DossierRed,
): RedTableauDossierIdentiteVue {
  return {
    id: r.id,
    mission: r.mission,
    client: r.client,
    intitule: r.intitule,
    secteur: r.secteur,
    devise: r.devise,
    statut: r.statut,
    ouvert_le: r.ouvert_le,
    clos_le: iso(dossier.clos_le),
  };
}

async function identite(db: Db, dossier: DossierRed): Promise<RedTableauDossierIdentiteVue> {
  const r = await db.query(
    `SELECT m.id AS mission_id, m.intitule AS mission_intitule, c.id AS client_id, c.raison_sociale
     FROM missions m JOIN clients c ON c.id = $2 WHERE m.id = $1`,
    [dossier.mission_id, dossier.client_id],
  );
  const l = r.rows[0] as
    | { mission_id: string; mission_intitule: string; client_id: string; raison_sociale: string }
    | undefined;
  if (!l) throw introuvable("Dossier de redressement");
  return {
    id: dossier.id,
    mission: { id: l.mission_id, intitule: l.mission_intitule },
    client: { id: l.client_id, raison_sociale: l.raison_sociale },
    intitule: dossier.intitule,
    secteur: dossier.secteur as RedSecteur,
    devise: dossier.devise as Devise,
    statut: dossier.statut as RedStatutDossier,
    ouvert_le: isoOuVide(dossier.cree_le),
    clos_le: iso(dossier.clos_le),
  };
}

function indicateurs(
  d: DonneesVoyant,
  suivi: RedTableauSuiviVue | null,
  dateSuivi: string,
): RedIndicateurTableauVue[] {
  const liste: RedIndicateurTableauVue[] = [
    {
      cle: "voyant_urgence",
      libelle: "Dernier diagnostic d'urgence",
      valeur: d.urgence?.voyant ?? null,
      source: "Diagnostic d'urgence",
      date: d.urgence ? isoOuVide(d.urgence.cree_le) : null,
    },
    {
      cle: "niveau_alerte",
      libelle: "Niveau d'alerte précoce",
      valeur: d.alerte?.niveau ?? null,
      source: "Score d'alerte précoce",
      date: d.alerte ? isoOuVide(d.alerte.cree_le) : null,
    },
    {
      cle: "score_alerte",
      libelle: "Score d'alerte précoce",
      valeur: d.alerte?.score ?? null,
      source: "Score d'alerte précoce",
      date: d.alerte ? isoOuVide(d.alerte.cree_le) : null,
    },
    {
      cle: "semaines_tension",
      libelle: "Semaines de tension de trésorerie",
      valeur: d.tresorerie ? d.tresorerie.semaines_tension.length : null,
      source: d.tresorerie
        ? `Trésorerie à 13 semaines (version ${d.tresorerie.version})`
        : "Trésorerie à 13 semaines",
      date: d.tresorerie ? d.tresorerie.date_debut : null,
    },
    {
      cle: "covenants_en_defaut",
      libelle: "Covenants non respectés",
      valeur: d.covenantsEnDefaut,
      source: "Covenants bancaires",
      date: null,
    },
    {
      cle: "actions_en_retard",
      libelle: "Actions du plan en retard",
      valeur: d.plan.en_retard,
      source: "Plan d'actions",
      date: dateSuivi,
    },
  ];
  if (suivi) {
    liste.push({
      cle: "alertes_suivi",
      libelle: "Alertes du suivi après mission",
      valeur: suivi.nombre,
      source: "Suivi après mission",
      date: dateSuivi,
    });
  }
  return liste;
}

function planVue(plan: DonneesVoyant["plan"]): RedTableauPlanVue | null {
  const total = Object.values(plan.actions_par_statut).reduce((a, b) => a + b, 0);
  if (total === 0 && plan.version_courante === null) return null;
  return {
    actions_par_statut: plan.actions_par_statut,
    en_retard: plan.en_retard,
    version_courante: plan.version_courante,
    modifie_depuis_validation: plan.modifie_depuis_validation,
  };
}

async function blocCovenants(db: Db, dossier: DossierRed): Promise<RedTableauCovenantsVue | null> {
  const c = await lireCovenants(db, dossier);
  if (!c.version || !c.synthese) return null;
  return {
    version: c.version.version,
    exercice: c.exercice ? c.exercice.exercice : null,
    nombre: c.synthese.nombre,
    respectes: c.synthese.respectes,
    en_defaut: c.synthese.en_defaut,
    non_calculables: c.synthese.non_calculables,
    covenants: c.version.covenants.map((x) => ({
      ratio: x.ratio,
      preteur: x.preteur,
      statut: x.evaluation.statut,
    })),
  };
}

async function blocFinancement(
  db: Db,
  dossier: DossierRed,
): Promise<RedTableauFinancementVue | null> {
  const f = await lireFinancement(db, dossier);
  if (!f.version || !f.plan) return null;
  return {
    version: f.version.version,
    date_debut: f.version.date_debut,
    type_periode: f.version.type_periode,
    nombre_periodes: f.version.nombre_periodes,
    equilibre: f.plan.equilibre,
    totaux: f.plan.totaux,
    couverture_totale_pb: f.plan.couverture_totale_pb,
    premiere_periode_insuffisance: f.plan.premiere_periode_insuffisance,
    insuffisance_maximale_cumulee: f.plan.insuffisance_maximale_cumulee,
  };
}

async function blocTresorerie(
  db: Db,
  dossier: DossierRed,
  d: DonneesVoyant,
): Promise<RedTableauTresorerieVue | null> {
  const t = d.tresorerie;
  if (!t) return null;
  const m = (await lireTresorerieMensuelle(db, dossier)).mensuel;
  return {
    ...t,
    semaines_tension: [...t.semaines_tension],
    mensuel: m
      ? {
          mois_tension: m.mois_tension,
          premier_mois_tension: m.premier_mois_tension,
          solde_minimum: m.solde_minimum,
          totaux: m.totaux,
        }
      : null,
  };
}

/**
 * Cartographie des causes : seule une version VALIDÉE est présentée comme validée et comptée ;
 * une proposition non validée est signalée comme telle, sans nombre de causes.
 */
async function blocCauses(db: Db, dossier: DossierRed): Promise<RedTableauCausesVue | null> {
  const versions = (await listerCauses(db, dossier)).elements; // plus récente d'abord
  const recente = versions[0];
  if (!recente) return null;
  const validee = versions.find((v) => v.statut === "valide");
  if (validee) {
    return {
      statut: "validee",
      version: validee.version,
      valide_le: validee.valide_le,
      nombre_causes: validee.causes.length,
      version_plus_recente_non_validee: recente.id !== validee.id,
    };
  }
  return {
    statut: "non_validee",
    version: recente.version,
    valide_le: null,
    nombre_causes: null,
    version_plus_recente_non_validee: false,
  };
}

/** Vue consolidée d'un dossier (le dossier est déjà établi visible par l'appelant). */
export async function vueTableauDossier(
  db: Db,
  auth: Auth,
  acces: AccesDossierRed,
): Promise<RedTableauDossierVue> {
  const { dossier } = acces;
  const dateCalcul = dateDuJour();
  const donnees = await rassemblerDonneesVoyant(db, auth, dossier);
  const etat = calculerEtatVoyant(donnees.entrees);
  const clos = dossier.statut === "clos";
  let suivi: RedTableauSuiviVue | null = null;
  if (clos) {
    const s = await lireSuivi(db, dossier);
    if (s.plan) suivi = { nombre: s.synthese.nombre, attention: s.synthese.attention };
  }
  const passif = await resumePassif(db, dossier.id);
  return {
    dossier: await identite(db, dossier),
    date_calcul: dateCalcul,
    voyant: voyantVue(etat),
    indicateurs: indicateurs(donnees, suivi, dateCalcul),
    tresorerie: await blocTresorerie(db, dossier, donnees),
    covenants: await blocCovenants(db, dossier),
    financement: await blocFinancement(db, dossier),
    plan: planVue(donnees.plan),
    creanciers: passif.nombre > 0 ? passif : null,
    causes: await blocCauses(db, dossier),
    cloture: clos ? await resumeCloture(db, dossier.id) : null,
    suivi,
    mention: RED_TABLEAU_MENTION,
  };
}

/**
 * Page du portefeuille : dossiers des missions visibles de l'appelant (même visibilité, même
 * pagination par curseur et mêmes filtres que `listerDossiers`), avec voyant, motifs principaux
 * et indicateurs. La page est courte (un calcul par dossier).
 */
export async function listerTableauPortefeuille(
  db: Db,
  auth: Auth,
  q: RedTableauPortefeuilleQuery,
): Promise<RedTableauPortefeuilleVue> {
  const page = await listerDossiers(db, auth, {
    limite: q.limite,
    ...(q.curseur !== undefined ? { curseur: q.curseur } : {}),
    ...(q.statut !== undefined ? { statut: q.statut } : {}),
    ...(q.secteur !== undefined ? { secteur: q.secteur } : {}),
  });
  const elements: RedTableauPortefeuilleVue["elements"] = [];
  for (const r of page.elements) {
    const dossier = await lireDossier(db, r.id);
    if (!dossier) continue; // supprimé entre-temps : ignoré
    const d = await rassemblerDonneesVoyant(db, auth, dossier);
    const etat = calculerEtatVoyant(d.entrees);
    elements.push({
      dossier: identiteDepuisResume(r, dossier),
      voyant: etat.voyant,
      motifs: motifsPrincipaux(etat.motifs).map((m) => ({
        code: m.code,
        gravite: m.gravite,
        libelle: m.libelle,
      })),
      indicateurs: {
        dernier_voyant_urgence: (d.urgence?.voyant as RedVoyant | undefined) ?? null,
        dernier_niveau_alerte: (d.alerte?.niveau as RedNiveauAlerte | undefined) ?? null,
        dernier_score: d.alerte?.score ?? null,
        semaines_tension: d.entrees.semainesTension,
        covenants_en_defaut: d.entrees.covenantsEnDefaut,
        actions_en_retard: d.entrees.actionsEnRetard,
      },
    });
  }
  return {
    date_calcul: dateDuJour(),
    elements,
    suivant: page.suivant,
    synthese_page: { ...synthetiserPortefeuilleVoyants(elements.map((e) => e.voyant)) },
    mention: RED_TABLEAU_MENTION,
  };
}
