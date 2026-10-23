import {
  syntheseEtatsFinanciers,
  type AlerteSynthese,
  type ConstatControleEtat,
  type Devise,
  type EtatPourSynthese,
  type LigneSyntheseExercice,
  type TotauxEtatFinancier,
} from "@missionpilot/engines";
import { SECTION_ETAT_LIBELLES, type SectionEtatDossier } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { exigerDossierVisible } from "../dossier/acces.js";
import { avecErreursDossier } from "../dossier/erreurs.js";
import { listerEtats, type VueEtat } from "../dossier/etats.js";
import { calculerFiabilite } from "../dossier/fiabilite.js";
import { AppError, requeteInvalide } from "../errors.js";
import { tronquer } from "./etat-avancement.js";
import { dateAffichee, PLAFONDS_MODELE, type Bloc, type Rapport, type Section } from "./modele.js";
import {
  borner,
  cellule,
  liste,
  lireEnteteMission,
  montantAffiche,
  NON_DISPONIBLE,
  paragraphe,
  pourcentage,
  section,
} from "./outils.js";

/*
 * Rapport « État financier » du dossier client (migration 0552, niveau « dossier »).
 *
 * PROVENANCE DES CHIFFRES (aucun calcul ici) : les états financiers ACCEPTÉS du dossier du client
 * de la mission (état courant d'un exercice : ni remplacé ni rejeté, décision « accepte »,
 * automatique ou humaine) ; totaux, marges, variations et alertes viennent du moteur
 * `syntheseEtatsFinanciers` (@missionpilot/engines), les constats d'équilibre du moteur de contrôle
 * (`controles`, stockés à l'ingestion), l'indice de fiabilité du moteur `indiceFiabiliteDossier`.
 * L'API met en forme : montants par `montantAffiche`, pourcentages par Intl (la conversion des
 * points de base du moteur en fraction n'est qu'un changement d'unité d'affichage).
 *
 * DONNÉES : celles DU CLIENT seulement (états, provenance). Aucune donnée FIN-02 du cabinet
 * (coûts, taux, marges) : la permission du niveau est « dossier.lire ».
 *
 * COMMENTAIRE : texte libre du consultant, restitué brut sous une mention qui en dit l'auteur ;
 * aucun commentaire n'est produit par l'IA ici. Le rapport reste « brouillon » et confidentiel.
 */

/** Exercices repris dans la synthèse quand la requête n'en précise pas le nombre. */
export const EXERCICES_PAR_DEFAUT = 3;

const MENTION_COMMENTAIRE =
  "Commentaire du consultant — rédigé par le consultant ; les chiffres du rapport proviennent du moteur de calcul";

const ORIGINES: Record<string, string> = {
  saisie: "Saisie",
  csv: "Import CSV",
  excel: "Import Excel",
};

const STATUTS_CONSTAT: Record<string, string> = {
  ok: "Conforme",
  ecart: "Écart",
  non_verifiable: "Non vérifiable",
};

const POURCENT_SIGNE = new Intl.NumberFormat("fr-FR", {
  style: "percent",
  maximumFractionDigits: 1,
  signDisplay: "exceptZero",
});

/** Points de base du moteur (1 234 = 12,34 %) → fraction pour l'affichage. */
const enFraction = (bps: number | null) => (bps === null ? null : bps / 10_000);

const pct = (bps: number | null) => pourcentage(enFraction(bps));
const pctSigne = (bps: number | null) =>
  bps === null ? NON_DISPONIBLE : POURCENT_SIGNE.format(bps / 10_000);

export interface ResultatEtatFinancier {
  rapport: Rapport;
  niveau: "dossier";
  missionId: string;
  /** Identifiants seulement (journal d'audit), jamais de montant. */
  audit: { client_id: string; etat_ids: string[] };
}

interface LigneEtat {
  code: string;
  libelle: string;
  section: string;
  montant: number;
}

