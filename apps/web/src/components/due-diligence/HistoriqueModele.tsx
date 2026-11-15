"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageDd } from "../../lib/due-diligence";
import { cheminVersionsModele, type VersionModele } from "../../lib/due-diligence-modeles";
import { formaterDateHeure } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

/** Historique des versions d'un modèle sectoriel, chargé à la demande (ajout seul). */
export function HistoriqueModele({ id }: { id: string }) {
  const t = useT();
  const langue = useLangue();
  const [versions, setVersions] = useState<VersionModele[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    setEnCours(true);
    setErreur(null);
    try {
      const r = await api.get<{ elements: VersionModele[] }>(cheminVersionsModele(id));
      setVersions(r.elements);
    } catch (e) {
      setErreur(messageDd(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  return (
    <div className="mp-dd-pile">
      {versions === null ? (
        <div>
          <Bouton
            variante="secondaire"
            icone="historique"
            chargement={enCours}
            texteChargement={t("Chargement…", "Loading…")}
            onClick={() => void charger()}
          >
            {t("Afficher l'historique", "Show history")}
          </Bouton>
        </div>
      ) : (
        <ol
          className="mp-dd-liste"
          aria-label={t(
            "Versions, de la plus récente à la plus ancienne",
            "Versions, from newest to oldest",
          )}
        >
          {[...versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <li key={v.version} className="mp-dd-element">
                <p className="mp-dd-element__titre">{`Version ${v.version}`}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {formaterDateHeure(v.cree_le, undefined, langue)}
                </p>
                {v.motif ? (
                  <p className="mp-dd-texte">{`${t("Motif", "Reason")} : ${v.motif}`}</p>
                ) : null}
                <p className="mp-texte-petit">
                  {t(
                    `${v.points.length} point${v.points.length > 1 ? "s" : ""} à examiner · ${v.actif ? "actif" : "retiré"}`,
                    `${v.points.length} point${v.points.length > 1 ? "s" : ""} to examine · ${v.actif ? "active" : "removed"}`,
                  )}
                </p>
              </li>
            ))}
        </ol>
      )}
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
