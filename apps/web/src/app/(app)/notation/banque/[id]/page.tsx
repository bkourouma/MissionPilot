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
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant } from "../../../../../lib/identifiant";
import { nomAuteurGrille } from "../../../../../lib/notation-grilles";
import {
  cheminItemBanque,
  detailStatutItem,
  droitsItemBanque,
  hrefItemBanque,
  hrefNouvelleVersionItem,
  type ItemBanqueDetail,
} from "../../../../../lib/notation-augmentee";
import { exigerLectureNotation } from "../../../../../lib/notation-serveur";
import { chargerPersonnes } from "../../../../../lib/referentiels-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Item de la banque", "Bank item") };
}

/**
 * Une version d'item de la banque (NOT-09). En brouillon : édition par qui rédige et validation
 * par un expert métier qui n'en est ni l'auteur ni le dernier modificateur (séparation des tâches,
 * MPN04) ; validée, la version est figée (MPN08) et une correction passe par une nouvelle version.
 * Les droits affichés sont un confort : l'API reste seule juge.
 */
export default async function PageItemBanque({ params }: { params: Promise<{ id: string }> }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const { utilisateur } = await exigerLectureNotation();
  const [r, personnes] = await Promise.all([
    chargerServeur<ItemBanqueDetail>(cheminItemBanque(id)),
    chargerPersonnes(utilisateur.roles),
  ]);
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: "/notation/banque", libelle: t("Banque d'items", "Item bank") };
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Item de la banque", "Bank item")} retour={retour} />
        <EtatErreur
          titre={t("L'item n'a pas pu être chargé.", "The item could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefItemBanque(id)}
        />
      </div>
    );
  }
  const item = r.donnees;
  const droits = droitsItemBanque(utilisateur.roles, utilisateur.id, item, langue);
  const nom = (uid: string | null | undefined) =>
    nomAuteurGrille(uid, utilisateur.id, personnes, langue);
  const statut = detailStatutItem(item.statut, langue) ?? {
    libelle: t("Statut inconnu", "Unknown status"),
    tonalite: "neutre" as const,
  };
  const brouillonExistant = item.versions.find((v) => v.statut === "brouillon" && v.id !== item.id);

  return (
    <div className="mp-page">
      <EnteteDePage
        titre={`${item.contenu.intitule} — ${t("version", "version")} ${item.version}`}
        retour={retour}
        soustitre={`${t("Code", "Code")} ${item.code}`}
        badges={<BadgeStatut tonalite={statut.tonalite}>{statut.libelle}</BadgeStatut>}
      />

      <Carte titre={t("Historique", "History")}>
        <dl className="mp-liste-def mp-liste-def--compacte">
          <div>
            <dt>{t("Créée", "Created")}</dt>
            <dd>
              {t("le", "on")} {formaterDateHeure(item.cree_le, "Africa/Abidjan", langue)}{" "}
              {t("par", "by")} {nom(item.cree_par)}
            </dd>
          </div>
          <div>
            <dt>{t("Dernière modification", "Last modified")}</dt>
            <dd>
              {t("le", "on")} {formaterDateHeure(item.modifie_le, "Africa/Abidjan", langue)}{" "}
              {t("par", "by")} {nom(item.modifie_par)}
            </dd>
          </div>
          {item.valide_le ? (
            <div>
              <dt>{t("Validée", "Approved")}</dt>
              <dd>
                {t("le", "on")} {formaterDateHeure(item.valide_le, "Africa/Abidjan", langue)}{" "}
                {t("par", "by")} {nom(item.valide_par)}
              </dd>
            </div>
          ) : null}
        </dl>
      </Carte>

      {item.statut === "brouillon" ? (
        <>
          <Carte
            titre={
              droits.modifier
                ? t("Modifier le brouillon", "Edit the draft")
                : t("Contenu du brouillon", "Draft content")
            }
          >
            {droits.modifier ? (
              <FormulaireItemBanque
                itemId={item.id}
                base={item.contenu}
                identifiantsFiges
                suggestions={suggestionsDimensions()}
                avertissement={
                  droits.valider
                    ? t(
                        "Si vous enregistrez une modification, vous en deviendrez le dernier modificateur : un autre expert métier devra alors valider cette version.",
                        "If you save a change, you become its last editor: another business expert will then have to approve this version.",
                      )
                    : null
                }
              />
            ) : (
              <LectureItemBanque contenu={item.contenu} />
            )}
          </Carte>
          <Carte titre={t("Validation par un expert métier", "Approval by a business expert")}>
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
                    t(
                      "La validation revient à un expert métier du cabinet.",
                      "Approval is up to a business expert of the firm.",
                    )}
                </p>
              </Alerte>
            )}
            <p className="mp-texte-doux mp-texte-petit">
              {t(
                "La validation porte sur la version enregistrée et la fige : elle pourra alors servir aux questionnaires adaptatifs.",
                "Approval applies to the saved version and locks it: it can then be used in adaptive questionnaires.",
              )}
            </p>
          </Carte>
        </>
      ) : (
        <>
          <Carte titre={t("Contenu de la version", "Version content")}>
            <LectureItemBanque contenu={item.contenu} />
          </Carte>
          <Carte titre={t("Nouvelle version", "New version")}>
            <Alerte
              tonalite="succes"
              titre={t("Version validée et figée", "Version approved and locked")}
              annonce="aucune"
            >
              <p>
                {t(
                  "Elle ne se modifie plus : une correction passe par une nouvelle version, qu'un autre expert métier validera.",
                  "It can no longer be edited: a correction goes through a new version, which another business expert will approve.",
                )}
              </p>
            </Alerte>
            {brouillonExistant ? (
              <p>
                {t(
                  `Un brouillon existe déjà (version ${brouillonExistant.version}) :`,
                  `A draft already exists (version ${brouillonExistant.version}):`,
                )}{" "}
                <Link href={hrefItemBanque(brouillonExistant.id)}>
                  {t("ouvrez-le pour le modifier", "open it to edit it")}
                </Link>
                .
              </p>
            ) : droits.nouvelleVersion ? (
              <p>
                <Link href={hrefNouvelleVersionItem(item.id)} className={classesBouton("primaire")}>
                  {t("Créer une nouvelle version", "Create a new version")}
                </Link>
              </p>
            ) : null}
          </Carte>
        </>
      )}

      <section aria-labelledby="na-titre-versions" className="mp-pile">
        <h2 id="na-titre-versions" className="mp-section__titre">
          {t("Versions de l'item", "Item versions")}
        </h2>
        <ul className="mp-liste-lignes">
          {item.versions.map((v) => (
            <li key={v.id} className="mp-liste-lignes__ligne">
              <div className="mp-liste-lignes__texte">
                {v.id === item.id ? (
                  <span>
                    {t("Version", "Version")} {v.version} {t("(affichée)", "(shown)")}
                  </span>
                ) : (
                  <Link href={hrefItemBanque(v.id)} className="mp-lien-ligne">
                    {t("Version", "Version")} {v.version}
                  </Link>
                )}
                <span className="mp-texte-doux mp-texte-petit">
                  {t("Créée le", "Created on")}{" "}
                  {formaterDateHeure(v.cree_le, "Africa/Abidjan", langue)}
                  {v.valide_le
                    ? ` · ${t("validée le", "approved on")} ${formaterDateHeure(v.valide_le, "Africa/Abidjan", langue)}`
                    : ""}
                </span>
              </div>
              <BadgeStatut tonalite={detailStatutItem(v.statut, langue)?.tonalite ?? "neutre"}>
                {detailStatutItem(v.statut, langue)?.libelle ??
                  t("Statut inconnu", "Unknown status")}
              </BadgeStatut>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
