"use client";

import { RED_DOMAINES, type RedUrgenceVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { cheminUrgences, libelleDomaine } from "../../lib/redressement";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { Alerte } from "../ui/Alerte";
import { Bouton } from "../ui/Bouton";
import { Tableau } from "../ui/Tableau";
import { useChargerPlus } from "./useChargerPlus";
import { Voyant } from "./Voyant";

/** Historique des évaluations d'urgence (du plus récent au plus ancien), « Charger plus ». */
export function HistoriqueUrgences({
  dossierId,
  initial,
  suivant,
}: {
  dossierId: string;
  initial: RedUrgenceVue[];
  suivant: string | null;
}) {
  const t = useT();
  const langue = useLangue();
  const h = useChargerPlus<RedUrgenceVue>(initial, suivant, (c) => cheminUrgences(dossierId, c));
  return (
    <div className="mp-red-section">
      <Tableau
        legende={t("Historique des évaluations d'urgence", "Urgency assessment history")}
        messageVide={t(
          "Aucune évaluation d'urgence pour ce dossier.",
          "No urgency assessment for this file.",
        )}
        colonnes={[
          {
            cle: "date",
            entete: "Date",
            rendu: (u: RedUrgenceVue) => formaterDateHeure(u.cree_le, undefined, langue),
          },
          {
            cle: "voyant",
            entete: t("Voyant global", "Overall indicator"),
            rendu: (u) => <Voyant voyant={u.voyant} />,
          },
          {
            cle: "domaines",
            entete: t("Voyants par domaine", "Indicators by domain"),
            rendu: (u) => (
              <ul className="mp-red-liste-voyants">
                {RED_DOMAINES.map((d) => {
                  const r = u.resultat.domaines.find((x) => x.domaine === d);
                  return (
                    <li key={d}>
                      <span className="mp-texte-petit">{libelleDomaine(d, langue)}</span>
                      <Voyant voyant={r?.voyant ?? "non_evalue"} />
                    </li>
                  );
                })}
              </ul>
            ),
          },
          { cle: "auteur", entete: t("Auteur", "Author"), rendu: (u) => u.saisi_par.nom },
        ]}
        lignes={h.elements}
        cleLigne={(u) => u.id}
      />
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
