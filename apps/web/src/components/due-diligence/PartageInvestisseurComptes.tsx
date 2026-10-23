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
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
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
  const p = usePartageInvestisseur();

  if (comptes.length === 0) {
    return (
      <p className="mp-texte-doux">
        Aucun compte investisseur n&apos;existe pour le client de ce dossier. Invitez d&apos;abord
        l&apos;investisseur dans l&apos;espace client (rôle « Investisseur »).
      </p>
    );
  }

  return (
    <div className="mp-dd-pile">
      <PartageInvestisseurRetour erreur={p.erreur} succes={p.succes} />
      <ul className="mp-dd-liste" aria-label="Comptes investisseurs du dossier">
        {comptes.map((c) => {
          const action = actionCompte(c);
          const etat = libelleCompte(c);
          return (
            <li key={c.utilisateur_id} className="mp-dd-element">
              <h4 className="mp-dd-element__titre">{c.nom}</h4>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
                {c.invite_le ? (
                  <span className="mp-texte-doux mp-texte-petit">{`Invité le ${formaterDate(c.invite_le)}`}</span>
                ) : null}
              </span>
              {action === "inviter" ? (
                <Bouton
                  variante="secondaire"
                  disabled={p.enCours}
                  aria-label={`Inviter ${c.nom}`}
                  onClick={() =>
                    void p.executer(
                      () =>
                        api.post(cheminInvitationsPortailDd(dossierId), {
                          utilisateur_id: c.utilisateur_id,
                        }),
                      `${c.nom} est invité : les notes publiées lui seront visibles.`,
                    )
                  }
                >
                  Inviter
                </Bouton>
              ) : null}
              {action === "retirer" ? (
                <BoutonConfirmation
                  libelle="Retirer"
                  ariaLabel={`Retirer l'accès de ${c.nom}`}
                  question={`Retirer l'accès de ${c.nom} aux notes de ce dossier ?`}
                  libelleConfirmation="Oui, retirer"
                  texteChargement="Retrait…"
                  action={() =>
                    p.executer(
                      () => api.post(cheminRetraitInvitationPortailDd(dossierId, c.utilisateur_id)),
                      `L'accès de ${c.nom} est retiré.`,
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
