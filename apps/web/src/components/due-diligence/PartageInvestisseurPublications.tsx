"use client";

import type { DdPortailPublicationCabinet } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  badgePublication,
  cheminRetraitPublication,
  libelleRapport,
} from "../../lib/due-diligence-portail";
import { libellesDd } from "../../lib/due-diligence";
import { formaterDate } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EtatVide } from "../ui/EtatListe";
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
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
  const p = usePartageInvestisseur();
  if (publications.length === 0) {
    return (
      <EtatVide icone="envoyer" titre={t("Aucune note publiée", "No published memo")}>
        <p>
          {t(
            "Publiez une note validée pour la rendre visible aux investisseurs invités.",
            "Publish an approved memo to make it visible to invited investors.",
          )}
        </p>
      </EtatVide>
    );
  }
  return (
    <div className="mp-dd-pile">
      <PartageInvestisseurRetour erreur={p.erreur} succes={p.succes} />
      <ul className="mp-dd-liste" aria-label={t("Publications actives", "Active publications")}>
        {publications.map((pub) => {
          const badge = badgePublication(pub, langue);
          return (
            <li key={pub.id} className="mp-dd-element">
              <h4 className="mp-dd-element__titre">{pub.titre}</h4>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={badge.tonalite}>{badge.libelle}</BadgeStatut>
                <BadgeStatut tonalite="neutre" sansIcone>
                  {L.RECOMMANDATION[pub.recommandation] ?? pub.recommandation}
                </BadgeStatut>
              </span>
              <p className="mp-texte-doux mp-texte-petit">
                {t(
                  `Version ${pub.version} · validée le ${formaterDate(pub.valide_le)} · publiée le ${formaterDate(pub.publie_le)}`,
                  `Version ${pub.version} · approved on ${formaterDate(pub.valide_le, "UTC", langue)} · published on ${formaterDate(pub.publie_le, "UTC", langue)}`,
                )}
              </p>
              {pub.perimee ? (
                <Alerte
                  tonalite="attention"
                  titre={t("Publication périmée", "Outdated publication")}
                  annonce="aucune"
                >
                  <p>
                    {t(
                      "Une version plus récente de la note a été soumise. Retirez cette publication puis publiez la nouvelle version une fois validée.",
                      "A more recent version of the memo has been submitted. Withdraw this publication, then publish the new version once approved.",
                    )}
                  </p>
                </Alerte>
              ) : null}
              <p className="mp-texte-petit">
                {pub.pieces.length === 0
                  ? t("Aucun rapport joint.", "No report attached.")
                  : t(
                      `Rapports joints : ${pub.pieces.map((r) => libelleRapport(r)).join(", ")}.`,
                      `Attached reports: ${pub.pieces.map((r) => libelleRapport(r, langue)).join(", ")}.`,
                    )}
              </p>
              <BoutonConfirmation
                libelle={t("Retirer", "Withdraw")}
                ariaLabel={t(
                  `Retirer la publication ${pub.titre}`,
                  `Withdraw the publication ${pub.titre}`,
                )}
                question={t(
                  "Retirer cette publication ? Les investisseurs ne pourront plus la consulter.",
                  "Withdraw this publication? Investors will no longer be able to view it.",
                )}
                libelleConfirmation={t("Oui, retirer", "Yes, withdraw")}
                texteChargement={t("Retrait…", "Withdrawing…")}
                action={() =>
                  p.executer(
                    () => api.post(cheminRetraitPublication(pub.id)),
                    t("Publication retirée.", "Publication withdrawn."),
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
