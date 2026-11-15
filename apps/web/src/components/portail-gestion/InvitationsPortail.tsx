"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { messageSpecifiqueLangue } from "../../lib/double-authentification";
import { formaterDate } from "../../lib/format";
import {
  cheminInvitationPortail,
  libellesRolesPortail,
  messageErreurPortailGestion,
  type InvitationPortail,
} from "../../lib/portail-gestion";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { BadgeStatut } from "../ui/BadgeStatut";
import { EtatVide } from "../ui/EtatListe";

/**
 * Invitations du portail en attente, révocables. L'annonce de la révocation vit au-dessus de
 * la liste : la ligne disparaît au rafraîchissement, le message (et le focus) restent.
 */
export function InvitationsPortail({ invitations }: { invitations: readonly InvitationPortail[] }) {
  const t = useT();
  const [annonce, setAnnonce] = useState<string | null>(null);
  const refAnnonce = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (annonce) refAnnonce.current?.focus();
  }, [annonce]);

  return (
    <div className="mp-pile">
      {annonce ? (
        <Alerte ref={refAnnonce} tonalite="succes" annonce="status">
          <p>{annonce}</p>
        </Alerte>
      ) : null}
      {invitations.length === 0 ? (
        <EtatVide
          titre={t("Aucune invitation en attente.", "No pending invitations.")}
          icone="courrier"
        >
          <p>
            {t(
              "Les invitations acceptées, expirées ou révoquées n'apparaissent plus ici.",
              "Accepted, expired or revoked invitations no longer appear here.",
            )}
          </p>
        </EtatVide>
      ) : (
        <ul className="mp-liste-lignes">
          {invitations.map((i) => (
            <LigneInvitation key={i.id} invitation={i} onRevoquee={setAnnonce} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LigneInvitation({
  invitation: i,
  onRevoquee,
}: {
  invitation: InvitationPortail;
  onRevoquee: (message: string) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<never>();
  const [revoquee, setRevoquee] = useState(false);
  const revoquer = () =>
    f.envoyer({ ok: true, charge: undefined }, () => api.supprimer(cheminInvitationPortail(i.id)), {
      messageSpecifique: (e) =>
        messageErreurPortailGestion(e, "revocation", langue) ?? messageSpecifiqueLangue(langue)(e),
      apres: () => {
        setRevoquee(true);
        onRevoquee(
          t(
            `Invitation de ${i.email} révoquée : le lien reçu ne fonctionne plus.`,
            `Invitation of ${i.email} revoked: the link they received no longer works.`,
          ),
        );
      },
    });

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-liste-lignes__texte">
        <strong className="mp-coupure">{i.email}</strong>
        <span className="mp-texte-doux">
          {libellesRolesPortail(i.roles, langue)} · {t("envoyée le", "sent on")}{" "}
          {formaterDate(i.cree_le, "Africa/Abidjan", langue)} · {t("expire le", "expires on")}{" "}
          {formaterDate(i.expire_le, "Africa/Abidjan", langue)}
        </span>
      </div>
      <div className="mp-liste-lignes__actions">
        {revoquee ? (
          <BadgeStatut tonalite="neutre">{t("Révoquée", "Revoked")}</BadgeStatut>
        ) : (
          <BoutonConfirmation
            libelle={t("Révoquer", "Revoke")}
            ariaLabel={t(
              `Révoquer l'invitation de ${i.email}`,
              `Revoke the invitation of ${i.email}`,
            )}
            question={t(
              `Révoquer l'invitation de ${i.email} ? Le lien reçu cessera de fonctionner.`,
              `Revoke the invitation of ${i.email}? The link they received will stop working.`,
            )}
            libelleConfirmation={t("Oui, révoquer", "Yes, revoke")}
            texteChargement={t("Révocation…", "Revoking…")}
            action={revoquer}
          />
        )}
      </div>
      {f.erreurGlobale ? (
        <div className="mp-pleine-largeur">
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur={t("Révocation impossible", "Unable to revoke")}
          />
        </div>
      ) : null}
    </li>
  );
}
