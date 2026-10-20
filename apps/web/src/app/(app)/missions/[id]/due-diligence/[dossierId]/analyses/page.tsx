import Link from "next/link";
import type { Metadata } from "next";
import { ANALYSES_DD, CATEGORIES_ANALYSE_DD } from "@missionpilot/shared";
import { BadgeNiveauRisque } from "../../../../../../../components/due-diligence/BadgesDd";
import {
  CorrectionPoint,
  FormulairePoint,
} from "../../../../../../../components/due-diligence/FormulairesPoint";
import { EncartModeleSecteur } from "../../../../../../../components/due-diligence/EncartModeleSecteur";
import { BadgeSolidite } from "../../../../../../../components/preuves/BadgeSolidite";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  ANALYSE_DD_LIBELLES,
  cheminAnalyses,
  droitsDd,
  hrefAnalyses,
  hrefAssertionRegistre,
  hrefEcranDossier,
  libelleCategorie,
  lireAnalyse,
  messageFragilite,
  peutSignerAvisDd,
  type ReponseAnalyses,
} from "../../../../../../../lib/due-diligence";
import {
  cheminModelesDuDossier,
  type ModelesDuDossier,
} from "../../../../../../../lib/due-diligence-modeles";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Analyses du dossier" };

/**
 * Analyses PESTEL, cinq forces, SWOT et opérationnelle (DD-03, DD-05) : chaque point est une
 * affirmation, assertion du registre des preuves. Sa solidité est celle du moteur des preuves ; un
 * point sans source ou à source unique est signalé en texte, pas seulement en couleur.
 */
export default async function PageAnalysesDd({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; dossierId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id, dossierId } = await params;
  const { utilisateur } = await exigerPermission("dd.lire");
  const mission = await chargerMission(id);
  if (!mission.ok) return null;
  const droits = droitsDd(utilisateur.roles, mission.donnees);
  const analyse = lireAnalyse(await searchParams, ANALYSES_DD);
  const [r, modeles] = await Promise.all([
    chargerServeur<ReponseAnalyses>(cheminAnalyses(dossierId, analyse)),
    // Modèle du cabinet pour le secteur du dossier (DD-07) : aucun encart sans modèle ou en cas d'erreur.
    chargerServeur<ModelesDuDossier>(cheminModelesDuDossier(dossierId, analyse)),
  ]);
  const peutSigner = peutSignerAvisDd(utilisateur.roles);
  const bloc = r.ok ? r.donnees.analyses.find((a) => a.analyse === analyse) : undefined;

  return (
    <>
      <nav aria-label="Choix de l'analyse" className="mp-onglets">
        <ul className="mp-onglets__liste">
          {ANALYSES_DD.map((a) => (
            <li key={a}>
              <Link
                href={hrefAnalyses(id, dossierId, a)}
                className="mp-onglets__lien"
                aria-current={a === analyse ? "page" : undefined}
              >
                {ANALYSE_DD_LIBELLES[a]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!r.ok ? (
        <EtatErreur
          titre="Les analyses n'ont pas pu être chargées."
          message={r.message}
          hrefReessayer={hrefAnalyses(id, dossierId, analyse)}
        />
      ) : (
        <>
          <p className="mp-texte-doux">
            {`Couverture du dossier : ${r.donnees.couverture.points} point(s), dont ${r.donnees.couverture.solides} solide(s), ${r.donnees.couverture.etayes} étayé(s) et ${r.donnees.couverture.fragiles} fragile(s).`}
          </p>
          {modeles.ok ? <EncartModeleSecteur modeles={modeles.donnees.elements} /> : null}
          <div className="mp-dd-categories">
            {CATEGORIES_ANALYSE_DD[analyse].map((categorie) => {
              const points = bloc?.categories.find((c) => c.categorie === categorie)?.points ?? [];
              return (
                <section
                  key={categorie}
                  className="mp-dd-categorie"
                  aria-labelledby={`cat-${categorie}`}
                >
                  <h3 id={`cat-${categorie}`} className="mp-dd-categorie__titre">
                    {libelleCategorie(categorie)}
                  </h3>
                  {points.length === 0 ? (
                    <p className="mp-texte-doux mp-texte-petit">
                      Aucun point dans cette catégorie.
                    </p>
                  ) : (
                    <ul className="mp-dd-liste">
                      {points.map((p) => {
                        const fragilite = messageFragilite(p);
                        return (
                          <li key={p.id} className="mp-dd-element">
                            {p.libelle ? <p className="mp-dd-element__titre">{p.libelle}</p> : null}
                            <p className="mp-dd-texte">{p.enonce}</p>
                            <span className="mp-dd-meta">
                              <BadgeSolidite solidite={p.solidite ?? undefined} />
                              {p.niveau ? <BadgeNiveauRisque niveau={p.niveau} /> : null}
                              {fragilite ? (
                                <BadgeStatut tonalite="attention">{fragilite}</BadgeStatut>
                              ) : null}
                              {p.a_arbitrer > 0 ? (
                                <BadgeStatut tonalite="danger">{`${p.a_arbitrer} contradiction(s) à arbitrer`}</BadgeStatut>
                              ) : null}
                            </span>
                            <p className="mp-texte-doux mp-texte-petit">
                              {`${p.nb_pour} source(s) en faveur, ${p.nb_contre} contraire(s)`}
                            </p>
                            <div className="mp-barre-actions mp-barre-actions--compacte">
                              <Link
                                className="mp-lien-action"
                                href={hrefAssertionRegistre(id, p.assertion_id)}
                              >
                                Ajouter une source
                              </Link>
                            </div>
                            {droits.ecrire ? (
                              <details className="mp-dd-details">
                                <summary>Corriger ou retirer ce point</summary>
                                <div className="mp-dd-details__corps">
                                  <CorrectionPoint point={p} />
                                </div>
                              </details>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {droits.ecrire ? (
                    <details className="mp-dd-details">
                      <summary>{`Ajouter un point : ${libelleCategorie(categorie)}`}</summary>
                      <div className="mp-dd-details__corps">
                        <FormulairePoint
                          dossierId={dossierId}
                          analyse={analyse}
                          categorie={categorie}
                          peutSigner={peutSigner}
                        />
                      </div>
                    </details>
                  ) : null}
                </section>
              );
            })}
          </div>
          <Carte titre="Comment lire la solidité" niveauTitre={3}>
            <p className="mp-texte-doux">
              La solidité d&apos;un point (solide, étayé, fragile) est calculée par le moteur du
              registre des preuves à partir des sources reliées à l&apos;affirmation ; elle ne se
              saisit pas. Une source se relie depuis la fiche de l&apos;assertion dans le{" "}
              <Link href={`/missions/${id}/preuves/assertions`}>registre des preuves</Link>. Retour
              à la{" "}
              <Link href={hrefEcranDossier(id, dossierId, "risques")}>checklist des risques</Link>.
            </p>
          </Carte>
        </>
      )}
    </>
  );
}
