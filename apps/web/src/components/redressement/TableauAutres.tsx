import {
  RED_STATUTS_ACTION,
  type RedClotureDossierResume,
  type RedTableauCausesVue,
  type RedTableauCreanciersVue,
  type RedTableauPlanVue,
  type RedTableauSuiviVue,
} from "@missionpilot/shared";
import { formaterDate, formaterMontantMineur, type Devise } from "../../lib/format";
import { obtenirLangue, obtenirT } from "../../lib/i18n/serveur";
import { libelleStatutAction } from "../../lib/redressement";
import {
  libelleStatutClotureDossier,
  libelleNombre,
  textesTableau,
} from "../../lib/redressement-tableau";
import { BadgeStatut } from "../ui/BadgeStatut";
import { TableauListe } from "./TableauBloc";

/** Plan d'actions : répartition par statut et actions en retard (comptes fournis par l'API). */
export async function TableauPlan({ p }: { p: RedTableauPlanVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const nb = (v: number | null) => libelleNombre(v, langue);
  return (
    <TableauListe
      lignes={[
        ...RED_STATUTS_ACTION.map(
          (s) => [libelleStatutAction(s, langue), nb(p.actions_par_statut[s] ?? 0)] as const,
        ),
        [t("Actions en retard", "Overdue actions"), nb(p.en_retard)],
        [
          t("Version du plan", "Plan version"),
          p.version_courante === null
            ? t("Aucune version", "No version")
            : `Version ${nb(p.version_courante)}`,
        ],
        [
          t("Modifié depuis la validation", "Modified since approval"),
          p.modifie_depuis_validation
            ? t("Oui, à faire valider de nouveau", "Yes, to be approved again")
            : t("Non", "No"),
        ],
      ]}
    />
  );
}

/** Créanciers : nombre, encours et échu totaux (déjà additionnés par l'API). */
export async function TableauCreanciers({
  c,
  devise,
}: {
  c: RedTableauCreanciersVue;
  devise: Devise;
}) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <TableauListe
      lignes={[
        [t("Nombre de créanciers", "Number of creditors"), libelleNombre(c.nombre, langue)],
        [
          t("Encours total", "Total outstanding"),
          formaterMontantMineur(c.encours_total, devise, langue),
        ],
        [t("Dont échu", "Of which past due"), formaterMontantMineur(c.echu_total, devise, langue)],
      ]}
    />
  );
}

/** Causes racines : une proposition non validée est présentée comme telle, jamais comme acquise. */
export async function TableauCauses({ c }: { c: RedTableauCausesVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  const tx = textesTableau(langue);
  const nb = (v: number | null) => libelleNombre(v, langue);
  const validee = c.statut === "validee";
  return (
    <div className="mp-pile">
      <p>
        <BadgeStatut tonalite={validee ? "succes" : "attention"}>
          {validee
            ? t("Validée par un expert", "Approved by an expert")
            : t("Proposition à valider", "Proposal pending approval")}
        </BadgeStatut>
      </p>
      {validee ? null : <p className="mp-texte-doux">{tx.causesNonValidees}</p>}
      <TableauListe
        lignes={[
          [t("Version", "Version"), `Version ${nb(c.version)}`],
          ...(validee
            ? ([
                [
                  t("Validée le", "Approved on"),
                  c.valide_le ? formaterDate(c.valide_le, "UTC", langue) : "—",
                ],
                [t("Causes retenues", "Causes retained"), nb(c.nombre_causes)],
              ] as const)
            : []),
        ]}
      />
      {c.version_plus_recente_non_validee && validee ? (
        <p className="mp-texte-doux">{tx.causesPlusRecente}</p>
      ) : null}
    </div>
  );
}

/** Bilan de clôture : statut, version et date de validation. */
export async function TableauCloture({ c }: { c: RedClotureDossierResume }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <TableauListe
      lignes={[
        [t("Statut du bilan", "Review status"), libelleStatutClotureDossier(c.statut, langue)],
        [
          t("Version", "Version"),
          c.version === null ? "—" : `Version ${libelleNombre(c.version, langue)}`,
        ],
        [
          t("Validé le", "Approved on"),
          c.valide_le ? formaterDate(c.valide_le, "UTC", langue) : "—",
        ],
      ]}
    />
  );
}

/** Suivi après mission : nombre d'alertes et points d'attention. */
export async function TableauSuivi({ s }: { s: RedTableauSuiviVue }) {
  const t = await obtenirT();
  const langue = await obtenirLangue();
  return (
    <TableauListe
      lignes={[
        [t("Alertes de suivi", "Follow-up alerts"), libelleNombre(s.nombre, langue)],
        [
          t("Dont points d'attention", "Of which attention points"),
          libelleNombre(s.attention, langue),
        ],
      ]}
    />
  );
}
