import type {
  RedCovenantRatio,
  RedTableauCovenantsVue,
  RedTableauFinancementVue,
  RedTableauTresorerieVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import {
  formaterCouverture,
  libelleMois,
  libelleRatioCovenant,
  libelleSemainesTension,
  libelleStatutCovenant,
  libelleTypePeriodeFinancement,
  tonaliteStatutCovenant,
} from "../../lib/redressement-financement";
import { libelleNombre, textesTableau } from "../../lib/redressement-tableau";
import { BadgeStatut } from "../ui/BadgeStatut";
import { TableauListe } from "./TableauBloc";

/** Trésorerie : solde minimum, besoin, semaines de tension et synthèse mensuelle. */
export async function TableauTresorerie({
  tresorerie: tr,
  devise,
}: {
  tresorerie: RedTableauTresorerieVue;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const nb = (v: number) => libelleNombre(v, langue);
  return (
    <div className="mp-pile">
      <TableauListe
        lignes={[
          [
            t("Version du plan", "Plan version"),
            t(
              `Version ${nb(tr.version)}, début le ${formaterDate(tr.date_debut, "UTC", langue)}`,
              `Version ${nb(tr.version)}, starting ${formaterDate(tr.date_debut, "UTC", langue)}`,
            ),
          ],
          [
            t("Solde minimum prévu", "Forecast minimum balance"),
            `${m(tr.solde_minimum.montant)} (${t("semaine", "week")} ${nb(tr.solde_minimum.semaine)})`,
          ],
          [t("Besoin de financement prévu", "Forecast financing need"), m(tr.besoin_financement)],
          [
            t("Semaines de tension", "Strain weeks"),
            libelleSemainesTension(tr.semaines_tension, langue),
          ],
          [
            t("Dernière semaine réalisée", "Last realized week"),
            tr.derniere_semaine_realisee === null
              ? t("Aucune", "None")
              : `${t("Semaine", "Week")} ${nb(tr.derniere_semaine_realisee)}`,
          ],
        ]}
      />
      {tr.mensuel ? (
        <TableauListe
          lignes={[
            [
              t("Mois de tension", "Strain months"),
              tr.mensuel.mois_tension.length === 0
                ? t("Aucun", "None")
                : tr.mensuel.mois_tension.map((x) => libelleMois(x, langue)).join(", "),
            ],
            [
              t("Solde minimum mensuel", "Monthly minimum balance"),
              `${m(tr.mensuel.solde_minimum.montant)} (${libelleMois(tr.mensuel.solde_minimum.mois, langue)}, ${t("semaine", "week")} ${nb(tr.mensuel.solde_minimum.semaine)})`,
            ],
            [t("Encaissements", "Receipts"), m(tr.mensuel.totaux.encaissements)],
            [t("Décaissements", "Disbursements"), m(tr.mensuel.totaux.decaissements)],
            [t("Flux net", "Net flow"), m(tr.mensuel.totaux.flux_net)],
          ]}
        />
      ) : (
        <p className="mp-texte-doux">
          {t(
            "La synthèse mensuelle n'est pas disponible.",
            "The monthly summary is not available.",
          )}
        </p>
      )}
    </div>
  );
}

/** Covenants : constat arithmétique ratio par ratio, sans qualification juridique. */
export async function TableauCovenants({ c }: { c: RedTableauCovenantsVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const nb = (v: number) => libelleNombre(v, langue);
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">{textesTableau(langue).covenantConstat}</p>
      <TableauListe
        lignes={[
          [
            t("Version", "Version"),
            `Version ${nb(c.version)}${c.exercice === null ? "" : t(`, exercice ${c.exercice}`, `, fiscal year ${c.exercice}`)}`,
          ],
          [
            t("Respectés", "Met"),
            t(`${nb(c.respectes)} sur ${nb(c.nombre)}`, `${nb(c.respectes)} of ${nb(c.nombre)}`),
          ],
          [t("Non respectés", "Not met"), nb(c.en_defaut)],
          [t("Non calculables", "Not computable"), nb(c.non_calculables)],
        ]}
      />
      {c.covenants.length > 0 ? (
        <ul
          className="mp-tdb-motifs"
          aria-label={t("Constat par covenant", "Observation by covenant")}
        >
          {c.covenants.map((x, i) => (
            <li key={`${x.ratio}-${x.preteur ?? ""}-${i}`} className="mp-tdb-motif">
              <BadgeStatut tonalite={tonaliteStatutCovenant(x.statut)}>
                {libelleStatutCovenant(x.statut, langue)}
              </BadgeStatut>
              <span>
                {libelleRatioCovenant(x.ratio as RedCovenantRatio, langue)}
                {x.preteur ? ` — ${x.preteur}` : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Plan de financement : totaux emplois / ressources et première période insuffisante. */
export async function TableauFinancement({
  f,
  devise,
}: {
  f: RedTableauFinancementVue;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const m = (v: number) => formaterMontantMineur(v, devise, langue);
  const nb = (v: number) => libelleNombre(v, langue);
  const periodes = libelleTypePeriodeFinancement(f.type_periode, langue).toLowerCase();
  return (
    <TableauListe
      lignes={[
        [
          t("Version du plan", "Plan version"),
          t(
            `Version ${nb(f.version)}, début le ${formaterDate(f.date_debut, "UTC", langue)}, ${nb(f.nombre_periodes)} période(s) (${periodes})`,
            `Version ${nb(f.version)}, starting ${formaterDate(f.date_debut, "UTC", langue)}, ${nb(f.nombre_periodes)} period(s) (${periodes})`,
          ),
        ],
        [t("Emplois", "Uses"), m(f.totaux.emplois)],
        [t("Ressources", "Resources"), m(f.totaux.ressources)],
        [t("Solde", "Balance"), m(f.totaux.solde)],
        [t("Plan équilibré", "Balanced plan"), f.equilibre ? t("Oui", "Yes") : t("Non", "No")],
        [
          t("Couverture des emplois", "Coverage of uses"),
          formaterCouverture(f.couverture_totale_pb, langue),
        ],
        [
          t("Première période insuffisante", "First period with a shortfall"),
          f.premiere_periode_insuffisance === null
            ? t("Aucune", "None")
            : `${t("Période", "Period")} ${nb(f.premiere_periode_insuffisance)}`,
        ],
        [
          t("Insuffisance cumulée maximale", "Maximum cumulative shortfall"),
          m(f.insuffisance_maximale_cumulee),
        ],
      ]}
    />
  );
}
