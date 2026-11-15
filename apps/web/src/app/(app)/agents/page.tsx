import type { Metadata } from "next";
import type { Langue, Traduire } from "@missionpilot/shared";
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
import { obtenirLangue, obtenirT } from "../../../lib/i18n/serveur";
import { obtenirSession } from "../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Agents IA", "AI agents") };
}

/**
 * Équipe d'agents IA (AGT-01) : le registre standard, ce que chaque agent fait et ne fait
 * jamais, ses outils, les droits qu'il exige de l'utilisateur qui le déclenche, et son niveau
 * d'autonomie maximal. Un expert métier ou un associé peut restreindre un agent pour le cabinet.
 */
export default async function PageEquipeAgents() {
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<{ elements: AgentIa[] }>("/api/agents");

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t("Équipe d'agents IA", "AI agent team")}
        soustitre={t(
          "Chaque agent a une mission bornée, une liste fermée d'outils et un niveau d'autonomie maximal. Il agit toujours dans vos droits ; ce qu'il produit reste une proposition tant qu'un humain ne l'a pas validée, et aucun chiffre ne vient du modèle.",
          "Each agent has a bounded mission, a closed list of tools and a maximum autonomy level. It always acts within your permissions; what it produces remains a proposal until a person approves it, and no figure comes from the model.",
        )}
      />
      {!r.ok ? (
        <EtatErreur
          titre={t(
            "Le registre des agents n'a pas pu être chargé.",
            "The agent registry could not be loaded.",
          )}
          message={r.message}
          hrefReessayer="/agents"
        />
      ) : r.donnees.elements.length === 0 ? (
        <EtatVide
          titre={t("Aucun agent dans le registre.", "No agent in the registry.")}
          icone="info"
        />
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
                      {t(`Jusqu'à ${a.niveau_max}`, `Up to ${a.niveau_max}`)}
                    </BadgeStatut>
                  ) : (
                    <BadgeStatut tonalite="neutre">{t("Désactivé", "Disabled")}</BadgeStatut>
                  )
                }
              >
                <FicheAgent agent={a} gerer={droits.gerer} t={t} langue={langue} />
              </Carte>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FicheAgent({
  agent: a,
  gerer,
  t,
  langue,
}: {
  agent: AgentIa;
  gerer: boolean;
  t: Traduire;
  langue: Langue;
}) {
  return (
    <div className="mp-agents__fiche">
      <p>{a.mission}</p>
      <p className="mp-agents__jamais">
        <strong>{t("Ne fait jamais :", "Never does:")}</strong> {a.ne_fait_jamais}
      </p>
      <dl className="mp-liste-def">
        <div>
          <dt>{t("Niveau maximal", "Maximum level")}</dt>
          <dd>
            {libelleNiveau(a.niveau_max, langue)}
            {a.niveau_max_cabinet || !a.actif
              ? t(` (standard : ${a.niveau_max_standard})`, ` (standard: ${a.niveau_max_standard})`)
              : ""}
          </dd>
        </div>
        <div>
          <dt>{t("Entrées", "Inputs")}</dt>
          <dd>{a.entrees.join(" ; ")}</dd>
        </div>
        <div>
          <dt>
            {t("Droits exigés du déclencheur", "Permissions required of the person triggering it")}
          </dt>
          <dd>{a.droits.length > 0 ? a.droits.join(", ") : t("Utiliser l'IA", "Use AI")}</dd>
        </div>
        <div>
          <dt>{t("Contenus clients", "Client content")}</dt>
          <dd>
            {a.lit_contenu_client
              ? t(
                  "Lus comme des données non fiables, jamais comme des consignes.",
                  "Read as untrusted data, never as instructions.",
                )
              : t("Aucun.", "None.")}
          </dd>
        </div>
      </dl>
      <div>
        <p className="mp-texte-petit mp-texte-doux">{t("Outils autorisés", "Authorized tools")}</p>
        <ul className="mp-agents__etiquettes">
          {a.outils_autorises.map((o) => (
            <li key={o} className="mp-agents__etiquette">
              {libelleOutil(o, langue)}
            </li>
          ))}
        </ul>
      </div>
      {a.restriction ? (
        <p className="mp-texte-petit mp-texte-doux">
          {t(
            `Restreint le ${formaterDate(a.restriction.cree_le)} : ${a.restriction.motif}`,
            `Restricted on ${formaterDate(a.restriction.cree_le, "UTC", langue)}: ${a.restriction.motif}`,
          )}
        </p>
      ) : null}
      {gerer ? (
        <details className="mp-details">
          <summary>{t("Restreindre pour le cabinet", "Restrict for the firm")}</summary>
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
