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
import { useLangue, useT } from "../i18n/FournisseurLangue";
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
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif" | ChampConfirmation>();
  const [motif, setMotif] = useState("");
  const [confirmation, setConfirmation] = useState<SaisieConfirmation>(SAISIE_CONFIRMATION_VIDE);
  const [versions, setVersions] = useState<number | null>(null);

  if (anonymise) {
    return (
      <Alerte tonalite="succes" titre={t("CV anonymisé", "CV anonymized")} annonce="status">
        <p>
          {t(
            "Le parcours de cette personne est effacé (nom, employeurs, diplômes, langues). Ce CV ne peut plus servir : plus d'export, plus de nouvelle version, plus d'offre.",
            "This person's background has been erased (name, employers, degrees, languages). This CV can no longer be used: no export, no new version, no bid.",
          )}
          {versions !== null
            ? t(` ${versions} version(s) anonymisée(s).`, ` ${versions} version(s) anonymized.`)
            : ""}{" "}
          {t(
            "La trace d'audit est conservée, sans donnée personnelle.",
            "The audit trail is kept, without personal data.",
          )}
        </p>
      </Alerte>
    );
  }

  async function anonymiser(): Promise<boolean> {
    const ok = await f.envoyer(
      lireAnonymisationCv(motif, confirmation, langue),
      (c) =>
        api.post<{ id: string; anonymise: boolean; versions: number }>(
          `/api/banque-ao/cv/${encodeURIComponent(cvId)}/anonymisation`,
          c,
          { redirigerSi401: false },
        ),
      {
        apres: (r) => setVersions(r.versions),
        messageSpecifique: (e) =>
          messageReconfirmation(e, confirmation.facteur, langue) ?? messageBanqueAo(e, langue),
      },
    );
    // Mot de passe et code ne restent jamais à l'écran après une tentative.
    if (!ok) setConfirmation((x) => ({ ...x, motDePasse: "", code: "" }));
    return ok;
  }

  return (
    <div className="mp-pile mp-pleine-largeur">
      <Alerte
        tonalite="attention"
        titre={t("Action irréversible", "Irreversible action")}
        annonce="aucune"
      >
        <p>
          {t(
            "L'anonymisation efface le parcours de la personne (nom, employeurs, diplômes, langues, nationalité) dans toutes les versions du CV et la détache de son collaborateur. Elle ne peut pas être annulée. Le CV n'est ensuite plus utilisable (export, nouvelle version, offre). Le texte d'une offre technique déjà rédigée, qui citerait son nom, n'est pas réécrit.",
            "Anonymization erases the person's background (name, employers, degrees, languages, nationality) from every version of the CV and detaches it from their staff record. It cannot be undone. The CV can then no longer be used (export, new version, bid). The text of an already drafted technical bid that cites their name is not rewritten.",
          )}
        </p>
      </Alerte>
      <form
        ref={f.refFormulaire}
        className="mp-formulaire"
        noValidate
        onSubmit={(e) => e.preventDefault()}
        aria-label={t("Anonymiser ce CV", "Anonymize this CV")}
      >
        <RetourFormulaire
          erreur={f.erreurGlobale}
          refAlerte={f.refAlerte}
          titreErreur={t("Anonymisation impossible", "Anonymization failed")}
        />
        <Champ
          libelle={t("Motif de l'anonymisation", "Reason for anonymization")}
          aide={t(
            "Obligatoire, conservé dans le journal d'audit (départ, demande d'effacement…).",
            "Required, kept in the audit log (departure, erasure request…).",
          )}
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
          motifEn="irreversibly anonymize this CV"
        />
        <div className="mp-actions-formulaire">
          <BoutonConfirmation
            libelle={t("Anonymiser ce CV", "Anonymize this CV")}
            icone="cadenas"
            question={t(
              "Anonymiser ce CV ? Le parcours de la personne sera effacé définitivement, sans retour possible.",
              "Anonymize this CV? The person's background will be erased permanently, with no way back.",
            )}
            libelleConfirmation={t("Oui, anonymiser définitivement", "Yes, anonymize permanently")}
            texteChargement={t("Anonymisation…", "Anonymizing…")}
            variante="danger"
            action={anonymiser}
          />
        </div>
      </form>
    </div>
  );
}
