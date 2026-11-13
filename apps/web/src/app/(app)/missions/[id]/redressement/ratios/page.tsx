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
import { obtenirLangue, obtenirT } from "../../../../../../lib/i18n/serveur";
import {
  cheminCorrespondances,
  cheminRatios,
  hrefFinancesClient,
  hrefRedressement,
  raisonSansEcriture,
  TEXTE_ANALYSES_INDICATIVES,
  TEXTE_ANALYSES_INDICATIVES_EN,
  TEXTE_ETATS_ABSENTS,
  TEXTE_ETATS_ABSENTS_EN,
  libellePoste,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export async function generateMetadata(): Promise<Metadata> {
  const t = await obtenirT();
  return { title: t("Ratios du redressement", "Turnaround ratios") };
}

/**
 * Ratios (RED-02) calculés par l'API sur les trois derniers exercices ACCEPTÉS du dossier client
 * (un état en revue, rejeté ou remplacé n'entre jamais dans un calcul), et correspondance de
 * postes « poste de ratio ← codes de lignes de l'état ».
 */
export default async function PageRatios({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await obtenirT();
  const langue = await obtenirLangue();
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
          texte={t(TEXTE_ANALYSES_INDICATIVES, TEXTE_ANALYSES_INDICATIVES_EN)}
          hrefFinances={hrefFinancesClient(mission.client_id)}
        />
      ) : null}

      <section className="mp-red-section" aria-labelledby="titre-ratios">
        <h2 id="titre-ratios" className="mp-red-section__titre">
          {t("Ratios", "Ratios")}
        </h2>
        {!ratios.ok ? (
          <EtatErreur
            titre={t("Les ratios n'ont pas pu être calculés.", "The ratios could not be computed.")}
            message={ratios.message}
            hrefReessayer={hrefRedressement(id, "ratios")}
          />
        ) : ratios.donnees.exercices.length === 0 ? (
          <EtatVide
            titre={t(
              "Aucun état financier accepté pour ce client.",
              "No accepted financial statement for this client.",
            )}
            icone="barres"
          >
            <p>{t(TEXTE_ETATS_ABSENTS, TEXTE_ETATS_ABSENTS_EN)}</p>
            <p>
              <Link
                href={hrefFinancesClient(mission.client_id)}
                className={classesBouton("secondaire")}
              >
                {t("Ouvrir les finances du client", "Open the client's finances")}
              </Link>
            </p>
          </EtatVide>
        ) : (
          <>
            {ratios.donnees.correspondance_version === null ? (
              <Alerte
                tonalite="attention"
                titre={t("Correspondance à renseigner", "Mapping to fill in")}
                annonce="aucune"
              >
                <p>
                  {t(
                    "Sans correspondance de postes, aucun ratio ne peut être calculé : renseignez-la ci-dessous.",
                    "Without an item mapping, no ratio can be computed: fill it in below.",
                  )}
                </p>
              </Alerte>
            ) : null}
            <TableauRatios ratios={ratios.donnees} />
          </>
        )}
      </section>

      <section className="mp-red-section" aria-labelledby="titre-correspondance">
        <h2 id="titre-correspondance" className="mp-red-section__titre">
          {t("Correspondance de postes", "Item mapping")}
        </h2>
        {!correspondances.ok ? (
          <EtatErreur
            titre={t(
              "La correspondance n'a pas pu être chargée.",
              "The mapping could not be loaded.",
            )}
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
                  {raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles, langue)}
                </p>
                {correspondances.donnees.courante ? (
                  <Tableau
                    legende={t("Correspondance de postes courante", "Current item mapping")}
                    colonnes={[
                      {
                        cle: "poste",
                        entete: t("Poste", "Item"),
                        rendu: (l: { poste: string; codes: string }) =>
                          libellePoste(l.poste, langue),
                      },
                      {
                        cle: "codes",
                        entete: t("Codes de lignes", "Line codes"),
                        rendu: (l) => l.codes,
                      },
                    ]}
                    lignes={Object.entries(correspondances.donnees.courante.postes).map(
                      ([poste, a]) => ({
                        poste,
                        codes: a.sans_objet
                          ? t("Sans objet", "Not applicable")
                          : a.codes.join(", "),
                      }),
                    )}
                    cleLigne={(l) => l.poste}
                  />
                ) : (
                  <p className="mp-texte-doux">
                    {t("Aucune correspondance enregistrée.", "No mapping recorded.")}
                  </p>
                )}
              </>
            )}
            <Tableau
              legende={t("Historique des versions de la correspondance", "Mapping version history")}
              messageVide={t("Aucune version enregistrée.", "No version recorded.")}
              colonnes={[
                {
                  cle: "version",
                  entete: t("Version", "Version"),
                  rendu: (h: RedCorrespondancesVue["historique"][number]) => h.version,
                },
                {
                  cle: "date",
                  entete: "Date",
                  rendu: (h) => formaterDateHeure(h.cree_le, undefined, langue),
                },
                { cle: "auteur", entete: t("Auteur", "Author"), rendu: (h) => h.cree_par.nom },
                { cle: "motif", entete: t("Motif", "Reason"), rendu: (h) => h.motif ?? "—" },
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
