"use client";

import type { RedSeuilsVersionVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import {
  cheminPublicationSeuils,
  libelleEtatVersionSeuils,
  tonaliteEtatVersionSeuils,
  TEXTE_PUBLICATION_SEUILS,
} from "../../lib/redressement";
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
  return (
    <div className="mp-red-section">
      <Tableau
        legende="Versions de seuils"
        messageVide="Aucune version de seuils pour ce secteur."
        colonnes={[
          { cle: "version", entete: "Version", rendu: (v: RedSeuilsVersionVue) => v.version },
          {
            cle: "statut",
            entete: "Statut",
            rendu: (v) => (
              <BadgeStatut tonalite={tonaliteEtatVersionSeuils(v)}>
                {libelleEtatVersionSeuils(v)}
              </BadgeStatut>
            ),
          },
          {
            cle: "auteur",
            entete: "Auteur",
            rendu: (v) => `${v.cree_par.nom}, le ${formaterDateHeure(v.cree_le)}`,
          },
          {
            cle: "publication",
            entete: "Publication",
            rendu: (v) =>
              v.publiee_par ? `${v.publiee_par.nom}, le ${formaterDateHeure(v.publiee_le)}` : "—",
          },
          { cle: "motif", entete: "Motif", rendu: (v) => v.motif ?? "—" },
          {
            cle: "action",
            entete: "Action",
            rendu: (v) =>
              v.statut === "brouillon" && peutParametrer ? (
                peutPublier ? (
                  <BoutonActionRed
                    libelle="Publier"
                    chemin={cheminPublicationSeuils(v.id)}
                    corps={{}}
                    succes="Version publiée : elle s'applique aux prochains scores."
                    variante="primaire"
                    confirmation={{
                      question: `Publier la version ${v.version} ? Elle s'appliquera aux prochains scores du secteur.`,
                      libelleConfirmation: "Oui, publier",
                    }}
                  />
                ) : (
                  <span className="mp-texte-doux mp-texte-petit">{TEXTE_PUBLICATION_SEUILS}</span>
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
