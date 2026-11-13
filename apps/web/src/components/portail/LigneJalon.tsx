"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Alerte } from "../ui/Alerte";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api } from "../../lib/api";
import { messageSpecifiqueLangue } from "../../lib/double-authentification";
import {
  cheminValidationJalon,
  COMMENTAIRE_VALIDATION_MAX,
  etatJalon,
  messageValidationJalon,
  validerCommentaireValidation,
  type JalonPortail,
  type ValidationJalon,
} from "../../lib/portail";

export interface LigneJalonProps {
  missionId: string;
  jalon: JalonPortail;
  /** Dirigeant client, jalon atteint et pas encore validé (l'API reste seule juge). */
  peutValider: boolean;
}

/**
 * Un jalon : libellé, statut, validation éventuelle. La validation enregistrée ici est gardée
 * en mémoire le temps que la page se rafraîchisse : le statut change aussitôt et le message de
 * confirmation reste affiché.
 */
export function LigneJalon({ missionId, jalon, peutValider }: LigneJalonProps) {
  const t = useT();
  const langue = useLangue();
  const [validationLocale, setValidationLocale] = useState<ValidationJalon | null>(null);
  const validation = jalon.validation ?? validationLocale;
  const etat = etatJalon({ ...jalon, validation }, langue);

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-liste-lignes__texte">
        <span className="mp-portail-ligne__titre">{jalon.libelle}</span>
        {etat.detail ? <span className="mp-portail-ligne__detail">{etat.detail}</span> : null}
        {validation?.commentaire ? (
          <p className="mp-portail-ligne__commentaire">
            <span className="mp-visuellement-cache">
              {t("Commentaire de validation : ", "Approval comment: ")}
            </span>
            {validation.commentaire}
          </p>
        ) : null}
      </div>
      <div className="mp-portail-ligne__actions">
        <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
      </div>
      {validationLocale ? (
        <div className="mp-pleine-largeur">
          <Alerte
            tonalite="succes"
            annonce="status"
            titre={t("Jalon validé", "Milestone approved")}
          >
            <p>
              {t(
                "Merci : votre validation est enregistrée et l'équipe du cabinet en est informée.",
                "Thank you: your approval has been recorded and the firm's team has been informed.",
              )}
            </p>
          </Alerte>
        </div>
      ) : peutValider && !validation ? (
        <ValidationJalonForm
          missionId={missionId}
          jalon={jalon}
          onValide={(v) => setValidationLocale(v)}
        />
      ) : null}
    </li>
  );
}

function ValidationJalonForm({
  missionId,
  jalon,
  onValide,
}: {
  missionId: string;
  jalon: JalonPortail;
  onValide: (v: ValidationJalon) => void;
}) {
  const t = useT();
  const langue = useLangue();
  const [ouvert, setOuvert] = useState(false);
  const [commentaire, setCommentaire] = useState("");
  const [rendreFocus, setRendreFocus] = useState(false);
  const f = useFormulaire<"commentaire">();
  const refTitre = useRef<HTMLParagraphElement>(null);
  const refBouton = useRef<HTMLButtonElement>(null);
  const idTitre = useId();

  useEffect(() => {
    if (ouvert) refTitre.current?.focus();
    else if (rendreFocus) refBouton.current?.focus();
  }, [ouvert, rendreFocus]);

  if (!ouvert) {
    return (
      <div className="mp-pleine-largeur">
        <Bouton
          ref={refBouton}
          icone="succes"
          onClick={() => {
            setRendreFocus(false);
            setOuvert(true);
          }}
        >
          {t("Valider ce jalon", "Approve this milestone")}
          <span className="mp-visuellement-cache"> : {jalon.libelle}</span>
        </Bouton>
      </div>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCommentaireValidation(commentaire, langue),
      (charge) =>
        api.post<{ validation: ValidationJalon }>(
          cheminValidationJalon(missionId, jalon.id),
          charge,
        ),
      {
        apres: (r) => onValide(r.validation),
        messageSpecifique: (e) =>
          messageValidationJalon(e, langue) ?? messageSpecifiqueLangue(langue)(e),
      },
    );
  }

  const longueur = commentaire.trim().length;
  return (
    <form
      ref={f.refFormulaire}
      className="mp-portail-validation"
      noValidate
      onSubmit={soumettre}
      aria-labelledby={idTitre}
      aria-busy={f.enCours}
    >
      <p id={idTitre} ref={refTitre} tabIndex={-1} className="mp-portail-validation__titre">
        {t(`Valider le jalon « ${jalon.libelle} » ?`, `Approve the milestone "${jalon.libelle}"?`)}
      </p>
      <p>
        {t(
          "Votre validation confirme au cabinet que ce jalon vous convient. Elle est définitive : elle sera datée, enregistrée à votre nom et transmise à l'équipe de la mission.",
          "Your approval confirms to the firm that this milestone suits you. It is final: it will be dated, recorded under your name and passed on to the engagement team.",
        )}
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur={t("Validation impossible", "Unable to approve")}
      />
      <ZoneTexte
        libelle={t("Commentaire (facultatif)", "Comment (optional)")}
        name="commentaire"
        rows={3}
        maxLength={COMMENTAIRE_VALIDATION_MAX}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
        aide={t(
          `Par exemple : « Conforme au compte rendu de la réunion ». ${longueur} caractère${longueur > 1 ? "s" : ""} sur ${COMMENTAIRE_VALIDATION_MAX}.`,
          `For example: "Matches the meeting minutes". ${longueur} character${longueur > 1 ? "s" : ""} of ${COMMENTAIRE_VALIDATION_MAX}.`,
        )}
      />
      <div className="mp-barre-actions">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Validation en cours…", "Approving…")}
        >
          {t("Confirmer la validation", "Confirm the approval")}
        </Bouton>
        <Bouton
          variante="secondaire"
          disabled={f.enCours}
          onClick={() => {
            setCommentaire("");
            setRendreFocus(true);
            setOuvert(false);
          }}
        >
          {t("Annuler", "Cancel")}
        </Bouton>
      </div>
    </form>
  );
}
