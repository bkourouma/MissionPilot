import type { RedChecklistModeleVue, RedChecklistVersionVue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { libelleDomaine } from "../../lib/redressement";
import {
  cheminPublicationChecklist,
  libelleStatutVersionChecklist,
  TEXTE_PUBLICATION_CHECKLIST,
  tonaliteStatutVersionChecklist,
} from "../../lib/redressement-diagnostic";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";
import { ChecklistEditeur } from "./ChecklistEditeur";

function ItemsVersion({ version }: { version: RedChecklistVersionVue }) {
  const items = version.items ?? [];
  return (
    <details className="mp-diag-details">
      <summary>
        Version {version.version} : {version.nombre_items} item(s)
      </summary>
      <ul className="mp-diag-historique">
        {items.map((i) => (
          <li key={i.id}>
            {i.libelle} <span className="mp-texte-doux">({libelleDomaine(i.domaine)})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * Modèle de check-list du cabinet : version en vigueur, brouillon, historique des versions,
 * publication (séparation des tâches jugée par l'API) et éditeur d'une nouvelle version, ces
 * deux dernières actions réservées au droit « paramétrer ».
 */
export function ChecklistModele({
  modele: m,
  peutParametrer,
}: {
  modele: RedChecklistModeleVue;
  peutParametrer: boolean;
}) {
  return (
    <Carte
      titre={m.intitule}
      niveauTitre={3}
      actions={<span className="mp-texte-doux mp-texte-petit">Code : {m.code}</span>}
    >
      <div className="mp-red-carte-corps">
        <p className="mp-texte-doux">
          {m.en_vigueur
            ? `Version ${m.en_vigueur.version} en vigueur`
            : "Aucune version en vigueur : le modèle ne peut pas encore être activé."}
          {m.brouillon ? ` · brouillon version ${m.brouillon.version}` : ""}
        </p>
        {m.en_vigueur ? <ItemsVersion version={m.en_vigueur} /> : null}
        {m.brouillon ? <ItemsVersion version={m.brouillon} /> : null}
        <Tableau
          legende={`Versions du modèle ${m.intitule}`}
          messageVide="Aucune version."
          colonnes={[
            { cle: "version", entete: "Version", rendu: (v: RedChecklistVersionVue) => v.version },
            {
              cle: "statut",
              entete: "Statut",
              rendu: (v) => (
                <BadgeStatut tonalite={tonaliteStatutVersionChecklist(v.statut)}>
                  {libelleStatutVersionChecklist(v.statut)}
                  {v.remplacee ? " (remplacée)" : ""}
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
            {
              cle: "action",
              entete: "Action",
              rendu: (v) =>
                v.statut === "brouillon" && peutParametrer ? (
                  v.peut_publier ? (
                    <BoutonActionRed
                      libelle="Publier"
                      chemin={cheminPublicationChecklist(v.id)}
                      corps={{}}
                      succes="Version publiée : elle peut être activée dans les dossiers."
                      titreErreur="Publication impossible"
                      variante="primaire"
                      confirmation={{
                        question: `Publier la version ${v.version} ? Elle pourra être activée dans les dossiers.`,
                        libelleConfirmation: "Oui, publier",
                      }}
                    />
                  ) : (
                    <span className="mp-texte-doux mp-texte-petit">
                      {TEXTE_PUBLICATION_CHECKLIST}
                    </span>
                  )
                ) : (
                  "—"
                ),
            },
          ]}
          lignes={m.historique}
          cleLigne={(v) => v.id}
        />
        {peutParametrer && m.brouillon === null ? (
          <details className="mp-diag-details">
            <summary>Rédiger une nouvelle version</summary>
            <ChecklistEditeur
              key={m.en_vigueur?.id ?? "vide"}
              modeleId={m.id}
              secteurInitial={m.secteur}
              depart={m.en_vigueur?.items ?? []}
            />
          </details>
        ) : null}
      </div>
    </Carte>
  );
}
