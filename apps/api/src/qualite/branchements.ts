import type { ScoreAjuste } from "@missionpilot/engines";
import type { Auth } from "../auth/contexte.js";
import type { Db } from "../db/pool.js";
import { assertionsFragilesDeMission } from "../preuves/synthese.js";
import type { Rapport } from "../rapports/modele.js";
import { score } from "../rapports/outils.js";
import { ajouterElementsRevue, type ElementRevueEntree } from "./revue.js";
import { assurerSuiviLivrable } from "./suivis.js";
import type { Suivi } from "./donnees.js";

/*
 * Branchements de la qualité (QUA-01 à QUA-03) sur les modules qui produisent un livrable, dans
 * LEUR transaction, sans droit supplémentaire (l'appelant a déjà exigé le sien) :
 * - génération d'un rapport (état d'avancement, notation, plan ; rapports/enregistrement.ts) :
 *   suivi `rapport` du rapport généré (classe minimale R2) ;
 * - soumission en revue et publication d'une notation (notation/notations.ts) : suivi `notation`
 *   de la version (classe minimale R3).
 * Chaque suivi reçoit les éléments de la revue guidée : assertions FRAGILES de la mission
 * (registre des preuves, indice du moteur), CHIFFRES du livrable avec leur source, et
 * RECOMMANDATIONS. Le dépôt est idempotent (clé stable) ; un suivi déjà validé ou signé ne reçoit
 * plus rien (son parcours est clos).
 */

/** Plafonds par dépôt (le relecteur parcourt chaque élément obligatoire). */
export const BRANCHEMENT_MAX = { assertions: 50, chiffres: 60, recommandations: 50 } as const;

/** Bornes du schéma `elementRevueSchema` : libellé 500, source 300, clé 120 caractères. */
const tronquerA = (t: string, max: number) =>
  t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
const tronquer = (t: string) => tronquerA(t, 480);
const tronquerSource = (t: string) => tronquerA(t, 300);
const cle = (t: string) => t.slice(0, 120);

/** Assertions fragiles de la mission (les plus risquées d'abord), éléments obligatoires. */
async function elementsAssertions(db: Db, missionId: string): Promise<ElementRevueEntree[]> {
  const fragiles = await assertionsFragilesDeMission(db, missionId);
  return fragiles.slice(0, BRANCHEMENT_MAX.assertions).map((a, i) => ({
    cle: `assertion:${a.id}`,
    kind: "assertion_fragile",
    libelle: tronquer(
      `${a.enonce}${a.contradiction_non_resolue ? " (contradiction non arbitrée)" : ""}`,
    ),
    ordre: i,
    source: "Registre des preuves : indice de solidité calculé par le moteur",
    source_type: "moteur",
    reference: `assertion:${a.id}`,
  }));
}

/** Dépose les éléments sur un suivi encore ouvert ; sans effet sur un suivi validé ou signé. */
async function deposer(
  db: Db,
  auth: Auth,
  suivi: Suivi,
  elements: readonly ElementRevueEntree[],
): Promise<void> {
  if (elements.length === 0 || suivi.statut === "valide" || suivi.statut === "signe") return;
  await ajouterElementsRevue(
    db,
    auth.cabinetId,
    auth.utilisateurId,
    { suiviId: suivi.id },
    elements,
  );
}

/** Chiffres d'un rapport : blocs « indicateurs », avec leur section comme source. */
export function chiffresDuRapport(rapport: Rapport, prefixe: string): ElementRevueEntree[] {
  const chiffres: ElementRevueEntree[] = [];
  rapport.sections.forEach((section, i) => {
    section.blocs.forEach((bloc, j) => {
      if (bloc.type !== "indicateurs") return;
      bloc.elements.forEach((e, k) => {
        chiffres.push({
          cle: `${prefixe}:chiffre:${i}.${j}.${k}`,
          kind: "chiffre",
          libelle: tronquer(
            `${section.titre} — ${e.libelle} : ${e.valeur}${e.detail ? ` (${e.detail})` : ""}`,
          ),
          ordre: 1000 + chiffres.length,
          source: tronquerSource(
            `Rapport « ${rapport.titre} », section « ${section.titre} » : valeur mise en forme depuis les moteurs MissionPilot`,
          ),
          source_type: "moteur",
        });
      });
    });
  });
  return chiffres.slice(0, BRANCHEMENT_MAX.chiffres);
}

