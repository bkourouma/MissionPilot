"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Bouton } from "../ui/Bouton";
import { Alerte } from "../ui/Alerte";
import { ZoneTexte } from "../ui/ZoneTexte";
import { api } from "../../lib/api";
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
  const [validationLocale, setValidationLocale] = useState<ValidationJalon | null>(null);
  const validation = jalon.validation ?? validationLocale;
  const etat = etatJalon({ ...jalon, validation });

  return (
    <li className="mp-liste-lignes__ligne">
      <div className="mp-liste-lignes__texte">
        <span className="mp-portail-ligne__titre">{jalon.libelle}</span>
        {etat.detail ? <span className="mp-portail-ligne__detail">{etat.detail}</span> : null}
        {validation?.commentaire ? (
          <p className="mp-portail-ligne__commentaire">
            <span className="mp-visuellement-cache">Commentaire de validation : </span>
            {validation.commentaire}
          </p>
        ) : null}
      </div>
      <div className="mp-portail-ligne__actions">
        <BadgeStatut tonalite={etat.tonalite}>{etat.libelle}</BadgeStatut>
      </div>
      {validationLocale ? (
        <div className="mp-pleine-largeur">
          <Alerte tonalite="succes" annonce="status" titre="Jalon validé">
            <p>
              Merci : votre validation est enregistrée et l&apos;équipe du cabinet en est informée.
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
          Valider ce jalon
          <span className="mp-visuellement-cache"> : {jalon.libelle}</span>
        </Bouton>
      </div>
    );
  }

  async function soumettre(ev: FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    await f.envoyer(
      validerCommentaireValidation(commentaire),
      (charge) =>
        api.post<{ validation: ValidationJalon }>(
          cheminValidationJalon(missionId, jalon.id),
          charge,
        ),
      { apres: (r) => onValide(r.validation), messageSpecifique: messageValidationJalon },
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
        Valider le jalon « {jalon.libelle} » ?
      </p>
      <p>
        Votre validation confirme au cabinet que ce jalon vous convient. Elle est définitive : elle
        sera datée, enregistrée à votre nom et transmise à l&apos;équipe de la mission.
      </p>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        refAlerte={f.refAlerte}
        titreErreur="Validation impossible"
      />
      <ZoneTexte
        libelle="Commentaire (facultatif)"
        name="commentaire"
        rows={3}
        maxLength={COMMENTAIRE_VALIDATION_MAX}
        value={commentaire}
        onChange={(e) => setCommentaire(e.target.value)}
        erreur={f.erreurs.commentaire}
        aide={`Par exemple : « Conforme au compte rendu de la réunion ». ${longueur} caractère${longueur > 1 ? "s" : ""} sur ${COMMENTAIRE_VALIDATION_MAX}.`}
      />
      <div className="mp-barre-actions">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Validation en cours…">
          Confirmer la validation
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
          Annuler
        </Bouton>
      </div>
    </form>
  );
}
