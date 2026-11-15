import Link from "next/link";
import { formaterDate, formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  estClotureAction,
  hrefCampagne,
  libelleCritere,
  libelleGravite,
  libelleStatutAction,
  statutsSuivants,
  tonaliteStatutAction,
  type ActionFroide,
} from "../../lib/qualite-froide";
import { BadgeStatut } from "../ui/BadgeStatut";
import { FroideSuiviAction } from "./FroideSuiviAction";

export interface FroideListeActionsProps {
  actions: ActionFroide[];
  /** Utilisateur connecté : le responsable change le statut de SON action. */
  utilisateurId: string;
  /** Associé : responsable et échéance modifiables, lien vers la campagne. */
  peutGerer: boolean;
  responsables: { valeur: string; libelle: string }[];
  afficherCampagne?: boolean;
}

/** Actions du plan d'amélioration : état, constat d'origine, historique et formulaire de suivi. */
export async function FroideListeActions({
  actions,
  utilisateurId,
  peutGerer,
  responsables,
  afficherCampagne = false,
}: FroideListeActionsProps) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const d = (v: string | null | undefined) => formaterDate(v, "UTC", langue);
  return (
    <ul className="mp-froide__liste">
      {actions.map((a) => {
        const suivi =
          !estClotureAction(a.statut) && (peutGerer || a.responsable_id === utilisateurId);
        return (
          <li key={a.id} className="mp-froide__element">
            <div className="mp-froide__ligne">
              <strong>{a.titre}</strong>
              <BadgeStatut tonalite={tonaliteStatutAction(a)}>
                {libelleStatutAction(a.statut, langue)}
              </BadgeStatut>
              {a.en_retard ? (
                <BadgeStatut tonalite="danger">{t("En retard", "Overdue")}</BadgeStatut>
              ) : null}
            </div>
            <p className="mp-texte-doux mp-texte-petit">
              {t("Responsable", "Owner")} : {a.responsable_nom ?? "—"} · {t("échéance", "due")}{" "}
              {d(a.echeance)}
              {a.cloturee_le
                ? t(` · clôturée le ${d(a.cloturee_le)}`, ` · closed on ${d(a.cloturee_le)}`)
                : ""}
              {afficherCampagne && a.campagne_intitule ? (
                <>
                  {` · ${t("campagne", "campaign")} `}
                  {peutGerer ? (
                    <Link href={hrefCampagne(a.campagne_id)} className="mp-lien-ligne">
                      {a.campagne_intitule}
                    </Link>
                  ) : (
                    a.campagne_intitule
                  )}
                </>
              ) : null}
            </p>
            {a.description ? <p>{a.description}</p> : null}
            {a.constat ? (
              <p className="mp-texte-petit">
                {t("Constat lié", "Linked finding")} (
                {libelleGravite(a.constat.gravite, langue).toLowerCase()},{" "}
                {libelleCritere(a.constat.critere, langue)}) : {a.constat.description}
              </p>
            ) : null}
            {a.historique && a.historique.length > 0 ? (
              <details>
                <summary>
                  {t("Historique", "History")} ({a.historique.length})
                </summary>
                <ol>
                  {a.historique.map((h) => (
                    <li key={h.rang}>
                      {formaterDateHeure(h.le, undefined, langue)} : {h.auteur_nom ?? "—"},{" "}
                      {h.de_statut
                        ? `${libelleStatutAction(h.de_statut, langue)} → `
                        : t("création : ", "created: ")}
                      {libelleStatutAction(h.vers_statut, langue)}
                      {h.commentaire ? ` · ${h.commentaire}` : ""}
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            {suivi && (peutGerer || statutsSuivants(a.statut).length > 0) ? (
              <FroideSuiviAction
                action={{
                  id: a.id,
                  titre: a.titre,
                  statut: a.statut,
                  responsable_id: a.responsable_id,
                  echeance: a.echeance,
                }}
                peutGerer={peutGerer}
                responsables={responsables}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
