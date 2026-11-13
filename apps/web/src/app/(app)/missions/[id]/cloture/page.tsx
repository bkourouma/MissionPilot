import Link from "next/link";
import type { Metadata } from "next";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import {
  clotureActivable,
  compterAnomalies,
  droitsCloture,
  ETAT_ITEM_CLOTURE,
  hrefControleCloture,
  libelleEcarts,
  libelleEtatItemCloture,
  raisonClotureImpossible,
  type EvaluationClotureVue,
} from "../../../../../lib/cloture";
import { formaterDateHeure } from "../../../../../lib/format";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { ActionsItemCloture, BarreCloture } from "./ActionsCloture";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Clôture de la mission", "Engagement close-out") };
}

/**
 * Check-list de clôture de la mission (AUT-08) : état de chaque item du modèle du cabinet, lien
 * vers l'écran qui le traite, dérogation motivée, et bouton de clôture activé seulement si
 * aucun item bloquant n'est ouvert. La décision est celle de l'API.
 */
export default async function PageClotureMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const e = await chargerServeur<EvaluationClotureVue>(`/api/missions/${m.id}/cloture`);
  if (!e.ok) {
    return (
      <EtatErreur
        titre={t(
          "La check-list de clôture n'a pas pu être chargée.",
          "The close-out checklist could not be loaded.",
        )}
        message={e.message}
        hrefReessayer={`/missions/${m.id}/cloture`}
      />
    );
  }
  const evaluation = e.donnees;
  const droits = droitsCloture(utilisateur.roles, evaluation.statut_mission);
  const actifs = evaluation.items.filter((i) => i.actif);
  const anomalies = compterAnomalies(evaluation.items);
  const raison = raisonClotureImpossible(evaluation, langue);

  return (
    <div className="mp-pile mp-pile--large">
      {evaluation.statut_mission === "cloturee" ? (
        <Alerte tonalite="info" titre={t("Mission clôturée", "Engagement closed")}>
          <p>
            {t(
              "La check-list est conservée à titre de trace ; elle ne peut plus changer.",
              "The checklist is kept as a record; it can no longer change.",
            )}
          </p>
        </Alerte>
      ) : evaluation.autorisee ? (
        <Alerte tonalite="succes" titre={t("Aucun item bloquant", "No blocking item")}>
          <p>
            {anomalies.avertissements > 0
              ? t(
                  `${anomalies.avertissements} item(s) non bloquant(s) restent à traiter.`,
                  `${anomalies.avertissements} non-blocking item(s) remain to be addressed.`,
                )
              : t("Tous les items actifs sont conformes.", "All active items are compliant.")}
            {anomalies.deroges > 0
              ? t(
                  ` ${anomalies.deroges} dérogation(s) en vigueur.`,
                  ` ${anomalies.deroges} waiver(s) in effect.`,
                )
              : ""}
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="danger" titre={t("Clôture bloquée", "Close-out blocked")}>
          <p>
            {t(
              `${anomalies.bloquants} item(s) bloquant(s) à traiter ou à déroger avant de clôturer.`,
              `${anomalies.bloquants} blocking item(s) to resolve or waive before closing.`,
            )}
          </p>
        </Alerte>
      )}
      <Carte titre={t("Check-list de clôture", "Close-out checklist")}>
        {actifs.length === 0 ? (
          <p className="mp-texte-doux">
            {t(
              "Aucun item actif dans le modèle du cabinet : la clôture n'est soumise à aucune vérification.",
              "No active item in the firm's template: close-out is not subject to any verification.",
            )}
          </p>
        ) : (
          <ul
            className="mp-liste-lignes"
            aria-label={t("Items de la check-list", "Checklist items")}
          >
            {actifs.map((item) => {
              const lien = hrefControleCloture(item.controle, m.id);
              const ecarts = libelleEcarts(item, langue);
              const etat = ETAT_ITEM_CLOTURE[item.etat];
              return (
                <li key={item.controle} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{item.libelle}</strong>
                    <span className="mp-texte-doux">{item.description}</span>
                    <span className="mp-texte-doux">
                      {item.bloquant
                        ? t("Bloquant", "Blocking")
                        : t("Non bloquant", "Non-blocking")}
                      {ecarts ? ` · ${ecarts}` : ""}
                      {item.verifie_le
                        ? t(
                            ` · vérifié le ${formaterDateHeure(item.verifie_le, undefined, langue)}`,
                            ` · verified on ${formaterDateHeure(item.verifie_le, undefined, langue)}`,
                          )
                        : ""}
                    </span>
                    {item.derogation ? (
                      <span className="mp-texte-doux">
                        {t("Dérogation de", "Waiver by")}{" "}
                        {item.derogation.par_nom ?? t("un responsable", "a manager")}{" "}
                        {t("le", "on")} {formaterDateHeure(item.derogation.le, undefined, langue)} :{" "}
                        {item.derogation.motif}
                      </span>
                    ) : null}
                    {item.attestation?.attestee ? (
                      <span className="mp-texte-doux">
                        {t("Attestée par", "Attested by")}{" "}
                        {item.attestation.par_nom ?? t("un membre de l'équipe", "a team member")}{" "}
                        {t("le", "on")} {formaterDateHeure(item.attestation.le, undefined, langue)}
                        {item.attestation.note ? ` : ${item.attestation.note}` : ""}
                      </span>
                    ) : null}
                    {lien && item.etat !== "conforme" ? (
                      <Link href={lien}>
                        {t("Ouvrir l'écran concerné", "Open the related screen")}
                      </Link>
                    ) : null}
                  </span>
                  <BadgeStatut tonalite={etat.tonalite}>
                    {libelleEtatItemCloture(item.etat, langue)}
                  </BadgeStatut>
                  <ActionsItemCloture missionId={m.id} item={item} droits={droits} />
                </li>
              );
            })}
          </ul>
        )}
      </Carte>
      <BarreCloture
        missionId={m.id}
        droits={droits}
        activable={clotureActivable(evaluation, droits)}
        raison={raison}
      />
    </div>
  );
}
