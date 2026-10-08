import type { Metadata } from "next";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  cheminAvecCurseur,
  hrefPage,
  libelleSignal,
  LIBELLES_DECISION,
  lireCurseur,
  tonaliteNiveau,
  type ExecutionIa,
  type PageIaAgents,
} from "../../../../lib/agents";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { formaterMicroUsd } from "../../../../lib/ia";

export const metadata: Metadata = { title: "Exécutions des agents" };

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
  const curseur = lireCurseur((await searchParams).curseur);
  const r = await chargerServeur<PageIaAgents<ExecutionIa>>(
    cheminAvecCurseur("/api/agents/executions", curseur),
  );

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre="Exécutions des agents"
        soustitre="Chaque sortie d'agent garde ses sources, la version du prompt, le modèle, le niveau d'autonomie et la décision humaine. L'entrée envoyée au modèle n'est jamais conservée en clair : seule son empreinte l'est."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Les exécutions n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefPage("/agents/executions", curseur)}
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre={curseur ? "Aucune autre exécution." : "Aucune exécution visible."}>
          <p>Les exécutions apparaissent dès qu&apos;un module fait travailler un agent.</p>
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
                  {e.mode_degrade ? "gabarit déterministe (mode dégradé)" : (e.modele ?? "—")} ·{" "}
                  {e.declencheur.nom} · {formaterDateHeure(e.cree_le)}
                  {typeof e.cout_micro_usd === "number"
                    ? ` · coût ${formaterMicroUsd(e.cout_micro_usd)}`
                    : ""}
                </span>
                {e.sources.length > 0 ? (
                  <span className="mp-texte-petit">
                    Sources : {e.sources.map((s) => s.libelle).join(" ; ")}
                  </span>
                ) : null}
                {e.donnees_non_fiables.length > 0 ? (
                  <span className="mp-texte-petit">
                    Contenus clients traités comme données : {e.donnees_non_fiables.join(", ")}
                    {e.signaux_injection.length > 0
                      ? ` — signaux relevés : ${e.signaux_injection.map(libelleSignal).join(", ")}`
                      : ""}
                  </span>
                ) : null}
                <span className="mp-agents__empreinte">
                  Empreinte de l&apos;entrée {e.entree.empreinte}
                </span>
              </div>
              <div className="mp-badges">
                <BadgeStatut tonalite={tonaliteNiveau(e.niveau_effectif)}>
                  {e.niveau_effectif}
                </BadgeStatut>
                {e.mode_degrade ? (
                  <BadgeStatut tonalite="attention">Mode dégradé</BadgeStatut>
                ) : null}
                {!e.sortie_valide ? (
                  <BadgeStatut tonalite="danger">Sortie non conforme</BadgeStatut>
                ) : null}
                {e.chiffres_non_verifies ? (
                  <BadgeStatut tonalite="attention">Chiffres non vérifiés</BadgeStatut>
                ) : null}
                <BadgeStatut
                  tonalite={
                    !e.decision ? "neutre" : e.decision.decision === "rejetee" ? "danger" : "succes"
                  }
                >
                  {e.decision ? LIBELLES_DECISION[e.decision.decision] : "En attente de décision"}
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
