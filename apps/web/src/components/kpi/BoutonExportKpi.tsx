"use client";

import { useEffect, useRef, useState } from "react";
import { formaterDate } from "../../lib/format";
import {
  chargerExportKpi,
  FORMAT_EXPORT_KPI,
  messageKpi,
  nomFichierExportKpi,
} from "../../lib/kpi";
import { RetourFormulaire } from "../formulaires/RetourFormulaire";
import { Bouton } from "../ui/Bouton";

export interface BoutonExportKpiProps {
  missionId: string;
  /** Date d'arrêté (null : aujourd'hui). */
  date: string | null;
  intitule: string;
}

/**
 * Export JSON versionné (`missionpilot.kpi.v1`) des KPI actifs de la mission à la date
 * d'arrêté : définitions, cibles, historique des mesures, séries, statuts et alertes, tels
 * que l'API les sert. Appel authentifié par le cookie de session ; le fichier est remis au
 * navigateur sans être conservé (URL temporaire révoquée aussitôt).
 */
export function BoutonExportKpi({ missionId, date, intitule }: BoutonExportKpiProps) {
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, setSucces] = useState<string | null>(null);
  const refAlerte = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (erreur) refAlerte.current?.focus();
  }, [erreur]);

  async function exporter() {
    setErreur(null);
    setSucces(null);
    setEnCours(true);
    try {
      const donnees = await chargerExportKpi(missionId, date);
      const fichier = new Blob([JSON.stringify(donnees, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(fichier);
      const lien = document.createElement("a");
      lien.href = url;
      lien.download = nomFichierExportKpi(
        donnees.mission.intitule ?? intitule,
        donnees.date_reference,
      );
      document.body.appendChild(lien);
      lien.click();
      lien.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setSucces(
        `Export téléchargé (format ${FORMAT_EXPORT_KPI}, arrêté au ${formaterDate(donnees.date_reference)}, ${donnees.kpis.length} KPI).`,
      );
    } catch (e) {
      setErreur(messageKpi(e));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-pile">
      <RetourFormulaire
        erreur={erreur}
        succes={succes}
        refAlerte={refAlerte}
        titreErreur="Export impossible"
      />
      <div className="mp-actions-formulaire">
        <Bouton
          variante="secondaire"
          icone="telechargement"
          chargement={enCours}
          texteChargement="Préparation de l'export…"
          onClick={exporter}
        >
          Exporter les données (JSON)
        </Bouton>
      </div>
    </div>
  );
}
