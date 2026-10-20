import { syntheseChaineDeValeur, type RecommandationNote } from "@missionpilot/engines";
import { noteBaseSchema, type NoteBase } from "@missionpilot/shared";
import { ZodError } from "zod";
import type { Db } from "../db/pool.js";
import { AppError } from "../errors.js";
import type { MissionAcces } from "../missions/acces.js";
import { aujourdhui } from "../missions/outils.js";
import { vuePreuve } from "../preuves/vues.js";
import type { DossierLu } from "./acces.js";
import { listerAjustements } from "./ajustements.js";
import { recoupement } from "./dimensionnement.js";
import type { ElementCourant } from "./elements.js";
import { chargerEtatDossier, controleNoteDe, type EtatDossier } from "./synthese.js";

/*
 * `base_figee` d'une note (SPEC-3b §9.2) : construite PAR LE SERVEUR à la soumission, depuis les
 * moteurs, dans la transaction de la route et mission verrouillée ; jamais reçue d'un client.
 * Objet validé par `noteBaseSchema` (`.strict()`) avant l'insertion et à la lecture par le rendu.
 * Toute valeur numérique vient d'un moteur : l'API ne fait que copier. Aucun verbatim nominatif
 * (les extraits sont ceux de `vuePreuve(…, false)` : masqués pour tous), aucun nom de personne,
 * aucune donnée financière interne (FIN-02).
 */

const RANG_LECTURE: Record<string, number> = { fragile: 0, etayee: 1, solide: 2 };

/** La plus faible lecture parmi les assertions citées (figées dans le verdict validé). */
function soliditeMin(
  citees: readonly { lecture: string }[],
): "solide" | "etayee" | "fragile" | null {
  let min: string | null = null;
  for (const c of citees) {
    if (min === null || (RANG_LECTURE[c.lecture] ?? 0) < (RANG_LECTURE[min] ?? 0)) min = c.lecture;
  }
  return min as "solide" | "etayee" | "fragile" | null;
}

function detailAnalyses(e: EtatDossier) {
  // Annexe numérotée des sources : preuves liées aux points d'analyse, extraits masqués pour tous.
  const numeros = new Map<string, number>();
  const sources: NoteBase["detail"]["sources"] = [];
  const renvoisDe = new Map<string, number[]>();
  for (const p of e.points) {
    const assertionId = p.assertion_id as string;
    const mes: number[] = [];
    for (const lien of e.registre.etat.liens.filter((l) => l.assertion_id === assertionId)) {
      const preuve = e.registre.etat.preuves.get(lien.preuve_id);
      if (!preuve) continue;
      let n = numeros.get(preuve.id);
      if (n === undefined) {
        if (sources.length >= 1_000) continue;
        n = sources.length + 1;
        numeros.set(preuve.id, n);
        const vue = vuePreuve(preuve, false);
        sources.push({
          n,
          type: vue.type_source,
          source: vue.source_precise,
          date: vue.date_preuve as string,
          fiabilite: vue.fiabilite as "A" | "B" | "C" | "D",
          extrait: vue.extrait,
          masque: vue.masque,
        });
      }
      if (mes.length < 50) mes.push(n);
    }
    renvoisDe.set(p.id, mes);
  }
  const analyses = e.points.map((p: ElementCourant) => ({
    analyse: p.analyse as NoteBase["detail"]["analyses"][number]["analyse"],
    categorie: p.categorie as string,
    enonce: e.registre.assertions.get(p.assertion_id as string)?.enonce ?? "",
    niveau: p.niveau as NoteBase["detail"]["analyses"][number]["niveau"],
    lecture: (e.registre.etat.evaluations.get(p.assertion_id as string)?.solidite.lecture ??
      null) as "solide" | "etayee" | "fragile" | null,
    renvois: renvoisDe.get(p.id) ?? [],
  }));
  return { analyses, sources };
}

/**
 * Base figée du dossier pour la recommandation donnée : objet validé, plus le contrôle du moteur
 * (bloquants, avertissements) dont dépend la soumission.
 */
