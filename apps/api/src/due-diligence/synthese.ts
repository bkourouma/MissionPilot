import {
  controlerNoteComite,
  syntheseChaineDeValeur,
  syntheseRisquesDd,
  type ControleNote,
  type RecommandationNote,
  type SyntheseEs,
  type SyntheseRisquesDd,
} from "@missionpilot/engines";
import { PLAFONDS_DD } from "@missionpilot/shared";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import type { MissionAcces } from "../missions/acces.js";
import type { DossierLu } from "./acces.js";
import { listerAjustements } from "./ajustements.js";
import { entreesChaine } from "./chaine.js";
import {
  dimensionnementsDuDossier,
  recoupement,
  type DimensionnementCourant,
} from "./dimensionnement.js";
import { cadrageCourant, type CadrageCourant } from "./dossiers.js";
import { elementsCourants, type ElementCourant } from "./elements.js";
import { filtragesDuDossier, syntheseDuFiltrage, type FiltrageEvalue } from "./filtrage.js";
import { chargerArbre, type ArbreDuDossier } from "./hypotheses.js";
import { synthesePlan } from "./plan-100-jours.js";
import {
  anomaliesSourcesDuDossier,
  chargerRegistre,
  idsAssertionsDuDossier,
  type RegistreDossier,
} from "./registre.js";
import { entreesRisques } from "./risques.js";
import { signauxDuDossier } from "./signaux.js";
import { libellesDuCadrage, type LibellesCadrage } from "./taxonomie.js";
import {
  vueArbre,
  vueControleNote,
  vuePlan,
  vueSyntheseChaine,
  vueSyntheseEs,
  vueSyntheseRisques,
} from "./vues.js";

/*
 * État calculé d'un dossier (SPEC-3b §8.1 R04, §9.2) : charge UNE FOIS les éléments, le registre
 * des preuves, l'arbre d'hypothèses, le marché, le filtrage E&S, le plan et les signaux, et fait
 * sortir de packages/engines tout ce qui est synthèse. Sert à la synthèse du dossier (R04), au
 * contrôle à blanc de la note et à la base figée de la soumission (`base-note.ts`). Aucun chiffre
 * n'est calculé ici.
 */

export interface EtatDossier {
  cadrage: CadrageCourant;
  libelles: LibellesCadrage;
  points: ElementCourant[];
  etapes: ElementCourant[];
  risques: ElementCourant[];
  actions: ElementCourant[];
  registre: RegistreDossier;
  idsAssertions: Set<string>;
  arbre: ArbreDuDossier;
  dimensionnements: DimensionnementCourant[];
  filtrages: FiltrageEvalue[];
  syntheseEs: SyntheseEs | null;
  syntheseRisques: SyntheseRisquesDd;
  plan: Awaited<ReturnType<typeof synthesePlan>>;
  signaux: Awaited<ReturnType<typeof signauxDuDossier>>;
  anomalies: Awaited<ReturnType<typeof anomaliesSourcesDuDossier>>;
}

export async function chargerEtatDossier(
  db: Db,
  mission: MissionAcces,
  dossier: DossierLu,
): Promise<EtatDossier> {
  const cadrage = await cadrageCourant(db, dossier.id);
  const libelles = await libellesDuCadrage(db, cadrage);
  const points = await elementsCourants(
    db,
    dossier.id,
    "point_analyse",
    PLAFONDS_DD.points_par_dossier,
  );
  const etapes = await elementsCourants(
    db,
    dossier.id,
    "etape_chaine",
    PLAFONDS_DD.etapes_par_dossier,
  );
  const risques = await elementsCourants(db, dossier.id, "risque", PLAFONDS_DD.risques_par_dossier);
  const filtrages = await filtragesDuDossier(db, dossier.id);
  const idsAssertions = new Set(await idsAssertionsDuDossier(db, dossier.id));
  for (const f of filtrages.slice(0, 1)) {
    for (const t of f.ligne.themes) if (t.assertion_id !== null) idsAssertions.add(t.assertion_id);
  }
  const registre = await chargerRegistre(db, mission.id, [...idsAssertions]);
  const arbre = await chargerArbre(db, mission.id, dossier.id, registre);
  const dernier = filtrages[0];
  return {
    cadrage,
    libelles,
    points,
    etapes,
    risques,
    actions: await elementsCourants(db, dossier.id, "action_100j", PLAFONDS_DD.actions_par_dossier),
    registre,
    idsAssertions,
    arbre,
    dimensionnements: await dimensionnementsDuDossier(db, dossier.id),
    filtrages,
    syntheseEs: dernier ? await syntheseDuFiltrage(db, mission.id, dernier, registre) : null,
    syntheseRisques: syntheseRisquesDd(entreesRisques(risques, registre)),
    plan: await synthesePlan(db, dossier.id),
    signaux: await signauxDuDossier(db, dossier.id),
    anomalies: await anomaliesSourcesDuDossier(db, mission.id, idsAssertions),
  };
}

