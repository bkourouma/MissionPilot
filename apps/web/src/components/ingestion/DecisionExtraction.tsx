"use client";

import "./ingestion.css";
import { useState, type FormEvent, type ReactNode } from "react";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { CaseACocher } from "../ui/CaseACocher";
import { ZoneTexte } from "../ui/ZoneTexte";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import {
  deciderExtraction,
  messageErreur,
  type ApiIngestion,
  type ExtractionIngestion,
} from "../../lib/ingestion";
import { corpsDecision, erreurDecision, MOTIF_REJET_MAX } from "../../lib/ingestion-extractions";

export interface DecisionExtractionProps {
  api: ApiIngestion;
  extraction: ExtractionIngestion;
  /** Le brouillon cite des éléments non retrouvés dans la source : acquittement obligatoire. */
  nonVerifies: boolean;
  libelleValider: string;
  /** Aide sous les boutons (ce que fait la validation). */
  aide?: ReactNode;
  /** Si renseignée, la validation est impossible (le rejet reste possible) et la raison s'affiche. */
  raisonValidationImpossible?: string;
  /** Appelé avec la vue de l'extraction tranchée. */
  onDecide: (extraction: ExtractionIngestion) => void;
}

/**
 * Valider ou rejeter un brouillon. La validation exige, quand des éléments ne sont pas retrouvés
 * dans la source, la case « J'ai relu les éléments non retrouvés dans la source » ; le rejet exige
 * un motif. Le serveur reste juge (droit, séparation des tâches, acquittement).
 */
export function DecisionExtraction({
  api,
  extraction,
  nonVerifies,
  libelleValider,
  aide,
  raisonValidationImpossible,
  onDecide,
}: DecisionExtractionProps) {
  const t = useT();
  const langue = useLangue();
  const [motif, setMotif] = useState("");
  const [acquitte, setAcquitte] = useState(false);
  const [erreurAcquittement, setErreurAcquittement] = useState<string | undefined>();
  const [erreurMotif, setErreurMotif] = useState<string | undefined>();
  const [enCours, setEnCours] = useState<"validee" | "rejetee" | null>(null);
  const [echec, setEchec] = useState<string | null>(null);
  const [annonce, setAnnonce] = useState("");

  async function decider(decision: "validee" | "rejetee") {
    const saisie = { decision, motif, acquitte, nonVerifies };
    const erreur = erreurDecision(saisie, langue);
    setErreurAcquittement(decision === "validee" ? (erreur ?? undefined) : undefined);
    setErreurMotif(decision === "rejetee" ? (erreur ?? undefined) : undefined);
    setEchec(null);
    if (erreur) return;
    setEnCours(decision);
    try {
      const vue = await deciderExtraction(api, extraction.id, corpsDecision(saisie));
      setAnnonce(
        decision === "validee"
          ? t("Brouillon validé.", "Draft approved.")
          : t("Brouillon rejeté.", "Draft rejected."),
      );
      onDecide(vue);
    } catch (e) {
      setEchec(messageErreur(e));
    } finally {
      setEnCours(null);
    }
  }

  const occupe = enCours !== null;
  const validationBloquee = Boolean(raisonValidationImpossible);

  return (
    <form
      className="mp-formulaire"
      noValidate
      aria-label={t("Décision sur le brouillon", "Decision on the draft")}
      onSubmit={(ev: FormEvent) => ev.preventDefault()}
    >
      {nonVerifies ? (
        <Alerte
          tonalite="attention"
          titre={t(
            "Des éléments ne sont pas retrouvés dans la source",
            "Some elements were not found in the source",
          )}
        >
          <p>
            {t(
              "Relisez chaque élément marqué « NON retrouvé dans la page » avant de valider : corrigez-le, retirez-le ou confirmez-le en connaissance de cause.",
              'Review each element marked "NOT found in the page" before approving: correct it, remove it or confirm it knowingly.',
            )}
          </p>
        </Alerte>
      ) : null}
      {nonVerifies ? (
        <CaseACocher
          libelle={t(
            "J'ai relu les éléments non retrouvés dans la source",
            "I have reviewed the elements not found in the source",
          )}
          checked={acquitte}
          disabled={occupe || validationBloquee}
          onChange={(e) => {
            setAcquitte(e.target.checked);
            setErreurAcquittement(undefined);
          }}
          aria-invalid={erreurAcquittement ? true : undefined}
          aria-describedby={erreurAcquittement ? "erreur-acquittement" : undefined}
        />
      ) : null}
      {erreurAcquittement ? (
        <p id="erreur-acquittement" className="mp-champ__erreur" role="alert">
          {erreurAcquittement}
        </p>
      ) : null}
      {validationBloquee ? (
        <Alerte tonalite="info" annonce="aucune">
          <p>{raisonValidationImpossible}</p>
        </Alerte>
      ) : null}
      <ZoneTexte
        libelle={t(
          "Motif du rejet (obligatoire pour rejeter)",
          "Reason for rejection (required to reject)",
        )}
        value={motif}
        maxLength={MOTIF_REJET_MAX}
        disabled={occupe}
        onChange={(e) => {
          setMotif(e.target.value);
          setErreurMotif(undefined);
        }}
        erreur={erreurMotif}
      />
      <div className="mp-actions-formulaire">
        <Bouton
          icone="succes"
          disabled={occupe || validationBloquee}
          chargement={enCours === "validee"}
          texteChargement={t("Validation en cours…", "Approving…")}
          onClick={() => void decider("validee")}
        >
          {libelleValider}
        </Bouton>
        <Bouton
          variante="danger"
          disabled={occupe}
          chargement={enCours === "rejetee"}
          texteChargement={t("Rejet en cours…", "Rejecting…")}
          onClick={() => void decider("rejetee")}
        >
          {t("Rejeter le brouillon", "Reject the draft")}
        </Bouton>
      </div>
      {aide ? <div className="mp-champ__aide">{aide}</div> : null}
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      {echec ? (
        <Alerte tonalite="danger" titre={t("Décision refusée", "Decision rejected")}>
          <p>{echec}</p>
        </Alerte>
      ) : null}
    </form>
  );
}
