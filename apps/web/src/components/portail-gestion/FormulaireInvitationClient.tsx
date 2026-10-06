"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CHEMIN_INVITATIONS_PORTAIL,
  messageErreurPortailGestion,
  OPTIONS_ROLES_PORTAIL,
  validerInvitationPortail,
  type ChampInvitationPortail,
} from "../../lib/portail-gestion";
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
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const f = useFormulaire<ChampInvitationPortail>();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const adresse = email.trim().toLowerCase();
    await f.envoyer(
      validerInvitationPortail({ email, role }, clientId),
      (c) => api.post(CHEMIN_INVITATIONS_PORTAIL, c),
      {
        succes: `Invitation envoyée à ${adresse}. Le lien, valable 7 jours, lui parvient par e-mail.`,
        messageSpecifique: (e) => messageErreurPortailGestion(e, "invitation"),
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
        titreErreur="Invitation impossible"
      />
      {clientActif ? null : (
        <Alerte tonalite="attention" annonce="aucune" titre="Client archivé">
          <p>Le portail est fermé à ce client : réactivez sa fiche pour inviter quelqu&apos;un.</p>
        </Alerte>
      )}
      <fieldset className="mp-groupe-section" disabled={!clientActif}>
        <legend className="mp-visuellement-cache">{`Inviter une personne de ${raisonSociale}`}</legend>
        <Champ
          libelle="Adresse e-mail"
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
          aide={`Adresse professionnelle d'une personne de ${raisonSociale}. Elle recevra un lien personnel pour créer son accès ; ce lien n'est jamais affiché ici.`}
        />
        <ChoixRolePortail
          options={OPTIONS_ROLES_PORTAIL}
          valeur={role}
          onChange={setRole}
          erreur={f.erreurs.role}
        />
        <div className="mp-actions-formulaire">
          <Bouton type="submit" icone="courrier" chargement={f.enCours} texteChargement="Envoi…">
            Envoyer l&apos;invitation
          </Bouton>
        </div>
      </fieldset>
    </form>
  );
}
