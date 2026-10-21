import {
  RED_CHANGEMENT_CLASSE_LIBELLES,
  RED_DOMAINE_LIBELLES,
  RED_EVOLUTION_CLOTURE_LIBELLES,
  RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES,
  RED_NIVEAU_ALERTE_LIBELLES,
  RED_RATIO_LIBELLES,
  RED_STATUT_RENOTATION_LIBELLES,
  RED_VOLET_LIBELLES,
  RED_VOYANT_LIBELLES,
  type Devise,
  type RedClotureContenu,
  type RedClotureRapportVue,
  type RedClotureRapportsVue,
} from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import { decoderCurseur, paginer } from "../http/outils.js";
import { sousTitreRapport, tronquer } from "../rapports/etat-avancement.js";
import { COLONNES_RAPPORT } from "../rapports/enregistrement.js";
import {
  dateAffichee,
  PLAFONDS_MODELE,
  type Bloc,
  type Rapport,
  type Section,
} from "../rapports/modele.js";
import { peutLireNiveau } from "../rapports/niveaux.js";
import {
  borner,
  lireEnteteMission,
  liste,
  montantAffiche,
  NON_DISPONIBLE,
  paragraphe,
  section,
} from "../rapports/outils.js";
import { vueFichier } from "../stockage/fichiers.js";
import { causesValidees } from "./causes.js";
import { clotureVisible, contenuLu } from "./cloture.js";

/*
 * Rapport de clôture du redressement (RED-08) : rendu d'un bilan de clôture VALIDÉ, depuis son
 * contenu FIGÉ, et des causes racines VALIDÉES seulement (jamais une proposition de l'IA non
 * validée). Aucun calcul ici : le contenu est lu, validé par le schéma partagé, puis mis en forme
 * (points de base en pourcentage et montants dans la devise du dossier, par chaînes de caractères
 * et par `formaterMontant` du moteur). Les chiffres sont placés dans des blocs « indicateurs » : le
 * suivi qualité les liste comme chiffres issus des moteurs (qualite/branchements.ts, classe R2 au
 * moins). Niveau « red » (lecture : « redressement.lire »), confidentiel : les montants sont ceux du
 * client. Aucune qualification juridique de la situation du client.
 */

export interface SourceCloture {
  missionId: string;
  clotureId: string;
  version: number;
}

const MOINS = "−";
const ESPACE_MILLIERS = " ";

/** Entier signé divisé par 10^decimales, par chaînes de caractères (aucun arrondi, aucun flottant). */
function decimal(n: number, decimales: number): string {
  const signe = n < 0 ? MOINS : "";
  const chiffres = String(Math.abs(n)).padStart(decimales + 1, "0");
  const entier = chiffres
    .slice(0, chiffres.length - decimales)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ESPACE_MILLIERS);
  const fraction = decimales > 0 ? chiffres.slice(-decimales).replace(/0+$/, "") : "";
  return `${signe}${entier}${fraction ? `,${fraction}` : ""}`;
}

const avecSigne = (n: number, texte: string): string => (n > 0 ? `+${texte}` : texte);

const pb = (v: number | null): string => (v === null ? NON_DISPONIBLE : `${decimal(v, 2)} %`);
const pbSigne = (v: number | null): string =>
  v === null ? NON_DISPONIBLE : avecSigne(v, `${decimal(v, 2)} %`);
const entier = (v: number | null): string => (v === null ? NON_DISPONIBLE : decimal(v, 0));
const entierSigne = (v: number | null): string =>
  v === null ? NON_DISPONIBLE : avecSigne(v, decimal(v, 0));
const jours = (v: number | null): string => (v === null ? NON_DISPONIBLE : `${decimal(v, 0)} j`);
const joursSigne = (v: number | null): string =>
  v === null ? NON_DISPONIBLE : avecSigne(v, `${decimal(v, 0)} j`);
