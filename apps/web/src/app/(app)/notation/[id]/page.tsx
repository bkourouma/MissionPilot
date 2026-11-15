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
import { obtenirLangue, obtenirT } from "../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../lib/identifiant";
import {
  cheminGrille,
  hrefGrille,
  hrefVersionGrille,
  libelleOrigine,
  libelleStatutGrille,
  nomAuteurGrille,
  STATUTS_GRILLE,
  type GrilleDetail,
} from "../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../lib/referentiels-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Grille de notation", "Rating framework") };
}

/**
 * Une grille du cabinet et ses versions (de la plus récente à la plus ancienne). Une version
 * validée est figée ; une correction passe par une nouvelle version (brouillon), qu'un expert
 * métier autre que son rédacteur valide.
 */
export default async function PageGrilleNotation({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          titre={t("Grille de notation", "Rating framework")}
          retour={{ href: "/notation", libelle: t("Grilles", "Frameworks") }}
        />
        <EtatErreur
          titre={t("La grille n'a pas pu être chargée.", "The framework could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefGrille(id)}
        />
      </div>
    );
  }
  const g = r.donnees;
  const brouillon = g.versions.find((v) => v.statut === "brouillon");
  const nom = (uid: string | null | undefined) =>
    nomAuteurGrille(uid, utilisateur.id, personnes, langue);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={g.titre}
        retour={{ href: "/notation", libelle: t("Grilles de notation", "Rating frameworks") }}
        soustitre={`${t("Code", "Code")} ${g.code} · ${libelleOrigine(g.origine, langue)}`}
      />

      <Carte titre={t("Nouvelle version", "New version")}>
        {brouillon ? (
          <p>
            {t(
              `Un brouillon existe déjà (version ${brouillon.version}) :`,
              `A draft already exists (version ${brouillon.version}):`,
            )}{" "}
            <Link href={hrefVersionGrille(brouillon.id)}>
              {t("ouvrez-le pour le modifier", "open it to edit it")}
            </Link>{" "}
            {t(
              "ou faites-le valider par un expert métier.",
              "or have it approved by a business expert.",
            )}
          </p>
        ) : (
          <NouvelleVersionGrille grilleId={g.id} />
        )}
      </Carte>

      <section aria-labelledby="titre-versions" className="mp-pile">
        <h2 id="titre-versions" className="mp-section__titre">
          {t("Versions", "Versions")}
        </h2>
        <ul className="mp-liste-lignes">
          {g.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                <Link href={hrefVersionGrille(v.id)} className="mp-lien-ligne">
                  {t("Version", "Version")} {v.version}
                  {v.statut === "brouillon"
                    ? t(" (modifier)", " (edit)")
                    : t(" (consulter)", " (view)")}
                </Link>
                <span className="mp-texte-doux mp-texte-petit">
                  {t("Créée le", "Created on")}{" "}
                  {formaterDateHeure(v.cree_le, "Africa/Abidjan", langue)} {t("par", "by")}{" "}
                  {nom(v.cree_par)}
                  {v.valide_le
                    ? ` · ${t("validée le", "approved on")} ${formaterDateHeure(v.valide_le, "Africa/Abidjan", langue)} ${t("par", "by")} ${nom(v.valide_par)}`
                    : ""}
                </span>
              </div>
              <BadgeStatut tonalite={STATUTS_GRILLE[v.statut]?.tonalite ?? "neutre"}>
                {libelleStatutGrille(v.statut, langue)}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
