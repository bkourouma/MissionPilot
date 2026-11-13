import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  cheminAvecCurseur,
  hrefPage,
  libelleDecision,
  libelleSignal,
  lireCurseur,
  tonaliteNiveau,
  type ExecutionIa,
  type PageIaAgents,
} from "../../../../lib/agents";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { formaterMicroUsd } from "../../../../lib/ia";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Exécutions des agents", "Agent executions") };
}

/**
 * Transparence des exécutions (AGT-09) : pour chaque sortie d'agent, sources, version du
 * prompt, modèle, niveau d'autonomie effectif, mode dégradé, conformité au schéma, contenus
 * clients traités comme données non fiables et décision humaine. Le coût n'apparaît qu'avec
 * le droit de lire les données financières.
 */
export default async function PageExecutions({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageIaAgents<ExecutionIa>>(
    cheminAvecCurseur("/api/agents/executions", curseur),
  );

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t("Exécutions des agents", "Agent executions")}
        soustitre={t(
          "Chaque sortie d'agent garde ses sources, la version du prompt, le modèle, le niveau d'autonomie et la décision humaine. L'entrée envoyée au modèle n'est jamais conservée en clair : seule son empreinte l'est.",
          "Each agent output keeps its sources, the prompt version, the model, the autonomy level and the human decision. The input sent to the model is never stored in clear: only its fingerprint is.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Les exécutions n'ont pas pu être chargées.",
            "The executions could not be loaded.",
          )}
          message={r.message}
          hrefReessayer={hrefPage("/agents/executions", curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={
            curseur
              ? t("Aucune autre exécution.", "No other execution.")
              : t("Aucune exécution visible.", "No visible execution.")
          }
        >
          <p>
            {t(
              "Les exécutions apparaissent dès qu'un module fait travailler un agent.",
              "Executions appear as soon as a module puts an agent to work.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {r.donnees.elements.map((e) => (
            <li key={e.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <strong>
                  {e.agent.nom}
                  {e.brique ? ` · ${e.brique.code}` : ""}
                </strong>
                <span className="mp-texte-doux mp-texte-petit">
                  Prompt {e.prompt.nom} v{e.prompt.version} ·{" "}
                  {e.mode_degrade
                    ? t(
                        "gabarit déterministe (mode dégradé)",
                        "deterministic template (degraded mode)",
                      )
                    : (e.modele ?? "—")}{" "}
                  · {e.declencheur.nom} · {formaterDateHeure(e.cree_le, undefined, langue)}
                  {typeof e.cout_micro_usd === "number"
                    ? t(
                        ` · coût ${formaterMicroUsd(e.cout_micro_usd)}`,
                        ` · cost ${formaterMicroUsd(e.cout_micro_usd, langue)}`,
                      )
                    : ""}
                </span>
                {e.sources.length > 0 ? (
                  <span className="mp-texte-petit">
                    {t("Sources :", "Sources:")} {e.sources.map((s) => s.libelle).join(" ; ")}
                  </span>
                ) : null}
                {e.donnees_non_fiables.length > 0 ? (
                  <span className="mp-texte-petit">
                    {t(
                      "Contenus clients traités comme données :",
                      "Client content treated as data:",
                    )}{" "}
                    {e.donnees_non_fiables.join(", ")}
                    {e.signaux_injection.length > 0
                      ? t(
                          ` — signaux relevés : ${e.signaux_injection.map((s) => libelleSignal(s)).join(", ")}`,
                          ` — signals detected: ${e.signaux_injection.map((s) => libelleSignal(s, "en")).join(", ")}`,
                        )
                      : ""}
                  </span>
                ) : null}
                <span className="mp-agents__empreinte">
                  {t("Empreinte de l'entrée", "Input fingerprint")} {e.entree.empreinte}
                </span>
              </div>
              <div className="mp-badges">
                <BadgeStatut tonalite={tonaliteNiveau(e.niveau_effectif)}>
                  {e.niveau_effectif}
                </BadgeStatut>
                {e.mode_degrade ? (
                  <BadgeStatut tonalite="attention">
                    {t("Mode dégradé", "Degraded mode")}
                  </BadgeStatut>
                ) : null}
                {!e.sortie_valide ? (
                  <BadgeStatut tonalite="danger">
                    {t("Sortie non conforme", "Non-compliant output")}
                  </BadgeStatut>
                ) : null}
                {e.chiffres_non_verifies ? (
                  <BadgeStatut tonalite="attention">
                    {t("Chiffres non vérifiés", "Unverified figures")}
                  </BadgeStatut>
                ) : null}
                <BadgeStatut
                  tonalite={
                    !e.decision ? "neutre" : e.decision.decision === "rejetee" ? "danger" : "succes"
                  }
                >
                  {e.decision
                    ? libelleDecision(e.decision.decision, langue)
                    : t("En attente de décision", "Awaiting decision")}
                </BadgeStatut>
              </div>
            </li>
          ))}
        </ul>
      )}
      {r.ok ? (
        <PaginationCurseur
          hrefSuivante={
            r.donnees.curseur_suivant
              ? hrefPage("/agents/executions", r.donnees.curseur_suivant)
              : null
          }
          hrefDebut={curseur ? "/agents/executions" : null}
        />
      ) : null}
    </div>
  );
}
