"use client";

import type { RedSeuilsVersionVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminPublicationSeuils,
  libelleEtatVersionSeuils,
  tonaliteEtatVersionSeuils,
  TEXTE_PUBLICATION_SEUILS,
  TEXTE_PUBLICATION_SEUILS_EN,
} from "../../lib/redressement";
import { useLangue, useT } from "../i18n/FournisseurLangue";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";

/**
 * Versions de seuils d'un secteur (brouillon, publiées). « Publier » n'est proposé que si
 * l'API l'annonce (`peut_publier`, confort d'affichage : elle reste juge, séparation des tâches
 * comprise) ; sinon le texte dit à qui revient la publication.
 */
export function VersionsSeuils({
  versions,
  peutPublier,
  peutParametrer,
}: {
  versions: RedSeuilsVersionVue[];
  peutPublier: boolean;
  peutParametrer: boolean;
}) {
  const t = useT();
  const langue = useLangue();
  return (
    <div className="mp-red-section">
      <Tableau
        legende={t("Versions de seuils", "Threshold versions")}
        messageVide={t(
          "Aucune version de seuils pour ce secteur.",
          "No threshold version for this sector.",
        )}
        colonnes={[
          {
            cle: "version",
            entete: t("Version", "Version"),
            rendu: (v: RedSeuilsVersionVue) => v.version,
          },
          {
            cle: "statut",
            entete: t("Statut", "Status"),
            rendu: (v) => (
              <BadgeStatut tonalite={tonaliteEtatVersionSeuils(v)}>
                {libelleEtatVersionSeuils(v, langue)}
              </BadgeStatut>
            ),
          },
          {
            cle: "auteur",
            entete: t("Auteur", "Author"),
            rendu: (v) =>
              `${v.cree_par.nom}, ${t("le", "on")} ${formaterDateHeure(v.cree_le, undefined, langue)}`,
          },
          {
            cle: "publication",
            entete: t("Publication", "Publication"),
            rendu: (v) =>
              v.publiee_par
                ? `${v.publiee_par.nom}, ${t("le", "on")} ${formaterDateHeure(v.publiee_le, undefined, langue)}`
                : "—",
          },
          { cle: "motif", entete: t("Motif", "Reason"), rendu: (v) => v.motif ?? "—" },
          {
            cle: "action",
            entete: "Action",
            rendu: (v) =>
              v.statut === "brouillon" && peutParametrer ? (
                peutPublier ? (
                  <BoutonActionRed
                    libelle={t("Publier", "Publish")}
                    chemin={cheminPublicationSeuils(v.id)}
                    corps={{}}
                    succes={t(
                      "Version publiée : elle s'applique aux prochains scores.",
                      "Version published: it applies to the next scores.",
                    )}
                    variante="primaire"
                    confirmation={{
                      question: t(
                        `Publier la version ${v.version} ? Elle s'appliquera aux prochains scores du secteur.`,
                        `Publish version ${v.version}? It will apply to the sector's next scores.`,
                      ),
                      libelleConfirmation: t("Oui, publier", "Yes, publish"),
                    }}
                  />
                ) : (
                  <span className="mp-texte-doux mp-texte-petit">
                    {t(TEXTE_PUBLICATION_SEUILS, TEXTE_PUBLICATION_SEUILS_EN)}
                  </span>
                )
              ) : (
                "—"
              ),
          },
        ]}
        lignes={versions}
        cleLigne={(v) => v.id}
      />
    </div>
  );
}
