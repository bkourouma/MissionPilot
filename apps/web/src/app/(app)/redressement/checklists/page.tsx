import type { Metadata } from "next";
import { aPermission, RED_SECTEURS, type RedChecklistModeleVue } from "@missionpilot/shared";
import "../../../../components/redressement/diagnostic.css";
import "../../../../components/redressement/redressement.css";
import { ChecklistEditeur } from "../../../../components/redressement/ChecklistEditeur";
import { ChecklistModele } from "../../../../components/redressement/ChecklistModeles";
import { Alerte } from "../../../../components/ui/Alerte";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur, EtatVide } from "../../../../components/ui/EtatListe";
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { libelleDomaine, libelleSecteur } from "../../../../lib/redressement";
import {
  HREF_CHECKLISTS_RED,
  MENTION_CHECKLIST_A_VALIDER,
  MENTION_CHECKLIST_A_VALIDER_EN,
  TEXTE_MODELES_LECTURE_SEULE,
  TEXTE_MODELES_LECTURE_SEULE_EN,
} from "../../../../lib/redressement-diagnostic";
import {
  chargerModelesChecklists,
  chargerReferentielChecklists,
} from "../../../../lib/redressement-diagnostic-serveur";
import { exigerPermission } from "../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Check-lists métier", "Business checklists") };
}

/**
 * Modèles de check-lists du cabinet, par secteur : version en vigueur, brouillon, éditeur d'items
 * et publication pour qui détient « paramétrer » (experts du cabinet), lecture seule sinon. Les
 * check-lists de départ sont en lecture, avec la mention « à valider par un expert ».
 */
export default async function PageChecklistsRedressement() {
  const session = await exigerPermission("redressement.lire");
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const peutParametrer = aPermission(session.utilisateur.roles, "redressement.parametrer");
  const [modeles, referentiel] = await Promise.all([
    chargerModelesChecklists(),
    chargerReferentielChecklists(),
  ]);
  const parSecteur = new Map<string, RedChecklistModeleVue[]>();
  if (modeles.ok) {
    for (const m of modeles.donnees.modeles) {
      parSecteur.set(m.secteur, [...(parSecteur.get(m.secteur) ?? []), m]);
    }
  }

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={t("Check-lists métier", "Business checklists")}
        soustitre={t(
          "Modèles de check-lists du cabinet pour le diagnostic des dossiers de redressement.",
          "Firm checklist templates for diagnosing turnaround files.",
        )}
      />
      <div className="mp-red">
        {peutParametrer ? null : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{t(TEXTE_MODELES_LECTURE_SEULE, TEXTE_MODELES_LECTURE_SEULE_EN)}</p>
          </Alerte>
        )}

        <section className="mp-red-section" aria-labelledby="titre-modeles">
          <h2 id="titre-modeles" className="mp-red-section__titre">
            {t("Modèles du cabinet", "Firm templates")}
          </h2>
          {!modeles.ok ? (
            <EtatErreur
              titre={t(
                "Les modèles n'ont pas pu être chargés.",
                "The templates could not be loaded.",
              )}
              message={modeles.message}
              hrefReessayer={HREF_CHECKLISTS_RED}
            />
          ) : modeles.donnees.modeles.length === 0 ? (
            <EtatVide
              titre={t("Aucun modèle de check-list.", "No checklist template.")}
              icone="taches"
            >
              <p>
                {t(
                  "Les check-lists de départ restent disponibles dans les dossiers.",
                  "The starter checklists remain available in the files.",
                )}
              </p>
            </EtatVide>
          ) : (
            RED_SECTEURS.filter((s) => parSecteur.has(s)).map((s) => (
              <section
                key={s}
                className="mp-red-section"
                aria-label={`${t("Secteur", "Sector")} ${libelleSecteur(s, langue)}`}
              >
                <h3 className="mp-red-section__titre">{libelleSecteur(s, langue)}</h3>
                {(parSecteur.get(s) ?? []).map((m) => (
                  <ChecklistModele key={m.id} modele={m} peutParametrer={peutParametrer} />
                ))}
              </section>
            ))
          )}
          {peutParametrer ? (
            <Carte titre={t("Créer un modèle", "Create a template")} niveauTitre={3}>
              <p className="mp-texte-doux">
                {t(
                  "Le modèle naît en brouillon : il doit être publié, par un autre membre habilité ou un associé, avant d'être activé dans un dossier.",
                  "The template starts as a draft: it must be published, by another authorized member or a partner, before being activated in a file.",
                )}
              </p>
              <ChecklistEditeur secteurInitial="general" />
            </Carte>
          ) : null}
        </section>

        <section className="mp-red-section" aria-labelledby="titre-departs">
          <h2 id="titre-departs" className="mp-red-section__titre">
            {t("Check-lists de départ", "Starter checklists")}
          </h2>
          <Alerte tonalite="attention" annonce="aucune">
            <p>{t(MENTION_CHECKLIST_A_VALIDER, MENTION_CHECKLIST_A_VALIDER_EN)}</p>
          </Alerte>
          {!referentiel.ok ? (
            <EtatErreur
              titre={t(
                "Les check-lists de départ n'ont pas pu être chargées.",
                "The starter checklists could not be loaded.",
              )}
              message={referentiel.message}
              hrefReessayer={HREF_CHECKLISTS_RED}
            />
          ) : (
            referentiel.donnees.departs.map((d) => (
              <Carte key={d.code} titre={d.intitule} niveauTitre={3}>
                <p className="mp-texte-doux">
                  {t(
                    `Secteur ${libelleSecteur(d.secteur, langue)} · code ${d.code} · à valider par un expert`,
                    `Sector ${libelleSecteur(d.secteur, langue)} · code ${d.code} · pending expert approval`,
                  )}
                </p>
                <details className="mp-diag-details">
                  <summary>{t(`${d.items.length} item(s)`, `${d.items.length} item(s)`)}</summary>
                  <ul className="mp-diag-historique">
                    {d.items.map((i) => (
                      <li key={i.id}>
                        {i.libelle}{" "}
                        <span className="mp-texte-doux">({libelleDomaine(i.domaine, langue)})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </Carte>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