/** Contrôle de la note par le moteur (bloquants, avertissements) pour une recommandation donnée. */
export function controleNoteDe(
  e: EtatDossier,
  recommandation: RecommandationNote,
  nbConditions: number,
): ControleNote {
  const dernier = e.filtrages[0];
  const lies = recoupement(e.dimensionnements);
  return controlerNoteComite({
    recommandation,
    nbConditions,
    hypotheses: e.arbre.hypotheses.map((h) => ({
      id: h.courant.id,
      parentId: h.courant.parent_id,
      retiree: h.courant.retire,
      verdict: h.etat.enVigueur?.verdict ?? null,
    })),
    anomaliesSources: e.anomalies.length,
    exclusionsBloquantes: dernier ? dernier.bloquantes : 0,
    risquesCritiquesFragiles: e.syntheseRisques.aDocumenter.length,
    marche: { present: e.dimensionnements.length > 0, recoupementAlerte: lies?.alerte ?? false },
    incoherencesArbre: e.arbre.arbre.incoherences.length,
  });
}

interface NoteResume {
  id: string;
  titre: string;
  derniere_version: number;
  etat: string;
  recommandation: string;
  nb_conditions: number;
}

/** Dernière note d'un dossier (la plus récente), avec l'état de sa dernière version. */
export async function derniereNote(db: Db, dossierId: string): Promise<NoteResume | null> {
  const r = await db.query(
    `SELECT n.id, n.titre, v.version, v.etat, v.recommandation, cardinality(v.conditions) AS nb
     FROM dd_notes n
       JOIN LATERAL (SELECT * FROM dd_note_versions nv WHERE nv.note_id = n.id
                     ORDER BY nv.version DESC LIMIT 1) v ON true
     WHERE n.dossier_id = $1 ORDER BY n.numero DESC LIMIT 1`,
    [dossierId],
  );
  const l = r.rows[0];
  if (!l) return null;
  return {
    id: l.id,
    titre: l.titre,
    derniere_version: l.version,
    etat: l.etat,
    recommandation: l.recommandation,
    nb_conditions: l.nb,
  };
}

function comptesLectures(e: EtatDossier) {
  const c = { solides: 0, etayees: 0, fragiles: 0 };
  for (const id of e.idsAssertions) {
    const a = e.registre.assertions.get(id);
    const s = e.registre.etat.evaluations.get(id)?.solidite;
    if (!a || a.statut === "abandonnee" || !s) continue;
    if (s.lecture === "solide") c.solides += 1;
    else if (s.lecture === "etayee") c.etayees += 1;
    else c.fragiles += 1;
  }
  return c;
}

/** R04 : synthèse calculée par les moteurs. */
export async function lireSynthese(db: Db, _auth: Auth, mission: MissionAcces, dossier: DossierLu) {
  const e = await chargerEtatDossier(db, mission, dossier);
  const note = await derniereNote(db, dossier.id);
  const ajustements = await listerAjustements(db, dossier.id);
  const lectures = comptesLectures(e);
  const controle = controleNoteDe(
    e,
    (note?.recommandation as RecommandationNote | undefined) ?? "reservee",
    note?.nb_conditions ?? 0,
  );
  const chaine = syntheseChaineDeValeur(entreesChaine(e.etapes));
  return {
    cadrage: {
      titre: e.cadrage.titre,
      secteur_libelle: e.libelles.secteur_libelle,
      filiere_libelle: e.libelles.filiere_libelle,
      pays_libelle: e.libelles.pays_libelle,
      type_operation: e.cadrage.type_operation,
      devise: e.cadrage.devise,
      date_operation: e.cadrage.date_operation,
    },
    compteurs: {
      points: e.points.length,
      etapes: e.etapes.length,
      risques: e.risques.length,
      hypotheses: e.arbre.hypotheses.filter((h) => !h.courant.retire).length,
      actions: e.actions.length,
      dimensionnements: e.dimensionnements.length,
      filtrages: e.filtrages.length,
    },
    sources: {
      solides: lectures.solides,
      etayees: lectures.etayees,
      fragiles: lectures.fragiles,
      anomalies_prv03: e.anomalies.length,
    },
    arbre: vueArbre(e.arbre.arbre),
    chaine: vueSyntheseChaine(chaine),
    risques: vueSyntheseRisques(e.syntheseRisques),
    marche: {
      dimensionnements: e.dimensionnements.map((d) => ({
        id: d.id,
        methode: d.methode,
        libelle: d.libelle,
        version: d.version,
        resultat: d.resultat.resultat,
        couverture: d.resultat.couverture,
      })),
      recoupement: recoupement(e.dimensionnements),
    },
    filtrage_es: e.syntheseEs === null ? null : vueSyntheseEs(e.syntheseEs),
    plan_100j: vuePlan(e.plan.synthese),
    signaux: {
      applicables: e.signaux.length,
      constates: e.signaux.filter((s) => s.etat_constat === "constate").length,
      a_verifier: e.signaux.filter((s) => s.etat_constat === "a_verifier").length,
      sans_constat: e.signaux.filter((s) => s.etat_constat === null).length,
    },
    note:
      note === null
        ? null
        : {
            id: note.id,
            titre: note.titre,
            derniere_version: note.derniere_version,
            etat: note.etat,
          },
    ajustements: { total: ajustements.length },
    controle_note: vueControleNote(controle),
  };
}
