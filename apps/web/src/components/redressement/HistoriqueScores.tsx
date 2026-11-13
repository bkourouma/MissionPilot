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
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Tableau } from "../ui/Tableau";
import { useChargerPlus } from "./useChargerPlus";
import { NiveauAlerte } from "./Voyant";

function texteIncident(v: number | boolean | null, t: (fr: string, en: string) => string): string {
  if (v === null) return t("Inconnu", "Unknown");
  if (typeof v === "boolean") return v ? t("Oui", "Yes") : t("Non", "No");
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
  const t = useT();
  const langue = useLangue();
  const h = useChargerPlus<RedScoreVue>(initial, suivant, (c) => cheminScores(dossierId, c));
  if (h.elements.length === 0) {
    return (
      <p className="mp-texte-doux">
        {t(
          "Aucun score d'alerte précoce calculé pour ce dossier.",
          "No early-warning score computed for this file.",
        )}
      </p>
    );
  }
  return (
    <div className="mp-red-section">
      <ul className="mp-liste-lignes" aria-label={t("Historique des scores", "Score history")}>
        {h.elements.map((s) => (
          <li key={s.id} className="mp-liste-lignes__ligne">
            <details className="mp-details" style={{ width: "100%" }}>
              <summary>
                {formaterDateHeure(s.cree_le, undefined, langue)} ·{" "}
                {libelleScore(s.score, s.niveau, langue)} ·{" "}
                {libelleSourceSeuils(s.seuils_source, s.secteur, s.seuils_version, langue)}
              </summary>
              <div className="mp-red-section">
                <p>
                  <NiveauAlerte niveau={s.niveau} />{" "}
                  <span className="mp-texte-doux">{t("Indicatif", "Indicative")}</span>
                </p>
                <dl className="mp-liste-def">
                  <div>
                    <dt>{t("Calculé par", "Computed by")}</dt>
                    <dd>{s.calcule_par.nom}</dd>
                  </div>
                  <div>
                    <dt>{t("Exercice de référence", "Reference fiscal year")}</dt>
                    <dd>
                      {s.entrees.exercice_reference ??
                        t("Aucun état accepté", "No accepted statement")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Correspondance de postes", "Item mapping")}</dt>
                    <dd>
                      {s.entrees.correspondance_version !== null
                        ? `Version ${s.entrees.correspondance_version}`
                        : t("Aucune", "None")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Rejets bancaires sur 12 mois", "Bank rejections over 12 months")}</dt>
                    <dd>{texteIncident(s.entrees.incidents.rejets_bancaires_12m, t)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t(
                        "Fournisseurs payés avec plus de 90 jours de retard",
                        "Suppliers paid more than 90 days late",
                      )}
                    </dt>
                    <dd>{texteIncident(s.entrees.incidents.retards_fournisseurs_90j, t)}</dd>
                  </div>
                  <div>
                    <dt>
                      {t(
                        "Arriérés d'impôts ou de cotisations",
                        "Tax or social contribution arrears",
                      )}
                    </dt>
                    <dd>{texteIncident(s.entrees.incidents.arrieres_fiscaux_sociaux, t)}</dd>
                  </div>
                  {s.entrees.analyses_indicatives ? (
                    <div>
                      <dt>{t("Comptes", "Accounts")}</dt>
                      <dd>{t("Analyses indicatives", "Indicative analyses")}</dd>
                    </div>
                  ) : null}
                </dl>
                <Tableau
                  legende={t("Seuils appliqués à ce score", "Thresholds applied to this score")}
                  colonnes={[
                    {
                      cle: "critere",
                      entete: t("Critère", "Criterion"),
                      rendu: (c: (typeof RED_CRITERES_ALERTE)[number]) => libelleCritere(c, langue),
                    },
                    {
                      cle: "sens",
                      entete: t("Sens de lecture", "Reading direction"),
                      rendu: (c) => libelleSensCritere(RED_CRITERE_ALERTE_SENS[c], langue),
                    },
                    {
                      cle: "orange",
                      entete: t("Seuil orange", "Orange threshold"),
                      alignement: "droite",
                      rendu: (c) => formaterSeuil(c, s.seuils.criteres[c].orange, langue),
                    },
                    {
                      cle: "rouge",
                      entete: t("Seuil rouge", "Red threshold"),
                      alignement: "droite",
                      rendu: (c) => formaterSeuil(c, s.seuils.criteres[c].rouge, langue),
                    },
                    {
                      cle: "poids",
                      entete: t("Poids", "Weight"),
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
        <Alerte
          tonalite="danger"
          titre={t("Chargement impossible", "Could not load")}
          annonce="alert"
        >
          <p>{h.erreur}</p>
        </Alerte>
      ) : null}
      {h.suivant !== null ? (
        <div className="mp-actions-formulaire">
          <Bouton
            variante="secondaire"
            chargement={h.enCours}
            texteChargement={t("Chargement…", "Loading…")}
            onClick={() => void h.chargerPlus()}
          >
            {t("Charger plus", "Load more")}
          </Bouton>
        </div>
      ) : null}
    </div>
  );
}
