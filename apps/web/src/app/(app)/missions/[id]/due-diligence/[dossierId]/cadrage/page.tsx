import type { Metadata } from "next";
import { FormulaireCadrage } from "../../../../../../../components/due-diligence/FormulaireCadrage";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminVersionsCadrage,
  droitsDd,
  hrefEcranDossier,
  libelleTaxonomie,
  libellesDd,
  type VersionCadrage,
} from "../../../../../../../lib/due-diligence";
import { chargerDossier, chargerTaxonomies } from "../../../../../../../lib/due-diligence-serveur";
import { formaterDate, formaterDateHeure, libelleDevise } from "../../../../../../../lib/format";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Cadrage du dossier", "File scoping") };
}

/** Cadrage courant (DD-01), correction motivée (version suivante) et historique des versions. */
export default async function PageCadrageDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
  const { utilisateur } = await exigerPermission("dd.lire");
  const [mission, dossier, versions] = await Promise.all([
    chargerMission(id),
    chargerDossier(dossierId),
    chargerServeur<{ elements: VersionCadrage[] }>(cheminVersionsCadrage(dossierId)),
  ]);
  if (!mission.ok || !dossier.ok) return null;
  const d = dossier.donnees;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const taxonomies = await chargerTaxonomies();
  const liste = versions.ok
    ? [...versions.donnees.elements].sort((a, b) => b.version - a.version)
    : [];
  const versionCourante = liste[0]?.version ?? d.version_cadrage;

  return (
    <>
      <Carte titre={t("Cadrage courant", "Current scoping")}>
        <dl className="mp-dd-pile">
          <div>
            <dt className="mp-texte-doux mp-texte-petit">{t("Opération", "Transaction")}</dt>
            <dd>{L.TYPE_OPERATION[d.type_operation]}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">
              {t("Secteur, filière et pays", "Sector, subsector and country")}
            </dt>
            <dd>
              {[d.secteur_libelle, d.filiere_libelle, d.pays_libelle].filter(Boolean).join(" · ") ||
                t("Non précisés", "Not specified")}
            </dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">{t("Cible", "Target")}</dt>
            <dd>{d.cible_nom ?? t("Non précisée", "Not specified")}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">
              {t("Date d'opération prévue", "Planned transaction date")}
            </dt>
            <dd>
              {d.date_operation
                ? formaterDate(d.date_operation, "UTC", langue)
                : t("Non précisée", "Not specified")}
            </dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">
              {t("Question d'investissement", "Investment question")}
            </dt>
            <dd className="mp-dd-texte">
              {d.question_investissement ?? t("Non précisée", "Not specified")}
            </dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">{t("Périmètre", "Scope")}</dt>
            <dd className="mp-dd-texte">{d.perimetre ?? t("Non précisé", "Not specified")}</dd>
          </div>
        </dl>
      </Carte>

      {droits.ecrire ? (
        <Carte titre={t("Corriger le cadrage", "Edit the scoping")}>
          <p className="mp-texte-doux">
            {t(
              "Une correction crée une nouvelle version, avec son motif ; les versions précédentes restent consultables.",
              "A correction creates a new version, with its reason; previous versions remain viewable.",
            )}
          </p>
          {taxonomies.erreur ? (
            <Alerte
              tonalite="attention"
              titre={t("Listes de choix incomplètes", "Incomplete choice lists")}
              annonce="aucune"
            >
              <p>{taxonomies.erreur}</p>
            </Alerte>
          ) : null}
          <FormulaireCadrage
            missionId={id}
            secteurs={taxonomies.secteurs}
            filieres={taxonomies.filieres}
            pays={taxonomies.pays}
            devise={d.devise}
            correction={{
              dossierId,
              versionCourante,
              valeurs: {
                titre: d.titre,
                secteur_code: d.secteur_code,
                filiere_code: d.filiere_code ?? "",
                pays_code: d.pays_code,
                cible_nom: d.cible_nom ?? "",
                type_operation: d.type_operation,
                devise: d.devise,
                date_operation: d.date_operation ?? "",
                question_investissement: d.question_investissement ?? "",
                perimetre: d.perimetre ?? "",
              },
            }}
          />
        </Carte>
      ) : null}

      <Carte titre={t("Historique des versions", "Version history")}>
        {!versions.ok ? (
          <EtatErreur
            titre={t("L'historique n'a pas pu être chargé.", "The history could not be loaded.")}
            message={versions.message}
            hrefReessayer={hrefEcranDossier(id, dossierId, "cadrage")}
          />
        ) : liste.length === 0 ? (
          <p className="mp-texte-doux">{t("Aucune version enregistrée.", "No version saved.")}</p>
        ) : (
          <ol
            className="mp-dd-liste"
            aria-label={t(
              "Versions du cadrage, de la plus récente à la plus ancienne",
              "Scoping versions, from newest to oldest",
            )}
          >
            {liste.map((v) => (
              <li key={v.version} className="mp-dd-element">
                <p className="mp-dd-element__titre">{`Version ${v.version}`}</p>
                <p className="mp-texte-doux mp-texte-petit">
                  {formaterDateHeure(v.cree_le, undefined, langue)}
                </p>
                {v.motif ? (
                  <p className="mp-dd-texte">{`${t("Motif", "Reason")} : ${v.motif}`}</p>
                ) : null}
                <p className="mp-texte-petit">
                  {`${v.titre} · ${L.TYPE_OPERATION[v.type_operation]} · ${libelleTaxonomie(taxonomies.secteurs, v.secteur_code, langue)} · ${libelleTaxonomie(taxonomies.pays, v.pays_code, langue)}${v.cible_nom ? ` · ${t("cible", "target")} : ${v.cible_nom}` : ""} · ${libelleDevise(v.devise)}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Carte>
    </>
  );
}
