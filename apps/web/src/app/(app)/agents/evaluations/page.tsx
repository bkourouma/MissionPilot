import type { Metadata } from "next";
import { EvaluationOpenRouter } from "../../../../components/agents/EvaluationOpenRouter";
import {
  FormulaireEvaluation,
  FormulaireJeuEssai,
} from "../../../../components/agents/FormulairesAgents";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import {
  droitsAgents,
  libelleRaisonCas,
  type EvaluationIa,
  type JeuEssaiIa,
  type PageIaAgents,
} from "../../../../lib/agents";
import { chargerServeur } from "../../../../lib/api-serveur";
import {
  droitsEvaluationOpenRouter,
  lirePromptPreselectionne,
} from "../../../../lib/evaluations-openrouter";
import { formaterDateHeure } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { chargerFacultatif } from "../../../../lib/ia-serveur";
import { obtenirSession } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Évaluations des agents", "Agent evaluations") };
}

interface VersionPrompt {
  id: string;
  nom: string;
  version: number;
  actif: boolean;
}

/**
 * Jeux d'essai et évaluations de non-régression (AGT-04) : aucune version de prompt ni aucun
 * modèle ne s'active sans évaluation réussie sur le jeu d'essai de référence. Deux fournisseurs :
 * le rejeu RÉEL sur OpenRouter (facturé, seul valable en production) et l'évaluation locale
 * déterministe (aucun appel à un modèle externe, hors production). Le panneau du rejeu réel est
 * un composant client qui ne reçoit que des propriétés sérialisables.
 */
