"use client";

import Link from "next/link";
import { useState } from "react";
import { hrefEcranDossier, libellesDd, type EtapeCarte } from "../../lib/due-diligence";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Calcule } from "../ui/Calcule";
import { EtatVide } from "../ui/EtatListe";
import { BadgeLecture, BadgeNiveauRisque } from "./BadgesDd";
import "./due-diligence-lecture.css";

export interface CarteChaineProps {
  missionId: string;
  dossierId: string;
  /** Étapes déjà triées par ordre (objets simples, sérialisables). */
  etapes: EtapeCarte[];
}

const libelleRisques = (n: number, t: (fr: string, en: string) => string) =>
  n === 0
    ? t("Aucun risque", "No risk")
    : n === 1
      ? t("1 risque", "1 risk")
      : t(`${n} risques`, `${n} risks`);

/**
 * Carte de la chaîne de valeur (DD-04) : les étapes en séquence (horizontale sur grand écran,
 * verticale sur téléphone). Chaque étape est un bouton (`aria-pressed`) ; l'activer affiche ses
 * risques dans le panneau voisin. Les parts de coût et de marge sont celles formatées par l'API.
 */
export function CarteChaine({ missionId, dossierId, etapes }: CarteChaineProps) {
  const t = useT();
  const L = libellesDd(useLangue());
  const [selection, setSelection] = useState<string | null>(null);
  const choisie = etapes.find((e) => e.id === selection) ?? null;
  const hrefRisques = hrefEcranDossier(missionId, dossierId, "risques");

  if (etapes.length === 0) {
    return (
      <EtatVide titre={t("Aucune étape", "No step")}>
        <p>
          {t(
            "Décrivez les étapes de la chaîne de valeur pour voir où se concentrent coûts, marges et risques.",
            "Describe the value chain steps to see where costs, margins and risks concentrate.",
          )}
        </p>
      </EtatVide>
    );
  }

  return (
    <div className="mp-chaine-zone">
      <p className="mp-dd-legende-calcul mp-texte-petit mp-texte-doux">
        <Calcule />
        <span>
          {t(
            "Parts de coût et de marge issues du moteur. Activez une étape pour voir ses risques.",
            "Cost and margin shares come from the engine. Select a step to see its risks.",
          )}
        </span>
      </p>
      <ol
        className="mp-chaine"
        aria-label={t("Étapes de la chaîne de valeur, dans l'ordre", "Value chain steps, in order")}
      >
        {etapes.map((e, i) => (
          <li key={e.id} className="mp-chaine__item">
            <button
              type="button"
              className="mp-chaine__etape"
              aria-pressed={selection === e.id}
              aria-controls="panneau-etape"
              onClick={() => setSelection(selection === e.id ? null : e.id)}
            >
              <span className="mp-chaine__rang">{t(`Étape ${e.ordre}`, `Step ${e.ordre}`)}</span>
              <span className="mp-chaine__nom">{e.libelle}</span>
              {e.acteurs.length > 0 ? (
                <span className="mp-texte-doux mp-texte-petit">
                  {`${t("Acteurs", "Actors")} : ${e.acteurs.join(", ")}`}
                </span>
              ) : null}
              <span className="mp-chaine__parts">
                <span>{`${t("Coût", "Cost")} : ${e.partCoutAffichee}`}</span>
                <span>{`${t("Marge", "Margin")} : ${e.partMargeAffichee}`}</span>
              </span>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={e.risques.length > 0 ? "attention" : "neutre"} sansIcone>
                  {libelleRisques(e.risques.length, t)}
                </BadgeStatut>
                {e.margeMax ? (
                  <BadgeStatut tonalite="succes">
                    {t("Plus forte marge", "Highest margin")}
                  </BadgeStatut>
                ) : null}
              </span>
            </button>
            {i < etapes.length - 1 ? (
              <span className="mp-chaine__fleche" aria-hidden="true">
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.8}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  focusable="false"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <section
        id="panneau-etape"
        className="mp-chaine__panneau"
        aria-live="polite"
        aria-label={t("Risques de l'étape choisie", "Risks of the selected step")}
      >
        {choisie === null ? (
          <p className="mp-texte-doux">
            {t(
              "Choisissez une étape pour afficher ses risques (niveau, famille, solidité).",
              "Choose a step to show its risks (level, family, strength).",
            )}
          </p>
        ) : (
          <>
            <h3 className="mp-carte__titre">{`${t("Risques", "Risks")} : ${choisie.libelle}`}</h3>
            {choisie.risques.length === 0 ? (
              <p className="mp-texte-doux">
                {t(
                  "Aucun risque n'est rattaché à cette étape. Rattachez-en depuis l'onglet « Risques ».",
                  "No risk is attached to this step. Attach some from the “Risks” tab.",
                )}
              </p>
            ) : (
              <ul className="mp-dd-liste">
                {choisie.risques.map((r) => (
                  <li key={r.id} className="mp-dd-element">
                    <p className="mp-dd-element__titre">
                      <Link href={`${hrefRisques}?etape_id=${encodeURIComponent(choisie.id)}`}>
                        {r.libelle}
                      </Link>
                    </p>
                    <span className="mp-dd-meta">
                      <BadgeNiveauRisque niveau={r.niveau} />
                      <BadgeStatut tonalite="neutre" sansIcone>
                        {L.FAMILLE[r.famille]}
                      </BadgeStatut>
                      <BadgeLecture lecture={r.lecture} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
