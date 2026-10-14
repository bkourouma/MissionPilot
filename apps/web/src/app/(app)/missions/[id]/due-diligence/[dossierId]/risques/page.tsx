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
  FAMILLE_RISQUE_DD_LIBELLES,
  hrefAssertionRegistre,
  hrefEcranDossier,
  lireFiltresRisques,
  NIVEAU_RISQUE_DD_LIBELLES,
  optionsDe,
  peutSignerAvisDd,
  requeteRisques,
  risquesParFamille,
  trierParGravite,
  type ReponseChaine,
  type ReponseRisques,
  type SignalDossier,
} from "../../../../../../../lib/due-diligence";
import { chargerMission } from "../../../../../../../lib/missions-serveur";
import { exigerPermission } from "../../../../../../../lib/session";

export const metadata: Metadata = { title: "Risques du dossier" };

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
        aria-label="Filtrer les risques"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Select
            libelle="Famille"
            name="famille"
            invite="Toutes"
            options={optionsDe(FAMILLES_RISQUE_DD, FAMILLE_RISQUE_DD_LIBELLES)}
            defaultValue={filtres.famille}
          />
          <Select
            libelle="Niveau"
            name="niveau"
            invite="Tous"
            options={optionsDe(NIVEAUX_RISQUE_DD, NIVEAU_RISQUE_DD_LIBELLES)}
            defaultValue={filtres.niveau}
          />
          <Select
            libelle="Étape de la chaîne"
            name="etape_id"
            invite="Toutes"
            options={etapes}
            defaultValue={filtres.etape_id}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("secondaire")}>
            <Icone nom="recherche" />
            <span>Filtrer</span>
          </button>
        </div>
      </form>

      {!risques.ok ? (
        <EtatErreur
          titre="Les risques n'ont pas pu être chargés."
          message={risques.message}
          hrefReessayer={hrefEcranDossier(id, dossierId, "risques")}
        />
      ) : risques.donnees.risques.length === 0 ? (
        <p className="mp-texte-doux" role="status">
          {filtre
            ? "Aucun risque ne correspond à ces filtres."
            : "Aucun risque n'est enregistré : la checklist est vide."}
        </p>
      ) : (
        <>
          {risques.donnees.synthese.a_documenter.length > 0 ? (
            <Alerte tonalite="attention" titre="Risques à documenter" annonce="aucune">
              <p>
                {`${risques.donnees.synthese.a_documenter.length} risque(s) élevé(s) ou critique(s) n'ont aucune source ou une source fragile : ajoutez des preuves à leur justification.`}
              </p>
            </Alerte>
          ) : null}
          {risquesParFamille(risques.donnees.risques, FAMILLES_RISQUE_DD).map(
            ({ famille, risques: liste }) => (
              <Carte
                key={famille}
                titre={`${FAMILLE_RISQUE_DD_LIBELLES[famille]} (${liste.length})`}
                niveauTitre={3}
              >
                {liste.length === 0 ? (
                  <p className="mp-texte-doux">Aucun risque de cette famille.</p>
                ) : (
                  <ul className="mp-dd-liste" aria-label={FAMILLE_RISQUE_DD_LIBELLES[famille]}>
                    {trierParGravite(liste).map((r) => (
                      <li key={r.id} className="mp-dd-element">
                        <p className="mp-dd-element__titre">{r.libelle}</p>
                        <span className="mp-dd-meta">
                          <BadgeNiveauRisque niveau={r.niveau} />
                          <BadgeSolidite solidite={r.solidite ?? undefined} />
                          {aDocumenter.has(r.id) ? (
                            <BadgeStatut tonalite="danger">À documenter</BadgeStatut>
                          ) : null}
                          {libelleEtape(r.etape_id) ? (
                            <span className="mp-texte-doux mp-texte-petit">{`Étape : ${libelleEtape(r.etape_id)}`}</span>
                          ) : null}
                        </span>
                        <p className="mp-dd-texte">{r.enonce}</p>
                        <div className="mp-barre-actions mp-barre-actions--compacte">
                          <a
                            className="mp-lien-action"
                            href={hrefAssertionRegistre(id, r.assertion_id)}
                          >
                            Ajouter une source
                          </a>
                        </div>
                        {droits.ecrire ? (
                          <details className="mp-dd-details">
                            <summary>Corriger ou retirer ce risque</summary>
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
