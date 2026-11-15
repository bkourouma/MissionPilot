"use client";

import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { GroupeCases } from "../../../../components/ui/CaseACocher";
import { Champ } from "../../../../components/ui/Champ";
import { api } from "../../../../lib/api";
import { messageSpecifiqueLangue } from "../../../../lib/double-authentification";
import { optionsRoles, validerEnvoiInvitation } from "../../../../lib/utilisateurs";

export function FormulaireInvitationEnvoi() {
  const t = useT();
  const langue = useLangue();
  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<string[]>(["consultant"]);
  const f = useFormulaire<"email" | "roles">();

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const adresse = email.trim().toLowerCase();
    await f.envoyer(
      validerEnvoiInvitation({ email, roles }, langue),
      (c) => api.post("/api/invitations", c),
      {
        succes: t(
          `Invitation envoyée à ${adresse}. Le lien est valable 7 jours.`,
          `Invitation sent to ${adresse}. The link is valid for 7 days.`,
        ),
        messageSpecifique: messageSpecifiqueLangue(langue),
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
        titreErreur={t("Invitation impossible", "Unable to invite")}
      />
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
          "La personne recevra un lien pour créer son compte.",
          "The person will receive a link to create their account.",
        )}
      />
      <GroupeCases
        legende={t("Rôles", "Roles")}
        nom="roles"
        requis
        options={optionsRoles(langue)}
        valeurs={roles}
        onChange={setRoles}
        erreur={f.erreurs.roles}
        aide={t(
          "Plusieurs rôles peuvent être cumulés. Seuls les associés et gestionnaires voient les coûts et les taux.",
          "Several roles can be combined. Only partners and managers see costs and rates.",
        )}
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
    </form>
  );
}
