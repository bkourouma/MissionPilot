"use client";

import { useState, type FormEvent } from "react";
import { api } from "../../lib/api";
import {
  CHEMIN_ADHESION,
  CHEMIN_CONTRIBUTIONS,
  CHEMIN_RETRAIT_ADHESION,
  lireAdhesion,
  lireRetrait,
  messageObservatoire,
  MOTIF_MAX,
  type ChampAdhesion,
} from "../../lib/observatoire";
import { messageVersement, nombreVerse } from "../../lib/observatoire-versement";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de l'observatoire (réservés à l'associé ; l'API reste juge du droit) : adhésion avec
 * consentement explicite, retrait d'adhésion, versement et retrait des contributions.
 */

export function FormulaireAdhesion() {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<ChampAdhesion>();
  const [consentement, setConsentement] = useState(false);
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(
      lireAdhesion({ consentement, motif }, langue),
      (c) => api.post(CHEMIN_ADHESION, c),
      {
        messageSpecifique: (err) => messageObservatoire(err, langue),
        succes: t(
          "Votre cabinet a adhéré à l'observatoire.",
          "Your firm has joined the observatory.",
        ),
      },
    );
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Adhésion impossible", "Could not join")}
      />
      <CaseACocher
        libelle={t(
          "Je confirme, au nom du cabinet, adhérer volontairement à l'observatoire.",
          "I confirm, on behalf of the firm, that it joins the observatory voluntarily.",
        )}
        aide={t(
          "Le cabinet verse des données agrégées et anonymes, et accède en retour aux agrégats des cabinets contributeurs. Le retrait reste possible à tout moment.",
          "The firm contributes aggregated, anonymous data, and in return accesses the aggregates of contributing firms. Withdrawal remains possible at any time.",
        )}
        checked={consentement}
        onChange={(e) => setConsentement(e.target.checked)}
        aria-invalid={f.erreurs.consentement ? true : undefined}
      />
      {f.erreurs.consentement ? (
        <p className="mp-champ__erreur" role="alert">
          {f.erreurs.consentement}
        </p>
      ) : null}
      <ZoneTexte
        libelle={t("Motif (facultatif)", "Reason (optional)")}
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          chargement={f.enCours}
          texteChargement={t("Adhésion en cours…", "Joining…")}
        >
          {t("Adhérer à l'observatoire", "Join the observatory")}
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireRetraitAdhesion() {
  const t = useT();
  const langue = useLangue();
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  // Action sensible : lancée seulement après la confirmation en deux temps (BoutonConfirmation).
  function retirer() {
    return f.envoyer(lireRetrait({ motif }, langue), (c) => api.post(CHEMIN_RETRAIT_ADHESION, c), {
      messageSpecifique: (err) => messageObservatoire(err, langue),
      succes: t(
        "Votre cabinet s'est retiré de l'observatoire.",
        "Your firm has withdrawn from the observatory.",
      ),
    });
  }

  return (
    <form
      ref={f.refFormulaire}
      className="mp-formulaire"
      noValidate
      onSubmit={(e: FormEvent<HTMLFormElement>) => e.preventDefault()}
    >
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur={t("Retrait impossible", "Could not withdraw")}
      />
      <p className="mp-texte-petit mp-texte-doux">
        {t(
          "Le retrait est immédiat : votre cabinet ne voit plus les agrégats et ses contributions ne sont plus retenues. Une nouvelle adhésion demandera de verser à nouveau.",
          "Withdrawal is immediate: your firm no longer sees the aggregates and its contributions are no longer counted. Joining again will require contributing again.",
        )}
      </p>
      <ZoneTexte
        libelle={t("Motif (facultatif)", "Reason (optional)")}
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <BoutonConfirmation
          variante="secondaire"
          libelle={t(
            "Retirer mon cabinet de l'observatoire",
            "Withdraw my firm from the observatory",
          )}
          question={t(
            "Retirer le cabinet de l'observatoire ? Les agrégats ne seront plus visibles et les contributions ne seront plus retenues.",
            "Withdraw the firm from the observatory? The aggregates will no longer be visible and contributions will no longer be counted.",
          )}
          libelleConfirmation={t("Oui, retirer le cabinet", "Yes, withdraw the firm")}
          texteChargement={t("Retrait en cours…", "Withdrawing…")}
          action={() => retirer()}
        />
      </div>
    </form>
  );
}

export function ActionsContributions({ aDesContributions }: { aDesContributions: boolean }) {
  const t = useT();
  const langue = useLangue();
  const fVerser = useFormulaire<never>();
  const fRetirer = useFormulaire<never>();
  const options = { messageSpecifique: (err: unknown) => messageObservatoire(err, langue) };

  // Le message dépend du nombre d'éléments réellement versés (réponse de l'API), pas d'un texte fixe.
  const [succesVersement, setSuccesVersement] = useState<string | null>(null);

  async function verser() {
    setSuccesVersement(null);
    await fVerser.envoyer(
      { ok: true, charge: { indicateur: "notation_score_global" as const } },
      (c) => api.post(CHEMIN_CONTRIBUTIONS, c),
      { ...options, apres: (r) => setSuccesVersement(messageVersement(nombreVerse(r), langue)) },
    );
  }

  async function retirer() {
    return fRetirer.envoyer(
      { ok: true, charge: {} },
      (c) => api.post(`${CHEMIN_CONTRIBUTIONS}/retrait`, c),
      {
        ...options,
        succes: t("Vos contributions ont été retirées.", "Your contributions have been withdrawn."),
      },
    );
  }

  return (
    <div className="mp-observatoire__actions">
      <RetourFormulaire
        erreur={fVerser.erreurGlobale}
        succes={succesVersement}
        refAlerte={fVerser.refAlerte}
        titreErreur={t("Versement impossible", "Could not contribute")}
      />
      <RetourFormulaire
        erreur={fRetirer.erreurGlobale}
        succes={fRetirer.succes}
        refAlerte={fRetirer.refAlerte}
        titreErreur={t("Retrait impossible", "Could not withdraw")}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="button"
          onClick={verser}
          chargement={fVerser.enCours}
          texteChargement={t("Versement en cours…", "Contributing…")}
        >
          {t("Verser les données du cabinet", "Contribute the firm's data")}
        </Bouton>
        {aDesContributions ? (
          <BoutonConfirmation
            libelle={t("Retirer mes contributions", "Withdraw my contributions")}
            question={t(
              "Retirer les contributions du cabinet ? Elles ne seront plus retenues dans les agrégats.",
              "Withdraw the firm's contributions? They will no longer be counted in the aggregates.",
            )}
            libelleConfirmation={t("Oui, retirer", "Yes, withdraw")}
            texteChargement={t("Retrait en cours…", "Withdrawing…")}
            action={retirer}
          />
        ) : null}
      </div>
      {aDesContributions ? null : (
        <p className="mp-texte-petit mp-texte-doux">
          {t(
            "Aucune contribution à retirer : versez d'abord les données du cabinet.",
            "No contribution to withdraw: contribute the firm's data first.",
          )}
        </p>
      )}
    </div>
  );
}
