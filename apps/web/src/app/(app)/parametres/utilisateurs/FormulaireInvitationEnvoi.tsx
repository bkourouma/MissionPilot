"use client";

import { useState, type FormEvent } from "react";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { GroupeCases } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { api } from "../../../../lib/api";
import { OPTIONS_ROLES, validerEnvoiInvitation } from "../../../../lib/utilisateurs";

export function FormulaireInvitationEnvoi() {
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["consultant"]);
  const f = useFormulaire<"email" | "roles">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const adresse = email.trim().toLowerCase();
    await f.envoyer(
      validerEnvoiInvitation({ email, roles }),
      (c) => api.post("/api/invitations", c),
      {
        succes: `Invitation envoyée à ${adresse}. Le lien est valable 7 jours.`,
        apres: () => {
          setEmail("");
          setRoles(["consultant"]);
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
        aide="La personne recevra un lien pour créer son compte."
      />
      <GroupeCases
        legende="Rôles"
        nom="roles"
        requis
        options={OPTIONS_ROLES}
        valeurs={roles}
        onChange={setRoles}
        erreur={f.erreurs.roles}
        aide="Plusieurs rôles peuvent être cumulés. Seuls les associés et gestionnaires voient les coûts et les taux."
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" icone="courrier" chargement={f.enCours} texteChargement="Envoi…">
          Envoyer l&apos;invitation
        </Bouton>
      </div>
    </form>
  );
}