/** Totaux d'un état tels que stockés (colonne `totaux` produite par le moteur de contrôle). */
function totauxStockes(brut: unknown): TotauxEtatFinancier {
  const t = (brut ?? {}) as Record<string, unknown>;
  const v = (cle: string) => (typeof t[cle] === "number" ? (t[cle] as number) : null);
  return {
    actif: v("actif"),
    passif: v("passif"),
    charges: v("charges"),
    produits: v("produits"),
    resultat: v("resultat"),
  };
}

/** États acceptés courants, un par exercice, les `n` exercices les plus récents. */
function etatsAcceptes(etats: readonly VueEtat[], n: number): VueEtat[] {
  const parExercice = new Map<number, VueEtat>();
  for (const e of etats) {
    if (e.statut === "accepte" && !parExercice.has(e.exercice)) parExercice.set(e.exercice, e);
  }
  return [...parExercice.values()].sort((a, b) => b.exercice - a.exercice).slice(0, n);
}

function versSynthese(e: VueEtat): EtatPourSynthese {
  return {
    exercice: e.exercice,
    dateCloture: e.date_cloture,
    devise: e.devise,
    totaux: totauxStockes(e.totaux),
    conforme: e.conforme,
    complet: e.complet,
    acceptation: e.decision?.automatique ? "automatique" : "humaine",
  };
}

async function lireLignes(db: Db, etatId: string): Promise<LigneEtat[]> {
  const r = await db.query(
    `SELECT code, libelle, section, montant FROM dossier_etats_lignes
     WHERE etat_id = $1 ORDER BY rang`,
    [etatId],
  );
  return r.rows.map((l) => ({
    code: l.code as string,
    libelle: l.libelle as string,
    section: l.section as string,
    montant: Number(l.montant),
  }));
}

function tableauLignes(titre: string, lignes: LigneEtat[], devise: Devise): Bloc[] {
  if (lignes.length === 0) return [];
  const { lignes: bornees, note } = borner(
    lignes.map((l) => [cellule(l.code), cellule(l.libelle), montantAffiche(l.montant, devise)]),
  );
  return [
    {
      type: "tableau",
      titre,
      colonnes: ["Code", "Libellé", "Montant"],
      alignements: ["gauche", "gauche", "droite"],
      lignes: bornees,
    },
    ...note,
  ];
}

function sectionSynthese(
  derniere: LigneSyntheseExercice,
  devise: Devise,
  alertes: readonly AlerteSynthese[],
  fiabilite: string | null,
): Section {
  const elements = [
    { libelle: "Actif", valeur: montantAffiche(derniere.actif, devise) },
    { libelle: "Produits", valeur: montantAffiche(derniere.produits, devise) },
    { libelle: "Résultat", valeur: montantAffiche(derniere.resultat, devise) },
    { libelle: "Marge nette", valeur: pct(derniere.margeNetteBps), detail: "résultat / produits" },
    ...(fiabilite ? [{ libelle: "Fiabilité des données du dossier", valeur: fiabilite }] : []),
  ];
  const blocs: Bloc[] = [
    paragraphe(
      `Indicateurs de l'exercice ${derniere.exercice} (clôturé le ${dateAffichee(derniere.dateCloture)}), d'après les états financiers acceptés du dossier du client.`,
    ),
    { type: "indicateurs", elements },
  ];
  blocs.push(
    alertes.length === 0
      ? paragraphe("Aucune alerte du moteur de synthèse.")
      : liste(alertes.map((a) => a.message)),
  );
  return section("Synthèse", blocs);
}

