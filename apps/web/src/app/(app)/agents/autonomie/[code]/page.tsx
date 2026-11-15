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
  libelleEvenement,
  libelleRaisonsNiveau,
  presentationEligibilite,
  tonaliteNiveau,
  type DetailBriqueIa,
} from "../../../../../lib/agents";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { obtenirSession } from "../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Autonomie d'une brique", "Building block autonomy") };
}

/**
 * Autonomie d'une brique : niveau effectif et ce qui le limite, statistiques et éligibilité à
 * la promotion (moteur pur), décision d'un associé, incidents et historique des niveaux.
 */
export default async function PageBrique({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const { utilisateur } = await obtenirSession();
  const droits = droitsAgents(utilisateur.roles);
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerServeur<DetailBriqueIa>(`/api/agents/briques/${encodeURIComponent(code)}`);
  if (!r.ok) {
    return (
      <div className="mp-page mp-agents">
        <EnteteDePage
          titre={t("Autonomie d'une brique", "Building block autonomy")}
          retour={{
            href: "/agents/autonomie",
            libelle: t("Toutes les briques", "All building blocks"),
          }}
        />
        <EtatErreur
          titre={
            r.statut === 404
              ? t("Brique introuvable.", "Building block not found.")
              : t("La brique n'a pas pu être chargée.", "The building block could not be loaded.")
          }
          message={r.message}
          hrefReessayer={hrefBrique(code)}
        />
      </div>
    );
  }
  const b = r.donnees;
  const elig = presentationEligibilite(b.eligibilite, langue);
  const stats = b.eligibilite.statistiques;

  return (
    <div className="mp-page mp-agents">
      <EnteteDePage
        titre={t(`Brique ${b.code}`, `Building block ${b.code}`)}
        soustitre={`${b.agent?.nom ?? t("Agent inconnu", "Unknown agent")} · ${libelleClasse(b.classe_risque, langue)} · ${t("plafond", "ceiling")} ${b.niveau_max}`}
        badges={
          b.autonomie ? (
            <BadgeStatut tonalite={tonaliteNiveau(b.autonomie.niveau_effectif)}>
              {t(
                `Effectif ${b.autonomie.niveau_effectif}`,
                `Effective ${b.autonomie.niveau_effectif}`,
              )}
            </BadgeStatut>
          ) : undefined
        }
        retour={{
          href: "/agents/autonomie",
          libelle: t("Toutes les briques", "All building blocks"),
        }}
      />

      <Carte titre={t("Niveau d'autonomie", "Autonomy level")}>
        <dl className="mp-liste-def">
          <div>
            <dt>{t("Accordé", "Granted")}</dt>
            <dd>{libelleNiveau(b.niveau_accorde, langue)}</dd>
          </div>
          {b.autonomie ? (
            <>
              <div>
                <dt>{t("Effectif", "Effective")}</dt>
                <dd>{libelleNiveau(b.autonomie.niveau_effectif, langue)}</dd>
              </div>
              <div>
                <dt>{t("Plafond appliqué", "Ceiling applied")}</dt>
                <dd>{b.autonomie.plafond}</dd>
              </div>
              {b.autonomie.raisons.length > 0 ? (
                <div>
                  <dt>{t("Limité par", "Limited by")}</dt>
                  <dd>{libelleRaisonsNiveau(b.autonomie.raisons, langue)}</dd>
                </div>
              ) : null}
            </>
          ) : null}
          <div>
            <dt>{t("Depuis le", "Since")}</dt>
            <dd>{formaterDateHeure(b.depuis, undefined, langue)}</dd>
          </div>
        </dl>
      </Carte>

      <Carte titre={t("Résultats au niveau actuel", "Results at the current level")}>
        <div className="mp-pile">
          <dl className="mp-agents__chiffres">
            <div>
              <dt>{t("Exécutions décidées", "Executions decided")}</dt>
              <dd>{stats.executions}</dd>
            </div>
            <div>
              <dt>{t("Acceptées sans modification majeure", "Accepted without major edits")}</dt>
              <dd>{stats.accepteesSansModificationMajeure}</dd>
            </div>
            <div>
              <dt>{t("Taux d'acceptation", "Acceptance rate")}</dt>
              <dd>{formaterPart(b.eligibilite.evaluation.tauxAcceptation, langue)}</dd>
            </div>
            <div>
              <dt>{t("Incidents majeurs (90 jours)", "Major incidents (90 days)")}</dt>
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
        <Carte titre={t("Décision d'un associé", "Partner decision")}>
          <FormulaireDecisionAutonomie
            code={b.code}
            accorde={b.niveau_accorde}
            plafond={b.autonomie?.plafond ?? b.niveau_max}
          />
        </Carte>
      ) : null}

      <Carte titre={t("Signaler un incident", "Report an incident")}>
        <FormulaireIncident code={b.code} majeur={droits.incidentMajeur} />
      </Carte>

      <Carte titre={t("Historique des niveaux", "Level history")}>
        {b.historique.evenements.length === 0 ? (
          <p className="mp-texte-doux">{t("Aucun événement.", "No events.")}</p>
        ) : (
          <ul className="mp-agents__historique">
            {b.historique.evenements.map((e) => (
              <li key={e.id}>
                <strong>{libelleEvenement(e.type, langue)}</strong>
                {t(" :", ":")} {e.niveau_avant ? `${e.niveau_avant} → ` : ""}
                {e.niveau_apres} — {e.motif}
                <span className="mp-texte-doux mp-texte-petit">
                  {" "}
                  ({e.auteur_nom ?? t("automatique", "automatic")},{" "}
                  {formaterDateHeure(e.cree_le, undefined, langue)})
                </span>
              </li>
            ))}
          </ul>
        )}
      </Carte>

      <Carte titre={t("Incidents", "Incidents")}>
        {b.historique.incidents.length === 0 ? (
          <p className="mp-texte-doux">{t("Aucun incident signalé.", "No incidents reported.")}</p>
        ) : (
          <ul className="mp-agents__historique">
            {b.historique.incidents.map((i) => (
              <li key={i.id}>
                <BadgeStatut tonalite={i.gravite === "majeur" ? "danger" : "attention"}>
                  {i.gravite === "majeur" ? t("Majeur", "Major") : t("Mineur", "Minor")}
                </BadgeStatut>{" "}
                {i.description}
                <span className="mp-texte-doux mp-texte-petit">
                  {" "}
                  ({i.signale_par_nom}, {formaterDateHeure(i.cree_le, undefined, langue)})
                </span>
              </li>
            ))}
          </ul>
        )}
        {b.historique.tronque ? (
          <p className="mp-texte-petit mp-texte-doux">
            {t(
              "Seuls les 100 éléments les plus récents sont affichés.",
              "Only the 100 most recent items are shown.",
            )}
          </p>
        ) : null}
      </Carte>
    </div>
  );
}
