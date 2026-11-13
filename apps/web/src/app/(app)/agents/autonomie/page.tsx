import type { Metadata } from "next";
import Link from "next/link";
import {
  FormulaireBrique,
  FormulaireCoupeCircuit,
} from "../../../../components/agents/FormulairesAutonomie";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide, PaginationCurseur } from "../../../../components/ui/EtatListe";
import {
  cheminAvecCurseur,
  droitsAgents,
  hrefBrique,
  hrefPage,
  libelleClasse,
  libelleRaisonsNiveau,
  lireCurseur,
  tonaliteNiveau,
  type AgentIa,
  type PageBriquesIa,
} from "../../../../lib/agents";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDate } from "../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../lib/session";
import { briqueContradicteurDeclaree } from "./contradicteur-agent";
import { PreparationContradicteur } from "./PreparationContradicteur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Autonomie des agents", "Agent autonomy") };
}

/**
 * Autonomie par brique (AGT-03) : niveau accordé et niveau effectif (plafonds, N4 réservé à
 * R0, coupe-circuit), coupe-circuit N4 du cabinet, briques confiées aux agents.
 */
export default async function PageAutonomie({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const curseur = lireCurseur((await searchParams).curseur);
  const [r, agents] = await Promise.all([
    chargerServeur<PageBriquesIa>(cheminAvecCurseur("/api/agents/briques", curseur)),
    droits.gerer ? chargerServeur<{ elements: AgentIa[] }>("/api/agents") : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t("Autonomie par brique", "Autonomy per building block")}
        soustitre={t(
          "L'autonomie se mérite, se mesure et se retire : promotion en N3 ou N4 sur décision d'un associé après 50 exécutions dont 95 % acceptées et aucun incident majeur sur 90 jours ; le premier incident majeur ramène la brique en N2.",
          "Autonomy is earned, measured and withdrawn: promotion to N3 or N4 on a partner's decision after 50 executions with 95% accepted and no major incident in 90 days; the first major incident brings the building block back to N2.",
        )}
      />
      {r.ok ? (
        <Carte
          titre={t("Coupe-circuit N4", "N4 circuit breaker")}
          actions={
            r.donnees.coupe_circuit.actif ? (
              <BadgeStatut tonalite="danger">{t("Activé", "On")}</BadgeStatut>
            ) : (
              <BadgeStatut tonalite="succes">{t("Levé", "Lifted")}</BadgeStatut>
            )
          }
        >
          <div className="mp-pile">
            <p>
              {r.donnees.coupe_circuit.actif
                ? t(
                    "Aucune exécution automatique vers les clients : les briques N4 fonctionnent en N3.",
                    "No automatic execution towards clients: N4 building blocks run at N3.",
                  )
                : t(
                    "Les briques R0 promues en N4 peuvent écrire aux clients (relances, accusés de réception).",
                    "R0 building blocks promoted to N4 can write to clients (reminders, acknowledgements of receipt).",
                  )}
            </p>
            {r.donnees.coupe_circuit.motif ? (
              <p className="mp-texte-petit mp-texte-doux">
                {t(
                  `Dernier changement le ${formaterDate(r.donnees.coupe_circuit.modifie_le)} : ${r.donnees.coupe_circuit.motif}`,
                  `Last change on ${formaterDate(r.donnees.coupe_circuit.modifie_le, "UTC", langue)}: ${r.donnees.coupe_circuit.motif}`,
                )}
              </p>
            ) : null}
            <FormulaireCoupeCircuit
              actif={r.donnees.coupe_circuit.actif}
              peutCouper={droits.couper}
              peutLever={droits.lever}
            />
          </div>
        </Carte>
      ) : null}

      <section aria-labelledby="titre-briques" className="mp-pile">
        <h2 id="titre-briques" className="mp-section__titre">
          {t("Briques confiées aux agents", "Building blocks assigned to agents")}
        </h2>
        {!r.ok ? (
          <EtatErreur
            titre={t(
              "Les briques n'ont pas pu être chargées.",
              "The building blocks could not be loaded.",
            )}
            message={r.message}
            hrefReessayer={hrefPage("/agents/autonomie", curseur)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide
            titre={
              curseur
                ? t("Aucune autre brique.", "No other building block.")
                : t("Aucune brique confiée à un agent.", "No building block assigned to an agent.")
            }
          >
            <p>
              {t(
                "Un expert métier ou un associé confie une brique à un agent, au niveau N2 au plus.",
                "A subject-matter expert or a partner assigns a building block to an agent, at level N2 at most.",
              )}
            </p>
          </EtatVide>
        ) : (
          <ul className="mp-liste-lignes">
            {r.donnees.elements.map((b) => (
              <li key={b.id} className="mp-liste-lignes__ligne">
                <div className="mp-liste-lignes__texte">
                  <Link href={hrefBrique(b.code)} className="mp-lien-ligne">
                    {b.code}
                  </Link>
                  <span className="mp-texte-doux mp-texte-petit">
                    {b.agent?.nom ?? t("Agent inconnu", "Unknown agent")} ·{" "}
                    {libelleClasse(b.classe_risque, langue)} · {t("plafond", "ceiling")}{" "}
                    {b.niveau_max}
                    {b.autonomie && b.autonomie.raisons.length > 0
                      ? t(
                          ` · limité par : ${libelleRaisonsNiveau(b.autonomie.raisons)}`,
                          ` · limited by: ${libelleRaisonsNiveau(b.autonomie.raisons, "en")}`,
                        )
                      : ""}
                  </span>
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite="neutre">
                    {t(`Accordé ${b.niveau_accorde}`, `Granted ${b.niveau_accorde}`)}
                  </BadgeStatut>
                  {b.autonomie ? (
                    <BadgeStatut tonalite={tonaliteNiveau(b.autonomie.niveau_effectif)}>
                      {t(
                        `Effectif ${b.autonomie.niveau_effectif}`,
                        `Effective ${b.autonomie.niveau_effectif}`,
                      )}
                    </BadgeStatut>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {r.ok ? (
          <PaginationCurseur
            hrefSuivante={
              r.donnees.curseur_suivant
                ? hrefPage("/agents/autonomie", r.donnees.curseur_suivant)
                : null
            }
            hrefDebut={curseur ? "/agents/autonomie" : null}
          />
        ) : null}
      </section>

      {droits.gerer ? (
        <Carte
          titre={t(
            "Revue contradictoire (agent contradicteur)",
            "Counter-analysis review (contradictor agent)",
          )}
        >
          <PreparationContradicteur
            declaree={r.ok && briqueContradicteurDeclaree(r.donnees.elements)}
          />
        </Carte>
      ) : null}

      {droits.gerer && agents?.ok ? (
        <Carte titre={t("Confier une brique à un agent", "Assign a building block to an agent")}>
          <FormulaireBrique
            r0={droits.declarerR0}
            agents={agents.donnees.elements
              .filter((a) => a.actif)
              .map((a) => ({ code: a.code, nom: a.nom }))}
          />
        </Carte>
      ) : null}
    </div>
  );
}
