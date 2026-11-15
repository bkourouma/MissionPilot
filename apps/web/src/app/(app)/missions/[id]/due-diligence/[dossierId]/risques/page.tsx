import type { Metadata } from "next";
import { FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD } from "@missionpilot/shared";
import { BadgeNiveauRisque } from "../../../../../../../components/due-diligence/BadgesDd";
import {
  CorrectionRisque,
  EspaceRisques,
} from "../../../../../../../components/due-diligence/EspaceRisques";
import { BadgeSolidite } from "../../../../../../../components/preuves/BadgeSolidite";
import { Alerte } from "../../../../../../../components/ui/Alerte";
import { BadgeStatut } from "../../../../../../../components/ui/BadgeStatut";
import { classesBouton } from "../../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../../components/ui/Carte";
import { EtatErreur } from "../../../../../../../components/ui/EtatListe";
import { Icone } from "../../../../../../../components/ui/Icone";
import { Select } from "../../../../../../../components/ui/Select";
import { chargerServeur } from "../../../../../../../lib/api-serveur";
import {
  cheminChaine,
  cheminRisques,
  cheminSignauxDossier,
  droitsDd,
  hrefAssertionRegistre,
  hrefEcranDossier,
  libellesDd,
  lireFiltresRisques,
  optionsDe,
  peutSignerAvisDd,
  requeteRisques,
  risquesParFamille,
  trierParGravite,
  type ReponseChaine,
  type ReponseRisques,
  type SignalDossier,
} from "../../../../../../../lib/due-diligence";
import { obtenirLangue, obtenirT } from "../../../../../../../lib/i18n/serveur";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Risques du dossier", "File risks") };
}

/**
 * Checklist de risques par famille (pays, change, opérationnel, réglementaire) et niveau (DD-06)
 * et signaux d'alerte applicables (DD-11). La justification d'un risque est une assertion
 * sourcée ou signalée fragile ; les signaux applicables sont choisis par le moteur de l'API.
 */
