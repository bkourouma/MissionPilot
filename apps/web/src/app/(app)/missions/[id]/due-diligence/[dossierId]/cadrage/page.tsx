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
  TYPE_OPERATION_DD_LIBELLES,
  type VersionCadrage,
} from "../../../../../../../lib/due-diligence";
import { chargerDossier, chargerTaxonomies } from "../../../../../../../lib/due-diligence-serveur";
import { formaterDate, formaterDateHeure, libelleDevise } from "../../../../../../../lib/format";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Cadrage du dossier" };

/** Cadrage courant (DD-01), correction motivée (version suivante) et historique des versions. */
export default async function PageCadrageDd({
  params,
}: {
  params: Promise<{ id: string; dossierId: string }>;
}) {
  const { id, dossierId } = await params;
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
      <Carte titre="Cadrage courant">
        <dl className="mp-dd-pile">
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Opération</dt>
            <dd>{TYPE_OPERATION_DD_LIBELLES[d.type_operation]}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Secteur, filière et pays</dt>
            <dd>
              {[d.secteur_libelle, d.filiere_libelle, d.pays_libelle].filter(Boolean).join(" · ") ||
                "Non précisés"}
            </dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Cible</dt>
            <dd>{d.cible_nom ?? "Non précisée"}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Date d&apos;opération prévue</dt>
            <dd>{d.date_operation ? formaterDate(d.date_operation) : "Non précisée"}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Question d&apos;investissement</dt>
            <dd className="mp-dd-texte">{d.question_investissement ?? "Non précisée"}</dd>
          </div>
          <div>
            <dt className="mp-texte-doux mp-texte-petit">Périmètre</dt>
            <dd className="mp-dd-texte">{d.perimetre ?? "Non précisé"}</dd>
          </div>
        </dl>
      </Carte>

      {droits.ecrire ? (
        <Carte titre="Corriger le cadrage">
          <p className="mp-texte-doux">
            Une correction crée une nouvelle version, avec son motif ; les versions précédentes
            restent consultables.
          </p>
          {taxonomies.erreur ? (
            <Alerte tonalite="attention" titre="Listes de choix incomplètes" annonce="aucune">
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

      <Carte titre="Historique des versions">
        {!versions.ok ? (
          <EtatErreur
            titre="L'historique n'a pas pu être chargé."
            message={versions.message}
            hrefReessayer={hrefEcranDossier(id, dossierId, "cadrage")}
          />
        ) : liste.length === 0 ? (
          <p className="mp-texte-doux">Aucune version enregistrée.</p>
        ) : (
          <ol
            className="mp-dd-liste"
            aria-label="Versions du cadrage, de la plus récente à la plus ancienne"
          >
            {liste.map((v) => (
              <li key={v.version} className="mp-dd-element">
                <p className="mp-dd-element__titre">{`Version ${v.version}`}</p>
                <p className="mp-texte-doux mp-texte-petit">{formaterDateHeure(v.cree_le)}</p>
                {v.motif ? <p className="mp-dd-texte">{`Motif : ${v.motif}`}</p> : null}
                <p className="mp-texte-petit">
                  {`${v.titre} · ${TYPE_OPERATION_DD_LIBELLES[v.type_operation]} · ${libelleTaxonomie(taxonomies.secteurs, v.secteur_code)} · ${libelleTaxonomie(taxonomies.pays, v.pays_code)}${v.cible_nom ? ` · cible : ${v.cible_nom}` : ""} · ${libelleDevise(v.devise)}`}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Carte>
    </>
  );
}
