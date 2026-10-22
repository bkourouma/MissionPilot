import type { Metadata } from "next";
import { aPermission } from "@missionpilot/shared";
import {
  ActionsRecommandation,
  FormulaireRecommandation,
} from "../../../../components/connaissances/EfficaciteFormulaires";
import {
  CHEMIN_EFFICACITE,
  libelleContexte,
  libelleMiseEnOeuvre,
  libelleScore,
  libelleScoreRecommandation,
  libelleStatutEfficacite,
  tonaliteStatutEfficacite,
  type OptionsMission,
  type RecommandationResume,
  type ReponseScores,
} from "../../../../components/connaissances/efficacite-outils";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Efficacité des recommandations" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Efficacité des recommandations (CAP-03) : initiative recommandée, mise en oeuvre, effet mesuré
 * sur le KPI, score d'efficacité par contexte (type d'initiative, secteur, taille). Les scores
 * viennent du moteur ; sous le seuil d'observations, aucun score ni effectif n'est affiché. Les agrégats ne nomment aucun client.
 */
export default async function PageEfficacite({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await exigerPermission("connaissance.lire");
  const roles = utilisateur.roles;
  const peutEcrire =
    aPermission(roles, "mission.planifier") &&
    aPermission(roles, "plan.lire") &&
    aPermission(roles, "kpi.lire");
  const brut = (await searchParams).mission;
  const missionId = typeof brut === "string" && UUID.test(brut) ? brut : null;

  const [scores, liste, missions, options] = await Promise.all([
    chargerServeur<ReponseScores>(`${CHEMIN_EFFICACITE}/scores`),
    chargerServeur<{ elements: RecommandationResume[] }>(`${CHEMIN_EFFICACITE}/recommandations`),
    peutEcrire
      ? chargerServeur<{ elements: { id: string; intitule: string }[] }>("/api/missions?limite=100")
      : Promise.resolve(null),
    peutEcrire && missionId
      ? chargerServeur<OptionsMission>(`${CHEMIN_EFFICACITE}/missions/${missionId}/options`)
      : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page mp-connaissances">
      <EnteteDePage
        titre="Efficacité des recommandations"
        soustitre="Ce qui a réellement amélioré les KPI : recommandation, mise en oeuvre, effet mesuré, score par contexte."
      />
      <Carte titre="Scores par contexte" niveauTitre={2}>
        {!scores.ok ? (
          <EtatErreur
            titre="Les scores n'ont pas pu être chargés."
            message={scores.message}
            hrefReessayer="/connaissances/efficacite"
          />
        ) : scores.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune recommandation suivie pour l'instant." />
        ) : (
          <>
            <p className="mp-texte-petit mp-texte-doux">
              Un score n&apos;est affiché qu&apos;à partir de {scores.donnees.seuil} recommandations
              évaluées dans le contexte. {scores.donnees.evaluees} évaluée(s) sur{" "}
              {scores.donnees.recommandations_suivies} suivie(s).
            </p>
            <Tableau
              legende="Scores d'efficacité par contexte"
              cleLigne={(c) => c.cle}
              lignes={scores.donnees.elements}
              colonnes={[
                { cle: "contexte", entete: "Contexte", rendu: (c) => libelleContexte(c) },
                {
                  cle: "effectif",
                  entete: "Effectif",
                  alignement: "droite",
                  rendu: (c) => (c.effectif === null ? "—" : c.effectif),
                },
                {
                  cle: "score_moyen",
                  entete: "Score moyen",
                  rendu: (c) => libelleScore(c, scores.donnees.seuil),
                },
                {
                  cle: "mediane",
                  entete: "Médiane",
                  alignement: "droite",
                  rendu: (c) => (c.mediane === null ? "—" : `${c.mediane} / 100`),
                },
              ]}
            />
          </>
        )}
      </Carte>

      <Carte titre="Recommandations" niveauTitre={2}>
        {!liste.ok ? (
          <EtatErreur
            titre="Les recommandations n'ont pas pu être chargées."
            message={liste.message}
            hrefReessayer="/connaissances/efficacite"
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune recommandation enregistrée." />
        ) : (
          <ul className="mp-connaissances__resultats">
            {liste.donnees.elements.map((r) => (
              <li key={r.id}>
                <Carte
                  titre={r.libelle ?? "Recommandation d'une mission hors de votre périmètre"}
                  niveauTitre={3}
                  actions={
                    <BadgeStatut tonalite={tonaliteStatutEfficacite(r.statut)}>
                      {libelleStatutEfficacite(r.statut)}
                    </BadgeStatut>
                  }
                >
                  <p className="mp-texte-petit">
                    {r.type_initiative}
                    {r.mission_intitule ? ` · ${r.mission_intitule}` : ""}
                    {libelleMiseEnOeuvre(r.mise_en_oeuvre_le)}
                  </p>
                  <p>Score d&apos;efficacité : {libelleScoreRecommandation(r)}</p>
                  {peutEcrire && r.visible ? (
                    <ActionsRecommandation id={r.id} statut={r.statut} />
                  ) : null}
                </Carte>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {peutEcrire ? (
        <Carte titre="Recommander une initiative" niveauTitre={2}>
          <form method="get" className="mp-formulaire" aria-label="Choix de la mission">
            {missions?.ok ? (
              <Select
                libelle="Mission"
                name="mission"
                invite="Choisir une mission"
                defaultValue={missionId ?? ""}
                options={missions.donnees.elements.map((m) => ({
                  valeur: m.id,
                  libelle: m.intitule,
                }))}
              />
            ) : null}
            <div className="mp-actions-formulaire">
              <Bouton type="submit" variante="secondaire">
                Charger les KPI et le plan
              </Bouton>
            </div>
          </form>
          {options && !options.ok ? (
            <EtatErreur
              titre="Les KPI de la mission n'ont pas pu être chargés."
              message={options.message}
              hrefReessayer={`/connaissances/efficacite?mission=${missionId}`}
            />
          ) : options?.ok && missionId ? (
            options.donnees.kpi.length === 0 ? (
              <EtatVide titre="Cette mission n'a aucun KPI actif à observer." />
            ) : (
              <FormulaireRecommandation missionId={missionId} options={options.donnees} />
            )
          ) : null}
        </Carte>
      ) : null}
    </div>
  );
}
