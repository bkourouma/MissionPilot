import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NouvelleVersionGrille } from "../../../../components/notation/ActionsGrille";
import "../../../../components/notation/notation.css";
import { BadgeStatut } from "../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../lib/api-serveur";
import { formaterDateHeure } from "../../../../lib/format";
import { estIdentifiant } from "../../../../lib/identifiant";
import {
  cheminGrille,
  hrefGrille,
  hrefVersionGrille,
  libelleOrigine,
  nomAuteurGrille,
  STATUTS_GRILLE,
  type GrilleDetail,
} from "../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";

export const metadata: Metadata = { title: "Grille de notation" };

/**
 * Une grille du cabinet et ses versions (de la plus récente à la plus ancienne). Une version
 * validée est figée ; une correction passe par une nouvelle version (brouillon), qu'un expert
 * métier autre que son rédacteur valide.
 */
export default async function PageGrilleNotation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<GrilleDetail>(cheminGrille(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage
          titre="Grille de notation"
          retour={{ href: "/notation", libelle: "Grilles" }}
        />
        <EtatErreur
          titre="La grille n'a pas pu être chargée."
          message={r.message}
          hrefReessayer={hrefGrille(id)}
        />
      </div>
    );
  }
  const g = r.donnees;
  const brouillon = g.versions.find((v) => v.statut === "brouillon");
  const nom = (uid: string | null | undefined) => nomAuteurGrille(uid, utilisateur.id, personnes);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={g.titre}
        retour={{ href: "/notation", libelle: "Grilles de notation" }}
        soustitre={`Code ${g.code} · ${libelleOrigine(g.origine)}`}
      />

      <Carte titre="Nouvelle version">
        {brouillon ? (
          <p>
            Un brouillon existe déjà (version {brouillon.version}) :{" "}
            <Link href={hrefVersionGrille(brouillon.id)}>ouvrez-le pour le modifier</Link> ou
            faites-le valider par un expert métier.
          </p>
        ) : (
          <NouvelleVersionGrille grilleId={g.id} />
        )}
      </Carte>

      <section aria-labelledby="titre-versions" className="mp-pile">
        <h2 id="titre-versions" className="mp-section__titre">
          Versions
        </h2>
        <ul className="mp-liste-lignes">
          {g.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefVersionGrille(v.id)} className="mp-lien-ligne">
                  Version {v.version}
                  {v.statut === "brouillon" ? " (modifier)" : " (consulter)"}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  Créée le {formaterDateHeure(v.cree_le)} par {nom(v.cree_par)}
                  {v.valide_le
                    ? ` · validée le ${formaterDateHeure(v.valide_le)} par ${nom(v.valide_par)}`
                    : ""}
                </span>
              </div>
              <BadgeStatut tonalite={STATUTS_GRILLE[v.statut]?.tonalite ?? "neutre"}>
                {STATUTS_GRILLE[v.statut]?.libelle ?? "Statut inconnu"}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
