import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import "../../../../../components/notation/notation.css";
import "../../../../../components/notation-augmentee/notation-augmentee.css";
import { FormulaireItemBanque } from "../../../../../components/notation-augmentee/FormulaireItemBanque";
import { LectureItemBanque } from "../../../../../components/notation-augmentee/LectureItemBanque";
import { suggestionsDimensions } from "../../../../../components/notation-augmentee/suggestions";
import { ValiderItemBanque } from "../../../../../components/notation-augmentee/ValiderItemBanque";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../components/ui/Bouton";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { nomAuteurGrille } from "../../../../../lib/notation-grilles";
import {
  STATUTS_ITEM,
  cheminItemBanque,
  droitsItemBanque,
  hrefItemBanque,
  hrefNouvelleVersionItem,
  type ItemBanqueDetail,
} from "../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export const metadata: Metadata = { title: "Item de la banque" };

/**
 * Une version d'item de la banque (NOT-09). En brouillon : édition par qui rédige et validation
 * par un expert métier qui n'en est ni l'auteur ni le dernier modificateur (séparation des tâches,
 * MPN04) ; validée, la version est figée (MPN08) et une correction passe par une nouvelle version.
 * Les droits affichés sont un confort : l'API reste seule juge.
 */
export default async function PageItemBanque({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<ItemBanqueDetail>(cheminItemBanque(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/notation/banque", libelle: "Banque d'items" };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre="Item de la banque" retour={retour} />
        <EtatErreur
          titre="L'item n'a pas pu être chargé."
          message={r.message}
          hrefReessayer={hrefItemBanque(id)}
        />
      </div>
    );
  }
  const item = r.donnees;
  const droits = droitsItemBanque(utilisateur.roles, utilisateur.id, item);
  const nom = (uid: string | null | undefined) => nomAuteurGrille(uid, utilisateur.id, personnes);
  const statut = STATUTS_ITEM[item.statut] ?? { libelle: "Statut inconnu", tonalite: "neutre" };
  const brouillonExistant = item.versions.find((v) => v.statut === "brouillon" && v.id !== item.id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${item.contenu.intitule} — version ${item.version}`}
        retour={retour}
        soustitre={`Code ${item.code}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <Carte titre="Historique">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Créée</dt>
            <dd>
              le {formaterDateHeure(item.cree_le)} par {nom(item.cree_par)}
            </dd>
          </div>
          <div>
            <dt>Dernière modification</dt>
            <dd>
              le {formaterDateHeure(item.modifie_le)} par {nom(item.modifie_par)}
            </dd>
          </div>
          {item.valide_le ? (
            <div>
              <dt>Validée</dt>
              <dd>
                le {formaterDateHeure(item.valide_le)} par {nom(item.valide_par)}
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      {item.statut === "brouillon" ? (
        <>
          <Carte titre={droits.modifier ? "Modifier le brouillon" : "Contenu du brouillon"}>
            {droits.modifier ? (
              <FormulaireItemBanque
                itemId={item.id}
                base={item.contenu}
                identifiantsFiges
                suggestions={suggestionsDimensions()}
                avertissement={
                  droits.valider
                    ? "Si vous enregistrez une modification, vous en deviendrez le dernier modificateur : un autre expert métier devra alors valider cette version."
                    : null
                }
              />
            ) : (
              <LectureItemBanque contenu={item.contenu} />
            )}
          </Carte>
          <Carte titre="Validation par un expert métier">
            {droits.validerVisible ? (
              <ValiderItemBanque
                itemId={item.id}
                code={item.code}
                version={item.version}
                statut={item.statut}
                desactive={droits.explicationValidation}
              />
            ) : (
              <Alerte tonalite="info" annonce="aucune">
                <p>
                  {droits.explicationValidation ??
                    "La validation revient à un expert métier du cabinet."}
                </p>
              </Alerte>
            )}
            <p className="mp-texte-doux mp-texte-petit">
              La validation porte sur la version enregistrée et la fige : elle pourra alors servir
              aux questionnaires adaptatifs.
            </p>
          </Carte>
        </>
      ) : (
        <>
          <Carte titre="Contenu de la version">
            <LectureItemBanque contenu={item.contenu} />
          </Carte>
          <Carte titre="Nouvelle version">
            <Alerte tonalite="succes" titre="Version validée et figée" annonce="aucune">
              <p>
                Elle ne se modifie plus : une correction passe par une nouvelle version, qu&apos;un
                autre expert métier validera.
              </p>
            </Alerte>
            {brouillonExistant ? (
              <p>
                Un brouillon existe déjà (version {brouillonExistant.version}) :{" "}
                <Link href={hrefItemBanque(brouillonExistant.id)}>ouvrez-le pour le modifier</Link>.
              </p>
            ) : droits.nouvelleVersion ? (
              <p>
                <Link href={hrefNouvelleVersionItem(item.id)} className={classesBouton("primaire")}>
                  Créer une nouvelle version
                </Link>
              </p>
            ) : null}
          </Carte>
        </>
      )}

      <section aria-labelledby="na-titre-versions" className="mp-pile">
        <h2 id="na-titre-versions" className="mp-section__titre">
          Versions de l&apos;item
        </h2>
        <ul className="mp-liste-lignes">
          {item.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                {v.id === item.id ? (
                  <span>Version {v.version} (affichée)</span>
                ) : (
                  <Link href={hrefItemBanque(v.id)} className="mp-lien-ligne">
                    Version {v.version}
                  </Link>
                )}
                <span className="mp-texte-doux mp-texte-petit">
                  Créée le {formaterDateHeure(v.cree_le)}
                  {v.valide_le ? ` · validée le ${formaterDateHeure(v.valide_le)}` : ""}
                </span>
              </div>
              <BadgeStatut tonalite={STATUTS_ITEM[v.statut]?.tonalite ?? "neutre"}>
                {STATUTS_ITEM[v.statut]?.libelle ?? "Statut inconnu"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
