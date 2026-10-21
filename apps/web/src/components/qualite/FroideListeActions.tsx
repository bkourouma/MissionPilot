import Link from "next/link";
import { formaterDate, formaterDateHeure } from "../../lib/format";
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
export function FroideListeActions({
  actions,
  utilisateurId,
  peutGerer,
  responsables,
  afficherCampagne = false,
}: FroideListeActionsProps) {
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
                {libelleStatutAction(a.statut)}
              </BadgeStatut>
              {a.en_retard ? <BadgeStatut tonalite="danger">En retard</BadgeStatut> : null}
            </div>
            <p className="mp-texte-doux mp-texte-petit">
              Responsable : {a.responsable_nom ?? "—"} · échéance {formaterDate(a.echeance)}
              {a.cloturee_le ? ` · clôturée le ${formaterDate(a.cloturee_le)}` : ""}
              {afficherCampagne && a.campagne_intitule ? (
                <>
                  {" · campagne "}
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
                Constat lié ({libelleGravite(a.constat.gravite).toLowerCase()},{" "}
                {libelleCritere(a.constat.critere)}) : {a.constat.description}
              </p>
            ) : null}
            {a.historique && a.historique.length > 0 ? (
              <details>
                <summary>Historique ({a.historique.length})</summary>
                <ol>
                  {a.historique.map((h) => (
                    <li key={h.rang}>
                      {formaterDateHeure(h.le)} : {h.auteur_nom ?? "—"},{" "}
                      {h.de_statut ? `${libelleStatutAction(h.de_statut)} → ` : "création : "}
                      {libelleStatutAction(h.vers_statut)}
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