export default async function PageRisquesDd({
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
  const filtres = lireFiltresRisques(await searchParams, FAMILLES_RISQUE_DD, NIVEAUX_RISQUE_DD);
  const filtre = Boolean(filtres.famille ?? filtres.niveau ?? filtres.etape_id);
  const [risques, chaine, signaux] = await Promise.all([
    chargerServeur<ReponseRisques>(cheminRisques(dossierId, requeteRisques(filtres))),
    chargerServeur<ReponseChaine>(cheminChaine(dossierId)),
    chargerServeur<{ elements: SignalDossier[] }>(cheminSignauxDossier(dossierId)),
  ]);
  const etapes = chaine.ok
    ? [...chaine.donnees.etapes]
        .sort((a, b) => a.ordre - b.ordre)
        .map((e) => ({ valeur: e.id, libelle: `${e.ordre}. ${e.libelle}` }))
    : [];
  const gravites: Record<string, (typeof NIVEAUX_RISQUE_DD)[number]> = {};
  if (signaux.ok)
    for (const s of signaux.donnees.elements) gravites[s.signal_id] = s.gravite_indicative;
  const libelleEtape = (etapeId: string | null) =>
    etapeId ? (etapes.find((e) => e.valeur === etapeId)?.libelle ?? null) : null;
  const peutSigner = peutSignerAvisDd(utilisateur.roles);
  const aDocumenter = risques.ok
    ? new Set(risques.donnees.synthese.a_documenter)
    : new Set<string>();

  return (
    <>
      <form
        method="get"
        action={hrefEcranDossier(id, dossierId, "risques")}
        className="mp-filtres"
        role="search"
        aria-label={t("Filtrer les risques", "Filter the risks")}
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle={t("Famille", "Family")}
            name="famille"
            invite={t("Toutes", "All")}
            options={optionsDe(FAMILLES_RISQUE_DD, L.FAMILLE)}
            defaultValue={filtres.famille}
          />
          <Select
            libelle={t("Niveau", "Level")}
            name="niveau"
            invite={t("Tous", "All")}
            options={optionsDe(NIVEAUX_RISQUE_DD, L.NIVEAU_RISQUE)}
            defaultValue={filtres.niveau}
          />
          <Select
            libelle={t("Étape de la chaîne", "Value chain step")}
            name="etape_id"
            invite={t("Toutes", "All")}
            options={etapes}
            defaultValue={filtres.etape_id}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>{t("Filtrer", "Filter")}</span>
          </button>
        </div>
      </form>

      {!risques.ok ? (
        <EtatErreur
          titre={t("Les risques n'ont pas pu être chargés.", "The risks could not be loaded.")}
          message={risques.message}
          hrefReessayer={hrefEcranDossier(id, dossierId, "risques")}
        />
      ) : risques.donnees.risques.length === 0 ? (
        <p className="mp-texte-doux" role="status">
          {filtre
            ? t("Aucun risque ne correspond à ces filtres.", "No risk matches these filters.")
            : t(
                "Aucun risque n'est enregistré : la checklist est vide.",
                "No risk is recorded: the checklist is empty.",
              )}
        </p>
      ) : (
        <>
          {risques.donnees.synthese.a_documenter.length > 0 ? (
            <Alerte
              tonalite="attention"
              titre={t("Risques à documenter", "Risks to document")}
              annonce="aucune"
            >
              <p>
                {t(
                  `${risques.donnees.synthese.a_documenter.length} risque(s) élevé(s) ou critique(s) n'ont aucune source ou une source fragile : ajoutez des preuves à leur justification.`,
                  `${risques.donnees.synthese.a_documenter.length} high or critical risk(s) have no source or a weak source: add evidence to their justification.`,
                )}
              </p>
            </Alerte>
          ) : null}
          {risquesParFamille(risques.donnees.risques, FAMILLES_RISQUE_DD).map(
            ({ famille, risques: liste }) => (
              <Carte
                key={famille}
                titre={`${L.FAMILLE[famille]} (${liste.length})`}
                niveauTitre={3}
              >
                {liste.length === 0 ? (
                  <p className="mp-texte-doux">
                    {t("Aucun risque de cette famille.", "No risk in this family.")}
                  </p>
                ) : (
                  <ul className="mp-dd-liste" aria-label={L.FAMILLE[famille]}>
                    {trierParGravite(liste).map((r) => (
                      <li key={r.id} className="mp-dd-element">
                        <p className="mp-dd-element__titre">{r.libelle}</p>
                        <span className="mp-dd-meta">
                          <BadgeNiveauRisque niveau={r.niveau} />
                          <BadgeSolidite solidite={r.solidite ?? undefined} />
                          {aDocumenter.has(r.id) ? (
                            <BadgeStatut tonalite="danger">
                              {t("À documenter", "To document")}
                            </BadgeStatut>
                          ) : null}
                          {libelleEtape(r.etape_id) ? (
                            <span className="mp-texte-doux mp-texte-petit">{`${t("Étape", "Step")} : ${libelleEtape(r.etape_id)}`}</span>
                          ) : null}
                        </span>
                        <p className="mp-dd-texte">{r.enonce}</p>
                        <div className="mp-barre-actions mp-barre-actions--compacte">
                          <a
                            className="mp-lien-action"
                            href={hrefAssertionRegistre(id, r.assertion_id)}
                          >
                            {t("Ajouter une source", "Add a source")}
                          </a>
                        </div>
                        {droits.ecrire ? (
                          <details className="mp-dd-details">
                            <summary>
                              {t("Corriger ou retirer ce risque", "Edit or remove this risk")}
                            </summary>
                            <div className="mp-dd-details__corps">
                              <CorrectionRisque
                                risque={r}
                                etapes={etapes}
                                graviteSignal={r.signal_id ? (gravites[r.signal_id] ?? null) : null}
                              />
                            </div>
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
              </Carte>
            ),
          )}
        </>
      )}

      <EspaceRisques
        dossierId={dossierId}
        etapes={etapes}
        signaux={signaux.ok ? signaux.donnees.elements : []}
        erreurSignaux={signaux.ok ? null : signaux.message}
        peutEcrire={droits.ecrire}
        peutSigner={peutSigner}
      />
    </>
  );
}
