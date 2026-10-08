import type { Metadata } from "next";
import {
  GrilleIndicateurs,
  ListeAlertesDerive,
} from "../../../components/indicateurs/GrilleIndicateurs";
import { TableauNiveau } from "../../../components/indicateurs/TableauNiveau";
import { Alerte } from "../../../components/ui/Alerte";
import { classesBouton } from "../../../components/ui/Bouton";
import { Carte } from "../../../components/ui/Carte";
import { Champ } from "../../../components/ui/Champ";
import { EnteteDePage } from "../../../components/ui/EnteteDePage";
import { EtatErreur } from "../../../components/ui/EtatListe";
import { Icone } from "../../../components/ui/Icone";
import { Select } from "../../../components/ui/Select";
import { chargerServeur } from "../../../lib/api-serveur";
import { formaterDate } from "../../../lib/format";
import {
  alertesDerive,
  indicateursAffiches,
  lireFiltresIndicateurs,
  NIVEAU_LIBELLES,
  OPTIONS_NIVEAUX,
  requeteIndicateurs,
  type ElementMission,
  type ReponseIndicateurs,
} from "../../../lib/indicateurs";
import { exigerPermission } from "../../../lib/session";

export const metadata: Metadata = { title: "Indicateurs du cabinet" };

export default async function PageIndicateurs({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await exigerPermission("indicateurs.cabinet");
  const f = lireFiltresIndicateurs(await searchParams);
  const requete = requeteIndicateurs(f);
  const [r, missions] = await Promise.all([
    chargerServeur<ReponseIndicateurs>(`/api/indicateurs/cabinet?${requete}`),
    f.niveau === "mission"
      ? Promise.resolve(null)
      : chargerServeur<ReponseIndicateurs>(
          `/api/indicateurs/cabinet?${requeteIndicateurs({ ...f, niveau: "mission" })}`,
        ),
  ]);
  const parMission = f.niveau === "mission" ? r : missions;

  return (
    <div className="mp-page">
      <EnteteDePage
        titre="Indicateurs du cabinet"
        soustitre="Les onze indicateurs de pilotage, calculés par le moteur à partir des temps validés, des budgets, des factures et des encaissements."
      />
      <form
        method="get"
        action="/indicateurs"
        className="mp-filtres"
        role="search"
        aria-label="Période et niveau de lecture"
      >
        <div className="mp-grille-champs mp-grille-champs--filtres">
          <Champ libelle="Du" type="date" name="du" defaultValue={f.du} required />
          <Champ
            libelle="Au"
            type="date"
            name="au"
            defaultValue={f.au}
            required
            aide="Période de 366 jours au plus."
          />
          <Select
            libelle="Niveau de lecture"
            name="niveau"
            options={OPTIONS_NIVEAUX}
            defaultValue={f.niveau}
          />
        </div>
        <div className="mp-actions-formulaire">
          <button type="submit" className={classesBouton("primaire")}>
            <Icone nom="courbe" />
            <span>Afficher</span>
          </button>
        </div>
      </form>
      {f.corrigee ? (
        <Alerte tonalite="attention" annonce="status">
          <p>
            Période invalide ou de plus de 366 jours : la période par défaut (mois en cours) est
            affichée.
          </p>
        </Alerte>
      ) : null}

      {!r.ok ? (
        <EtatErreur
          titre="Les indicateurs n'ont pas pu être calculés."
          message={r.message}
          hrefReessayer={`/indicateurs?${requete}`}
        />
      ) : (
        <>
          <section aria-labelledby="titre-cabinet" className="mp-pile">
            <h2 id="titre-cabinet" className="mp-section__titre">
              {`Cabinet du ${formaterDate(r.donnees.du)} au ${formaterDate(r.donnees.au)}`}
            </h2>
            <p className="mp-texte-doux">
              {`Montants en ${r.donnees.devise}. Jalons et feuilles évalués au ${formaterDate(r.donnees.date_reference)}. Les statuts de couleur appliquent des seuils de lecture de départ, à valider par le cabinet.`}
            </p>
            {r.donnees.missions_exclues && r.donnees.missions_exclues.length > 0 ? (
              <Alerte tonalite="attention" annonce="aucune">
                <p>
                  {`${r.donnees.missions_exclues.length} mission(s) exclue(s) des montants : taux de change non figé.`}
                </p>
              </Alerte>
            ) : null}
            <GrilleIndicateurs indicateurs={indicateursAffiches(r.donnees)} />
          </section>

          <Carte titre="Alertes de dérive" id="alertes">
            <div className="mp-pile">
              <p className="mp-texte-doux">
                Missions dont l&apos;atterrissage dépasse le budget en jours. Ouvrez le suivi pour
                voir l&apos;écart par phase, puis réallouez des jours ou demandez une révision de
                budget.
              </p>
              {parMission?.ok ? (
                <ListeAlertesDerive
                  alertes={alertesDerive(parMission.donnees.elements as ElementMission[])}
                />
              ) : (
                <p className="mp-texte-doux">Les alertes n&apos;ont pas pu être calculées.</p>
              )}
            </div>
          </Carte>

          {r.donnees.niveau !== "cabinet" ? (
            <Carte titre={`Détail par ${NIVEAU_LIBELLES[r.donnees.niveau].toLowerCase()}`}>
              <TableauNiveau reponse={r.donnees} />
            </Carte>
          ) : null}
        </>
      )}
    </div>
  );
}
