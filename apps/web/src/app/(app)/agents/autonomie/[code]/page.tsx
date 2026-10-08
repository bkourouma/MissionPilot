import type { Metadata } from "next";
import {
  FormulaireDecisionAutonomie,
  FormulaireIncident,
} from "../../../../../components/agents/FormulairesAutonomie";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import {
  droitsAgents,
  formaterPart,
  hrefBrique,
  libelleClasse,
  libelleNiveau,
  libelleRaisonsNiveau,
  LIBELLES_EVENEMENT,
  presentationEligibilite,
  tonaliteNiveau,
  type DetailBriqueIa,
} from "../../../../../lib/agents";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { obtenirSession } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Autonomie d'une brique" };

/**
 * Autonomie d'une brique : niveau effectif et ce qui le limite, statistiques et éligibilité à
 * la promotion (moteur pur), décision d'un associé, incidents et historique des niveaux.
 */
export default async function PageBrique({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const r = await chargerServeur<DetailBriqueIa>(`/api/agents/briques/${encodeURIComponent(code)}`);
  if (!r.ok) {
    return (
      <div className="mp-page mp-agents">
        <EnteteDePage
          titre="Autonomie d'une brique"
          retour={{ href: "/agents/autonomie", libelle: "Toutes les briques" }}
        />
        <EtatErreur
          titre={r.statut === 404 ? "Brique introuvable." : "La brique n'a pas pu être chargée."}
          message={r.message}
          hrefReessayer={hrefBrique(code)}
        />
      </div>
    );
  }
  const b = r.donnees;
  const elig = presentationEligibilite(b.eligibilite);
  const stats = b.eligibilite.statistiques;

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={`Brique ${b.code}`}
        soustitre={`${b.agent?.nom ?? "Agent inconnu"} · ${libelleClasse(b.classe_risque)} · plafond ${b.niveau_max}`}
        badges={
          b.autonomie ? (
            <BadgeStatut tonalite={tonaliteNiveau(b.autonomie.niveau_effectif)}>
              {`Effectif ${b.autonomie.niveau_effectif}`}
            </BadgeStatut>
          ) : undefined
        }
        retour={{ href: "/agents/autonomie", libelle: "Toutes les briques" }}
      />

      <Carte titre="Niveau d'autonomie">
        <dl className="mp-liste-def">
          <div>
            <dt>Accordé</dt>
            <dd>{libelleNiveau(b.niveau_accorde)}</dd>
          </div>
          {b.autonomie ? (
            <>
              <div>
                <dt>Effectif</dt>
                <dd>{libelleNiveau(b.autonomie.niveau_effectif)}</dd>
              </div>
              <div>
                <dt>Plafond appliqué</dt>
                <dd>{b.autonomie.plafond}</dd>
              </div>
              {b.autonomie.raisons.length > 0 ? (
                <div>
                  <dt>Limité par</dt>
                  <dd>{libelleRaisonsNiveau(b.autonomie.raisons)}</dd>
                </div>
              ) : null}
            </>
          ) : null}
          <div>
            <dt>Depuis le</dt>
            <dd>{formaterDateHeure(b.depuis)}</dd>
          </div>
        </dl>
      </Carte>

      <Carte titre="Résultats au niveau actuel">
        <div className="mp-pile">
          <dl className="mp-agents__chiffres">
            <div>
              <dt>Exécutions décidées</dt>
              <dd>{stats.executions}</dd>
            </div>
            <div>
              <dt>Acceptées sans modification majeure</dt>
              <dd>{stats.accepteesSansModificationMajeure}</dd>
            </div>
            <div>
              <dt>Taux d&apos;acceptation</dt>
              <dd>{formaterPart(b.eligibilite.evaluation.tauxAcceptation)}</dd>
            </div>
            <div>
              <dt>Incidents majeurs (90 jours)</dt>
              <dd>{stats.incidentsMajeursFenetre}</dd>
            </div>
          </dl>
          <Alerte tonalite={elig.tonalite === "succes" ? "succes" : "info"} titre={elig.titre}>
            {elig.details.length > 0 ? (
              <ul>
                {elig.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </Alerte>
        </div>
      </Carte>

      {droits.decider ? (
        <Carte titre="Décision d'un associé">
          <FormulaireDecisionAutonomie
            code={b.code}
            accorde={b.niveau_accorde}
            plafond={b.autonomie?.plafond ?? b.niveau_max}
          />
        </Carte>
      ) : null}

      <Carte titre="Signaler un incident">
        <FormulaireIncident code={b.code} />
      </Carte>

      <Carte titre="Historique des niveaux">
        {b.historique.evenements.length === 0 ? (
          <p className="mp-texte-doux">Aucun événement.</p>
        ) : (
          <ul className="mp-agents__historique">
            {b.historique.evenements.map((e) => (
              <li key={e.id}>
                <strong>{LIBELLES_EVENEMENT[e.type]}</strong> :{" "}
                {e.niveau_avant ? `${e.niveau_avant} → ` : ""}
                {e.niveau_apres} — {e.motif}
                <span className="mp-texte-doux mp-texte-petit">
                  {" "}
                  ({e.auteur_nom ?? "automatique"}, {formaterDateHeure(e.cree_le)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre="Incidents">
        {b.historique.incidents.length === 0 ? (
          <p className="mp-texte-doux">Aucun incident signalé.</p>
        ) : (
          <ul className="mp-agents__historique">
            {b.historique.incidents.map((i) => (
              <li key={i.id}>
                <BadgeStatut tonalite={i.gravite === "majeur" ? "danger" : "attention"}>
                  {i.gravite === "majeur" ? "Majeur" : "Mineur"}
                </BadgeStatut>{" "}
                {i.description}
                <span className="mp-texte-doux mp-texte-petit">
                  {" "}
                  ({i.signale_par_nom}, {formaterDateHeure(i.cree_le)})
                </span>
              </li>
            ))}
          </ul>
        )}
        {b.historique.tronque ? (
          <p className="mp-texte-petit mp-texte-doux">
            Seuls les 100 éléments les plus récents sont affichés.
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
