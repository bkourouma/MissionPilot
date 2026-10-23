import type { Metadata } from "next";
import type { RedRatiosVue, RedTresorerieVue } from "@missionpilot/shared";
import { EtatContexteRed } from "../../../../../../components/redressement/EtatsContexte";
import { FormulaireVersionTresorerie } from "../../../../../../components/redressement/FormulaireVersionTresorerie";
import { GraphiqueSoldes } from "../../../../../../components/redressement/GraphiqueSoldes";
import { GrilleTresorerie } from "../../../../../../components/redressement/GrilleTresorerie";
import { PointMort } from "../../../../../../components/redressement/PointMort";
import { SaisieRealise } from "../../../../../../components/redressement/SaisieRealise";
import { Alerte } from "../../../../../../components/ui/Alerte";
import { Carte } from "../../../../../../components/ui/Carte";
import { EtatErreur, EtatVide } from "../../../../../../components/ui/EtatListe";
import { Tableau } from "../../../../../../components/ui/Tableau";
import { chargerServeur } from "../../../../../../lib/api-serveur";
import {
  formaterDate,
  formaterDateHeure,
  formaterMontantMineur,
} from "../../../../../../lib/format";
import { aujourdhui as aujourdhuiIso } from "../../../../../../lib/periode";
import {
  cheminRatios,
  cheminTresorerie,
  hrefRedressement,
  LIBELLE_BESOIN_FINANCEMENT,
  raisonSansEcriture,
  TEXTE_BESOIN_FINANCEMENT,
  TEXTE_TENSION,
} from "../../../../../../lib/redressement";
import { chargerContexteRed } from "../../../../../../lib/redressement-serveur";

export const metadata: Metadata = { title: "Trésorerie à 13 semaines" };

/**
 * Trésorerie à 13 semaines (RED-11) : synthèse, grille prévu / réalisé / écart / solde retenu,
 * graphique et tableau équivalent, nouvelle version de la prévision, saisie du réalisé et point
 * mort. Tous les soldes et écarts sont ceux de l'API (moteur de trésorerie).
 */