export default async function PageEvaluations({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const droitsOr = droitsEvaluationOpenRouter(utilisateur.roles);
  const q = await searchParams;
  const [jeux, evaluations] = await Promise.all([
    chargerServeur<PageIaAgents<JeuEssaiIa>>("/api/agents/jeux-essai?limite=50"),
    chargerServeur<PageIaAgents<EvaluationIa>>("/api/agents/evaluations?limite=30"),
  ]);
  const noms = jeux.ok ? [...new Set(jeux.donnees.elements.map((j) => j.prompt_nom))] : [];
  // Versions des prompts dotés d'un jeu d'essai (lecture facultative : un rôle sans « ia.utiliser »
  // n'obtient pas la liste, le panneau l'explique).
  const lots = await Promise.all(
    noms.map((nom) =>
      chargerFacultatif<PageIaAgents<VersionPrompt>>(
        `/api/ia/prompts?nom=${encodeURIComponent(nom)}&limite=10`,
      ),
    ),
  );
  const versions: { id: string; libelle: string }[] = [];
  for (const v of lots) {
    if (v.etat !== "ok") continue;
    for (const p of v.donnees.elements) {
      versions.push({
        id: p.id,
        libelle: `${p.nom} v${p.version}${p.actif ? t(" (active)", " (active)") : ""}`,
      });
    }
  }

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t("Évaluations de non-régression", "Non-regression evaluations")}
        soustitre={t(
          "Tout changement de prompt ou de modèle rejoue le jeu d'essai de référence avant activation : la base refuse d'activer une version ou un modèle sans évaluation réussie.",
          "Any change of prompt or model replays the reference test set before activation: the database refuses to activate a version or a model without a successful evaluation.",
        )}
      />

      {droitsOr.lire ? (
        <Carte
          titre={t(
            "Évaluation de non-régression sur OpenRouter",
            "Non-regression evaluation on OpenRouter",
          )}
        >
          <EvaluationOpenRouter
            versions={versions}
            idInitial={lirePromptPreselectionne(q.prompt)}
            peutLancer={droitsOr.lancer}
          />
        </Carte>
      ) : null}

      {droits.gerer ? (
        <Carte
          titre={t("Évaluation locale (hors production)", "Local evaluation (non-production)")}
        >
          <div className="mp-pile">
            <p className="mp-texte-petit mp-texte-doux">
              {t(
                "L'évaluation locale n'appelle aucun modèle : elle sert à préparer un jeu d'essai sans frais. Elle ne suffit pas pour activer un prompt en production, où seul un rejeu réussi sur OpenRouter est accepté.",
                "The local evaluation calls no model: it is used to prepare a test set at no cost. It is not enough to activate a prompt in production, where only a successful replay on OpenRouter is accepted.",
              )}
            </p>
            <FormulaireEvaluation versions={versions} />
          </div>
        </Carte>
      ) : null}

      <section aria-labelledby="titre-evaluations" className="mp-pile">
        <h2 id="titre-evaluations" className="mp-section__titre">
          {t("Dernières évaluations", "Latest evaluations")}
        </h2>
        {!evaluations.ok ? (
          <EtatErreur
            titre={t(
              "Les évaluations n'ont pas pu être chargées.",
              "The evaluations could not be loaded.",
            )}
            message={evaluations.message}
            hrefReessayer="/agents/evaluations"
          />
        ) : evaluations.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucune évaluation pour l'instant.", "No evaluation yet.")} />
        ) : (
          <ul className="mp-liste-lignes">
            {evaluations.donnees.elements.map((e) => (
              <li key={e.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>
                    {e.prompt_nom} v{e.prompt_version}
                    {e.prompt_reference_version !== null
                      ? t(
                          ` comparée à v${e.prompt_reference_version}`,
                          ` compared with v${e.prompt_reference_version}`,
                        )
                      : ""}
                  </strong>
                  <span className="mp-texte-doux mp-texte-petit">
                    {t("Jeu", "Set")} v{e.jeu_version} · {e.modele} ·{" "}
                    {e.fournisseur === "local"
                      ? t("fournisseur local", "local provider")
                      : "OpenRouter"}{" "}
                    · {e.lance_par_nom} · {formaterDateHeure(e.cree_le, undefined, langue)}
                  </span>
                  {e.resultats.some((c) => !c.reussi) ? (
                    <span className="mp-texte-petit">
                      {t("Échecs :", "Failures:")}{" "}
                      {e.resultats
                        .filter((c) => !c.reussi)
                        .map(
                          (c) =>
                            `${c.code} (${c.raisons.map((r) => libelleRaisonCas(r, langue)).join(", ")})`,
                        )
                        .join(" ; ")}
                    </span>
                  ) : null}
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite={e.reussie ? "succes" : "danger"}>
                    {e.reussie ? t("Réussie", "Passed") : t("Échouée", "Failed")}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre">
                    {t(
                      `${e.cas_reussis} / ${e.cas_total} cas`,
                      `${e.cas_reussis} / ${e.cas_total} cases`,
                    )}
                  </BadgeStatut>
                  {e.regressions > 0 ? (
                    <BadgeStatut tonalite="danger">
                      {t(`${e.regressions} régression(s)`, `${e.regressions} regression(s)`)}
                    </BadgeStatut>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-jeux" className="mp-pile">
        <h2 id="titre-jeux" className="mp-section__titre">
          {t("Jeux d'essai", "Test sets")}
        </h2>
        {!jeux.ok ? (
          <EtatErreur
            titre={t(
              "Les jeux d'essai n'ont pas pu être chargés.",
              "The test sets could not be loaded.",
            )}
            message={jeux.message}
            hrefReessayer="/agents/evaluations"
          />
        ) : jeux.donnees.elements.length === 0 ? (
          <EtatVide titre={t("Aucun jeu d'essai.", "No test set.")}>
            <p>
              {t(
                "Un jeu d'essai protège un prompt : ses nouvelles versions doivent le réussir.",
                "A test set protects a prompt: its new versions must pass it.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {jeux.donnees.elements.map((j) => (
              <li key={j.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>
                    {j.prompt_nom} — {t("jeu", "set")} v{j.version}
                  </strong>
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(`${j.cas.length} cas`, `${j.cas.length} cases`)}
                    {j.brique_code
                      ? t(` · brique ${j.brique_code}`, ` · building block ${j.brique_code}`)
                      : ""}{" "}
                    · {j.auteur_nom} · {formaterDateHeure(j.cree_le, undefined, langue)}
                    {j.description ? ` · ${j.description}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {droits.gerer ? (
        <Carte titre={t("Nouveau jeu d'essai", "New test set")}>
          <FormulaireJeuEssai />
        </Carte>
      ) : null}
    </div>
  );
}