/** Recommandations d'un rapport : initiatives de la feuille de route (plan stratégique). */
export function recommandationsDuRapport(rapport: Rapport, prefixe: string): ElementRevueEntree[] {
  const initiatives = rapport.sections.find((s) => s.titre === "Initiatives");
  const tableau = initiatives?.blocs.find((b) => b.type === "tableau");
  if (!tableau || tableau.type !== "tableau") return [];
  return tableau.lignes.slice(0, BRANCHEMENT_MAX.recommandations).map((l, i) => ({
    cle: `${prefixe}:recommandation:${i}`,
    kind: "recommandation",
    libelle: tronquer(`Initiative recommandée : ${l[0] ?? ""}`),
    ordre: 2000 + i,
  }));
}

/** Rapport généré : suivi `rapport` (R2 au moins) et éléments de revue guidée. */
export async function brancherRapport(
  db: Db,
  auth: Auth,
  p: { missionId: string; rapportId: string; libelle: string; rapport: Rapport },
): Promise<Suivi> {
  const suivi = await assurerSuiviLivrable(db, auth, {
    mission_id: p.missionId,
    type_livrable: "rapport",
    livrable_id: p.rapportId,
    version: 1,
    libelle: tronquer(p.libelle).slice(0, 200),
  });
  const prefixe = `rapport:${p.rapportId}`;
  await deposer(db, auth, suivi, [
    ...(await elementsAssertions(db, p.missionId)),
    ...chiffresDuRapport(p.rapport, prefixe),
    ...recommandationsDuRapport(p.rapport, prefixe),
  ]);
  return suivi;
}

/** Chiffres d'une version de notation : score global et score retenu de chaque dimension. */
function chiffresNotation(
  notationId: string,
  numero: number,
  etat: ScoreAjuste,
): ElementRevueEntree[] {
  const prefixe = `notation:${notationId}:v${numero}`;
  const source = `Moteur de notation (notation.score_global), version ${numero} ; ajustements motivés rejoués par le moteur`;
  return [
    {
      cle: `${prefixe}:score`,
      kind: "chiffre",
      libelle:
        etat.score === null
          ? "Score global : non notable"
          : `Score global : ${score(etat.score)} / 100 (classe ${etat.classe ?? "—"})`,
      ordre: 1000,
      source,
      source_type: "moteur",
    },
    ...etat.dimensions.slice(0, BRANCHEMENT_MAX.chiffres - 1).map((d, i) => ({
      cle: cle(`${prefixe}:dimension:${d.dimension}`),
      kind: "chiffre" as const,
      libelle: tronquer(
        `${d.libelle} : ${d.score === null ? "non notable" : `${score(d.score)} / 100`}`,
      ),
      ordre: 1001 + i,
      source,
      source_type: "moteur" as const,
    })),
  ];
}

/**
 * Version de notation soumise ou publiée : suivi `notation` (R3 au moins) et éléments de revue
 * guidée (assertions fragiles, scores, recommandations candidates de la méthode de la mission).
 */
export async function brancherNotation(
  db: Db,
  auth: Auth,
  p: {
    missionId: string;
    notationId: string;
    numero: number;
    etat: ScoreAjuste;
    recommandations: readonly string[];
  },
): Promise<Suivi> {
  const suivi = await assurerSuiviLivrable(db, auth, {
    mission_id: p.missionId,
    type_livrable: "notation",
    livrable_id: p.notationId,
    version: p.numero,
    libelle: `Notation — version ${p.numero}`,
  });
  const prefixe = `notation:${p.notationId}:v${p.numero}`;
  await deposer(db, auth, suivi, [
    ...(await elementsAssertions(db, p.missionId)),
    ...chiffresNotation(p.notationId, p.numero, p.etat),
    ...p.recommandations.slice(0, BRANCHEMENT_MAX.recommandations).map((code, i) => ({
      cle: cle(`${prefixe}:recommandation:${code}`),
      kind: "recommandation" as const,
      libelle: tronquer(`Recommandation candidate de la méthode : ${code}`),
      ordre: 2000 + i,
      source: "Règles de modulation de la méthode de la mission",
      source_type: "moteur" as const,
    })),
  ]);
  return suivi;
}
