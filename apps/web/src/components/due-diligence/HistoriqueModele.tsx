"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import { messageDd } from "../../lib/due-diligence";
import { cheminVersionsModele, type VersionModele } from "../../lib/due-diligence-modeles";
import { formaterDateHeure } from "../../lib/format";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";

/** Historique des versions d'un modèle sectoriel, chargé à la demande (ajout seul). */
export function HistoriqueModele({ id }: { id: string }) {
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
      setErreur(messageDd(e));
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
            texteChargement="Chargement…"
            onClick={() => void charger()}
          >
            Afficher l&apos;historique
          </Bouton>
        </div>
      ) : (
        <ol className="mp-dd-liste" aria-label="Versions, de la plus récente à la plus ancienne">
          {[...versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <li key={v.version} className="mp-dd-element">
                <p className="mp-dd-element__titre">{`Version ${v.version}`}</p>
                <p className="mp-texte-doux mp-texte-petit">{formaterDateHeure(v.cree_le)}</p>
                {v.motif ? <p className="mp-dd-texte">{`Motif : ${v.motif}`}</p> : null}
                <p className="mp-texte-petit">
                  {`${v.points.length} point${v.points.length > 1 ? "s" : ""} à examiner · ${v.actif ? "actif" : "retiré"}`}
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