export default async function PageTresorerie({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await chargerContexteRed(id);
  if (ctx.etat !== "ok") {
    return (
      <EtatContexteRed
        contexte={ctx}
        missionId={id}
        hrefReessayer={hrefRedressement(id, "tresorerie")}
      />
    );
  }
  const { mission, dossier, droits } = ctx;
  const devise = dossier.devise;
  const jour = aujourdhuiIso();
  const [t, ratios] = await Promise.all([
    chargerServeur<RedTresorerieVue>(cheminTresorerie(dossier.id)),
    chargerServeur<RedRatiosVue>(cheminRatios(dossier.id)),
  ]);
  const dernierExercice = ratios.ok ? ratios.donnees.exercices[0] : undefined;

  if (!t.ok) {
    return (
      <EtatErreur
        titre="La trésorerie n'a pas pu être chargée."
        message={t.message}
        hrefReessayer={hrefRedressement(id, "tresorerie")}
      />
    );
  }
  const { version, projection, realises } = t.donnees;
  const m = (v: number) => formaterMontantMineur(v, devise);
  const correctionsParSemaine = new Map(realises.map((r) => [r.semaine_debut, r.corrections]));
  const semaineParDefaut =
    projection?.semaines.find((s) => s.realise === null)?.debut ??
    projection?.semaines[0]?.debut ??
    "";

  return (
    <div className="mp-red">
      <p className="mp-texte-doux">{TEXTE_TENSION}</p>

      {version === null || projection === null ? (
        <EtatVide titre="Aucune prévision de trésorerie." icone="courbe">
          <p>
            Aucune prévision de trésorerie. Créez la première version : date de début (un lundi),
            solde bancaire initial, puis encaissements et décaissements attendus semaine par
            semaine.
          </p>
        </EtatVide>
      ) : (
        <>
          <div className="mp-red-cartes">
            <Carte titre="Solde minimum prévu" niveauTitre={3}>
              <p className="mp-red-chiffre">Semaine {projection.solde_minimum.semaine}</p>
              <p className="mp-red-valeur">{m(projection.solde_minimum.montant)}</p>
            </Carte>
            <Carte titre="Première semaine de tension" niveauTitre={3}>
              <p className="mp-red-chiffre">
                {projection.premiere_semaine_tension !== null
                  ? `Semaine ${projection.premiere_semaine_tension}`
                  : "Aucune"}
              </p>
              <p className="mp-texte-doux mp-texte-petit">
                {projection.semaines_tension.length} semaine(s) en tension sur 13.
              </p>
            </Carte>
            <Carte titre={LIBELLE_BESOIN_FINANCEMENT} niveauTitre={3}>
              <p className="mp-red-chiffre mp-red-valeur">{m(projection.besoin_financement)}</p>
              <p className="mp-texte-doux mp-texte-petit">{TEXTE_BESOIN_FINANCEMENT}</p>
            </Carte>
          </div>

          <Carte titre="Fenêtre de la prévision">
            <dl className="mp-liste-def">
              <div>
                <dt>Version courante</dt>
                <dd>
                  {version.version}, par {version.cree_par.nom} le{" "}
                  {formaterDateHeure(version.cree_le)}
                </dd>
              </div>
              <div>
                <dt>Date de début</dt>
                <dd>{formaterDate(version.date_debut)}</dd>
              </div>
              <div>
                <dt>Solde bancaire initial</dt>
                <dd className="mp-red-valeur">{m(version.solde_initial)}</dd>
              </div>
              <div>
                <dt>Seuil de tension</dt>
                <dd className="mp-red-valeur">{m(version.seuil_tension)}</dd>
              </div>
            </dl>
            {t.donnees.realises_hors_fenetre > 0 ? (
              <p className="mp-texte-doux mp-texte-petit">
                {t.donnees.realises_hors_fenetre} réalisé(s) hors de la fenêtre actuelle sont
                conservés dans l&apos;historique.
              </p>
            ) : null}
          </Carte>

          <section className="mp-red-section" aria-labelledby="titre-grille">
            <h2 id="titre-grille" className="mp-red-section__titre">
              Grille de 13 semaines
            </h2>
            <GrilleTresorerie projection={projection} devise={devise} />
          </section>

          <section className="mp-red-section" aria-labelledby="titre-graphique">
            <h2 id="titre-graphique" className="mp-red-section__titre">
              Soldes de clôture
            </h2>
            <GraphiqueSoldes
              semaines={projection.semaines}
              seuil={version.seuil_tension}
              devise={devise}
            />
          </section>
        </>
      )}

      {droits.ecrire ? (
        <>
          <Carte titre="Nouvelle version de la prévision">
            <FormulaireVersionTresorerie
              key={version?.id ?? "premiere"}
              dossierId={dossier.id}
              devise={devise}
              version={version}
              aujourdhui={jour}
            />
          </Carte>
          {projection ? (
            <Carte titre="Saisir le réalisé d'une semaine">
              <SaisieRealise
                key={realises.map((r) => r.id).join("-") || "aucun"}
                dossierId={dossier.id}
                devise={devise}
                semaines={projection.semaines.map((s) => ({
                  semaine: s.semaine,
                  debut: s.debut,
                  fin: s.fin,
                  corrections: correctionsParSemaine.get(s.debut) ?? null,
                }))}
                semaineParDefaut={semaineParDefaut}
              />
            </Carte>
          ) : null}
        </>
      ) : (
        <Alerte tonalite="info" annonce="aucune">
          <p>{raisonSansEcriture(mission, dossier, ctx.session.utilisateur.roles)}</p>
        </Alerte>
      )}

      <Carte titre="Point mort">
        <PointMort
          dossierId={dossier.id}
          devise={devise}
          chiffreAffaires={dernierExercice?.postes.chiffre_affaires ?? null}
          chargesVariables={dernierExercice?.postes.cout_ventes ?? null}
        />
      </Carte>

      {t.donnees.historique.length > 0 ? (
        <Carte titre="Historique des versions de la prévision">
          <Tableau
            legende="Versions de la prévision de trésorerie"
            colonnes={[
              {
                cle: "version",
                entete: "Version",
                rendu: (h: RedTresorerieVue["historique"][number]) => h.version,
              },
              { cle: "debut", entete: "Date de début", rendu: (h) => formaterDate(h.date_debut) },
              { cle: "auteur", entete: "Auteur", rendu: (h) => h.cree_par.nom },
              { cle: "date", entete: "Créée le", rendu: (h) => formaterDateHeure(h.cree_le) },
              { cle: "motif", entete: "Motif", rendu: (h) => h.motif ?? "—" },
            ]}
            lignes={t.donnees.historique}
            cleLigne={(h) => h.id}
          />
        </Carte>
      ) : null}
    </div>
  );
}
