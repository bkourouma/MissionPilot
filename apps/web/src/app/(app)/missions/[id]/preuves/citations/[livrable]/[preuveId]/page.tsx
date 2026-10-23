import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  EtiquettesPreuve,
  ExtraitPreuve,
} from "../../../../../../../../components/preuves/AffichagePreuves";
import { Carte } from "../../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../../components/ui/EtatListe";
import {
  estLivrableCitation,
  hrefLivrableCitant,
  hrefOuvertureCitation,
  LIVRABLE_CITATION_LIBELLES,
  libelleRetourLivrable,
} from "../../../../../../../../lib/citations";
import { chargerSourceCitee } from "../../../../../../../../lib/citations-serveur";
import { formaterDate } from "../../../../../../../../lib/format";
import { estIdentifiant } from "../../../../../../../../lib/identifiant";
import { hrefPreuve, libelleAuteur } from "../../../../../../../../lib/preuves";
import { exigerPermission } from "../../../../../../../../lib/session";

export const metadata: Metadata = { title: "Source citée" };

/**
 * Ouverture d'une source citée par un livrable (PRV-06). Les droits sont revérifiés par l'API :
 * la preuve n'est servie que si elle est citée par ce livrable de cette mission (sinon 404), et
 * un verbatim nominatif sans accord reste masqué.
 */
export default async function PageSourceCitee({
  params,
}: {
  params: Promise<{ id: string; livrable: string; preuveId: string }>;
}) {
  const { id, livrable, preuveId } = await params;
  if (!estIdentifiant(id) || !estIdentifiant(preuveId) || !estLivrableCitation(livrable)) {
    notFound();
  }
  await exigerPermission("preuve.lire");
  const r = await chargerSourceCitee(id, livrable, preuveId);
  if (!r.ok && r.statut === 404) notFound();
  if (!r.ok) {
    return (
      <EtatErreur
        titre="La source citée n'a pas pu être chargée."
        message={r.message}
        hrefReessayer={hrefOuvertureCitation(id, livrable, preuveId)}
      />
    );
  }
  const p = r.donnees;

  return (
    <>
      <Link href={hrefLivrableCitant(id, livrable)} className="mp-lien-retour">
        {libelleRetourLivrable(livrable)}
      </Link>
      <Carte titre={p.source_precise}>
        <div className="mp-pile">
          <p className="mp-texte-doux mp-texte-petit">
            {`Source citée par le livrable « ${LIVRABLE_CITATION_LIBELLES[livrable]} »`}
          </p>
          <EtiquettesPreuve preuve={p} />
          <p className="mp-texte-doux mp-texte-petit">
            {formaterDate(p.date_preuve)} · recueillie par {libelleAuteur(p.auteur)}
          </p>
          <ExtraitPreuve preuve={p} />
          <p>
            <Link href={hrefPreuve(id, p.id)}>Voir la fiche complète de la preuve</Link>
          </p>
        </div>
      </Carte>
    </>
  );
}