const note = (v: number | null): string => (v === null ? NON_DISPONIBLE : decimal(v, 1));
const noteSignee = (v: number | null): string =>
  v === null ? NON_DISPONIBLE : avecSigne(v, decimal(v, 1));
const montant = (v: number | null, devise: Devise): string =>
  v === null ? NON_DISPONIBLE : montantAffiche(v, devise);
const montantSigne = (v: number | null, devise: Devise): string =>
  v === null ? NON_DISPONIBLE : avecSigne(v, montantAffiche(v, devise));

const tableau = (colonnes: string[], lignes: string[][], titre?: string): Bloc[] => {
  const b = borner(lignes);
  return [{ type: "tableau", ...(titre ? { titre } : {}), colonnes, lignes: b.lignes }, ...b.note];
};

const evolution = (e: keyof typeof RED_EVOLUTION_CLOTURE_LIBELLES) =>
  RED_EVOLUTION_CLOTURE_LIBELLES[e];

function sectionSynthese(c: RedClotureContenu, version: number, valideLe: string): Section {
  return section("Synthèse", [
    paragraphe(
      `Bilan de clôture, version ${version}, validé le ${dateAffichee(valideLe)}. Situation arrêtée au ${dateAffichee(c.date_reference)}, comparée à l'ouverture du dossier.`,
    ),
    {
      type: "indicateurs",
      elements: [
        { libelle: "Indicateurs en amélioration", valeur: entier(c.synthese.ameliorations) },
        { libelle: "Indicateurs en dégradation", valeur: entier(c.synthese.degradations) },
        { libelle: "Indicateurs stables", valeur: entier(c.synthese.stables) },
        { libelle: "Indicateurs non comparables", valeur: entier(c.synthese.non_comparables) },
      ],
    },
  ]);
}

function sectionRatios(c: RedClotureContenu): Section {
  const ouverture = c.exercice_ouverture === null ? NON_DISPONIBLE : String(c.exercice_ouverture);
  const fin = c.exercice_fin === null ? NON_DISPONIBLE : String(c.exercice_fin);
  const lignes = c.ratios.map((r) => {
    const formater = r.unite === "jours" ? jours : pb;
    const variation = r.unite === "jours" ? joursSigne : pbSigne;
    return [
      RED_RATIO_LIBELLES[r.cle],
      formater(r.ouverture),
      formater(r.fin),
      variation(r.variation),
      evolution(r.evolution),
    ];
  });
  return section("Ratios financiers", [
    paragraphe(`Exercice d'ouverture : ${ouverture}. Exercice de fin : ${fin}.`),
    ...tableau(["Ratio", "Ouverture", "Fin", "Variation", "Évolution"], lignes),
  ]);
}

function sectionAlerteUrgence(c: RedClotureContenu): Section {
  const a = c.alerte;
  const u = c.urgence;
  const instantAlerte = (i: RedClotureContenu["alerte"]["ouverture"]) =>
    i === null
      ? NON_DISPONIBLE
      : `${i.score === null ? NON_DISPONIBLE : entier(i.score)} (${RED_NIVEAU_ALERTE_LIBELLES[i.niveau]})`;
  const instantUrgence = (i: RedClotureContenu["urgence"]["ouverture"]) =>
    i === null ? NON_DISPONIBLE : RED_VOYANT_LIBELLES[i.voyant];
  return section("Alerte et urgence", [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Score d'alerte à l'ouverture", valeur: instantAlerte(a.ouverture) },
        {
          libelle: "Score d'alerte de fin",
          valeur: instantAlerte(a.fin),
          detail: `Variation ${entierSigne(a.variation_points)} point(s) — ${evolution(a.evolution)}`,
        },
        { libelle: "Voyant d'urgence à l'ouverture", valeur: instantUrgence(u.ouverture) },
        {
          libelle: "Voyant d'urgence de fin",
          valeur: instantUrgence(u.fin),
          detail: `Domaines au rouge : ${entier(u.ouverture?.domaines_rouges ?? null)} puis ${entier(u.fin?.domaines_rouges ?? null)} — ${evolution(u.evolution)}`,
        },
      ],
    },
  ]);
}

