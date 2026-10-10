"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { lireAnonymisationCv, messageBanqueAo, MOTIF_ANONYMISATION_MAX } from "../../lib/banque-ao";
import {
  messageReconfirmation,
  SAISIE_CONFIRMATION_VIDE,
  type ChampConfirmation,
  type SaisieConfirmation,
} from "../../lib/double-authentification";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { ChampsReconfirmation } from "../securite/ChampsReconfirmation";
import { Alerte } from "../ui/Alerte";
import { Champ } from "../ui/Champ";

/**
 * Anonymisation d'un CV (départ d'une personne, droit à l'effacement), réservée à `cabinet.gerer`.
 * IRRÉVERSIBLE : motif obligatoire, reconfirmation d'identité (mot de passe, et code de
 * l'application si la double authentification est active), puis confirmation en deux temps.
 * Une fois anonymisé, le CV n'est plus exportable ni modifiable (409 CV_ANONYME côté API).
 */
export function AnonymisationCv({ cvId, anonymise }: { cvId: string; anonymise: boolean }) {
  const f = useFormulaire<"motif" | ChampConfirmation>();
  const [motif, setMotif] = useState("");
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const [versions, setVersions] = useState<number | null>(null);

  if (anonymise) {
    return (
      <Alerte tonalite="succes" titre="CV anonymisé" annonce="status">
        <p>
          Le parcours de cette personne est effacé (nom, employeurs, diplômes, langues). Ce CV ne
          peut plus servir : plus d&apos;export, plus de nouvelle version, plus d&apos;offre.
          {versions !== null ? ` ${versions} version(s) anonymisée(s).` : ""} La trace d&apos;audit
          est conservée, sans donnée personnelle.
        </p>
      </Alerte>
    );
  }

  async function anonymiser(): Promise<boolean> {
    const ok = await f.envoyer(
      lireAnonymisationCv(motif, confirmation),
      (c) =>
        api.post<{ id: string; anonymise: boolean; versions: number }>(
          `/api/banque-ao/cv/${encodeURIComponent(cvId)}/anonymisation`,
          c,
          { redirigerSi401: false },
        ),
      {
        apres: (r) => setVersions(r.versions),
        messageSpecifique: (e) =>
          messageReconfirmation(e, confirmation.facteur) ?? messageBanqueAo(e),
      },
    );
    // Mot de passe et code ne restent jamais à l'écran après une tentative.
    if (!ok) setConfirmation((x) => ({ ...x, motDePasse: "", code: "" }));
    return ok;
  }

  return (
    <div className="mp-pile mp-pleine-largeur">
      <Alerte tonalite="attention" titre="Action irréversible" annonce="aucune">
        <p>
          L&apos;anonymisation efface le parcours de la personne (nom, employeurs, diplômes,
          langues, nationalité) dans toutes les versions du CV et la détache de son collaborateur.
          Elle ne peut pas être annulée. Le CV n&apos;est ensuite plus utilisable (export, nouvelle
          version, offre). Le texte d&apos;une offre technique déjà rédigée, qui citerait son nom,
          n&apos;est pas réécrit.
        </p>
      </Alerte>
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={(e) => e.preventDefault()}
        aria-label="Anonymiser ce CV"
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur="Anonymisation impossible"
        />
        <Champ
          libelle="Motif de l'anonymisation"
          aide="Obligatoire, conservé dans le journal d'audit (départ, demande d'effacement…)."
          required
          maxLength={MOTIF_ANONYMISATION_MAX}
          value={motif}
          onChange={(e) => setMotif(e.target.value)}
          erreur={f.erreurs.motif}
        />
        <ChampsReconfirmation
          saisie={confirmation}
          onChange={setConfirmation}
          erreurs={f.erreurs}
          motif="anonymiser ce CV de façon irréversible"
        />
        <div className="mp-actions-formulaire">
          <BoutonConfirmation
            libelle="Anonymiser ce CV"
            icone="cadenas"
            question="Anonymiser ce CV ? Le parcours de la personne sera effacé définitivement, sans retour possible."
            libelleConfirmation="Oui, anonymiser définitivement"
            texteChargement="Anonymisation…"
            variante="danger"
            action={anonymiser}
          />
        </div>
      </form>
    </div>
  );
}
