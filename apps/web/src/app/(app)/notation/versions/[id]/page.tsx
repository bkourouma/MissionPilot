import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ValiderVersionGrille } from "../../../../../components/notation/ActionsGrille";
import { EditeurGrille } from "../../../../../components/notation/EditeurGrille";
import { PonderationsGrille } from "../../../../../components/notation/PonderationsGrille";
import "../../../../../components/notation/notation.css";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../../lib/format";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  cheminVersionGrille,
  droitsVersionGrille,
  editionDepuisContenu,
  hrefGrille,
  hrefVersionGrille,
  nomAuteurGrille,
  sommeConforme,
  STATUTS_GRILLE,
  totauxEdition,
  type VersionGrille,
} from "../../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export const metadata: Metadata = { title: "Version de grille de notation" };

/**
 * Une version de grille : en brouillon, édition des pondérations (sommes en direct) et
 * validation par un expert métier qui ne l'a ni rédigée ni modifiée ; validée, lecture seule.
 */
export default async function PageVersionGrille({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<VersionGrille>(cheminVersionGrille(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Version de grille"
          retour={{ href: "/notation", libelle: "Grilles de notation" }}
        />
        <EtatErreur
          titre="La version n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefVersionGrille(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  const droits = droitsVersionGrille(utilisateur.roles, utilisateur.id, v);
  const nom = (uid: string | null | undefined) => nomAuteurGrille(uid, utilisateur.id, personnes);
  const totaux = totauxEdition(v.contenu.dimensions, editionDepuisContenu(v.contenu));
  const conformes =
    sommeConforme(totaux.total) && totaux.secteurs.every((s) => sommeConforme(s.total));
  const statut = STATUTS_GRILLE[v.statut] ?? { libelle: "Statut inconnu", tonalite: "neutre" };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${v.contenu.titre} — version ${v.version}`}
        retour={{ href: hrefGrille(v.grille_id), libelle: "Versions de la grille" }}
        soustitre={`Code ${v.code}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <Carte titre="Historique">
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>Créée</dt>
            <dd>
              le {formaterDateHeure(v.cree_le)} par {nom(v.cree_par)}
            </dd>
          </div>
          <div>
            <dt>Dernière modification</dt>
            <dd>
              le {formaterDateHeure(v.modifie_le)}
              {v.modifie_par ? ` par ${nom(v.modifie_par)}` : ""}
            </dd>
          </div>
          {v.valide_le ? (
            <div>
              <dt>Validée</dt>
              <dd>
                le {formaterDateHeure(v.valide_le)} par {nom(v.valide_par)}
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte titre="Pondérations">
        {droits.modifier ? (
          <EditeurGrille
            versionId={v.id}
            contenu={v.contenu}
            avertissement={droits.avertissementModification}
          />
        ) : (
          <PonderationsGrille contenu={v.contenu} />
        )}
      </Carte>

      {v.statut === "brouillon" ? (
        <Carte titre="Validation par un expert métier">
          {droits.valider ? (
            <ValiderVersionGrille
              versionId={v.id}
              numero={v.version}
              statut={v.statut}
              sommesConformes={conformes}
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
            La validation porte sur la version enregistrée et la fige : elle pourra alors servir au
            calcul des notations.
          </p>
        </Carte>
      ) : (
        <Alerte tonalite="succes" titre="Version validée et figée" annonce="aucune">
          <p>
            Elle sert au calcul des notations et ne se modifie plus : créez une nouvelle version
            depuis la page de la grille pour la faire évoluer.
          </p>
        </Alerte>
      )}
    </div>
  );
}
