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
import { obtenirSession } from "../../../../lib/session";

export const metadata: Metadata = { title: "Autonomie des agents" };

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
  const curseur = lireCurseur((await searchParams).curseur);
  const [r, agents] = await Promise.all([
    chargerServeur<PageBriquesIa>(cheminAvecCurseur("/api/agents/briques", curseur)),
    droits.gerer ? chargerServeur<{ elements: AgentIa[] }>("/api/agents") : Promise.resolve(null),
  ]);

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre="Autonomie par brique"
        soustitre="L'autonomie se mérite, se mesure et se retire : promotion en N3 ou N4 sur décision d'un associé après 50 exécutions dont 95 % acceptées et aucun incident majeur sur 90 jours ; le premier incident majeur ramène la brique en N2."
      />
      {r.ok ? (
        <Carte
          titre="Coupe-circuit N4"
          actions={
            r.donnees.coupe_circuit.actif ? (
              <BadgeStatut tonalite="danger">Activé</BadgeStatut>
            ) : (
              <BadgeStatut tonalite="succes">Levé</BadgeStatut>
            )
          }
        >
          <div className="mp-pile">
            <p>
              {r.donnees.coupe_circuit.actif
                ? "Aucune exécution automatique vers les clients : les briques N4 fonctionnent en N3."
                : "Les briques R0 promues en N4 peuvent écrire aux clients (relances, accusés de réception)."}
            </p>
            {r.donnees.coupe_circuit.motif ? (
              <p className="mp-texte-petit mp-texte-doux">
                Dernier changement le {formaterDate(r.donnees.coupe_circuit.modifie_le)} :{" "}
                {r.donnees.coupe_circuit.motif}
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
          Briques confiées aux agents
        </h2>
        {!r.ok ? (
          <EtatErreur
            titre="Les briques n'ont pas pu être chargées."
            message={r.message}
            hrefReessayer={hrefPage("/agents/autonomie", curseur)}
          />
        ) : r.donnees.elements.length === 0 ? (
          <EtatVide titre={curseur ? "Aucune autre brique." : "Aucune brique confiée à un agent."}>
            <p>
              Un expert métier ou un associé confie une brique à un agent, au niveau N2 au plus.
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
                    {b.agent?.nom ?? "Agent inconnu"} · {libelleClasse(b.classe_risque)} · plafond{" "}
                    {b.niveau_max}
                    {b.autonomie && b.autonomie.raisons.length > 0
                      ? ` · limité par : ${libelleRaisonsNiveau(b.autonomie.raisons)}`
                      : ""}
                  </span>
                </div>
                <div className="mp-badges">
                  <BadgeStatut tonalite="neutre">{`Accordé ${b.niveau_accorde}`}</BadgeStatut>
                  {b.autonomie ? (
                    <BadgeStatut tonalite={tonaliteNiveau(b.autonomie.niveau_effectif)}>
                      {`Effectif ${b.autonomie.niveau_effectif}`}
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

      {droits.gerer && agents?.ok ? (
        <Carte titre="Confier une brique à un agent">
          <FormulaireBrique
            agents={agents.donnees.elements
              .filter((a) => a.actif)
              .map((a) => ({ code: a.code, nom: a.nom }))}
          />
        </Carte>
      ) : null}
    </div>
  );
}