export async function construireBaseNote(
  db: Db,
  mission: MissionAcces,
  dossier: DossierLu,
  recommandation: RecommandationNote,
  nbConditions: number,
): Promise<{ base: NoteBase; bloquants: readonly string[]; soumissible: boolean }> {
  const e = await chargerEtatDossier(db, mission, dossier);
  const controle = controleNoteDe(e, recommandation, nbConditions);
  const ajustements = await listerAjustements(db, dossier.id);
  const etapes = new Map(e.etapes.map((x) => [x.id, x.libelle as string]));
  const chaine = syntheseChaineDeValeur(
    e.etapes.map((x) => ({
      id: x.id,
      ordre: x.ordre as number,
      partCoutBp: x.part_cout_bp,
      partMargeBp: x.part_marge_bp,
    })),
  );
  const rangs = new Map(chaine.etapes.map((x) => [x.id, x.rangMarge]));
  const dernierFiltrage = e.filtrages[0];
  const detail = detailAnalyses(e);
  const bloquantes = dernierFiltrage ? dernierFiltrage.bloquantes : 0;
  const lectures = { solides: 0, etayees: 0, fragiles: 0 };
  for (const id of e.idsAssertions) {
    const a = e.registre.assertions.get(id);
    const s = e.registre.etat.evaluations.get(id)?.solidite;
    if (!a || a.statut === "abandonnee" || !s) continue;
    if (s.lecture === "solide") lectures.solides += 1;
    else if (s.lecture === "etayee") lectures.etayees += 1;
    else lectures.fragiles += 1;
  }
  const brut = {
    version_base: 1,
    genere_le: aujourdhui(),
    cadrage: {
      titre: e.cadrage.titre,
      secteur_code: e.cadrage.secteur_code,
      secteur_libelle: e.libelles.secteur_libelle,
      filiere_code: e.cadrage.filiere_code,
      filiere_libelle: e.libelles.filiere_libelle,
      pays_code: e.cadrage.pays_code,
      pays_libelle: e.libelles.pays_libelle,
      cible_nom: e.cadrage.cible_nom,
      type_operation: e.cadrage.type_operation,
      devise: e.cadrage.devise,
      date_operation: e.cadrage.date_operation,
      question_investissement: e.cadrage.question_investissement,
      perimetre: e.cadrage.perimetre,
    },
    hypotheses: e.arbre.hypotheses
      .filter((h) => !h.courant.retire)
      .map((h) => ({
        id: h.courant.id,
        parent_id: h.courant.parent_id,
        libelle: h.courant.libelle,
        critere: h.courant.critere,
        verdict: h.etat.enVigueur?.verdict ?? null,
        indication_moteur: h.etat.enVigueur?.indication_moteur ?? null,
        nb_citees: h.etat.enVigueur?.assertions_citees.length ?? 0,
        // Solidité COURANTE des sources citées (la photographie du verdict sert de repli).
        solidite_min: soliditeMin(
          (h.etat.enVigueur?.assertions_citees ?? []).map((c) => ({
            lecture: e.registre.etat.evaluations.get(c.assertion_id)?.solidite.lecture ?? c.lecture,
          })),
        ),
      })),
    risques: e.risques.map((r) => ({
      id: r.id,
      famille: r.categorie,
      niveau: r.niveau,
      libelle: r.libelle,
      etape: r.etape_id === null ? null : (etapes.get(r.etape_id) ?? null),
      lecture: e.registre.etat.evaluations.get(r.assertion_id as string)?.solidite.lecture ?? null,
    })),
    marche: {
      present: e.dimensionnements.length > 0,
      dimensionnements: e.dimensionnements.map((d) => ({
        methode: d.methode,
        libelle: d.libelle,
        resultat: d.resultat.resultat,
        avant_ajustement: d.resultat.avant_ajustement,
        couverture: d.resultat.couverture,
        parametres: (
          d.parametres as {
            code: string;
            bas: number;
            base: number;
            haut: number;
            source: { type: string } | null;
          }[]
        ).map((p) => ({
          code: p.code,
          bas: p.bas,
          base: p.base,
          haut: p.haut,
          source: p.source?.type ?? null,
        })),
      })),
      recoupement: recoupement(e.dimensionnements),
    },
    filtrage_es: {
      realise: dernierFiltrage !== undefined,
      liste:
        dernierFiltrage === undefined
          ? null
          : { nom: dernierFiltrage.ligne.liste_nom, version: dernierFiltrage.ligne.liste_version },
      // Le dernier filtrage n'est pas compté (e.filtrages : plus récent d'abord).
      filtrages_anterieurs: Math.max(0, e.filtrages.length - 1),
      // Confirmées dans un filtrage antérieur, non levées dans le dernier : bloquantes, donc déjà
      // comptées dans `exclusions_bloquantes` ; elles ne figurent pas dans `touches`.
      exclusions_anterieures_non_levees: dernierFiltrage ? dernierFiltrage.anterieures.length : 0,
      niveau_global: e.syntheseEs?.niveauGlobal ?? null,
      bloquant: bloquantes > 0,
      touches:
        dernierFiltrage === undefined
          ? []
          : dernierFiltrage.ligne.resultat.touches.map((t) => ({
              regle: t.regle,
              libelle: t.libelle ?? t.regle,
              decision:
                dernierFiltrage.decisions.find((d) => d.regle_code === t.regle)?.decision ?? null,
            })),
      themes: (dernierFiltrage?.ligne.themes ?? []).map((t) => ({
        code: t.code,
        niveau: t.niveau,
        justification: t.justification,
      })),
    },
    plan_100j: {
      present: e.actions.length > 0,
      total: e.plan.synthese.total,
      terminees: e.plan.synthese.terminees,
      par_phase: e.plan.synthese.parPhase,
      actions: e.actions.map((a) => {
        const s = e.plan.synthese.actions.find((x) => x.id === a.id);
        return {
          libelle: a.libelle,
          jour_debut: a.jour_debut,
          jour_fin: a.jour_fin,
          statut: a.statut_action,
          date_debut: s?.dateDebut ?? null,
          date_fin: s?.dateFin ?? null,
        };
      }),
    },
    ajustements: ajustements
      .slice()
      .reverse()
      .map((a) => ({
        cible_type: a.cible_type,
        champ: a.champ,
        avant: a.valeur_avant,
        apres: a.valeur_apres,
        motif: a.motif,
        cree_le: a.cree_le.toISOString(),
      })),
    sources: { assertions: lectures, anomalies: e.anomalies.length },
    detail: {
      analyses: detail.analyses,
      chaine: chaine.etapes.map((x) => ({
        ordre: x.ordre,
        libelle: etapes.get(x.id) ?? "",
        part_cout_bp: x.partCoutBp,
        part_marge_bp: x.partMargeBp,
        rang_marge: rangs.get(x.id) ?? null,
      })),
      signaux: e.signaux
        .filter((s) => s.etat_constat !== null)
        .map((s) => ({
          libelle: s.libelle,
          famille: s.famille,
          gravite: s.gravite_indicative,
          etat: s.etat_constat,
        })),
      sensibilite: e.dimensionnements.flatMap((d) =>
        d.resultat.sensibilite.map((s) => ({
          methode: d.methode,
          code: s.code,
          resultat_bas: s.resultat_bas,
          resultat_haut: s.resultat_haut,
          amplitude: s.amplitude,
          part_amplitude_bp: s.part_amplitude_bp,
        })),
      ),
      sources: detail.sources,
    },
    bloquants: [...controle.bloquants],
    avertissements: [...controle.avertissements],
    exclusions_bloquantes: bloquantes,
  };
  let base: NoteBase;
  try {
    base = noteBaseSchema.parse(brut);
  } catch (erreur) {
    if (!(erreur instanceof ZodError)) throw erreur;
    throw new AppError(
      409,
      "NOTE_BASE_INVALIDE",
      "Le dossier ne peut pas être figé : une donnée dépasse les limites de la note au comité.",
    );
  }
  return { base, bloquants: controle.bloquants, soumissible: controle.soumissible };
}
