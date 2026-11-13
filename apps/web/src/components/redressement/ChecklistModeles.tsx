import type { RedChecklistModeleVue, RedChecklistVersionVue, Langue } from "@missionpilot/shared";
import { formaterDateHeure } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleDomaine } from "../../lib/redressement";
import {
  cheminPublicationChecklist,
  libelleStatutVersionChecklist,
  TEXTE_PUBLICATION_CHECKLIST,
  TEXTE_PUBLICATION_CHECKLIST_EN,
  tonaliteStatutVersionChecklist,
} from "../../lib/redressement-diagnostic";
import { BadgeStatut } from "../ui/BadgeStatut";
import { Carte } from "../ui/Carte";
import { Tableau } from "../ui/Tableau";
import { BoutonActionRed } from "./BoutonActionRed";
import { ChecklistEditeur } from "./ChecklistEditeur";

function ItemsVersion({
  version,
  langue,
  t,
}: {
  version: RedChecklistVersionVue;
  langue: Langue;
  t: (fr: string, en: string) => string;
}) {
  const items = version.items ?? [];
  return (
    <details className="mp-diag-details">
      <summary>
        {t(
          `Version ${version.version} : ${version.nombre_items} item(s)`,
          `Version ${version.version}: ${version.nombre_items} item(s)`,
        )}
      </summary>
      <ul className="mp-diag-historique">
        {items.map((i) => (
          <li key={i.id}>
            {i.libelle} <span className="mp-texte-doux">({libelleDomaine(i.domaine, langue)})</span>
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
export async function ChecklistModele({
  modele: m,
  peutParametrer,
}: {
  modele: RedChecklistModeleVue;
  peutParametrer: boolean;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <Carte
      titre={m.intitule}
      niveauTitre={3}
      actions={<span className="mp-texte-doux mp-texte-petit">Code : {m.code}</span>}
    >
      <div className="mp-red-carte-corps">
        <p className="mp-texte-doux">
          {m.en_vigueur
            ? t(
                `Version ${m.en_vigueur.version} en vigueur`,
                `Version ${m.en_vigueur.version} in force`,
              )
            : t(
                "Aucune version en vigueur : le modèle ne peut pas encore être activé.",
                "No version in force: the template cannot be activated yet.",
              )}
          {m.brouillon
            ? t(
                ` · brouillon version ${m.brouillon.version}`,
                ` · draft version ${m.brouillon.version}`,
              )
            : ""}
        </p>
        {m.en_vigueur ? <ItemsVersion version={m.en_vigueur} langue={langue} t={t} /> : null}
        {m.brouillon ? <ItemsVersion version={m.brouillon} langue={langue} t={t} /> : null}
        <Tableau
          legende={t(`Versions du modèle ${m.intitule}`, `Versions of template ${m.intitule}`)}
          messageVide={t("Aucune version.", "No version.")}
          colonnes={[
            {
              cle: "version",
              entete: t("Version", "Version"),
              rendu: (v: RedChecklistVersionVue) => v.version,
            },
            {
              cle: "statut",
              entete: t("Statut", "Status"),
              rendu: (v) => (
                <BadgeStatut tonalite={tonaliteStatutVersionChecklist(v.statut)}>
                  {libelleStatutVersionChecklist(v.statut, langue)}
                  {v.remplacee ? t(" (remplacée)", " (replaced)") : ""}
                </BadgeStatut>
              ),
            },
            {
              cle: "auteur",
              entete: t("Auteur", "Author"),
              rendu: (v) =>
                `${v.cree_par.nom}${t(", le ", ", on ")}${formaterDateHeure(v.cree_le, undefined, langue)}`,
            },
            {
              cle: "publication",
              entete: t("Publication", "Publication"),
              rendu: (v) =>
                v.publiee_par
                  ? `${v.publiee_par.nom}${t(", le ", ", on ")}${formaterDateHeure(v.publiee_le, undefined, langue)}`
                  : "—",
            },
            {
              cle: "action",
              entete: "Action",
              rendu: (v) =>
                v.statut === "brouillon" && peutParametrer ? (
                  v.peut_publier ? (
                    <BoutonActionRed
                      libelle={t("Publier", "Publish")}
                      chemin={cheminPublicationChecklist(v.id)}
                      corps={{}}
                      succes={t(
                        "Version publiée : elle peut être activée dans les dossiers.",
                        "Version published: it can be activated in the files.",
                      )}
                      titreErreur={t("Publication impossible", "Publication not possible")}
                      variante="primaire"
                      confirmation={{
                        question: t(
                          `Publier la version ${v.version} ? Elle pourra être activée dans les dossiers.`,
                          `Publish version ${v.version}? It will be able to be activated in the files.`,
                        ),
                        libelleConfirmation: t("Oui, publier", "Yes, publish"),
                      }}
                    />
                  ) : (
                    <span className="mp-texte-doux mp-texte-petit">
                      {t(TEXTE_PUBLICATION_CHECKLIST, TEXTE_PUBLICATION_CHECKLIST_EN)}
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
            <summary>{t("Rédiger une nouvelle version", "Draft a new version")}</summary>
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
