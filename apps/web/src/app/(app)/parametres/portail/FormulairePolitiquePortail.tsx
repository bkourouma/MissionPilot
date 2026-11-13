"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useLangue, useT } from "../../../../components/i18n/FournisseurLangue";
import { RetourFormulaire } from "../../../../components/formulaires/RetourFormulaire";
import { useFormulaire } from "../../../../components/formulaires/useFormulaire";
import { ChampsReconfirmation } from "../../../../components/securite/ChampsReconfirmation";
import { Alerte } from "../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Bouton } from "../../../../components/ui/Bouton";
import { CaseACocher } from "../../../../components/ui/CaseACocher";
import { api } from "../../../../lib/api";
import {
  messageSpecifiqueLangue,
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../../../lib/double-authentification";
import { CHEMIN_SECURITE_COMPTE } from "../../../../lib/navigation";
import {
  CHEMIN_PARAMETRES_PORTAIL,
  estRefusTfaInactive,
  libellePolitiquePortail,
  messagePolitiquePortail,
  validerPolitiquePortail,
  type ParametresPortail,
} from "../../../../lib/portail-gestion";

export interface FormulairePolitiquePortailProps {
  parametres: ParametresPortail;
  /** Double authentification active sur le compte de l'auteur (exigée par l'API). */
  tfaActive: boolean;
}

/**
 * Politique 2FA du portail client (PUT /api/portail/parametres) : action à fort impact,
 * confirmée par le mot de passe et un code de l'auteur (sa propre 2FA doit être active,
 * sinon 409 TFA_INACTIVE). Les associés sont avertis de chaque changement par l'API.
 */
export function FormulairePolitiquePortail({
  parametres,
  tfaActive,
}: FormulairePolitiquePortailProps) {
  const t = useT();
  const langue = useLangue();
  const [enregistree, setEnregistree] = useState(parametres.tfa_obligatoire);
  const [obligatoire, setObligatoire] = useState(parametres.tfa_obligatoire);
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const [refusTfa, setRefusTfa] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const f = useFormulaire<ChampConfirmation>();
  const modifiee = obligatoire !== enregistree;

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    setRefusTfa(false);
    setInfo(null);
    if (!modifiee) {
      setInfo(t("Aucune modification à enregistrer.", "No changes to save."));
      return;
    }
    await f.envoyer(
      validerPolitiquePortail(obligatoire, confirmation, tfaActive, langue),
      (c) => api.put<ParametresPortail>(CHEMIN_PARAMETRES_PORTAIL, c, { redirigerSi401: false }),
      {
        rafraichir: false,
        succes: obligatoire
          ? t(
              "Politique enregistrée : la double authentification est désormais exigée pour le portail. Les associés en sont avertis.",
              "Policy saved: two-factor authentication is now required for the portal. Partners are notified.",
            )
          : t(
              "Politique enregistrée : la double authentification est désormais facultative pour le portail. Les associés en sont avertis.",
              "Policy saved: two-factor authentication is now optional for the portal. Partners are notified.",
            ),
        messageSpecifique: (e) => {
          if (estRefusTfaInactive(e)) setRefusTfa(true);
          return (
            messagePolitiquePortail(e, confirmation.facteur, langue) ??
            messageSpecifiqueLangue(langue)(e)
          );
        },
        apres: (r) => setEnregistree(r.tfa_obligatoire),
      },
    );
    // Jamais de mot de passe ni de code conservé après un essai.
    setConfirmation((c) => ({ ...c, motDePasse: "", code: "" }));
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <p>
        {t("Politique enregistrée :", "Saved policy:")}{" "}
        <BadgeStatut tonalite={enregistree ? "succes" : "neutre"}>
          {libellePolitiquePortail(enregistree, langue)}
        </BadgeStatut>
      </p>
      <RetourFormulaire erreur={f.erreurGlobale} succes={f.succes} refAlerte={f.refAlerte} />
      {refusTfa ? (
        <p>
          <Link href={CHEMIN_SECURITE_COMPTE}>
            {t("Activer ma double authentification", "Turn on my two-factor authentication")}
          </Link>
        </p>
      ) : null}
      <CaseACocher
        libelle={t(
          "Exiger la double authentification pour tous les utilisateurs du portail client",
          "Require two-factor authentication for all client portal users",
        )}
        aide={t(
          "Une personne du portail sans double authentification devra l'activer à sa prochaine connexion avant d'accéder à quoi que ce soit.",
          "A portal user without two-factor authentication will have to turn it on at their next sign-in before accessing anything.",
        )}
        checked={obligatoire}
        onChange={(e) => {
          setObligatoire(e.target.checked);
          setInfo(null);
        }}
      />
      {modifiee ? (
        <ChampsReconfirmation
          saisie={confirmation}
          onChange={setConfirmation}
          erreurs={f.erreurs}
          motif="modifier la politique de sécurité du portail client"
          motifEn="change the client portal security policy"
        />
      ) : null}
      {info ? (
        <Alerte tonalite="info" annonce="status">
          <p>{info}</p>
        </Alerte>
      ) : null}
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Enregistrement…", "Saving…")}
        >
          {t("Enregistrer la politique", "Save the policy")}
        </Bouton>
      </div>
    </form>
  );
}