function sectionEvolution(lignes: readonly LigneSyntheseExercice[], devise: Devise): Section {
  const { lignes: bornees, note } = borner(
    lignes.map((l) => [
      String(l.exercice),
      montantAffiche(l.actif, devise),
      montantAffiche(l.passif, devise),
      montantAffiche(l.charges, devise),
      montantAffiche(l.produits, devise),
      montantAffiche(l.resultat, devise),
      pct(l.margeNetteBps),
      pctSigne(l.variationProduitsBps),
      pctSigne(l.variationResultatBps),
      pctSigne(l.variationActifBps),
    ]),
  );
  return section("Évolution sur les exercices", [
    paragraphe(
      "Les variations sont calculées par rapport à l'exercice immédiatement précédent, lorsqu'il est consécutif ; « — » sinon.",
    ),
    {
      type: "tableau",
      colonnes: [
        "Exercice",
        "Actif",
        "Passif",
        "Charges",
        "Produits",
        "Résultat",
        "Marge nette",
        "Var. produits",
        "Var. résultat",
        "Var. actif",
      ],
      alignements: [
        "gauche",
        "droite",
        "droite",
        "droite",
        "droite",
        "droite",
        "droite",
        "droite",
        "droite",
        "droite",
      ],
      lignes: bornees,
    },
    ...note,
  ]);
}

function sectionEtats(exercice: number, lignes: LigneEtat[], devise: Devise): Section {
  const de = (s: SectionEtatDossier) => lignes.filter((l) => l.section === s);
  const blocs: Bloc[] = [
    ...tableauLignes(`Bilan — ${SECTION_ETAT_LIBELLES.actif}`, de("actif"), devise),
    ...tableauLignes(`Bilan — ${SECTION_ETAT_LIBELLES.passif}`, de("passif"), devise),
    ...tableauLignes(
      `Compte de résultat — ${SECTION_ETAT_LIBELLES.charges}`,
      de("charges"),
      devise,
    ),
    ...tableauLignes(
      `Compte de résultat — ${SECTION_ETAT_LIBELLES.produits}`,
      de("produits"),
      devise,
    ),
    ...tableauLignes(
      `Compte de résultat — ${SECTION_ETAT_LIBELLES.resultat}`,
      de("resultat"),
      devise,
    ),
  ];
  return section(`Bilan et compte de résultat de l'exercice ${exercice}`, [
    paragraphe(`Lignes de l'état accepté, dans l'ordre de l'état déposé (devise : ${devise}).`),
    ...blocs,
  ]);
}

function sectionControles(etats: readonly VueEtat[], devise: Devise): Section {
  const lignes = etats.flatMap((e) =>
    (e.constats as unknown as ConstatControleEtat[]).map((c) => [
      String(e.exercice),
      cellule(c.code),
      STATUTS_CONSTAT[c.statut] ?? cellule(String(c.statut)),
      montantAffiche(c.ecart, devise),
      cellule(c.message),
    ]),
  );
  const { lignes: bornees, note } = borner(lignes);
  return section("Contrôles d'équilibre", [
    paragraphe(
      "Constats du moteur de contrôle, établis à l'ingestion de chaque état (équilibre du bilan, résultat, sous-totaux).",
    ),
    bornees.length === 0
      ? paragraphe("Aucun constat enregistré.")
      : {
          type: "tableau",
          colonnes: ["Exercice", "Contrôle", "Statut", "Écart", "Message"],
          alignements: ["gauche", "gauche", "gauche", "droite", "gauche"],
          lignes: bornees,
        },
    ...note,
  ]);
}

function decisionAffichee(e: VueEtat): string {
  const d = e.decision;
  if (!d) return NON_DISPONIBLE;
  const quand = dateAffichee(d.le);
  const motif = d.motif ? ` — motif : ${d.motif}` : "";
  return d.automatique
    ? `Automatique le ${quand}${motif}`
    : `Humaine : ${d.par?.nom ?? NON_DISPONIBLE}, le ${quand}${motif}`;
}

