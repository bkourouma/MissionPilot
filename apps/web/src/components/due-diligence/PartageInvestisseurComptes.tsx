"use client";

import type { DdPortailCompte } from "@missionpilot/shared";
import { api } from "../../lib/api";
import {
  actionCompte,
  cheminInvitationsPortailDd,
  cheminRetraitInvitationPortailDd,
  libelleCompte,
} from "../../lib/due-diligence-portail";
import { formaterDate } from "../../lib/format";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { EtatVide } from "../ui/EtatListe";
import { PartageInvestisseurRetour } from "./PartageInvestisseurRetour";
import { usePartageInvestisseur } from "./usePartageInvestisseur";

export interface PartageInvestisseurComptesProps {
  dossierId: string;
  comptes: DdPortailCompte[];
}

/** Comptes investisseurs du client du dossier : inviter ou retirer l'accès aux notes publiées. */
export function PartageInvestisseurComptes({
  dossierId,
  comptes,
}: PartageInvestisseurComptesProps) {
  const t = useT();
  const langue = useLangue();
  const p = usePartageInvestisseur();

  if (comptes.length === 0) {
    return (
      <EtatVide icone="personnes" titre={t("Aucun compte investisseur", "No investor account")}>
        <p>
          {t(
            "Aucun compte investisseur n'existe pour le client de ce dossier. Invitez d'abord l'investisseur dans l'espace client (rôle « Investisseur »).",
            "No investor account exists for this file's client. First invite the investor in the client space (“Investor” role).",
          )}
        </p>
      </EtatVide>
    );
  }

  return (
    <div className="mp-dd-pile">
      <PartageInvestisseurRetour erreur={p.erreur} succes={p.succes} />
      <ul
        className="mp-dd-liste"
        aria-label={t("Comptes investisseurs du dossier", "Investor accounts of the file")}
      >
        {comptes.map((c) => {
          const action = actionCompte(c);
          const etat = libelleCompte(c, langue);
          return (
            <li key={c.utilisateur_id} className="mp-dd-element">
              <h4 className="mp-dd-element__titre">{c.nom}</h4>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                {c.invite_le ? (
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(
                      `Invité le ${formaterDate(c.invite_le)}`,
                      `Invited on ${formaterDate(c.invite_le, "UTC", langue)}`,
                    )}
                  </span>
                ) : null}
              </span>
              {action === "inviter" ? (
                <Bouton
                  variante="secondaire"
                  disabled={p.enCours}
                  aria-label={t(`Inviter ${c.nom}`, `Invite ${c.nom}`)}
                  onClick={() =>
                    void p.executer(
                      () =>
                        api.post(cheminInvitationsPortailDd(dossierId), {
                          utilisateur_id: c.utilisateur_id,
                        }),
                      t(
                        `${c.nom} est invité : les notes publiées lui seront visibles.`,
                        `${c.nom} is invited: published memos will be visible to them.`,
                      ),
                    )
                  }
                >
                  {t("Inviter", "Invite")}
                </Bouton>
              ) : null}
              {action === "retirer" ? (
                <BoutonConfirmation
                  libelle={t("Retirer", "Remove")}
                  ariaLabel={t(`Retirer l'accès de ${c.nom}`, `Remove access for ${c.nom}`)}
                  question={t(
                    `Retirer l'accès de ${c.nom} aux notes de ce dossier ?`,
                    `Remove ${c.nom}'s access to the memos of this file?`,
                  )}
                  libelleConfirmation={t("Oui, retirer", "Yes, remove")}
                  texteChargement={t("Retrait…", "Removing…")}
                  action={() =>
                    p.executer(
                      () => api.post(cheminRetraitInvitationPortailDd(dossierId, c.utilisateur_id)),
                      t(`L'accès de ${c.nom} est retiré.`, `${c.nom}'s access has been removed.`),
                    )
                  }
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
