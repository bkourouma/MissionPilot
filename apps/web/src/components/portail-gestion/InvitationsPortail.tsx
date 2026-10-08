"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { formaterDate } from "../../lib/format";
import {
  cheminInvitationPortail,
  libellesRolesPortail,
  messageErreurPortailGestion,
  type InvitationPortail,
} from "../../lib/portail-gestion";
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
        <EtatVide titre="Aucune invitation en attente." icone="courrier">
          <p>Les invitations acceptées, expirées ou révoquées n&apos;apparaissent plus ici.</p>
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
  const f = useFormulaire<never>();
  const [revoquee, setRevoquee] = useState(false);
  const revoquer = () =>
    f.envoyer({ ok: true, charge: undefined }, () => api.supprimer(cheminInvitationPortail(i.id)), {
      messageSpecifique: (e) => messageErreurPortailGestion(e, "revocation"),
      apres: () => {
        setRevoquee(true);
        onRevoquee(`Invitation de ${i.email} révoquée : le lien reçu ne fonctionne plus.`);
      },
    });

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-liste-lignes__texte">
        <strong className="mp-coupure">{i.email}</strong>
        <span className="mp-texte-doux">
          {libellesRolesPortail(i.roles)} · envoyée le {formaterDate(i.cree_le, "Africa/Abidjan")} ·
          expire le {formaterDate(i.expire_le, "Africa/Abidjan")}
        </span>
      </div>
      <div className="mp-liste-lignes__actions">
        {revoquee ? (
          <BadgeStatut tonalite="neutre">Révoquée</BadgeStatut>
        ) : (
          <BoutonConfirmation
            libelle="Révoquer"
            ariaLabel={`Révoquer l'invitation de ${i.email}`}
            question={`Révoquer l'invitation de ${i.email} ? Le lien reçu cessera de fonctionner.`}
            libelleConfirmation="Oui, révoquer"
            texteChargement="Révocation…"
            action={revoquer}
          />
        )}
      </div>
      {f.erreurGlobale ? (
        <div className="mp-pleine-largeur">
          <RetourFormulaire
            erreur={f.erreurGlobale}
            refAlerte={f.refAlerte}
            titreErreur="Révocation impossible"
          />
        </div>
      ) : null}
    </li>
  );
}
