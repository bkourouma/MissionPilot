"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import {
  cheminValidationModele,
  etatModeleChange,
  libelleValidationModele,
  messageModele,
  type ResumeModele,
} from "../../lib/plan-modele";
import { BoutonConfirmation } from "../formulaires/BoutonConfirmation";
import { useAttenteRafraichissement } from "../formulaires/useAttenteRafraichissement";
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
  const router = useRouter();
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
      setSucces(`Version ${version} validée : elle sert désormais de référence (ROI, rapport).`);
      attendre();
      router.refresh();
      return true;
    } catch (e) {
      setErreur(messageModele(e));
      if (etatModeleChange(e)) router.refresh();
      return false;
    }
  }

  return (
    <div className="mp-plan__section">
      {erreur ? (
        <Alerte ref={refErreur} tonalite="danger" titre="Validation refusée">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
      {succes ? (
        <Alerte tonalite="succes" annonce="status">
          <p>{succes}</p>
        </Alerte>
      ) : null}
      {validation ? (
        <Alerte tonalite="succes" titre={libelleValidationModele({ validation })} annonce="aucune">
          <p>
            Une version validée ne se modifie plus : toute correction crée une nouvelle version.
          </p>
        </Alerte>
      ) : (
        <Alerte tonalite="attention" titre="Version non validée" annonce="aucune">
          <p>
            Elle doit être validée par un responsable de la mission, autre que son auteur, avant
            tout partage du plan au client.
          </p>
        </Alerte>
      )}
      {!validation && peutValider && !raison ? (
        <div className="mp-barre-actions">
          <BoutonConfirmation
            libelle={`Valider la version ${version}`}
            question={`Valider la version ${version} du modèle financier ? Ses chiffres, calculés par le moteur, deviendront la référence du plan.`}
            libelleConfirmation="Oui, valider"
            texteChargement="Validation…"
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