function sectionTresorerie(c: RedClotureContenu): Section {
  const t = c.tresorerie;
  const d = c.devise;
  return section("Trésorerie à 13 semaines", [
    ...tableau(
      ["Indicateur", "Prévision initiale", "Projection actuelle", "Variation"],
      [
        [
          "Semaines sous le seuil de tension",
          entier(t.ouverture?.semaines_tension ?? null),
          entier(t.fin?.semaines_tension ?? null),
          entierSigne(t.variation_semaines_tension),
        ],
        [
          "Besoin de financement",
          montant(t.ouverture?.besoin_financement ?? null, d),
          montant(t.fin?.besoin_financement ?? null, d),
          montantSigne(t.variation_besoin_financement, d),
        ],
        [
          "Solde minimum",
          montant(t.ouverture?.solde_minimum ?? null, d),
          montant(t.fin?.solde_minimum ?? null, d),
          NON_DISPONIBLE,
        ],
      ],
    ),
    paragraphe(`Évolution d'ensemble : ${evolution(t.evolution)}.`),
  ]);
}

function sectionPlan(c: RedClotureContenu): Section {
  const p = c.plan;
  const d = c.devise;
  const volet = (nom: string, v: typeof p.par_volet.quick_win) => [
    nom,
    entier(v.total),
    entier(v.terminees),
    entier(v.abandonnees),
    entier(v.en_retard),
    pb(v.avancement_pb),
  ];
  return section("Plan de redressement", [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Avancement du plan", valeur: pb(p.avancement_pb) },
        {
          libelle: "Actions terminées",
          valeur: entier(p.terminees),
          detail: `sur ${entier(p.total)}`,
        },
        { libelle: "Actions en retard", valeur: entier(p.en_retard) },
        { libelle: "Actions au plan validé", valeur: entier(p.actions_au_plan_valide) },
      ],
    },
    ...tableau(
      ["Volet", "Actions", "Terminées", "Abandonnées", "En retard", "Avancement"],
      [
        volet(RED_VOLET_LIBELLES.quick_win, p.par_volet.quick_win),
        volet(RED_VOLET_LIBELLES.restructuration, p.par_volet.restructuration),
      ],
    ),
    {
      type: "indicateurs",
      elements: [
        { libelle: "Actions avec levier", valeur: entier(p.leviers.actions_avec_levier) },
        {
          libelle: "Impact de trésorerie retenu",
          valeur: montantSigne(p.leviers.impact_tresorerie_unique_retenu, d),
          detail: `dont réalisé : ${montantSigne(p.leviers.impact_tresorerie_unique_realise, d)}`,
        },
        {
          libelle: "Impact annuel sur le résultat retenu",
          valeur: montantSigne(p.leviers.impact_resultat_annuel_retenu, d),
          detail: `dont réalisé : ${montantSigne(p.leviers.impact_resultat_annuel_realise, d)}`,
        },
      ],
    },
  ]);
}

function sectionCreanciers(c: RedClotureContenu): Section {
  const k = c.creanciers;
  const d = c.devise;
  return section("Créanciers et accords", [
    {
      type: "indicateurs",
      elements: [
        { libelle: "Créanciers suivis", valeur: entier(k.nombre) },
        { libelle: "Encours initial", valeur: montant(k.encours_initial, d) },
        {
          libelle: "Encours restant",
          valeur: montant(k.encours_restant, d),
          detail: `Apurement : ${pbSigne(k.apurement_pb)}`,
        },
        { libelle: "Montant échu", valeur: montant(k.echu, d) },
        { libelle: "Remises obtenues", valeur: montant(k.remises_obtenues, d) },
        { libelle: "Total payé", valeur: montant(k.total_paye, d) },
      ],
    },
    ...tableau(
      ["Accords", "Nombre"],
      [
        ["Accords conclus", entier(k.accords.total)],
        ["Respectés", entier(k.accords.respectes)],
        ["Soldés", entier(k.accords.soldes)],
        ["En retard", entier(k.accords.en_retard)],
        ["Rompus", entier(k.accords.rompus)],
        ["Tenus (respectés ou soldés)", `${entier(k.accords.tenus)} (${pb(k.accords.tenus_pb)})`],
      ],
    ),
  ]);
}

