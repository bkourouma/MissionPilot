"use client";

import Link from "next/link";
import { useState } from "react";
import {
  FAMILLE_RISQUE_DD_LIBELLES,
  hrefEcranDossier,
  type EtapeCarte,
} from "../../lib/due-diligence";
import { BadgeStatut } from "../ui/BadgeStatut";
import { BadgeLecture, BadgeNiveauRisque } from "./BadgesDd";

export interface CarteChaineProps {
  missionId: string;
  dossierId: string;
  /** Étapes déjà triées par ordre (objets simples, sérialisables). */
  etapes: EtapeCarte[];
}

const libelleRisques = (n: number) =>
  n === 0 ? "Aucun risque" : n === 1 ? "1 risque" : `${n} risques`;

/**
 * Carte de la chaîne de valeur (DD-04) : les étapes en séquence (horizontale sur grand écran,
 * verticale sur téléphone). Chaque étape est un bouton (`aria-pressed`) ; l'activer affiche ses
 * risques dans le panneau voisin. Les parts de coût et de marge sont celles formatées par l'API.
 */
export function CarteChaine({ missionId, dossierId, etapes }: CarteChaineProps) {
  const [selection, setSelection] = useState<string | null>(null);
  const choisie = etapes.find((e) => e.id === selection) ?? null;
  const hrefRisques = hrefEcranDossier(missionId, dossierId, "risques");

  return (
    <div className="mp-chaine-zone">
      <ol className="mp-chaine" aria-label="Étapes de la chaîne de valeur, dans l'ordre">
        {etapes.map((e, i) => (
          <li key={e.id} className="mp-chaine__item">
            <button
              type="button"
              className="mp-chaine__etape"
              aria-pressed={selection === e.id}
              aria-controls="panneau-etape"
              onClick={() => setSelection(selection === e.id ? null : e.id)}
            >
              <span className="mp-chaine__rang">{`Étape ${e.ordre}`}</span>
              <span className="mp-chaine__nom">{e.libelle}</span>
              {e.acteurs.length > 0 ? (
                <span className="mp-texte-doux mp-texte-petit">{`Acteurs : ${e.acteurs.join(", ")}`}</span>
              ) : null}
              <span className="mp-chaine__parts">
                <span>{`Coût : ${e.partCoutAffichee}`}</span>
                <span>{`Marge : ${e.partMargeAffichee}`}</span>
              </span>
              <span className="mp-dd-meta">
                <BadgeStatut tonalite={e.risques.length > 0 ? "attention" : "neutre"} sansIcone>
                  {libelleRisques(e.risques.length)}
                </BadgeStatut>
                {e.margeMax ? <BadgeStatut tonalite="succes">Plus forte marge</BadgeStatut> : null}
              </span>
            </button>
            {i < etapes.length - 1 ? (
              <span className="mp-chaine__fleche" aria-hidden="true">
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      <section
        id="panneau-etape"
        className="mp-chaine__panneau"
        aria-live="polite"
        aria-label="Risques de l'étape choisie"
      >
        {choisie === null ? (
          <p className="mp-texte-doux">
            Choisissez une étape pour afficher ses risques (niveau, famille, solidité).
          </p>
        ) : (
          <>
            <h3 className="mp-carte__titre">{`Risques : ${choisie.libelle}`}</h3>
            {choisie.risques.length === 0 ? (
              <p className="mp-texte-doux">
                Aucun risque n&apos;est rattaché à cette étape. Rattachez-en depuis l&apos;onglet «
                Risques ».
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
                        {FAMILLE_RISQUE_DD_LIBELLES[r.famille]}
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
