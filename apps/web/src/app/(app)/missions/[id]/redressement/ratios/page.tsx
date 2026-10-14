import Link from "next/link";
import type { Metadata } from "next";
import { aPermission, type RedCorrespondancesVue, type RedRatiosVue } from "@missionpilot/shared";
import {
  EditeurCorrespondance,
  type LigneEtatAide,
} from "../../../../../../components/redressement/EditeurCorrespondance";
import {
  BandeauIndicatif,
  EtatContexteRed,
} from "../../../../../../components/redressement/EtatsContexte";
import { TableauRatios } from "../../../../../../components/redressement/TableauRatios";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { classesBouton } from "../../../../../../components/ui/Bouton";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import { cheminApiDossier, type EtatDetaille } from "../../../../../../lib/dossier";
import { formaterDateHeure } from "../../../../../../lib/format";
import {
  cheminCorrespondances,
  cheminRatios,
  hrefFinancesClient,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_ANALYSES_INDICATIVES,
  TEXTE_ETATS_ABSENTS,
  libellePoste,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Ratios du redressement" };

/**
 * Ratios (RED-02) calculés par l'API sur les trois derniers exercices ACCEPTÉS du dossier client
 * (un état en revue, rejeté ou remplacé n'entre jamais dans un calcul), et correspondance de
 * postes « poste de ratio ← codes de lignes de l'état ».
 */
export default async function PageRatios({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "ratios")}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const [ratios, correspondances] = await Promise.all([
    chargerServeur<RedRatiosVue>(cheminRatios(dossier.id)),
    chargerServeur<RedCorrespondancesVue>(cheminCorrespondances(dossier.id)),
  ]);

  // Aide à la saisie : lignes du dernier état accepté (lecture du dossier client).
  let lignesEtat: LigneEtatAide[] = [];
  const dernierEtat = ratios.ok ? ratios.donnees.exercices[0] : undefined;
  if (dernierEtat && aPermission(ctx.session.utilisateur.roles, "dossier.lire")) {
    const e = await chargerServeur<EtatDetaille>(
      `${cheminApiDossier(mission.client_id)}/etats-financiers/${encodeURIComponent(dernierEtat.etat_id)}`,
    );
    if (e.ok) {
      lignesEtat = e.donnees.lignes.map((l) => ({
        rang: l.rang,
        code: l.code,
        libelle: l.libelle,
        section: l.section,
        montant: l.montant,
      }));
    }
  }

  return (
    <div className="mp-red">
      {ratios.ok && ratios.donnees.analyses_indicatives ? (
        <BandeauIndicatif
          texte={TEXTE_ANALYSES_INDICATIVES}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}

      <section className="mp-red-section" aria-labelledby="titre-ratios">
        <h2 id="titre-ratios" className="mp-red-section__titre">
          Ratios
        </h2>
        {!ratios.ok ? (
          <EtatErreur
            titre="Les ratios n'ont pas pu être calculés."
            message={ratios.message}
            hrefReessayer={hrefRedressement(id, "ratios")}
          />
        ) : ratios.donnees.exercices.length === 0 ? (
          <EtatVide titre="Aucun état financier accepté pour ce client." icone="barres">
            <p>{TEXTE_ETATS_ABSENTS}</p>
            <p>
              <Link
                href={hrefFinancesClient(mission.client_id)}
                className={classesBouton("secondaire")}
              >
                Ouvrir les finances du client
              </Link>
            </p>
          </EtatVide>
        ) : (
          <>
            {ratios.donnees.correspondance_version === null ? (
              <Alerte tonalite="attention" titre="Correspondance à renseigner" annonce="aucune">
                <p>
                  Sans correspondance de postes, aucun ratio ne peut être calculé : renseignez-la
                  ci-dessous.
                </p>
              </Alerte>
            ) : null}
            <TableauRatios ratios={ratios.donnees} />
          </>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-correspondance">
        <h2 id="titre-correspondance" className="mp-red-section__titre">
          Correspondance de postes
        </h2>
        {!correspondances.ok ? (
          <EtatErreur
            titre="La correspondance n'a pas pu être chargée."
            message={correspondances.message}
            hrefReessayer={hrefRedressement(id, "ratios")}
          />
        ) : (
          <>
            {droits.ecrire ? (
              <Carte>
                <EditeurCorrespondance
                  key={correspondances.donnees.courante?.version ?? 0}
                  dossierId={dossier.id}
                  courante={correspondances.donnees.courante?.postes ?? null}
                  indicative={correspondances.donnees.indicative}
                  lignesEtat={lignesEtat}
                  devise={dossier.devise}
                />
              </Carte>
            ) : (
              <>
                <p className="mp-texte-doux">
                  {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}
                </p>
                {correspondances.donnees.courante ? (
                  <Tableau
                    legende="Correspondance de postes courante"
                    colonnes={[
                      {
                        cle: "poste",
                        entete: "Poste",
                        rendu: (l: { poste: string; codes: string }) => libellePoste(l.poste),
                      },
                      { cle: "codes", entete: "Codes de lignes", rendu: (l) => l.codes },
                    ]}
                    lignes={Object.entries(correspondances.donnees.courante.postes).map(
                      ([poste, a]) => ({
                        poste,
                        codes: a.sans_objet ? "Sans objet" : a.codes.join(", "),
                      }),
                    )}
                    cleLigne={(l) => l.poste}
                  />
                ) : (
                  <p className="mp-texte-doux">Aucune correspondance enregistrée.</p>
                )}
              </>
            )}
            <Tableau
              legende="Historique des versions de la correspondance"
              messageVide="Aucune version enregistrée."
              colonnes={[
                {
                  cle: "version",
                  entete: "Version",
                  rendu: (h: RedCorrespondancesVue["historique"][number]) => h.version,
                },
                { cle: "date", entete: "Date", rendu: (h) => formaterDateHeure(h.cree_le) },
                { cle: "auteur", entete: "Auteur", rendu: (h) => h.cree_par.nom },
                { cle: "motif", entete: "Motif", rendu: (h) => h.motif ?? "—" },
              ]}
              lignes={correspondances.donnees.historique}
              cleLigne={(h) => String(h.version)}
            />
          </>
        )}
      </section>
    </div>
  );
}
