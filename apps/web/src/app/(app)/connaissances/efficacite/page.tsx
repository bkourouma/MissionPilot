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
import { Calcule } from "../../../../components/ui/Calcule";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { Select } from "../../../../components/ui/Select";
import { Tableau } from "../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../lib/api-serveur";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Efficacité des recommandations", "Recommendation effectiveness") };
}

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
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
        titre={t("Efficacité des recommandations", "Recommendation effectiveness")}
        soustitre={t(
          "Ce qui a réellement amélioré les KPI : recommandation, mise en oeuvre, effet mesuré, score par contexte.",
          "What actually improved the KPIs: recommendation, implementation, measured effect, score per context.",
        )}
      />
      <Carte
        titre={t("Scores par contexte", "Scores per context")}
        niveauTitre={2}
        actions={<Calcule />}
      >
        {!scores.ok ? (
          <EtatErreur
            titre={t("Les scores n'ont pas pu être chargés.", "The scores could not be loaded.")}
            message={scores.message}
            hrefReessayer="/connaissances/efficacite"
          />
        ) : scores.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucune recommandation suivie pour l'instant.",
              "No recommendation tracked yet.",
            )}
          >
            <p>
              {t(
                "Les scores apparaissent quand des initiatives recommandées sont mises en oeuvre puis mesurées sur un KPI.",
                "Scores appear once recommended initiatives are implemented and then measured on a KPI.",
              )}
            </p>
          </EtatVide>
        ) : (
          <>
            <p className="mp-texte-petit mp-texte-doux">
              {t(
                `Un score n'est affiché qu'à partir de ${scores.donnees.seuil} recommandations évaluées dans le contexte. ${scores.donnees.evaluees} évaluée(s) sur ${scores.donnees.recommandations_suivies} suivie(s).`,
                `A score is only shown from ${scores.donnees.seuil} recommendations assessed in the context. ${scores.donnees.evaluees} assessed out of ${scores.donnees.recommandations_suivies} tracked.`,
              )}
            </p>
            <Tableau
              legende={t("Scores d'efficacité par contexte", "Effectiveness scores per context")}
              cleLigne={(c) => c.cle}
              lignes={scores.donnees.elements}
              colonnes={[
                {
                  cle: "contexte",
                  entete: t("Contexte", "Context"),
                  rendu: (c) => libelleContexte(c, langue),
                },
                {
                  cle: "effectif",
                  entete: t("Effectif", "Sample size"),
                  alignement: "droite",
                  rendu: (c) => (c.effectif === null ? "—" : c.effectif),
                },
                {
                  cle: "score_moyen",
                  entete: t("Score moyen", "Average score"),
                  alignement: "droite",
                  rendu: (c) => libelleScore(c, scores.donnees.seuil, langue),
                },
                {
                  cle: "mediane",
                  entete: t("Médiane", "Median"),
                  alignement: "droite",
                  rendu: (c) => (c.mediane === null ? "—" : `${c.mediane} / 100`),
                },
              ]}
            />
          </>
        )}
      </Carte>

      <Carte titre={t("Recommandations", "Recommendations")} niveauTitre={2}>
        {!liste.ok ? (
          <EtatErreur
            titre={t(
              "Les recommandations n'ont pas pu être chargées.",
              "The recommendations could not be loaded.",
            )}
            message={liste.message}
            hrefReessayer="/connaissances/efficacite"
          />
        ) : liste.donnees.elements.length === 0 ? (
          <EtatVide
            titre={t("Aucune recommandation enregistrée.", "No recommendation recorded.")}
          />
        ) : (
          <ul className="mp-connaissances__resultats">
            {liste.donnees.elements.map((r) => (
              <li key={r.id}>
                <Carte
                  titre={
                    r.libelle ??
                    t(
                      "Recommandation d'une mission hors de votre périmètre",
                      "Recommendation from an engagement outside your scope",
                    )
                  }
                  niveauTitre={3}
                  actions={
                    <BadgeStatut tonalite={tonaliteStatutEfficacite(r.statut)}>
                      {libelleStatutEfficacite(r.statut, langue)}
                    </BadgeStatut>
                  }
                >
                  <p className="mp-texte-petit">
                    {r.type_initiative}
                    {r.mission_intitule ? ` · ${r.mission_intitule}` : ""}
                    {libelleMiseEnOeuvre(r.mise_en_oeuvre_le, langue)}
                  </p>
                  <p>
                    {t("Score d'efficacité :", "Effectiveness score:")}{" "}
                    {libelleScoreRecommandation(r, langue)}
                  </p>
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
        <Carte titre={t("Recommander une initiative", "Recommend an initiative")} niveauTitre={2}>
          <form
            method="get"
            className="mp-formulaire"
            aria-label={t("Choix de la mission", "Engagement choice")}
          >
            {missions?.ok ? (
              <Select
                libelle={t("Mission", "Engagement")}
                name="mission"
                invite={t("Choisir une mission", "Choose an engagement")}
                defaultValue={missionId ?? ""}
                options={missions.donnees.elements.map((m) => ({
                  valeur: m.id,
                  libelle: m.intitule,
                }))}
              />
            ) : null}
            <div className="mp-actions-formulaire">
              <Bouton type="submit" variante="secondaire">
                {t("Charger les KPI et le plan", "Load the KPIs and the plan")}
              </Bouton>
            </div>
          </form>
          {options && !options.ok ? (
            <EtatErreur
              titre={t(
                "Les KPI de la mission n'ont pas pu être chargés.",
                "The engagement's KPIs could not be loaded.",
              )}
              message={options.message}
              hrefReessayer={`/connaissances/efficacite?mission=${missionId}`}
            />
          ) : options?.ok && missionId ? (
            options.donnees.kpi.length === 0 ? (
              <EtatVide
                titre={t(
                  "Cette mission n'a aucun KPI actif à observer.",
                  "This engagement has no active KPI to observe.",
                )}
              />
            ) : (
              <FormulaireRecommandation missionId={missionId} options={options.donnees} />
            )
          ) : null}
        </Carte>
      ) : null}
    </div>
  );
}
