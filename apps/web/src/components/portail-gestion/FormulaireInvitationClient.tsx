"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import { messageSpecifiqueLangue } from "../../lib/double-authentification";
import {
  CHEMIN_INVITATIONS_PORTAIL,
  messageErreurPortailGestion,
  optionsRolesPortail,
  validerInvitationPortail,
  type ChampInvitationPortail,
} from "../../lib/portail-gestion";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Champ } from "../ui/Champ";
import { ChoixRolePortail } from "./ChoixRolePortail";

export interface FormulaireInvitationClientProps {
  clientId: string;
  raisonSociale: string;
  /** Client archivé : l'API refuse toute invitation (409). */
  clientActif: boolean;
}

/**
 * Invitation d'une personne de l'entreprise cliente sur le portail (POST
 * /api/portail/invitations). Le lien part par e-mail : il n'est jamais affiché ici.
 */
export function FormulaireInvitationClient({
  clientId,
  raisonSociale,
  clientActif,
}: FormulaireInvitationClientProps) {
  const t = useT();
  const langue = useLangue();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const f = useFormulaire<ChampInvitationPortail>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const adresse = email.trim().toLowerCase();
    await f.envoyer(
      validerInvitationPortail({ email, role }, clientId, langue),
      (c) => api.post(CHEMIN_INVITATIONS_PORTAIL, c),
      {
        succes: t(
          `Invitation envoyée à ${adresse}. Le lien, valable 7 jours, lui parvient par e-mail.`,
          `Invitation sent to ${adresse}. The link, valid for 7 days, is sent to them by email.`,
        ),
        messageSpecifique: (e) =>
          messageErreurPortailGestion(e, "invitation", langue) ??
          messageSpecifiqueLangue(langue)(e),
        apres: () => {
          setEmail("");
          setRole("");
        },
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Invitation impossible", "Unable to invite")}
      />
      {clientActif ? null : (
        <Alerte
          tonalite="attention"
          annonce="aucune"
          titre={t("Client archivé", "Archived client")}
        >
          <p>
            {t(
              "Le portail est fermé à ce client : réactivez sa fiche pour inviter quelqu'un.",
              "The portal is closed to this client: reactivate its profile to invite someone.",
            )}
          </p>
        </Alerte>
      )}
      <fieldset className="mp-groupe-section" disabled={!clientActif}>
        <legend className="mp-visuellement-cache">
          {t(`Inviter une personne de ${raisonSociale}`, `Invite a person from ${raisonSociale}`)}
        </legend>
        <Champ
          libelle={t("Adresse e-mail", "Email address")}
          type="email"
          name="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="off"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          erreur={f.erreurs.email}
          aide={t(
            `Adresse professionnelle d'une personne de ${raisonSociale}. Elle recevra un lien personnel pour créer son accès ; ce lien n'est jamais affiché ici.`,
            `Work email address of a person at ${raisonSociale}. They will receive a personal link to create their access; this link is never shown here.`,
          )}
        />
        <ChoixRolePortail
          options={optionsRolesPortail(langue)}
          valeur={role}
          onChange={setRole}
          erreur={f.erreurs.role}
        />
        <div className="mp-actions-formulaire">
          <Bouton
            type="submit"
            icone="courrier"
            chargement={f.enCours}
            texteChargement={t("Envoi…", "Sending…")}
          >
            {t("Envoyer l'invitation", "Send the invitation")}
          </Bouton>
        </div>
      </fieldset>
    </form>
  );
}