function sectionConformite(c: RedClotureContenu): Section {
  const l = c.checklists;
  return section("Covenants et check-lists", [
    {
      type: "indicateurs",
      elements: [
        {
          libelle: "Covenants en défaut",
          valeur:
            c.covenants.en_defaut === null
              ? "Aucun covenant défini"
              : entier(c.covenants.en_defaut),
        },
        {
          libelle: "Check-lists actives",
          valeur: entier(l.nombre),
          detail: `dont complètes : ${entier(l.completes)}`,
        },
        { libelle: "Complétude moyenne", valeur: pb(l.completude_moyenne_pb) },
        {
          libelle: "Conformité moyenne",
          valeur: pb(l.conformite_moyenne_pb),
          detail: `Minimale : ${pb(l.conformite_minimale_pb)}`,
        },
      ],
    },
  ]);
}

function sectionReNotation(c: RedClotureContenu): Section {
  const n = c.renotation;
  const version = (v: typeof n.premiere) =>
    v === null
      ? [NON_DISPONIBLE, NON_DISPONIBLE, NON_DISPONIBLE]
      : [`Version ${v.numero}`, note(v.score_dixiemes), v.classe ?? NON_DISPONIBLE];
  const blocs: Bloc[] = [paragraphe(`${RED_STATUT_RENOTATION_LIBELLES[n.statut]}.`)];
  if (n.premiere || n.derniere) {
    blocs.push(
      ...tableau(
        ["Notation", "Version", "Note sur 100", "Classe"],
        [
          ["Première version publiée", ...version(n.premiere)],
          ["Dernière version publiée", ...version(n.derniere)],
        ],
      ),
    );
  }
  if (n.statut === "compare") {
    blocs.push({
      type: "indicateurs",
      elements: [
        { libelle: "Écart de note", valeur: noteSignee(n.ecart_dixiemes) },
        { libelle: "Classe", valeur: RED_CHANGEMENT_CLASSE_LIBELLES[n.changement_classe] },
      ],
    });
  }
  return section("Re-notation", blocs);
}

async function sectionCauses(db: Db, dossierId: string): Promise<Section> {
  const causes = await causesValidees(db, dossierId);
  if (!causes) {
    return section("Causes racines", [
      paragraphe("Aucune cartographie validée par un consultant."),
    ]);
  }
  return section("Causes racines validées", [
    paragraphe(
      `Cartographie validée (version ${causes.version}). Elle consigne des hypothèses qualitatives retenues par le consultant.`,
    ),
    ...causes.causes.flatMap((x): Bloc[] => [
      paragraphe(
        `${RED_DOMAINE_LIBELLES[x.domaine]} — ${x.libelle}${x.confiance ? ` (${RED_NIVEAU_CONFIANCE_CAUSE_LIBELLES[x.confiance]})` : ""}`,
      ),
      paragraphe(x.description),
    ]),
  ]);
}

function sectionControles(c: RedClotureContenu): Section {
  return section("Contrôles de complétude", [
    liste(c.controles.map((x) => `${x.satisfait ? "Satisfait" : "Non satisfait"} — ${x.libelle}`)),
  ]);
}

/**
 * Contenu du rapport d'un bilan VALIDÉ : 404 si le dossier est invisible, 409
 * RED_CLOTURE_NON_VALIDEE si le bilan n'est pas validé (doublé en base, MPR05).
 */
