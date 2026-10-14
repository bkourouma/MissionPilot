"use client";

import {
  RED_CRITERES_ALERTE,
  RED_CRITERE_ALERTE_SENS,
  type RedScoreVue,
} from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminScores,
  formaterSeuil,
  libelleCritere,
  libelleScore,
  libelleSensCritere,
  libelleSourceSeuils,
} from "../../lib/redressement";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Tableau } from "../ui/Tableau";
import { useChargerPlus } from "./useChargerPlus";
import { NiveauAlerte } from "./Voyant";

function texteIncident(v: number | boolean | null): string {
  if (v === null) return "Inconnu";
  if (typeof v === "boolean") return v ? "Oui" : "Non";
  return String(v);
}

/**
 * Historique des scores d'alerte (du plus récent au plus ancien) : chaque ligne se déplie sur les
 * entrées conservées avec le score et sur l'instantané des seuils appliqués (un score ne change
 * jamais après coup).
 */
export function HistoriqueScores({
  dossierId,
  initial,
  suivant,
}: {
  dossierId: string;
  initial: RedScoreVue[];
  suivant: string | null;
}) {
  const h = useChargerPlus<RedScoreVue>(initial, suivant, (c) => cheminScores(dossierId, c));
  if (h.elements.length === 0) {
    return (
      <p className="mp-texte-doux">Aucun score d&apos;alerte précoce calculé pour ce dossier.</p>
    );
  }
  return (
    <div className="mp-red-section">
      <ul className="mp-liste-lignes" aria-label="Historique des scores">
        {h.elements.map((s) => (
          <li key={s.id} className="mp-liste-lignes__ligne">
            <details className="mp-details" style={{ width: "100%" }}>
              <summary>
                {formaterDateHeure(s.cree_le)} · {libelleScore(s.score, s.niveau)} ·{" "}
                {libelleSourceSeuils(s.seuils_source, s.secteur, s.seuils_version)}
              </summary>
              <div className="mp-red-section">
                <p>
                  <NiveauAlerte niveau={s.niveau} />{" "}
                  <span className="mp-texte-doux">Indicatif</span>
                </p>
                <dl className="mp-liste-def">
                  <div>
                    <dt>Calculé par</dt>
                    <dd>{s.calcule_par.nom}</dd>
                  </div>
                  <div>
                    <dt>Exercice de référence</dt>
                    <dd>{s.entrees.exercice_reference ?? "Aucun état accepté"}</dd>
                  </div>
                  <div>
                    <dt>Correspondance de postes</dt>
                    <dd>
                      {s.entrees.correspondance_version !== null
                        ? `Version ${s.entrees.correspondance_version}`
                        : "Aucune"}
                    </dd>
                  </div>
                  <div>
                    <dt>Rejets bancaires sur 12 mois</dt>
                    <dd>{texteIncident(s.entrees.incidents.rejets_bancaires_12m)}</dd>
                  </div>
                  <div>
                    <dt>Fournisseurs payés avec plus de 90 jours de retard</dt>
                    <dd>{texteIncident(s.entrees.incidents.retards_fournisseurs_90j)}</dd>
                  </div>
                  <div>
                    <dt>Arriérés d&apos;impôts ou de cotisations</dt>
                    <dd>{texteIncident(s.entrees.incidents.arrieres_fiscaux_sociaux)}</dd>
                  </div>
                  {s.entrees.analyses_indicatives ? (
                    <div>
                      <dt>Comptes</dt>
                      <dd>Analyses indicatives</dd>
                    </div>
                  ) : null}
                </dl>
                <Tableau
                  legende="Seuils appliqués à ce score"
                  colonnes={[
                    {
                      cle: "critere",
                      entete: "Critère",
                      rendu: (c: (typeof RED_CRITERES_ALERTE)[number]) => libelleCritere(c),
                    },
                    {
                      cle: "sens",
                      entete: "Sens de lecture",
                      rendu: (c) => libelleSensCritere(RED_CRITERE_ALERTE_SENS[c]),
                    },
                    {
                      cle: "orange",
                      entete: "Seuil orange",
                      alignement: "droite",
                      rendu: (c) => formaterSeuil(c, s.seuils.criteres[c].orange),
                    },
                    {
                      cle: "rouge",
                      entete: "Seuil rouge",
                      alignement: "droite",
                      rendu: (c) => formaterSeuil(c, s.seuils.criteres[c].rouge),
                    },
                    {
                      cle: "poids",
                      entete: "Poids",
                      alignement: "droite",
                      rendu: (c) => s.seuils.criteres[c].poids,
                    },
                  ]}
                  lignes={RED_CRITERES_ALERTE}
                  cleLigne={(c) => c}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
      {h.erreur ? (
        <Alerte tonalite="danger" titre="Chargement impossible" annonce="alert">
          <p>{h.erreur}</p>
        </Alerte>
      ) : null}
      {h.suivant !== null ? (
        <div className="mp-actions-formulaire">
          <Bouton
            variante="secondaire"
            chargement={h.enCours}
            texteChargement="Chargement…"
            onClick={() => void h.chargerPlus()}
          >
            Charger plus
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
