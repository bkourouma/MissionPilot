import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  EtiquettesPreuve,
  ExtraitPreuve,
} from "../../../../../../components/preuves/AffichagePreuves";
import { FormulairePreuve } from "../../../../../../components/preuves/FormulairePreuve";
import { BadgeStatut } from "../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { formaterDate, formaterDateHeure } from "../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../lib/identifiant";
import { chargerMission } from "../../../../../../lib/missions-serveur";
import { aujourdhui } from "../../../../../../lib/periode";
import {
  cheminDimensions,
  cheminPreuve,
  droitsPreuves,
  hrefAssertion,
  hrefPreuve,
  hrefRegistre,
  libelleAuteur,
  libelleDimension,
  SENS_LIBELLES,
  STATUTS_ASSERTION,
  type DetailPreuve,
  type DimensionVue,
} from "../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../lib/session";

export const metadata: Metadata = { title: "Preuve" };

/**
 * Détail d'une preuve : version courante, assertions auxquelles elle est liée, correction
 * (nouvelle version avec motif) et historique des versions.
 */
export default async function PageDetailPreuve({
  params,
}: {
  params: Promise<{ id: string; preuveId: string }>;
}) {
  const { id, preuveId } = await params;
  if (!estIdentifiant(preuveId)) notFound();
  const { utilisateur } = await exigerPermission("preuve.lire");
  const r = await chargerMission(id);
  if (!r.ok) return null;
  const droits = droitsPreuves(utilisateur.roles, r.donnees);
  const [detail, dimensions] = await Promise.all([
    chargerServeur<DetailPreuve>(cheminPreuve(preuveId)),
    chargerServeur<{ elements: DimensionVue[] }>(cheminDimensions(id)),
  ]);
  if (!detail.ok && detail.statut === 404) notFound();
  if (!detail.ok) {
    return (
      <EtatErreur
        titre="La preuve n'a pas pu être chargée."
        message={detail.message}
        hrefReessayer={hrefPreuve(id, preuveId)}
      />
    );
  }
  const p = detail.donnees;
  if (p.mission_id !== id) notFound();
  const dims = dimensions.ok ? dimensions.donnees.elements : [];
  const lien = p.document_id
    ? `document ${p.document_id}`
    : p.fichier_id
      ? `fichier ${p.fichier_id}`
      : p.reponse_id
        ? `réponse de questionnaire ${p.reponse_id}`
        : null;

  return (
    <>
      <Link href={hrefRegistre(id)} className="mp-lien-retour">
        Revenir au registre
      </Link>
      <Carte
        titre={p.source_precise}
        actions={
          <BadgeStatut tonalite="neutre" sansIcone>
            {`Version ${p.version}`}
          </BadgeStatut>
        }
      >
        <div className="mp-pile">
          <EtiquettesPreuve preuve={p} />
          <p className="mp-texte-doux mp-texte-petit">
            {formaterDate(p.date_preuve)} · recueillie par {libelleAuteur(p.auteur)}
            {p.dimensions.length > 0
              ? ` · ${p.dimensions.map((c) => libelleDimension(c, dims)).join(", ")}`
              : ""}
          </p>
          <ExtraitPreuve preuve={p} />
          {lien ? <p className="mp-texte-doux mp-texte-petit">Lien : {lien}</p> : null}
        </div>
      </Carte>

      <Carte titre="Assertions qui s'appuient sur cette preuve">
        {p.assertions.length === 0 ? (
          <p className="mp-texte-doux">Cette preuve n&apos;est liée à aucune assertion.</p>
        ) : (
          <ul className="mp-liste-simple">
            {p.assertions.map((a) => (
              <li key={a.assertion_id}>
                <Link href={hrefAssertion(id, a.assertion_id)}>{a.enonce}</Link>
                {` · ${SENS_LIBELLES[a.sens]} · ${a.classe_risque} · ${STATUTS_ASSERTION[a.statut]}`}
              </li>
            ))}
          </ul>
        )}
      </Carte>

      {droits.ecrire ? (
        <Carte titre="Corriger la preuve">
          {p.masque ? (
            <p className="mp-texte-doux">
              Cette preuve est un verbatim nominatif sans accord, masqué pour vous : son auteur et
              les responsables de la mission peuvent la corriger.
            </p>
          ) : (
            <FormulairePreuve
              missionId={id}
              dimensions={dims}
              aujourdhui={aujourdhui()}
              preuve={p}
            />
          )}
        </Carte>
      ) : null}

      <Carte titre="Historique des versions">
        <ol className="mp-liste-simple" reversed>
          {p.versions.map((v) => (
            <li key={v.version}>
              <strong>{`Version ${v.version}`}</strong>
              {` · ${formaterDateHeure(v.version_cree_le)} · fiabilité ${v.fiabilite}`}
              {v.motif ? ` · ${v.motif}` : " · enregistrement initial"}
            </li>
          ))}
        </ol>
      </Carte>
    </>
  );
}
