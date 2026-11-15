"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminValidationModele,
  etatModeleChange,
  libelleValidationModele,
  messageModele,
  texteRegleValidationModele,
  type ResumeModele,
} from "../../lib/plan-modele";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
import { useRafraichir } from "../formulaires/useRafraichir";
import { Alerte } from "../ui/Alerte";

export interface ValidationVersionModeleProps {
  planId: string;
  version: number;
  validation: ResumeModele["validation"];
  /** Responsable de la mission (plan.valider), mission ouverte. */
  peutValider: boolean;
  /** Pourquoi la validation n'est pas proposée (séparation des tâches), sinon null. */
  raison: string | null;
}

/**
 * Validation d'une version du modèle financier par un responsable de la mission, autre que
 * son auteur (sauf associé ou directeur de la mission). Le refus de l'API (403
 * VALIDATION_REQUISE) est expliqué en clair ; une version validée l'est une fois pour toutes.
 */
export function ValidationVersionModele({
  planId,
  version,
  validation,
  peutValider,
  raison,
}: ValidationVersionModeleProps) {
  const t = useT();
  const langue = useLangue();
  const { rafraichir } = useRafraichir();
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const [attente, attendre] = useAttenteRafraichissement(validation?.valide_le ?? null);
  const refErreur = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (erreur) refErreur.current?.focus();
  }, [erreur]);
  useEffect(() => {
    setErreur(null);
    setSucces(null);
  }, [version]);

  async function valider(): Promise<boolean> {
    if (attente) return false;
    setErreur(null);
    try {
      await api.post<ResumeModele>(cheminValidationModele(planId, version));
      setSucces(
        t(
          `Version ${version} validée : elle sert désormais de référence (ROI, rapport).`,
          `Version ${version} approved: it is now the reference (ROI, report).`,
        ),
      );
      attendre();
      rafraichir();
      return true;
    } catch (e) {
      setErreur(messageModele(e, langue));
      if (etatModeleChange(e)) rafraichir();
      return false;
    }
  }

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte
          ref={refErreur}
          tonalite="danger"
          titre={t("Validation refusée", "Approval refused")}
        >
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {validation ? (
        <Alerte
          tonalite="succes"
          titre={libelleValidationModele({ validation }, langue)}
          annonce="aucune"
        >
          <p>
            {t(
              "Une version validée ne se modifie plus : toute correction crée une nouvelle version.",
              "An approved version can no longer be edited: any correction creates a new version.",
            )}
          </p>
        </Alerte>
      ) : (
        <Alerte
          tonalite="attention"
          titre={t("Version non validée", "Version not approved")}
          annonce="aucune"
        >
          <p>
            {texteRegleValidationModele(langue)}{" "}
            {t(
              "Validation requise avant tout partage du plan au client.",
              "Approval is required before the plan is shared with the client.",
            )}
          </p>
        </Alerte>
      )}
      {!validation && peutValider && !raison ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={t(`Valider la version ${version}`, `Approve version ${version}`)}
            question={t(
              `Valider la version ${version} du modèle financier ? Ses chiffres, calculés par le moteur, deviendront la référence du plan.`,
              `Approve version ${version} of the financial model? Its figures, computed by the engine, will become the plan reference.`,
            )}
            libelleConfirmation={t("Oui, valider", "Yes, approve")}
            texteChargement={t("Validation…", "Approving…")}
            variante="primaire"
            icone="succes"
            action={valider}
          />
        </div>
      ) : null}
      {!validation && peutValider && raison ? (
        <p className="mp-texte-doux mp-texte-petit">{raison}</p>
      ) : null}
    </div>
  );
}
