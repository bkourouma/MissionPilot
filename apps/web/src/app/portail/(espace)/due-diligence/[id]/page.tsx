import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NonDisponible } from "../../../../../components/portail/NonDisponible";
import { Alerte } from "../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../components/ui/Carte";
import { EnteteDePage } from "../../../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../components/ui/Icone";
import { obtenirLangue, obtenirT } from "../../../../../lib/i18n/serveur";
import { estIdentifiant, peut } from "../../../../../lib/portail";
import {
  cheminApiDdPortail,
  CHEMIN_DD_PORTAIL,
  conditionsDdPortail,
  etatRecommandationPortail,
  hrefDdPortail,
  hrefPieceDdPortail,
  libellePieceDdPortail,
  mentionPublication,
  mentionValidation,
  piecesDdPortail,
  type DdPortailPublicationDetail,
} from "../../../../../lib/portail-dd";
import { chargerPortail, obtenirSessionPortail } from "../../../../../lib/portail-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Note de due diligence", "Due diligence note") };
}

/**
 * Une note de due diligence communiquée : recommandation, synthèse, conditions et documents à
 * télécharger. C'est une copie figée de la version validée par le cabinet : aucun identifiant
 * interne ni nom du cabinet n'est affiché. 404 uniforme de l'API : « introuvable ».
 */
export default async function DetailDueDiligencePortail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!estIdentifiant(id)) notFound();
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const { utilisateur } = await obtenirSessionPortail();
  if (!peut(utilisateur.roles, "portail.dd.lire")) {
    return <NonDisponible titre={t("Due diligence", "Due diligence")} />;
  }
  const r = await chargerPortail<DdPortailPublicationDetail>(cheminApiDdPortail(id));
  if (!r.ok && r.statut === 404) notFound();
  const retour = { href: CHEMIN_DD_PORTAIL, libelle: t("Due diligence", "Due diligence") };
  const lectureSeule = t("Lecture seule", "Read-only");
  if (!r.ok) {
    return (
      <div className="mp-page">
        <EnteteDePage titre={t("Note de due diligence", "Due diligence note")} retour={retour} />
        <EtatErreur
          titre={t("La note n'a pas pu être chargée.", "The note could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefDdPortail(id)}
        />
      </div>
    );
  }
  const d = r.donnees;
  const reco = etatRecommandationPortail(d.recommandation, langue);
  const conditions = conditionsDdPortail(d.conditions);
  const pieces = piecesDdPortail(d.pieces);
  return (
    <div className="mp-page mp-page--etroite">
      <EnteteDePage
        titre={d.titre}
        retour={retour}
        badges={
          <>
            <BadgeStatut tonalite={reco.tonalite}>{reco.libelle}</BadgeStatut>
            <BadgeStatut tonalite="neutre" sansIcone>
              {lectureSeule}
            </BadgeStatut>
          </>
        }
      />
      <Alerte tonalite="info" annonce="aucune" titre={mentionValidation(d.valide_le, langue)}>
        <p>
          {t(
            `${mentionPublication(d.publie_le)}. Cette note est en lecture seule : elle reflète la version ${d.version} validée par le cabinet.`,
            `${mentionPublication(d.publie_le, langue)}. This note is read-only: it reflects version ${d.version} approved by the firm.`,
          )}
        </p>
      </Alerte>
      <Carte titre={t("Synthèse", "Summary")} niveauTitre={2}>
        <p style={{ whiteSpace: "pre-line" }}>{d.synthese}</p>
      </Carte>
      {conditions.length > 0 ? (
        <Carte titre={t("Conditions", "Conditions")} niveauTitre={2}>
          <ul>
            {conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Carte>
      ) : null}
      <Carte titre={t("Documents", "Documents")} niveauTitre={2}>
        {pieces.length === 0 ? (
          <p className="mp-texte-doux">
            {t("Aucun document n'accompagne cette note.", "No document accompanies this note.")}
          </p>
        ) : (
          <ul className="mp-pile">
            {pieces.map((p) => (
              <li key={p.id}>
                <a className="mp-lien-action" href={hrefPieceDdPortail(d.id, p.id)} download>
                  <Icone nom="telechargement" taille={18} />
                  <span>
                    {t(
                      `Télécharger : ${libellePieceDdPortail(p)}`,
                      `Download: ${libellePieceDdPortail(p, langue)}`,
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Carte>
    </div>
  );
}
