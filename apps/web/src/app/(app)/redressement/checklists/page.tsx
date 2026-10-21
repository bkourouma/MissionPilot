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
import { libelleDomaine, libelleSecteur } from "../../../../lib/redressement";
import {
  HREF_CHECKLISTS_RED,
  MENTION_CHECKLIST_A_VALIDER,
  TEXTE_MODELES_LECTURE_SEULE,
} from "../../../../lib/redressement-diagnostic";
import {
  chargerModelesChecklists,
  chargerReferentielChecklists,
} from "../../../../lib/redressement-diagnostic-serveur";
import { exigerPermission } from "../../../../lib/session";

export const metadata: Metadata = { title: "Check-lists métier" };

/**
 * Modèles de check-lists du cabinet, par secteur : version en vigueur, brouillon, éditeur d'items
 * et publication pour qui détient « paramétrer » (experts du cabinet), lecture seule sinon. Les
 * check-lists de départ sont en lecture, avec la mention « à valider par un expert ».
 */
export default async function PageChecklistsRedressement() {
  const session = await exigerPermission("redressement.lire");
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
        titre="Check-lists métier"
        soustitre="Modèles de check-lists du cabinet pour le diagnostic des dossiers de redressement."
      />
      <div className="mp-red">
        {peutParametrer ? null : (
          <Alerte tonalite="info" annonce="aucune">
            <p>{TEXTE_MODELES_LECTURE_SEULE}</p>
          </Alerte>
        )}

        <section className="mp-red-section" aria-labelledby="titre-modeles">
          <h2 id="titre-modeles" className="mp-red-section__titre">
            Modèles du cabinet
          </h2>
          {!modeles.ok ? (
            <EtatErreur
              titre="Les modèles n'ont pas pu être chargés."
              message={modeles.message}
              hrefReessayer={HREF_CHECKLISTS_RED}
            />
          ) : modeles.donnees.modeles.length === 0 ? (
            <EtatVide titre="Aucun modèle de check-list." icone="taches">
              <p>Les check-lists de départ restent disponibles dans les dossiers.</p>
            </EtatVide>
          ) : (
            RED_SECTEURS.filter((s) => parSecteur.has(s)).map((s) => (
              <section
                key={s}
                className="mp-red-section"
                aria-label={`Secteur ${libelleSecteur(s)}`}
              >
                <h3 className="mp-red-section__titre">{libelleSecteur(s)}</h3>
                {(parSecteur.get(s) ?? []).map((m) => (
                  <ChecklistModele key={m.id} modele={m} peutParametrer={peutParametrer} />
                ))}
              </section>
            ))
          )}
          {peutParametrer ? (
            <Carte titre="Créer un modèle" niveauTitre={3}>
              <p className="mp-texte-doux">
                Le modèle naît en brouillon : il doit être publié, par un autre membre habilité ou
                un associé, avant d&apos;être activé dans un dossier.
              </p>
              <ChecklistEditeur secteurInitial="general" />
            </Carte>
          ) : null}
        </section>

        <section className="mp-red-section" aria-labelledby="titre-departs">
          <h2 id="titre-departs" className="mp-red-section__titre">
            Check-lists de départ
          </h2>
          <Alerte tonalite="attention" annonce="aucune">
            <p>{MENTION_CHECKLIST_A_VALIDER}</p>
          </Alerte>
          {!referentiel.ok ? (
            <EtatErreur
              titre="Les check-lists de départ n'ont pas pu être chargées."
              message={referentiel.message}
              hrefReessayer={HREF_CHECKLISTS_RED}
            />
          ) : (
            referentiel.donnees.departs.map((d) => (
              <Carte key={d.code} titre={d.intitule} niveauTitre={3}>
                <p className="mp-texte-doux">
                  Secteur {libelleSecteur(d.secteur)} · code {d.code} · à valider par un expert
                </p>
                <details className="mp-diag-details">
                  <summary>{d.items.length} item(s)</summary>
                  <ul className="mp-diag-historique">
                    {d.items.map((i) => (
                      <li key={i.id}>
                        {i.libelle}{" "}
                        <span className="mp-texte-doux">({libelleDomaine(i.domaine)})</span>
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
