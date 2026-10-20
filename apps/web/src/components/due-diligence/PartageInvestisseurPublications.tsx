"use client";

import {
  RECOMMANDATION_NOTE_LIBELLES,
  type DdPortailPublicationCabinet,
} from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  badgePublication,
  cheminRetraitPublication,
  libelleRapport,
} from "../../lib/due-diligence-portail";
import { formaterDate } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { BadgeStatut } from "../ui/BadgeStatut";
import { PartageInvestisseurRetour } from "./PartageInvestisseurRetour";
import { usePartageInvestisseur } from "./usePartageInvestisseur";

export interface PartageInvestisseurPublicationsProps {
  /** Publications non retirées, déjà filtrées côté serveur. */
  publications: DdPortailPublicationCabinet[];
}

/** Publications actives : version, pièces, badge « périmée » et retrait. */
export function PartageInvestisseurPublications({
  publications,
}: PartageInvestisseurPublicationsProps) {
  const p = usePartageInvestisseur();
  if (publications.length === 0) {
    return <p className="mp-texte-doux">Aucune note n&apos;est publiée pour le moment.</p>;
  }
  return (
    <div className="mp-dd-pile">
      <PartageInvestisseurRetour erreur={p.erreur} succes={p.succes} />
      <ul className="mp-dd-liste" aria-label="Publications actives">
        {publications.map((pub) => {
          const badge = badgePublication(pub);
          return (
            <li key={pub.id} className="mp-dd-element">
              <h4 className="mp-dd-element__titre">{pub.titre}</h4>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={badge.tonalite}>{badge.libelle}</BadgeStatut>
                <BadgeStatut tonalite="neutre" sansIcone>
                  {RECOMMANDATION_NOTE_LIBELLES[pub.recommandation] ?? pub.recommandation}
                </BadgeStatut>
              </span>
              <p className="mp-texte-doux mp-texte-petit">
                {`Version ${pub.version} · validée le ${formaterDate(pub.valide_le)} · publiée le ${formaterDate(pub.publie_le)}`}
              </p>
              {pub.perimee ? (
                <p className="mp-texte-petit">
                  Une version plus récente de la note a été soumise. Retirez cette publication puis
                  publiez la nouvelle version une fois validée.
                </p>
              ) : null}
              <p className="mp-texte-petit">
                {pub.pieces.length === 0
                  ? "Aucun rapport joint."
                  : `Rapports joints : ${pub.pieces.map(libelleRapport).join(", ")}.`}
              </p>
              <BoutonConfirmation
                libelle="Retirer"
                ariaLabel={`Retirer la publication ${pub.titre}`}
                question="Retirer cette publication ? Les investisseurs ne pourront plus la consulter."
                libelleConfirmation="Oui, retirer"
                texteChargement="Retrait…"
                action={() =>
                  p.executer(
                    () => api.post(cheminRetraitPublication(pub.id)),
                    "Publication retirée.",
                  )
                }
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
