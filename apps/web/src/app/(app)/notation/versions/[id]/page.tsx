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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import {
  cheminVersionGrille,
  droitsVersionGrille,
  editionDepuisContenu,
  hrefGrille,
  hrefVersionGrille,
  libelleStatutGrille,
  nomAuteurGrille,
  sommeConforme,
  STATUTS_GRILLE,
  totauxEdition,
  type VersionGrille,
} from "../../../../../lib/notation-grilles";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Version de grille de notation", "Rating framework version") };
}

/**
 * Une version de grille : en brouillon, édition des pondérations (sommes en direct) et
 * validation par un expert métier qui ne l'a ni rédigée ni modifiée ; validée, lecture seule.
 */
export default async function PageVersionGrille({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          titre={t("Version de grille", "Framework version")}
          retour={{ href: "/notation", libelle: t("Grilles de notation", "Rating frameworks") }}
        />
        <EtatErreur
          titre={t("La version n'a pas pu être chargée.", "The version could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefVersionGrille(id)}
        />
      </div>
    );
  }
  const v = r.donnees;
  const droits = droitsVersionGrille(utilisateur.roles, utilisateur.id, v, langue);
  const nom = (uid: string | null | undefined) =>
    nomAuteurGrille(uid, utilisateur.id, personnes, langue);
  const totaux = totauxEdition(v.contenu.dimensions, editionDepuisContenu(v.contenu), langue);
  const conformes =
    sommeConforme(totaux.total) && totaux.secteurs.every((s) => sommeConforme(s.total));
  const statut = {
    libelle: libelleStatutGrille(v.statut, langue),
    tonalite: STATUTS_GRILLE[v.statut]?.tonalite ?? "neutre",
  };

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${v.contenu.titre} — ${t("version", "version")} ${v.version}`}
        retour={{
          href: hrefGrille(v.grille_id),
          libelle: t("Versions de la grille", "Framework versions"),
        }}
        soustitre={`${t("Code", "Code")} ${v.code}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <Carte titre={t("Historique", "History")}>
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>{t("Créée", "Created")}</dt>
            <dd>
              {t("le", "on")} {formaterDateHeure(v.cree_le, "Africa/Abidjan", langue)}{" "}
              {t("par", "by")} {nom(v.cree_par)}
            </dd>
          </div>
          <div>
            <dt>{t("Dernière modification", "Last modified")}</dt>
            <dd>
              {t("le", "on")} {formaterDateHeure(v.modifie_le, "Africa/Abidjan", langue)}
              {v.modifie_par ? ` ${t("par", "by")} ${nom(v.modifie_par)}` : ""}
            </dd>
          </div>
          {v.valide_le ? (
            <div>
              <dt>{t("Validée", "Approved")}</dt>
              <dd>
                {t("le", "on")} {formaterDateHeure(v.valide_le, "Africa/Abidjan", langue)}{" "}
                {t("par", "by")} {nom(v.valide_par)}
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      <Carte titre={t("Pondérations", "Weightings")}>
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
        <Carte titre={t("Validation par un expert métier", "Approval by a business expert")}>
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
                  t(
                    "La validation revient à un expert métier du cabinet.",
                    "Approval is up to a business expert of the firm.",
                  )}
              </p>
            </Alerte>
          )}
          <p className="mp-texte-doux mp-texte-petit">
            {t(
              "La validation porte sur la version enregistrée et la fige : elle pourra alors servir au calcul des notations.",
              "Approval applies to the saved version and locks it: it can then be used to compute ratings.",
            )}
          </p>
        </Carte>
      ) : (
        <Alerte
          tonalite="succes"
          titre={t("Version validée et figée", "Version approved and locked")}
          annonce="aucune"
        >
          <p>
            {t(
              "Elle sert au calcul des notations et ne se modifie plus : créez une nouvelle version depuis la page de la grille pour la faire évoluer.",
              "It is used to compute ratings and can no longer be edited: create a new version from the framework page to evolve it.",
            )}
          </p>
        </Alerte>
      )}
    </div>
  );
}
