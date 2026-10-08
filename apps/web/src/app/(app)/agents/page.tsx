import type { Metadata } from "next";
import { FormulaireRestriction } from "../../../components/agents/FormulairesAgents";
import { BadgeStatut } from "../../../components/ui/BadgeStatut";
import { Carte } from "../../../components/ui/Carte";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../components/ui/EtatListe";
import {
  droitsAgents,
  libelleNiveau,
  libelleOutil,
  tonaliteNiveau,
  type AgentIa,
} from "../../../lib/agents";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import { obtenirSession } from "../../../lib/session";

export const metadata: Metadata = { title: "Agents IA" };

/**
 * Équipe d'agents IA (AGT-01) : le registre standard, ce que chaque agent fait et ne fait
 * jamais, ses outils, les droits qu'il exige de l'utilisateur qui le déclenche, et son niveau
 * d'autonomie maximal. Un expert métier ou un associé peut restreindre un agent pour le cabinet.
 */
export default async function PageEquipeAgents() {
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const r = await chargerServeur<{ elements: AgentIa[] }>("/api/agents");

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre="Équipe d'agents IA"
        soustitre="Chaque agent a une mission bornée, une liste fermée d'outils et un niveau d'autonomie maximal. Il agit toujours dans vos droits ; ce qu'il produit reste une proposition tant qu'un humain ne l'a pas validée, et aucun chiffre ne vient du modèle."
      />
      {!r.ok ? (
        <EtatErreur
          titre="Le registre des agents n'a pas pu être chargé."
          message={r.message}
          hrefReessayer="/agents"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide titre="Aucun agent dans le registre." icone="info" />
      ) : (
        <ul className="mp-agents__grille">
          {r.donnees.elements.map((a) => (
            <li key={a.code}>
              <Carte
                titre={a.nom}
                niveauTitre={2}
                actions={
                  a.actif ? (
                    <BadgeStatut tonalite={tonaliteNiveau(a.niveau_max)}>
                      {`Jusqu'à ${a.niveau_max}`}
                    </BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="neutre">Désactivé</BadgeStatut>
                  )
                }
              >
                <FicheAgent agent={a} gerer={droits.gerer} />
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FicheAgent({ agent: a, gerer }: { agent: AgentIa; gerer: boolean }) {
  return (
    <div className="mp-agents__fiche">
      <p>{a.mission}</p>
      <p className="mp-agents__jamais">
        <strong>Ne fait jamais :</strong> {a.ne_fait_jamais}
      </p>
      <dl className="mp-liste-def">
        <div>
          <dt>Niveau maximal</dt>
          <dd>
            {libelleNiveau(a.niveau_max)}
            {a.niveau_max_cabinet || !a.actif ? ` (standard : ${a.niveau_max_standard})` : ""}
          </dd>
        </div>
        <div>
          <dt>Entrées</dt>
          <dd>{a.entrees.join(" ; ")}</dd>
        </div>
        <div>
          <dt>Droits exigés du déclencheur</dt>
          <dd>{a.droits.length > 0 ? a.droits.join(", ") : "Utiliser l'IA"}</dd>
        </div>
        <div>
          <dt>Contenus clients</dt>
          <dd>
            {a.lit_contenu_client
              ? "Lus comme des données non fiables, jamais comme des consignes."
              : "Aucun."}
          </dd>
        </div>
      </dl>
      <div>
        <p className="mp-texte-petit mp-texte-doux">Outils autorisés</p>
        <ul className="mp-agents__etiquettes">
          {a.outils_autorises.map((o) => (
            <li key={o} className="mp-agents__etiquette">
              {libelleOutil(o)}
            </li>
          ))}
        </ul>
      </div>
      {a.restriction ? (
        <p className="mp-texte-petit mp-texte-doux">
          Restreint le {formaterDate(a.restriction.cree_le)} : {a.restriction.motif}
        </p>
      ) : null}
      {gerer ? (
        <details className="mp-details">
          <summary>Restreindre pour le cabinet</summary>
          <FormulaireRestriction
            code={a.code}
            actif={a.actif}
            standard={a.niveau_max_standard}
            cabinet={a.niveau_max_cabinet}
          />
        </details>
      ) : null}
    </div>
  );
}
