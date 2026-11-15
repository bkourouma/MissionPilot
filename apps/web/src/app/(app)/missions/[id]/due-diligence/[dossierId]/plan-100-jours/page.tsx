import type { Metadata } from "next";
import { FormulaireAction } from "../../../../../../../components/due-diligence/FormulaireAction";
import { FrisePlan100j } from "../../../../../../../components/due-diligence/FrisePlan100j";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminPlan100j,
  droitsDd,
  formaterBp,
  hrefEcranDossier,
  phraseJourCourant,
  type ReponsePlan100j,
} from "../../../../../../../lib/due-diligence";
import { chargerChoixLiensPlan } from "../../../../../../../lib/due-diligence-serveur";
import { formaterDate } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Plan des 100 jours", "100-day plan") };
}

/**
 * Plan des 100 jours (DD-15) : actions réparties en trois phases, reliées à une initiative d'un
 * plan stratégique (service #3) et à un indicateur (service #4). Dates, phases, retards et taux de
 * réalisation sont calculés par l'API ; un lien non visible de l'appelant n'expose aucun titre.
 */
export default async function PagePlan100jDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const [r, liens] = await Promise.all([
    chargerServeur<ReponsePlan100j>(cheminPlan100j(dossierId)),
    droits.ecrire
      ? chargerChoixLiensPlan(mission.donnees.client_id, utilisateur.roles)
      : Promise.resolve(null),
  ]);
  if (!r.ok) {
    return (
      <EtatErreur
        titre={t(
          "Le plan des 100 jours n'a pas pu être chargé.",
          "The 100-day plan could not be loaded.",
        )}
        message={r.message}
        hrefReessayer={hrefEcranDossier(id, dossierId, "plan-100-jours")}
      />
    );
  }
  const { actions, synthese: s, date_operation: dateOperation } = r.donnees;
  const choix = liens
    ? {
        equipe: mission.donnees.equipe.map((m) => ({ valeur: m.utilisateur_id, libelle: m.nom })),
        initiatives: liens.initiatives,
        indicateurs: liens.indicateurs,
        partiel: liens.partiel,
      }
    : null;
  const libelleAction = (idAction: string) => actions.find((a) => a.id === idAction)?.libelle;
  const nommer = (ids: string[]) =>
    ids
      .map((i) => libelleAction(i))
      .filter(Boolean)
      .join(", ");

  return (
    <>
      {dateOperation === null ? (
        <Alerte
          tonalite="info"
          titre={t("Date d'opération non précisée", "Transaction date not specified")}
          annonce="aucune"
        >
          <p>
            {t(
              "Les actions sont positionnées en jours après l'opération. Renseignez la date d'opération dans le cadrage pour afficher les dates et repérer les retards.",
              "Actions are positioned in days after the transaction. Enter the transaction date in the scoping to show dates and spot delays.",
            )}
          </p>
        </Alerte>
      ) : (
        <p className="mp-texte-doux">
          {t(
            `Date d'opération : ${formaterDate(dateOperation)}.`,
            `Transaction date: ${formaterDate(dateOperation, "UTC", langue)}.`,
          )}
        </p>
      )}

      {actions.length === 0 ? (
        <p className="mp-texte-doux" role="status">
          {droits.ecrire
            ? t(
                "Aucune action n'est planifiée : ajoutez la première ci-dessous.",
                "No action is planned: add the first one below.",
              )
            : t("Aucune action n'est planifiée pour le moment.", "No action is planned for now.")}
        </p>
      ) : (
        <>
          <Carte titre={t("Avancement", "Progress")} niveauTitre={3}>
            <div className="mp-dd-pile">
              <p className="mp-dd-chiffre">{formaterBp(s.taux_realisation_bp, langue)}</p>
              <p className="mp-texte-petit">
                {t(
                  `des actions sont terminées (${s.terminees} sur ${s.total}).`,
                  `of actions are done (${s.terminees} out of ${s.total}).`,
                )}
                {phraseJourCourant(s.jour_courant, langue)}
              </p>
              {s.en_retard.length > 0 ? (
                <Alerte
                  tonalite="danger"
                  titre={t("Actions en retard", "Overdue actions")}
                  annonce="aucune"
                >
                  <p>{nommer(s.en_retard)}</p>
                </Alerte>
              ) : null}
              {s.sans_responsable.length > 0 || s.sans_indicateur.length > 0 ? (
                <Alerte
                  tonalite="attention"
                  titre={t("Actions à compléter", "Actions to complete")}
                  annonce="aucune"
                >
                  {s.sans_responsable.length > 0 ? (
                    <p>{`${t("Sans responsable", "No owner")} : ${nommer(s.sans_responsable)}.`}</p>
                  ) : null}
                  {s.sans_indicateur.length > 0 ? (
                    <p>{`${t("Sans indicateur", "No KPI")} : ${nommer(s.sans_indicateur)}.`}</p>
                  ) : null}
                </Alerte>
              ) : null}
            </div>
          </Carte>
          <FrisePlan100j
            dossierId={dossierId}
            actions={actions}
            avecDates={dateOperation !== null}
            edition={choix}
          />
        </>
      )}

      {droits.ecrire && choix ? (
        <Carte titre={t("Nouvelle action", "New action")} niveauTitre={3}>
          <FormulaireAction dossierId={dossierId} choix={choix} />
        </Carte>
      ) : null}
    </>
  );
}
