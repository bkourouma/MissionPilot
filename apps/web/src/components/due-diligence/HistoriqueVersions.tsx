"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  chargerVersionCouranteListe,
  chargerVersionsListe,
  cheminVersionsSignal,
  FAMILLE_RISQUE_DD_LIBELLES,
  messageDd,
  NIVEAU_RISQUE_DD_LIBELLES,
  type EntreeTaxonomie,
  type ListeExclusion,
  type VersionListeExclusion,
  type VersionSignal,
} from "../../lib/due-diligence";
import { formaterDateHeure } from "../../lib/format";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { FormulaireListeExclusion } from "./FormulaireListeExclusion";

export interface HistoriqueVersionsProps {
  type: "signal" | "liste";
  id: string;
  /** Libellés de taxonomie pour afficher secteur et pays (jamais un code). */
  secteurs: readonly EntreeTaxonomie[];
  pays: readonly EntreeTaxonomie[];
}

const libelleDe = (entrees: readonly EntreeTaxonomie[], code: string | null, absent: string) =>
  code === null
    ? absent
    : (entrees.find((e) => e.code === code)?.libelle ?? "Libellé indisponible");

/** Historique des versions d'un signal ou d'une liste d'exclusion, chargé à la demande (ajout seul). */
export function HistoriqueVersions({ type, id, secteurs, pays }: HistoriqueVersionsProps) {
  const [versions, setVersions] = useState<(VersionSignal | VersionListeExclusion)[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    setEnCours(true);
    setErreur(null);
    try {
      if (type === "signal") {
        const r = await api.get<{ elements: VersionSignal[] }>(cheminVersionsSignal(id));
        setVersions(r.elements);
      } else {
        // R38 est paginée (10 par page, 20 au plus) : toutes les pages, sinon l'historique serait tronqué.
        const r = await chargerVersionsListe(id, (chemin) => api.get(chemin));
        if (r.ok) setVersions(r.donnees.elements);
        else setErreur(r.message);
      }
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
      ) : versions.length === 0 ? (
        <p className="mp-texte-doux">Aucune version enregistrée.</p>
      ) : (
        <ol className="mp-dd-liste" aria-label="Versions, de la plus récente à la plus ancienne">
          {[...versions]
            .sort((a, b) => b.version - a.version)
            .map((v) => (
              <li key={v.version} className="mp-dd-element">
                <p className="mp-dd-element__titre">{`Version ${v.version}`}</p>
                <p className="mp-texte-doux mp-texte-petit">{formaterDateHeure(v.cree_le)}</p>
                {v.motif ? <p className="mp-dd-texte">{`Motif : ${v.motif}`}</p> : null}
                {"gravite_indicative" in v ? (
                  <p className="mp-texte-petit">
                    {`${v.libelle} · ${FAMILLE_RISQUE_DD_LIBELLES[v.famille]} · gravité ${NIVEAU_RISQUE_DD_LIBELLES[v.gravite_indicative].toLowerCase()} · secteur : ${libelleDe(secteurs, v.secteur_code, "tous")} · pays : ${libelleDe(pays, v.pays_code, "tous")} · ${v.actif ? "actif" : "inactif"}`}
                  </p>
                ) : (
                  <p className="mp-texte-petit">
                    {`${v.regles.length} règle${v.regles.length > 1 ? "s" : ""} : ${v.regles.map((r) => r.libelle).join(", ")}`}
                  </p>
                )}
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

export interface CorrectionListeExclusionProps {
  liste: ListeExclusion;
  secteurs: readonly EntreeTaxonomie[];
  pays: readonly EntreeTaxonomie[];
  investisseurs: { valeur: string; libelle: string }[];
}

/** Correction motivée d'une liste : charge d'abord sa version courante (règles comprises) à la demande. */
export function CorrectionListeExclusion({
  liste,
  secteurs,
  pays,
  investisseurs,
}: CorrectionListeExclusionProps) {
  const [courante, setCourante] = useState<VersionListeExclusion | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);

  async function charger() {
    setEnCours(true);
    setErreur(null);
    try {
      // Une seule version suffit (la plus récente) : la route est paginée et chaque version est lourde.
      const derniere = await chargerVersionCouranteListe(liste.id, (chemin) => api.get(chemin));
      if (derniere) setCourante(derniere);
      else setErreur("Cette liste n'a aucune version lisible.");
    } catch (e) {
      setErreur(messageDd(e));
    } finally {
      setEnCours(false);
    }
  }

  if (courante) {
    return (
      <FormulaireListeExclusion
        secteurs={secteurs}
        pays={pays}
        investisseurs={investisseurs}
        liste={{ liste, courante }}
      />
    );
  }
  return (
    <div className="mp-dd-pile">
      <div>
        <Bouton
          variante="secondaire"
          chargement={enCours}
          texteChargement="Chargement…"
          onClick={() => void charger()}
        >
          Charger les règles pour les corriger
        </Bouton>
      </div>
      {erreur ? (
        <Alerte tonalite="danger" annonce="alert">
          <p>{erreur}</p>
        </Alerte>
      ) : null}
    </div>
  );
}
