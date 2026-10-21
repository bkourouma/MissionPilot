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
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { useFormulaire } from "../formulaires/useFormulaire";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";

/*
 * Formulaires de l'observatoire (réservés à l'associé ; l'API reste juge du droit) : adhésion avec
 * consentement explicite, retrait d'adhésion, versement et retrait des contributions.
 */

const OPTS = { messageSpecifique: messageObservatoire };

export function FormulaireAdhesion() {
  const f = useFormulaire<ChampAdhesion>();
  const [consentement, setConsentement] = useState(false);
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(lireAdhesion({ consentement, motif }), (c) => api.post(CHEMIN_ADHESION, c), {
      ...OPTS,
      succes: "Votre cabinet a adhéré à l'observatoire.",
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Adhésion impossible"
      />
      <CaseACocher
        libelle="Je confirme, au nom du cabinet, adhérer volontairement à l'observatoire."
        aide="Le cabinet verse des données agrégées et anonymes, et accède en retour aux agrégats des cabinets contributeurs. Le retrait reste possible à tout moment."
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
        libelle="Motif (facultatif)"
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton type="submit" chargement={f.enCours} texteChargement="Adhésion en cours…">
          Adhérer à l'observatoire
        </Bouton>
      </div>
    </form>
  );
}

export function FormulaireRetraitAdhesion() {
  const f = useFormulaire<"motif">();
  const [motif, setMotif] = useState("");

  async function soumettre(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    await f.envoyer(lireRetrait({ motif }), (c) => api.post(CHEMIN_RETRAIT_ADHESION, c), {
      ...OPTS,
      succes: "Votre cabinet s'est retiré de l'observatoire.",
    });
  }

  return (
    <form ref={f.refFormulaire} className="mp-formulaire" noValidate onSubmit={soumettre}>
      <RetourFormulaire
        erreur={f.erreurGlobale}
        succes={f.succes}
        refAlerte={f.refAlerte}
        titreErreur="Retrait impossible"
      />
      <p className="mp-texte-petit mp-texte-doux">
        Le retrait est immédiat : votre cabinet ne voit plus les agrégats et ses contributions ne
        sont plus retenues. Une nouvelle adhésion demandera de verser à nouveau.
      </p>
      <ZoneTexte
        libelle="Motif (facultatif)"
        rows={2}
        maxLength={MOTIF_MAX}
        value={motif}
        onChange={(e) => setMotif(e.target.value)}
        erreur={f.erreurs.motif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="submit"
          variante="danger"
          chargement={f.enCours}
          texteChargement="Retrait en cours…"
        >
          Retirer mon cabinet de l'observatoire
        </Bouton>
      </div>
    </form>
  );
}

export function ActionsContributions({ aDesContributions }: { aDesContributions: boolean }) {
  const fVerser = useFormulaire<never>();
  const fRetirer = useFormulaire<never>();

  async function verser() {
    await fVerser.envoyer(
      { ok: true, charge: { indicateur: "notation_score_global" as const } },
      (c) => api.post(CHEMIN_CONTRIBUTIONS, c),
      { ...OPTS, succes: "Vos données ont été versées ; elles seront retenues le mois suivant." },
    );
  }

  async function retirer() {
    await fRetirer.envoyer(
      { ok: true, charge: {} },
      (c) => api.post(`${CHEMIN_CONTRIBUTIONS}/retrait`, c),
      { ...OPTS, succes: "Vos contributions ont été retirées." },
    );
  }

  return (
    <div className="mp-observatoire__actions">
      <RetourFormulaire
        erreur={fVerser.erreurGlobale}
        succes={fVerser.succes}
        refAlerte={fVerser.refAlerte}
        titreErreur="Versement impossible"
      />
      <RetourFormulaire
        erreur={fRetirer.erreurGlobale}
        succes={fRetirer.succes}
        refAlerte={fRetirer.refAlerte}
        titreErreur="Retrait impossible"
      />
      <div className="mp-actions-formulaire">
        <Bouton
          type="button"
          onClick={verser}
          chargement={fVerser.enCours}
          texteChargement="Versement en cours…"
        >
          Verser les données du cabinet
        </Bouton>
        <Bouton
          type="button"
          variante="secondaire"
          onClick={retirer}
          disabled={!aDesContributions}
          chargement={fRetirer.enCours}
          texteChargement="Retrait en cours…"
        >
          Retirer mes contributions
        </Bouton>
      </div>
    </div>
  );
}