export async function rapportCloture(
  db: Db,
  auth: Auth,
  clotureId: string,
  aujourdhui: string,
): Promise<{ rapport: Rapport; source: SourceCloture }> {
  const { acces, ligne } = await clotureVisible(db, auth, clotureId);
  if (ligne.statut !== "valide" || !ligne.valide_le) {
    throw new AppError(
      409,
      "RED_CLOTURE_NON_VALIDEE",
      "Seul un bilan de clôture validé se rend en rapport.",
    );
  }
  const contenu = contenuLu(ligne.contenu);
  const entete = await lireEnteteMission(db, acces.mission.id);
  const valideLe =
    ligne.valide_le instanceof Date ? ligne.valide_le.toISOString() : String(ligne.valide_le);
  const sections: Section[] = [
    sectionSynthese(contenu, ligne.version, valideLe),
    sectionRatios(contenu),
    sectionAlerteUrgence(contenu),
    sectionTresorerie(contenu),
    sectionPlan(contenu),
    sectionCreanciers(contenu),
    sectionConformite(contenu),
    sectionReNotation(contenu),
    await sectionCauses(db, acces.dossier.id),
    sectionControles(contenu),
  ];
  return {
    source: { missionId: acces.mission.id, clotureId: ligne.id, version: ligne.version },
    rapport: {
      titre: "Rapport de clôture du redressement",
      sous_titre: sousTitreRapport(acces.dossier.intitule, entete.client),
      emetteur: tronquer(entete.cabinet, PLAFONDS_MODELE.longueurTitre),
      statut: "valide",
      genere_le: aujourdhui,
      confidentiel: true,
      sections: sections.slice(0, PLAFONDS_MODELE.sections),
    },
  };
}

/* ----- Liste des rapports d'un bilan ----- */

const CLE_TRI = `to_char(r.genere_le AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US')`;

/**
 * Rapports d'un bilan, plus récent d'abord. L'appelant a déjà contrôlé la visibilité du dossier ;
 * le niveau « red » est revérifié (jamais la clé de stockage ; fichiers supprimés ou purgés exclus).
 */
export async function listerRapportsCloture(
  db: Db,
  auth: Auth,
  clotureId: string,
  q: { limite: number; curseur?: string | undefined },
): Promise<RedClotureRapportsVue> {
  if (!peutLireNiveau(auth.roles, "red")) return { elements: [], curseur_suivant: null };
  const apres = decoderCurseur(q.curseur);
  const r = await db.query(
    `SELECT ${COLONNES_RAPPORT}, f.id AS fichier_id, f.nom_origine AS nom, f.type_mime,
       f.taille, f.sha256, f.envoye_par, f.cree_le, ${CLE_TRI} AS cle_tri
     FROM rapports_mission r JOIN fichiers f ON f.id = r.fichier_id
     WHERE r.red_cloture_id = $1 AND r.niveau = 'red'
       AND NOT EXISTS (SELECT 1 FROM fichiers_suppressions s WHERE s.fichier_id = f.id)
       AND ($2::text IS NULL OR (${CLE_TRI}, r.id) < ($2, $3::uuid))
     ORDER BY cle_tri DESC, r.id DESC LIMIT $4`,
    [clotureId, apres?.[0] ?? null, apres?.[1] ?? null, q.limite + 1],
  );
  type Ligne = Record<string, unknown> & { cle_tri: string; id: string };
  const page = paginer(r.rows as Ligne[], q.limite);
  return {
    elements: page.elements.map(
      (l) =>
        ({
          id: l.id,
          mission_id: l.mission_id,
          modele: l.modele,
          format: l.format,
          statut: l.statut,
          niveau: l.niveau,
          red_cloture_id: l.red_cloture_id,
          version_source: l.version_source,
          genere_par: l.genere_par,
          genere_le: l.genere_le,
          fichier: vueFichier({ ...l, id: l.fichier_id }),
        }) as unknown as RedClotureRapportVue,
    ),
    curseur_suivant: page.curseur_suivant,
  };
}
