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
  cheminAnalyses,
  droitsDd,
  hrefAnalyses,
  hrefAssertionRegistre,
  hrefEcranDossier,
  libelleCategorie,
  libellesDd,
  lireAnalyse,
  messageFragilite,
  peutSignerAvisDd,
  type ReponseAnalyses,
} from "../../../../../../../lib/due-diligence";
import {
  cheminModelesDuDossier,
  type ModelesDuDossier,
} from "../../../../../../../lib/due-diligence-modeles";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Analyses du dossier", "File analyses") };
}

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
  const langue = await obtenirLangue();
  const t = await obtenirT();
  const L = libellesDd(langue);
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
      <nav aria-label={t("Choix de l'analyse", "Choose the analysis")} className="mp-onglets">
        <ul className="mp-onglets__liste">
          {ANALYSES_DD.map((a) => (
            <li key={a}>
              <Link
                href={hrefAnalyses(id, dossierId, a)}
                className="mp-onglets__lien"
                aria-current={a === analyse ? "page" : undefined}
              >
                {L.ANALYSE[a]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {!r.ok ? (
        <EtatErreur
          titre={t("Les analyses n'ont pas pu être chargées.", "The analyses could not be loaded.")}
          message={r.message}
          hrefReessayer={hrefAnalyses(id, dossierId, analyse)}
        />
      ) : (
        <>
          <p className="mp-texte-doux">
            {t(
              `Couverture du dossier : ${r.donnees.couverture.points} point(s), dont ${r.donnees.couverture.solides} solide(s), ${r.donnees.couverture.etayes} étayé(s) et ${r.donnees.couverture.fragiles} fragile(s).`,
              `File coverage: ${r.donnees.couverture.points} item(s), of which ${r.donnees.couverture.solides} strong, ${r.donnees.couverture.etayes} supported and ${r.donnees.couverture.fragiles} weak.`,
            )}
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
                    {libelleCategorie(categorie, langue)}
                  </h3>
                  {points.length === 0 ? (
                    <p className="mp-texte-doux mp-texte-petit">
                      {t("Aucun point dans cette catégorie.", "No item in this category.")}
                    </p>
                  ) : (
                    <ul className="mp-dd-liste">
                      {points.map((p) => {
                        const fragilite = messageFragilite(p, langue);
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
                                <BadgeStatut tonalite="danger">
                                  {t(
                                    `${p.a_arbitrer} contradiction(s) à arbitrer`,
                                    `${p.a_arbitrer} contradiction(s) to arbitrate`,
                                  )}
                                </BadgeStatut>
                              ) : null}
                            </span>
                            <p className="mp-texte-doux mp-texte-petit">
                              {t(
                                `${p.nb_pour} source(s) en faveur, ${p.nb_contre} contraire(s)`,
                                `${p.nb_pour} source(s) in favor, ${p.nb_contre} against`,
                              )}
                            </p>
                            <div className="mp-barre-actions mp-barre-actions--compacte">
                              <Link
                                className="mp-lien-action"
                                href={hrefAssertionRegistre(id, p.assertion_id)}
                              >
                                {t("Ajouter une source", "Add a source")}
                              </Link>
                            </div>
                            {droits.ecrire ? (
                              <details className="mp-dd-details">
                                <summary>
                                  {t("Corriger ou retirer ce point", "Edit or remove this item")}
                                </summary>
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
                      <summary>
                        {t(
                          `Ajouter un point : ${libelleCategorie(categorie, langue)}`,
                          `Add an item: ${libelleCategorie(categorie, langue)}`,
                        )}
                      </summary>
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
          <Carte titre={t("Comment lire la solidité", "How to read strength")} niveauTitre={3}>
            <p className="mp-texte-doux">
              {t(
                "La solidité d'un point (solide, étayé, fragile) est calculée par le moteur du registre des preuves à partir des sources reliées à l'affirmation ; elle ne se saisit pas. Une source se relie depuis la fiche de l'assertion dans le ",
                "The strength of an item (strong, supported, weak) is computed by the evidence register engine from the sources linked to the statement; it is not entered. A source is linked from the statement page in the ",
              )}
              <Link href={`/missions/${id}/preuves/assertions`}>
                {t("registre des preuves", "evidence register")}
              </Link>
              {t(". Retour à la ", ". Back to the ")}
              <Link href={hrefEcranDossier(id, dossierId, "risques")}>
                {t("checklist des risques", "risk checklist")}
              </Link>
              .
            </p>
          </Carte>
        </>
      )}
    </>
  );
}
