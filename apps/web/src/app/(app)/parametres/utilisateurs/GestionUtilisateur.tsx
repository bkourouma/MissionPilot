"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { GroupeCases } from "../../../../components/ui/CaseACocher";
import { api } from "../../../../lib/api";
import {
  messageModificationUtilisateur,
  OPTIONS_ROLES,
  rolesValides,
  validerRoles,
  type Utilisateur,
} from "../../../../lib/utilisateurs";

export interface GestionUtilisateurProps {
  utilisateur: Utilisateur;
  estSoiMeme: boolean;
}

/** Changement de rôles et activation d'un compte (refus « dernier associé » expliqué). */
export function GestionUtilisateur({ utilisateur, estSoiMeme }: GestionUtilisateurProps) {
  const [ouvert, setOuvert] = useState(false);
  const [roles, setRoles] = useState<string[]>(utilisateur.roles);
  const f = useFormulaire<"roles">();
  const activation = useFormulaire<never>();
  const chemin = `/api/utilisateurs/${encodeURIComponent(utilisateur.id)}`;

  async function enregistrerRoles(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const erreur = validerRoles(roles);
    await f.envoyer(
      erreur
        ? { ok: false, erreurs: { roles: erreur } }
        : { ok: true, charge: rolesValides(roles) },
      (r) => api.patch(chemin, { roles: r }),
      {
        succes: `Rôles de ${utilisateur.nom} enregistrés.`,
        messageSpecifique: messageModificationUtilisateur,
      },
    );
  }

  const basculerActif = () =>
    activation.envoyer(
      { ok: true, charge: { actif: !utilisateur.actif } },
      (c) => api.patch(chemin, c),
      { messageSpecifique: messageModificationUtilisateur },
    );

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={activation.erreurGlobale}
        refAlerte={activation.refAlerte}
        titreErreur="Modification impossible"
      />
      <div className="mp-barre-actions">
        <Bouton
          variante="secondaire"
          icone="crayon"
          aria-expanded={ouvert}
          onClick={() => setOuvert((v) => !v)}
          aria-label={`Modifier les rôles de ${utilisateur.nom}`}
        >
          Modifier les rôles
        </Bouton>
        {utilisateur.actif ? (
          <BoutonConfirmation
            libelle="Désactiver"
            ariaLabel={`Désactiver le compte de ${utilisateur.nom}`}
            question={
              estSoiMeme
                ? "Désactiver votre propre compte ? Vous serez déconnecté."
                : `Désactiver le compte de ${utilisateur.nom} ? Ses sessions seront fermées.`
            }
            libelleConfirmation="Oui, désactiver"
            texteChargement="Désactivation…"
            action={basculerActif}
          />
        ) : (
          <Bouton
            variante="secondaire"
            chargement={activation.enCours}
            texteChargement="Réactivation…"
            onClick={basculerActif}
            aria-label={`Réactiver le compte de ${utilisateur.nom}`}
          >
            Réactiver
          </Bouton>
        )}
      </div>
      {ouvert ? (
        <form
          ref={f.refFormulaire}
          className="mp-formulaire"
          noValidate
          onSubmit={enregistrerRoles}
        >
          <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
          <GroupeCases
            legende={`Rôles de ${utilisateur.nom}`}
            nom={`roles-${utilisateur.id}`}
            requis
            options={OPTIONS_ROLES}
            valeurs={roles}
            onChange={setRoles}
            erreur={f.erreurs.roles}
          />
          <div className="mp-actions-formulaire">
            <Bouton type="submit" chargement={f.enCours} texteChargement="Enregistrement…">
              Enregistrer les rôles
            </Bouton>
            <Bouton
              variante="discret"
              onClick={() => {
                setRoles(utilisateur.roles);
                setOuvert(false);
              }}
            >
              Annuler
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
