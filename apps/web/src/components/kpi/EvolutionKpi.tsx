"use client";

import { useEffect, useId, useRef, useState } from "react";
import { formaterDate } from "../../lib/format";
import { chargerExportKpi, messageKpi, type ExportKpi } from "../../lib/kpi";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { GraphiqueSerieKpi } from "./GraphiqueSerieKpi";

export interface EvolutionKpiProps {
  missionId: string;
  /** Date d'arrêté (null : aujourd'hui). */
  date: string | null;
  /** Restreindre à un KPI (fiche du KPI). */
  kpiId?: string;
}

type Etat =
  | { etape: "repos" }
  | { etape: "chargement" }
  | { etape: "erreur"; message: string }
  | { etape: "pret"; donnees: ExportKpi };

/**
 * Séries par période chargées À LA DEMANDE : le tableau de bord ne sert que la dernière
 * période et la période en cours ; la série (36 dernières périodes au plus, valeurs, cibles
 * et statuts du moteur) vient de l'export de la mission, journalisé par l'API. Rien n'est
 * conservé dans le navigateur : les données vivent le temps de l'affichage.
 */
export function EvolutionKpi({ missionId, date, kpiId }: EvolutionKpiProps) {
  const id = useId();
  const [etat, setEtat] = useState<Etat>({ etape: "repos" });
  const refAlerte = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (etat.etape === "erreur") refAlerte.current?.focus();
  }, [etat]);

  async function charger() {
    setEtat({ etape: "chargement" });
    try {
      setEtat({ etape: "pret", donnees: await chargerExportKpi(missionId, date) });
    } catch (e) {
      setEtat({ etape: "erreur", message: messageKpi(e) });
    }
  }

  const kpis =
    etat.etape === "pret"
      ? etat.donnees.kpis.filter((k) => !kpiId || k.definition.id === kpiId)
      : [];
  const annonce =
    etat.etape === "chargement"
      ? "Chargement de l'évolution par période…"
      : etat.etape === "pret"
        ? `Évolution chargée : ${kpis.length} KPI, arrêté au ${formaterDate(etat.donnees.date_reference)}.`
        : "";

  return (
    <div className="mp-pile">
      <p className="mp-visuellement-cache" role="status" aria-live="polite">
        {annonce}
      </p>
      {etat.etape === "repos" || etat.etape === "chargement" || etat.etape === "erreur" ? (
        <>
          <p className="mp-texte-doux">
            Valeurs agrégées et cibles par période (36 dernières périodes au plus), avec le statut
            calculé par le moteur. Le chargement prépare les données complètes de la mission : il
            peut prendre quelques secondes et est consigné au journal comme un export.
          </p>
          {etat.etape === "erreur" ? (
            <Alerte ref={refAlerte} tonalite="danger" titre="Évolution indisponible">
              <p>{etat.message}</p>
            </Alerte>
          ) : null}
          <div className="mp-actions-formulaire">
            <Bouton
              variante="secondaire"
              icone="courbe"
              chargement={etat.etape === "chargement"}
              texteChargement="Chargement…"
              onClick={charger}
            >
              {etat.etape === "erreur" ? "Réessayer" : "Afficher l'évolution par période"}
            </Bouton>
          </div>
        </>
      ) : kpis.length === 0 ? (
        <p className="mp-texte-doux">Aucun KPI actif à cette date : aucune série à afficher.</p>
      ) : (
        kpis.map((k) => (
          <section key={k.definition.id} className="mp-pile" aria-label={k.definition.libelle}>
            {kpiId ? null : <h3 className="mp-kpi-serie__titre">{k.definition.libelle}</h3>}
            <GraphiqueSerieKpi
              libelle={k.definition.libelle}
              unite={k.definition.unite}
              periodes={k.periodes}
              idPrefixe={`${id}-${k.definition.id}-serie`}
            />
            {k.periodes_total > k.periodes.length ? (
              <p className="mp-texte-doux mp-texte-petit">
                {`Les ${k.periodes.length} dernières périodes sont affichées, sur ${k.periodes_total} depuis le début du suivi.`}
              </p>
            ) : null}
          </section>
        ))
      )}
    </div>
  );
}
