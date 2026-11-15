import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  FormulaireCommentaireAction,
  FormulaireStatutAction,
} from "../../../../../../../components/kpi/FormulairesActionKpi";
import "../../../../../../../components/kpi/kpi.css";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../lib/identifiant";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { droitsKpi, hrefKpi } from "../../../../../../../lib/kpi";
import {
  AVERTISSEMENT_EFFICACITE,
  AVERTISSEMENT_EFFICACITE_EN,
  cheminAction,
  enRetard,
  hrefAction,
  hrefActions,
  hrefRevue,
  libelleStatutAction,
  texteEfficaciteDetail,
  texteVerdict,
  type ActionKpi,
  type EvenementAction,
} from "../../../../../../../lib/kpi-pilotage";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../../lib/periode";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Action corrective", "Corrective action") };
}

const TYPES: Record<EvenementAction["type"], [string, string]> = {
  creation: ["Création", "Creation"],
  statut: ["Changement de statut", "Status change"],
  modification: ["Modification", "Edit"],
  commentaire: ["Commentaire", "Comment"],
};

/**
 * Une action corrective : son rattachement (KPI, alerte, décision de revue), son statut, son
 * efficacité mesurée par le moteur une fois terminée, et son historique en ajout seul.
 */
export default async function PageActionKpi({
  params,
}: {
  params: Promise<{ id: string; actionId: string }>;
}) {
  const { id, actionId } = await params;
  if (!estIdentifiant(actionId)) notFound();
  const { utilisateur } = await exigerPermission("kpi.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const a = await chargerServeur<ActionKpi>(cheminAction(actionId));
  if (!a.ok && a.statut === 404) notFound();
  if (!a.ok) {
    return (
      <EtatErreur
        titre={t("L'action n'a pas pu être chargée.", "The action could not be loaded.")}
        message={a.message}
        hrefReessayer={hrefAction(m.id, actionId)}
      />
    );
  }
  // Une action d'une autre mission que celle de l'URL n'existe pas pour cette page.
  if (a.donnees.mission_id !== m.id) notFound();
  const action = a.donnees;
  const jour = aujourdhui();
  const droits = droitsKpi(utilisateur.roles, utilisateur.id, m);
  const peutAgir = droits.gerer || droits.saisir || action.responsable_id === utilisateur.id;
  const e = action.efficacite;
  return (
    <div className="mp-kpi">
      <div className="mp-actions-formulaire">
        <Link href={hrefActions(m.id)} className={classesBouton("secondaire")}>
          {t("Revenir aux actions", "Back to the actions")}
        </Link>
      </div>
      <h2 className="mp-kpi-section__titre">
        {t("Action", "Action")} {action.numero} — {action.titre}
      </h2>
      <Carte titre={t("Situation", "Situation")}>
        <dl className="mp-kpi-mesures">
          <div>
            <dt>{t("Statut", "Status")}</dt>
            <dd>
              {libelleStatutAction(action.statut, langue)}
              {enRetard(action.echeance, action.statut, jour) ? (
                <>
                  {" "}
                  <BadgeStatut tonalite="danger">{t("En retard", "Overdue")}</BadgeStatut>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t("KPI concerné", "KPI concerned")}</dt>
            <dd>
              <Link href={hrefKpi(m.id, action.kpi_id)}>{action.kpi_libelle}</Link>
            </dd>
          </div>
          <div>
            <dt>{t("Responsable", "Owner")}</dt>
            <dd>{action.responsable_nom ?? "—"}</dd>
          </div>
          <div>
            <dt>{t("Échéance", "Due date")}</dt>
            <dd>{formaterDate(action.echeance, "UTC", langue)}</dd>
          </div>
          {action.date_effet ? (
            <div>
              <dt>{t("Date d'effet", "Effective date")}</dt>
              <dd>{formaterDate(action.date_effet, "UTC", langue)}</dd>
            </div>
          ) : null}
          {action.motif ? (
            <div>
              <dt>{t("Motif de l'abandon", "Reason for abandoning")}</dt>
              <dd>{action.motif}</dd>
            </div>
          ) : null}
          {action.revue_id ? (
            <div>
              <dt>{t("Décidée en revue", "Decided in review")}</dt>
              <dd>
                <Link href={hrefRevue(m.id, action.revue_id)}>
                  {t("Voir la revue", "See the review")}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {action.description ? <p>{action.description}</p> : null}
      </Carte>

      <Carte titre={t("Efficacité mesurée sur le KPI", "Effectiveness measured on the KPI")}>
        <p>
          <strong>{texteVerdict(e, langue)}</strong>
        </p>
        {e ? <p>{texteEfficaciteDetail(e, "", langue)}</p> : null}
        {e && e.periodes_avant.length + e.periodes_apres.length > 0 ? (
          <p className="mp-texte-doux">
            {t("Périodes comparées — avant :", "Periods compared — before:")}{" "}
            {e.periodes_avant.map((p) => p.periode).join(", ") || t("aucune", "none")}
            {t("; après :", "; after:")}{" "}
            {e.periodes_apres.map((p) => p.periode).join(", ") || t("aucune", "none")}.
          </p>
        ) : null}
        <p className="mp-texte-doux">
          {langue === "en" ? AVERTISSEMENT_EFFICACITE_EN : AVERTISSEMENT_EFFICACITE}
        </p>
      </Carte>

      {peutAgir ? (
        <>
          <Carte titre={t("Faire avancer l'action", "Move the action forward")}>
            <FormulaireStatutAction action={action} jour={jour} />
          </Carte>
        </>
      ) : null}
      {peutAgir ? (
        <Carte titre={t("Ajouter un commentaire", "Add a comment")}>
          <FormulaireCommentaireAction actionId={action.id} />
        </Carte>
      ) : null}

      <Carte titre={t("Historique", "History")}>
        <Tableau<EvenementAction>
          legende={t(
            "Historique de l'action (en ajout seul)",
            "History of the action (append-only)",
          )}
          colonnes={[
            {
              cle: "date",
              entete: t("Date", "Date"),
              rendu: (x) => formaterDateHeure(x.cree_le, undefined, langue),
            },
            {
              cle: "type",
              entete: t("Événement", "Event"),
              rendu: (x) => t(TYPES[x.type][0], TYPES[x.type][1]),
            },
            { cle: "auteur_nom", entete: t("Auteur", "Author") },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (x) =>
                x.statut_avant && x.statut_avant !== x.statut_apres
                  ? `${libelleStatutAction(x.statut_avant as ActionKpi["statut"], langue)} → ${libelleStatutAction(x.statut_apres as ActionKpi["statut"], langue)}`
                  : libelleStatutAction(x.statut_apres as ActionKpi["statut"], langue),
            },
            { cle: "commentaire", entete: t("Commentaire", "Comment") },
          ]}
          lignes={action.evenements ?? []}
          cleLigne={(x) => x.id}
        />
      </Carte>
    </div>
  );
}
