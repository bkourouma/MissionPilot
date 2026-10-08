"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Bouton } from "../../../../components/ui/Bouton";
import { GroupeCases } from "../../../../components/ui/CaseACocher";
import { api } from "../../../../lib/api";
import {
  avecReconfirmation,
  confirmationDemandee,
  messageReconfirmation,
  OPTIONS_ROLES_SENSIBLES,
  rolesPolitique,
  SAISIE_CONFIRMATION_VIDE,
  type PolitiqueTfa,
  type SaisieConfirmation,
} from "../../../../lib/double-authentification";

/**
 * Rôles sensibles pour lesquels la 2FA est exigée (PUT /api/auth/2fa/politique). Si l'API
 * redemande l'identité de l'auteur, les champs de confirmation s'affichent et la demande est
 * renvoyée avec eux.
 */
export function FormulairePolitiqueTfa({ politique }: { politique: PolitiqueTfa }) {
  const [roles, setRoles] = useState<string[]>(politique.roles_obligatoires);
  const [confirmation, setConfirmation] = useState<SaisieConfirmation | null>(null);
  const f = useFormulaire<"mot_de_passe" | "code">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const ok = await f.envoyer(
      avecReconfirmation(
        { ok: true, charge: { roles_obligatoires: rolesPolitique(roles) } },
        confirmation,
      ),
      (c) => api.put("/api/auth/2fa/politique", c, { redirigerSi401: false }),
      {
        succes: "Politique de double authentification enregistrée.",
        messageSpecifique: (e) => {
          if (confirmationDemandee(e)) setConfirmation((c) => c ?? SAISIE_CONFIRMATION_VIDE);
          return messageReconfirmation(e, confirmation?.facteur ?? "totp");
        },
      },
    );
    if (ok) setConfirmation(null);
    else setConfirmation((c) => (c ? { ...c, motDePasse: "", code: "" } : c));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      <GroupeCases
        legende="Exiger la double authentification pour"
        aide="Les personnes concernées sans double authentification sont invitées à l'activer à chaque connexion."
        nom="roles-tfa"
        options={OPTIONS_ROLES_SENSIBLES}
        valeurs={roles}
        onChange={setRoles}
      />
      {confirmation ? (
        <ChampsReconfirmation
          saisie={confirmation}
          onChange={setConfirmation}
          erreurs={f.erreurs}
          motif="modifier la politique de sécurité du cabinet"
        />
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
          Enregistrer la politique
        </Bouton>
      </div>
    </form>
  );
}