function sectionProvenance(etats: readonly VueEtat[], devise: Devise): Section {
  const { lignes, note } = borner(
    etats.map((e) => [
      String(e.exercice),
      ORIGINES[e.origine] ?? cellule(e.origine),
      cellule(String(e.fichier?.nom ?? e.source_libelle ?? NON_DISPONIBLE)),
      e.fichier ? `${String(e.fichier.sha256).slice(0, 12)}…` : NON_DISPONIBLE,
      cellule(`${dateAffichee(e.cree_le)} par ${e.importe_par.nom as string}`),
      cellule(decisionAffichee(e)),
      montantAffiche(e.tolerance, devise),
    ]),
  );
  return section("Annexe — Provenance des états", [
    paragraphe(
      "Origine de chaque état accepté : fichier source (empreinte SHA-256 abrégée), import, décision d'acceptation et tolérance des contrôles.",
    ),
    {
      type: "tableau",
      colonnes: [
        "Exercice",
        "Origine",
        "Fichier source",
        "Empreinte SHA-256",
        "Importé",
        "Décision",
        "Tolérance",
      ],
      alignements: ["gauche", "gauche", "gauche", "gauche", "gauche", "gauche", "droite"],
      lignes,
    },
    ...note,
  ]);
}

/**
 * Contenu du rapport d'état financier du dossier `clientId`, pour la mission `missionId` (qui
 * doit être celle de CE client). Dossier visible (404), mission du client (400), au moins un
 * état accepté (409 AUCUN_ETAT_ACCEPTE) ; une erreur du moteur (devises mêlées…) est traduite.
 */
export async function construireRapportEtatFinancier(
  db: Db,
  auth: Auth,
  clientId: string,
  missionId: string,
  nombreExercices: number,
  commentaire: string | undefined,
  date: string,
): Promise<ResultatEtatFinancier> {
  const client = await exigerDossierVisible(db, auth, clientId);
  const m = await db.query("SELECT client_id FROM missions WHERE id = $1", [missionId]);
  if (m.rows[0]?.client_id !== clientId) {
    throw requeteInvalide("La mission n'est pas celle de ce client.");
  }

  const etats = etatsAcceptes(await listerEtats(db, clientId), nombreExercices);
  if (etats.length === 0) {
    throw new AppError(
      409,
      "AUCUN_ETAT_ACCEPTE",
      "Aucun état financier accepté dans le dossier de ce client.",
    );
  }
  const synthese = await avecErreursDossier(async () =>
    syntheseEtatsFinanciers(etats.map(versSynthese)),
  );
  const devise = synthese.devise as Devise;
  const derniereLigne = synthese.exercices[synthese.exercices.length - 1]!;
  const dernierEtat = etats[0]!; // les plus récents d'abord
  const recents = etats;
  const croissants = [...etats].reverse();

  const indice = await calculerFiabilite(db, clientId);
  const fiabilite = `Classe ${indice.classe} (${indice.points} points)`;

  const entete = await lireEnteteMission(db, missionId);
  const exercices = synthese.exercices.map((l) => l.exercice).join(", ");
  const sections: Section[] = [
    sectionSynthese(derniereLigne, devise, synthese.alertes, fiabilite),
    sectionEvolution(synthese.exercices, devise),
    sectionEtats(dernierEtat.exercice, await lireLignes(db, dernierEtat.id), devise),
    sectionControles(recents, devise),
  ];
  if (commentaire) {
    sections.push(
      section("Commentaire du consultant", [
        paragraphe(MENTION_COMMENTAIRE),
        paragraphe(commentaire),
      ]),
    );
  }
  sections.push(sectionProvenance(croissants, devise));

  // Sous-titre borné : client (120) + séparateur + au plus cinq exercices.
  const longueurClient = 120;
  return {
    rapport: {
      titre: "Rapport d'état financier",
      sous_titre: `${tronquer(client.raison_sociale, longueurClient)} — exercice(s) ${exercices}`,
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: "brouillon",
      genere_le: date,
      confidentiel: true,
      sections,
    },
    niveau: "dossier",
    missionId,
    audit: { client_id: clientId, etat_ids: croissants.map((e) => e.id) },
  };
}
