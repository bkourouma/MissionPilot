"use client";

import { useState } from "react";
import { api } from "../../lib/api";
import {
  chargerVersionCouranteListe,
  chargerVersionsListe,
  cheminVersionsSignal,
  libellesDd,
  messageDd,
  type EntreeTaxonomie,
  type ListeExclusion,
  type VersionListeExclusion,
  type VersionSignal,
} from "../../lib/due-diligence";
import { formaterDateHeure } from "../../lib/format";
import { useLangue, useT } from "../i18n/FournisseurLangue";
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

const libelleDe = (
  entrees: readonly EntreeTaxonomie[],
  code: string | null,
  absent: string,
  indisponible: string,
) => (code === null ? absent : (entrees.find((e) => e.code === code)?.libelle ?? indisponible));

/** Historique des versions d'un signal ou d'une liste d'exclusion, chargé à la demande (ajout seul). */
export function HistoriqueVersions({ type, id, secteurs, pays }: HistoriqueVersionsProps) {
  const t = useT();
  const langue = useLangue();
  const L = libellesDd(langue);
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
        const r = await chargerVersionsListe(id, (chemin) => api.get(chemin), langue);
        if (r.ok) setVersions(r.donnees.elements);
        else setErreur(r.message);
      }
    } catch (e) {
      setErreur(messageDd(e, langue));
    } finally {
      setEnCours(false);
    }
  }

  const indisponible = t("Libellé indisponible", "Label unavailable");
  const tous = t("tous", "all");

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
      ) : versions.length === 0 ? (
        <p className="mp-texte-doux">{t("Aucune version enregistrée.", "No version saved.")}</p>
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
                {"gravite_indicative" in v ? (
                  <p className="mp-texte-petit">
                    {t(
                      `${v.libelle} · ${L.FAMILLE[v.famille]} · gravité ${L.NIVEAU_RISQUE[v.gravite_indicative].toLowerCase()} · secteur : ${libelleDe(secteurs, v.secteur_code, tous, indisponible)} · pays : ${libelleDe(pays, v.pays_code, tous, indisponible)} · ${v.actif ? "actif" : "inactif"}`,
                      `${v.libelle} · ${L.FAMILLE[v.famille]} · severity ${L.NIVEAU_RISQUE[v.gravite_indicative].toLowerCase()} · sector: ${libelleDe(secteurs, v.secteur_code, tous, indisponible)} · country: ${libelleDe(pays, v.pays_code, tous, indisponible)} · ${v.actif ? "active" : "inactive"}`,
                    )}
                  </p>
                ) : (
                  <p className="mp-texte-petit">
                    {t(
                      `${v.regles.length} règle${v.regles.length > 1 ? "s" : ""} : ${v.regles.map((r) => r.libelle).join(", ")}`,
                      `${v.regles.length} rule${v.regles.length > 1 ? "s" : ""}: ${v.regles.map((r) => r.libelle).join(", ")}`,
                    )}
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
  const t = useT();
  const langue = useLangue();
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
      else {
        setErreur(
          t("Cette liste n'a aucune version lisible.", "This list has no readable version."),
        );
      }
    } catch (e) {
      setErreur(messageDd(e, langue));
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
          texteChargement={t("Chargement…", "Loading…")}
          onClick={() => void charger()}
        >
          {t("Charger les règles pour les corriger", "Load the rules to edit them")}
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
