"use client";

import { useState, type FormEvent } from "react";
import { BoutonConfirmation } from "../../../../components/formulaires/BoutonConfirmation";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { Bouton } from "../../../../components/ui/Bouton";
import { GroupeCases } from "../../../../components/ui/CaseACocher";
import { api } from "../../../../lib/api";
import {
  messageSpecifiqueLangue,
  peutReinitialiserTfa,
} from "../../../../lib/double-authentification";
import { ReinitialisationTfa } from "./ReinitialisationTfa";
import {
  messageModificationUtilisateur,
  optionsRoles,
  rolesValides,
  validerRoles,
  type Utilisateur,
} from "../../../../lib/utilisateurs";

export interface GestionUtilisateurProps {
  utilisateur: Utilisateur;
  estSoiMeme: boolean;
  /** Identifiant de l'utilisateur connecté (pas de réinitialisation de sa propre 2FA). */
  moiId: string;
}

/** Changement de rôles et activation d'un compte (refus « dernier associé » expliqué). */
export function GestionUtilisateur({ utilisateur, estSoiMeme, moiId }: GestionUtilisateurProps) {
  const t = useT();
  const langue = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [roles, setRoles] = useState<string[]>(utilisateur.roles);
  const f = useFormulaire<"roles">();
  const activation = useFormulaire<never>();
  const chemin = `/api/utilisateurs/${encodeURIComponent(utilisateur.id)}`;

  const specifique = (e: unknown) =>
    messageModificationUtilisateur(e, langue) ?? messageSpecifiqueLangue(langue)(e);

  async function enregistrerRoles(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const erreur = validerRoles(roles, langue);
    await f.envoyer(
      erreur
        ? { ok: false, erreurs: { roles: erreur } }
        : { ok: true, charge: rolesValides(roles) },
      (r) => api.patch(chemin, { roles: r }),
      {
        succes: t(`Rôles de ${utilisateur.nom} enregistrés.`, `Roles of ${utilisateur.nom} saved.`),
        messageSpecifique: specifique,
      },
    );
  }

  const basculerActif = () =>
    activation.envoyer(
      { ok: true, charge: { actif: !utilisateur.actif } },
      (c) => api.patch(chemin, c),
      {
        succes: utilisateur.actif
          ? t(
              `Compte de ${utilisateur.nom} désactivé.`,
              `Account of ${utilisateur.nom} deactivated.`,
            )
          : t(
              `Compte de ${utilisateur.nom} réactivé.`,
              `Account of ${utilisateur.nom} reactivated.`,
            ),
        messageSpecifique: specifique,
      },
    );

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={activation.erreurGlobale}
        succes={activation.succes}
        refAlerte={activation.refAlerte}
        titreErreur={t("Modification impossible", "Unable to update")}
      />
      <div className="mp-barre-actions">
        <Bouton
          variante="secondaire"
          icone="crayon"
          aria-expanded={ouvert}
          aria-controls={`roles-${utilisateur.id}`}
          onClick={() => setOuvert((v) => !v)}
          aria-label={t(
            `Modifier les rôles de ${utilisateur.nom}`,
            `Edit roles of ${utilisateur.nom}`,
          )}
        >
          {t("Modifier les rôles", "Edit roles")}
        </Bouton>
        {utilisateur.actif ? (
          <BoutonConfirmation
            libelle={t("Désactiver", "Deactivate")}
            ariaLabel={t(
              `Désactiver le compte de ${utilisateur.nom}`,
              `Deactivate the account of ${utilisateur.nom}`,
            )}
            question={
              estSoiMeme
                ? t(
                    "Désactiver votre propre compte ? Vous serez déconnecté.",
                    "Deactivate your own account? You will be signed out.",
                  )
                : t(
                    `Désactiver le compte de ${utilisateur.nom} ? Ses sessions seront fermées.`,
                    `Deactivate the account of ${utilisateur.nom}? Their sessions will be closed.`,
                  )
            }
            libelleConfirmation={t("Oui, désactiver", "Yes, deactivate")}
            texteChargement={t("Désactivation…", "Deactivating…")}
            action={basculerActif}
          />
        ) : (
          <Bouton
            variante="secondaire"
            chargement={activation.enCours}
            texteChargement={t("Réactivation…", "Reactivating…")}
            onClick={basculerActif}
            aria-label={t(
              `Réactiver le compte de ${utilisateur.nom}`,
              `Reactivate the account of ${utilisateur.nom}`,
            )}
          >
            {t("Réactiver", "Reactivate")}
          </Bouton>
        )}
      </div>
      {peutReinitialiserTfa(utilisateur.id, moiId, utilisateur.tfa_active === true) ? (
        <ReinitialisationTfa utilisateurId={utilisateur.id} nom={utilisateur.nom} />
      ) : null}
      {ouvert ? (
        <form
          ref={f.refFormulaire}
          id={`roles-${utilisateur.id}`}
          className="mp-formulaire"
          noValidate
          onSubmit={enregistrerRoles}
        >
          <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
          <GroupeCases
            legende={t(`Rôles de ${utilisateur.nom}`, `Roles of ${utilisateur.nom}`)}
            nom={`roles-${utilisateur.id}`}
            requis
            options={optionsRoles(langue)}
            valeurs={roles}
            onChange={setRoles}
            erreur={f.erreurs.roles}
          />
          <div className="mp-actions-formulaire">
            <Bouton
              type="submit"
              chargement={f.enCours}
              texteChargement={t("Enregistrement…", "Saving…")}
            >
              {t("Enregistrer les rôles", "Save roles")}
            </Bouton>
            <Bouton
              variante="discret"
              onClick={() => {
                setRoles(utilisateur.roles);
                setOuvert(false);
              }}
            >
              {t("Annuler", "Cancel")}
            </Bouton>
          </div>
        </form>
      ) : null}
    </div>
  );
}
