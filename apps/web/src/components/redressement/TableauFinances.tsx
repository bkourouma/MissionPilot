import {
  RED_FINANCEMENT_TYPE_PERIODE_LIBELLES,
  type RedCovenantRatio,
  type RedTableauCovenantsVue,
  type RedTableauFinancementVue,
  type RedTableauTresorerieVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import {
  formaterCouverture,
  libelleMois,
  libelleRatioCovenant,
  libelleSemainesTension,
  libelleStatutCovenant,
  tonaliteStatutCovenant,
} from "../../lib/redressement-financement";
import { libelleNombre, TEXTE_COVENANT_CONSTAT } from "../../lib/redressement-tableau";
import { BadgeStatut } from "../ui/BadgeStatut";
import { TableauListe } from "./TableauBloc";

/** Trésorerie : solde minimum, besoin, semaines de tension et synthèse mensuelle. */
export function TableauTresorerie({ t, devise }: { t: RedTableauTresorerieVue; devise: Devise }) {
  const m = (v: number) => formaterMontantMineur(v, devise);
  return (
    <div className="mp-pile">
      <TableauListe
        lignes={[
          [
            "Version du plan",
            `Version ${libelleNombre(t.version)}, début le ${formaterDate(t.date_debut)}`,
          ],
          [
            "Solde minimum prévu",
            `${m(t.solde_minimum.montant)} (semaine ${libelleNombre(t.solde_minimum.semaine)})`,
          ],
          ["Besoin de financement prévu", m(t.besoin_financement)],
          ["Semaines de tension", libelleSemainesTension(t.semaines_tension)],
          [
            "Dernière semaine réalisée",
            t.derniere_semaine_realisee === null
              ? "Aucune"
              : `Semaine ${libelleNombre(t.derniere_semaine_realisee)}`,
          ],
        ]}
      />
      {t.mensuel ? (
        <TableauListe
          lignes={[
            [
              "Mois de tension",
              t.mensuel.mois_tension.length === 0
                ? "Aucun"
                : t.mensuel.mois_tension.map(libelleMois).join(", "),
            ],
            [
              "Solde minimum mensuel",
              `${m(t.mensuel.solde_minimum.montant)} (${libelleMois(t.mensuel.solde_minimum.mois)}, semaine ${libelleNombre(t.mensuel.solde_minimum.semaine)})`,
            ],
            ["Encaissements", m(t.mensuel.totaux.encaissements)],
            ["Décaissements", m(t.mensuel.totaux.decaissements)],
            ["Flux net", m(t.mensuel.totaux.flux_net)],
          ]}
        />
      ) : (
        <p className="mp-texte-doux">La synthèse mensuelle n&apos;est pas disponible.</p>
      )}
    </div>
  );
}

/** Covenants : constat arithmétique ratio par ratio, sans qualification juridique. */
export function TableauCovenants({ c }: { c: RedTableauCovenantsVue }) {
  return (
    <div className="mp-pile">
      <p className="mp-texte-doux">{TEXTE_COVENANT_CONSTAT}</p>
      <TableauListe
        lignes={[
          [
            "Version",
            `Version ${libelleNombre(c.version)}${c.exercice === null ? "" : `, exercice ${c.exercice}`}`,
          ],
          ["Respectés", `${libelleNombre(c.respectes)} sur ${libelleNombre(c.nombre)}`],
          ["Non respectés", libelleNombre(c.en_defaut)],
          ["Non calculables", libelleNombre(c.non_calculables)],
        ]}
      />
      {c.covenants.length > 0 ? (
        <ul className="mp-tdb-motifs" aria-label="Constat par covenant">
          {c.covenants.map((x, i) => (
            <li key={`${x.ratio}-${x.preteur ?? ""}-${i}`} className="mp-tdb-motif">
              <BadgeStatut tonalite={tonaliteStatutCovenant(x.statut)}>
                {libelleStatutCovenant(x.statut)}
              </BadgeStatut>
              <span>
                {libelleRatioCovenant(x.ratio as RedCovenantRatio)}
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
export function TableauFinancement({ f, devise }: { f: RedTableauFinancementVue; devise: Devise }) {
  const m = (v: number) => formaterMontantMineur(v, devise);
  const periodes = (
    RED_FINANCEMENT_TYPE_PERIODE_LIBELLES[f.type_periode] ?? f.type_periode
  ).toLowerCase();
  return (
    <TableauListe
      lignes={[
        [
          "Version du plan",
          `Version ${libelleNombre(f.version)}, début le ${formaterDate(f.date_debut)}, ${libelleNombre(f.nombre_periodes)} période(s) (${periodes})`,
        ],
        ["Emplois", m(f.totaux.emplois)],
        ["Ressources", m(f.totaux.ressources)],
        ["Solde", m(f.totaux.solde)],
        ["Plan équilibré", f.equilibre ? "Oui" : "Non"],
        ["Couverture des emplois", formaterCouverture(f.couverture_totale_pb)],
        [
          "Première période insuffisante",
          f.premiere_periode_insuffisance === null
            ? "Aucune"
            : `Période ${libelleNombre(f.premiere_periode_insuffisance)}`,
        ],
        ["Insuffisance cumulée maximale", m(f.insuffisance_maximale_cumulee)],
      ]}
    />
  );
}
