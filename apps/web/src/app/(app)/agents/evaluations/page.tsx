import type { Metadata } from "next";
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
import { formaterDateHeure } from "../../../../lib/format";
import { chargerFacultatif } from "../../../../lib/ia-serveur";
import { obtenirSession } from "../../../../lib/session";

export const metadata: Metadata = { title: "Évaluations des agents" };

interface VersionPrompt {
  id: string;
  nom: string;
  version: number;
  actif: boolean;
}

/**
 * Jeux d'essai et évaluations de non-régression (AGT-04) : aucune version de prompt ni aucun
 * modèle ne s'active sans évaluation réussie sur le jeu d'essai de référence. Dans cette
 * version, les évaluations tournent sur un fournisseur local déterministe (aucun appel à un
 * modèle externe).
 */
export default async function PageEvaluations() {
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const [jeux, evaluations] = await Promise.all([
    chargerServeur<PageIaAgents<JeuEssaiIa>>("/api/agents/jeux-essai?limite=50"),
    chargerServeur<PageIaAgents<EvaluationIa>>("/api/agents/evaluations?limite=30"),
  ]);
  const noms = jeux.ok ? [...new Set(jeux.donnees.elements.map((j) => j.prompt_nom))] : [];
  const versions: { id: string; libelle: string }[] = [];
  if (droits.gerer) {
    for (const nom of noms) {
      const v = await chargerFacultatif<PageIaAgents<VersionPrompt>>(
        `/api/ia/prompts?nom=${encodeURIComponent(nom)}&limite=10`,
      );
      if (v.etat !== "ok") continue;
      for (const p of v.donnees.elements) {
        versions.push({
          id: p.id,
          libelle: `${p.nom} v${p.version}${p.actif ? " (active)" : ""}`,
        });
      }
    }
  }

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre="Évaluations de non-régression"
        soustitre="Tout changement de prompt ou de modèle rejoue le jeu d'essai de référence avant activation : la base refuse d'activer une version ou un modèle sans évaluation réussie."
      />

      {droits.gerer ? (
        <Carte titre="Lancer une évaluation">
          <FormulaireEvaluation versions={versions} />
        </Carte>
      ) : null}

      <section aria-labelledby="titre-evaluations" className="mp-pile">
        <h2 id="titre-evaluations" className="mp-section__titre">
          Dernières évaluations
        </h2>
        {!evaluations.ok ? (
          <EtatErreur
            titre="Les évaluations n'ont pas pu être chargées."
            message={evaluations.message}
            hrefReessayer="/agents/evaluations"
          />
        ) : evaluations.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucune évaluation pour l'instant." />
        ) : (
          <ul className="mp-liste-lignes">
            {evaluations.donnees.elements.map((e) => (
              <li key={e.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>
                    {e.prompt_nom} v{e.prompt_version}
                    {e.prompt_reference_version !== null
                      ? ` comparée à v${e.prompt_reference_version}`
                      : ""}
                  </strong>
                  <span className="mp-texte-doux mp-texte-petit">
                    Jeu v{e.jeu_version} · {e.modele} ·{" "}
                    {e.fournisseur === "local" ? "fournisseur local" : "OpenRouter"} ·{" "}
                    {e.lance_par_nom} · {formaterDateHeure(e.cree_le)}
                  </span>
                  {e.resultats.some((c) => !c.reussi) ? (
                    <span className="mp-texte-petit">
                      Échecs :{" "}
                      {e.resultats
                        .filter((c) => !c.reussi)
                        .map((c) => `${c.code} (${c.raisons.map(libelleRaisonCas).join(", ")})`)
                        .join(" ; ")}
                    </span>
                  ) : null}
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite={e.reussie ? "succes" : "danger"}>
                    {e.reussie ? "Réussie" : "Échouée"}
                  </BadgeStatut>
                  <BadgeStatut tonalite="neutre">{`${e.cas_reussis} / ${e.cas_total} cas`}</BadgeStatut>
                  {e.regressions > 0 ? (
                    <BadgeStatut tonalite="danger">{`${e.regressions} régression(s)`}</BadgeStatut>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titre-jeux" className="mp-pile">
        <h2 id="titre-jeux" className="mp-section__titre">
          Jeux d&apos;essai
        </h2>
        {!jeux.ok ? (
          <EtatErreur
            titre="Les jeux d'essai n'ont pas pu être chargés."
            message={jeux.message}
            hrefReessayer="/agents/evaluations"
          />
        ) : jeux.donnees.elements.length === 0 ? (
          <EtatVide titre="Aucun jeu d'essai.">
            <p>
              Un jeu d&apos;essai protège un prompt : ses nouvelles versions doivent le réussir.
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {jeux.donnees.elements.map((j) => (
              <li key={j.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <strong>
                    {j.prompt_nom} — jeu v{j.version}
                  </strong>
                  <span className="mp-texte-doux mp-texte-petit">
                    {j.cas.length} cas{j.brique_code ? ` · brique ${j.brique_code}` : ""} ·{" "}
                    {j.auteur_nom} · {formaterDateHeure(j.cree_le)}
                    {j.description ? ` · ${j.description}` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {droits.gerer ? (
        <Carte titre="Nouveau jeu d'essai">
          <FormulaireJeuEssai />
        </Carte>
      ) : null}
    </div>
  );
}
