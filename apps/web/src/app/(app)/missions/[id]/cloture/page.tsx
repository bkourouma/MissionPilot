import Link from "next/link";
import type { Metadata } from "next";
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
  raisonClotureImpossible,
  type EvaluationClotureVue,
} from "../../../../../lib/cloture";
import { formaterDateHeure } from "../../../../../lib/format";
import { chargerMission } from "../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../lib/session";
import { ActionsItemCloture, BarreCloture } from "./ActionsCloture";

export const metadata: Metadata = { title: "Clôture de la mission" };

/**
 * Check-list de clôture de la mission (AUT-08) : état de chaque item du modèle du cabinet, lien
 * vers l'écran qui le traite, dérogation motivée, et bouton de clôture activé seulement si
 * aucun item bloquant n'est ouvert. La décision est celle de l'API.
 */
export default async function PageClotureMission({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { utilisateur } = await exigerPermission("mission.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const m = r.donnees;
  const e = await chargerServeur<EvaluationClotureVue>(`/api/missions/${m.id}/cloture`);
  if (!e.ok) {
    return (
      <EtatErreur
        titre="La check-list de clôture n'a pas pu être chargée."
        message={e.message}
        hrefReessayer={`/missions/${m.id}/cloture`}
      />
    );
  }
  const evaluation = e.donnees;
  const droits = droitsCloture(utilisateur.roles, evaluation.statut_mission);
  const actifs = evaluation.items.filter((i) => i.actif);
  const anomalies = compterAnomalies(evaluation.items);
  const raison = raisonClotureImpossible(evaluation);

  return (
    <div className="mp-pile mp-pile--large">
      {evaluation.statut_mission === "cloturee" ? (
        <Alerte tonalite="info" titre="Mission clôturée">
          <p>La check-list est conservée à titre de trace ; elle ne peut plus changer.</p>
        </Alerte>
      ) : evaluation.autorisee ? (
        <Alerte tonalite="succes" titre="Aucun item bloquant">
          <p>
            {anomalies.avertissements > 0
              ? `${anomalies.avertissements} item(s) non bloquant(s) restent à traiter.`
              : "Tous les items actifs sont conformes."}
            {anomalies.deroges > 0 ? ` ${anomalies.deroges} dérogation(s) en vigueur.` : ""}
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="danger" titre="Clôture bloquée">
          <p>{anomalies.bloquants} item(s) bloquant(s) à traiter ou à déroger avant de clôturer.</p>
        </Alerte>
      )}
      <Carte titre="Check-list de clôture">
        {actifs.length === 0 ? (
          <p className="mp-texte-doux">
            Aucun item actif dans le modèle du cabinet : la clôture n&apos;est soumise à aucune
            vérification.
          </p>
        ) : (
          <ul className="mp-liste-lignes" aria-label="Items de la check-list">
            {actifs.map((item) => {
              const lien = hrefControleCloture(item.controle, m.id);
              const ecarts = libelleEcarts(item);
              const etat = ETAT_ITEM_CLOTURE[item.etat];
              return (
                <li key={item.controle} className="mp-liste-lignes__ligne">
                  <span className="mp-liste-lignes__texte">
                    <strong>{item.libelle}</strong>
                    <span className="mp-texte-doux">{item.description}</span>
                    <span className="mp-texte-doux">
                      {item.bloquant ? "Bloquant" : "Non bloquant"}
                      {ecarts ? ` · ${ecarts}` : ""}
                      {item.verifie_le ? ` · vérifié le ${formaterDateHeure(item.verifie_le)}` : ""}
                    </span>
                    {item.derogation ? (
                      <span className="mp-texte-doux">
                        Dérogation de {item.derogation.par_nom ?? "un responsable"} le{" "}
                        {formaterDateHeure(item.derogation.le)} : {item.derogation.motif}
                      </span>
                    ) : null}
                    {item.attestation?.attestee ? (
                      <span className="mp-texte-doux">
                        Attestée par {item.attestation.par_nom ?? "un membre de l'équipe"} le{" "}
                        {formaterDateHeure(item.attestation.le)}
                        {item.attestation.note ? ` : ${item.attestation.note}` : ""}
                      </span>
                    ) : null}
                    {lien && item.etat !== "conforme" ? (
                      <Link href={lien}>Ouvrir l&apos;écran concerné</Link>
                    ) : null}
                  </span>
                  <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
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
